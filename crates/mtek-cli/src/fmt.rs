//! `mtek fmt [--check] [PATHS…]`: the canonical formatter (`spec/tooling.md` section 5,
//! decision 0070).
//!
//! Every `.mtek` file below the given paths (the working directory if there are none) is
//! formatted in place, or only compared with its canonical text with `--check`. A file that
//! does not parse is never rewritten: its diagnostics are reported and the exit code is 1.
//! The compiler library formats text (`mtek_compiler::format`); this module finds the files,
//! reads and writes them and reports.
//!
//! * `0`: every file is canonical (`--check`), or was formatted, and none has errors;
//! * `1`: `--check` found files that are not canonical (listed on stdout), or a file has syntax
//!   errors;
//! * `3`: a file or directory could not be read or written, or the formatter has a defect
//!   (`E9999`, the file is left as it was).

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use mtek_compiler::diagnostics::{Diagnostics, RenderOptions, render_report};
use mtek_compiler::format::format_text;
use mtek_compiler::source::{ProjectPath, SourceMap};

use crate::commands::{
    Context, EXIT_ERRORS, EXIT_INTERNAL, EXIT_OK, Outcome, absolute, counts, exit_code,
};

/// Directories that are not searched for sources: dependencies and build output.
fn skipped_directory(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist")
}

/// What `mtek fmt` found out about its arguments and files, and what it did.
#[derive(Default)]
struct Run {
    /// Files that are not canonical (`--check`) or were rewritten, as shown to the user.
    changed: Vec<String>,
    /// Files that were already canonical.
    unchanged: usize,
    /// Files refused because they do not parse.
    refused: usize,
    /// Reading, writing or finding files failed: one line each.
    io_errors: Vec<String>,
}

/// Every file `path` names: the file itself, or the `.mtek` files below a directory, in
/// order. Problems go to `run`.
fn find_files(path: &Path, shown: &str, out: &mut Vec<PathBuf>, run: &mut Run) {
    match fs::metadata(path) {
        Ok(meta) if meta.is_file() => out.push(path.to_path_buf()),
        Ok(meta) if meta.is_dir() => walk(path, out, run),
        Ok(_) => run
            .io_errors
            .push(format!("'{shown}' is neither a file nor a directory")),
        Err(error) => run
            .io_errors
            .push(format!("cannot read '{shown}': {error}")),
    }
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, run: &mut Run) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            run.io_errors
                .push(format!("cannot read '{}': {error}", dir.display()));
            return;
        }
    };
    let mut paths: Vec<(PathBuf, bool)> = Vec::new();
    for entry in entries.flatten() {
        // Links are not followed: a link to a directory could loop.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if kind.is_dir() && !skipped_directory(&name) {
            paths.push((entry.path(), true));
        } else if kind.is_file() && name.ends_with(".mtek") {
            paths.push((entry.path(), false));
        }
    }
    paths.sort();
    for (path, is_dir) in paths {
        if is_dir {
            walk(&path, out, run);
        } else {
            out.push(path);
        }
    }
}

/// The path as the user sees it: relative to the working directory when the file is inside
/// it, with `/` separators.
fn shown_path(cwd: &Path, path: &Path) -> String {
    match path.strip_prefix(cwd) {
        Ok(relative) => normal_segments(relative).join("/"),
        Err(_) => path.to_string_lossy().replace('\\', "/"),
    }
}

/// The named parts of `path`: no drive, no root, no `.` and no `..`.
fn normal_segments(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

/// The name of the file in the diagnostics: its path below the working directory, or, for a
/// file outside it, the path without its drive; a stand-in if that is not a valid project
/// path.
fn project_path(cwd: &Path, path: &Path, index: usize) -> ProjectPath {
    let relative = path.strip_prefix(cwd).unwrap_or(path);
    ProjectPath::new(&normal_segments(relative).join("/"))
        .or_else(|_| ProjectPath::new(&format!("file-{index}.mtek")))
        .unwrap_or_else(|_| ProjectPath::root())
}

/// Replace the file with `text`: written next to it and renamed over it, so that a crash
/// leaves the old file or the new one.
fn write_file(path: &Path, text: &str) -> io::Result<()> {
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".fmt-tmp");
    let temporary = PathBuf::from(temporary);
    fs::write(&temporary, text)?;
    fs::rename(&temporary, path).inspect_err(|_| {
        // Nothing more can be done if the clean-up fails too.
        let _ = fs::remove_file(&temporary);
    })
}

/// Run `mtek fmt`.
pub fn run(check: bool, paths: &[PathBuf], context: &Context) -> Outcome {
    let mut run = Run::default();
    let mut files: Vec<PathBuf> = Vec::new();
    if paths.is_empty() {
        find_files(&context.cwd, ".", &mut files, &mut run);
    }
    for path in paths {
        let path_shown = path.display().to_string();
        find_files(&absolute(&context.cwd, path), &path_shown, &mut files, &mut run);
    }
    files.sort();
    files.dedup();

    let mut sources = SourceMap::new();
    let mut sink = Diagnostics::new();
    let mut listing = String::new();
    for (index, path) in files.iter().enumerate() {
        let shown = shown_path(&context.cwd, path);
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) => {
                run.io_errors
                    .push(format!("cannot read '{shown}': {error}"));
                continue;
            }
        };
        let id = match sources.add(project_path(&context.cwd, path, index), &bytes) {
            Ok(id) => id,
            Err(error) => {
                sink.push(mtek_compiler::diagnostics::Diagnostic::from_source_error(
                    &error,
                ));
                run.refused += 1;
                continue;
            }
        };
        let Some(file) = sources.get(id) else {
            continue;
        };
        match format_text(id, file.text()) {
            Err(diagnostics) => {
                sink.extend(diagnostics);
                run.refused += 1;
            }
            Ok(formatted) if formatted == file.text() => run.unchanged += 1,
            Ok(formatted) => {
                if check {
                    listing.push_str(&format!("would reformat {shown}\n"));
                } else if let Err(error) = write_file(path, &formatted) {
                    run.io_errors
                        .push(format!("cannot write '{shown}': {error}"));
                    continue;
                } else {
                    listing.push_str(&format!("formatted {shown}\n"));
                }
                run.changed.push(shown);
            }
        }
    }
    finish(check, files.len(), run, sink, &sources, context, listing)
}

/// The outcome: the listing and the summary, the diagnostics, the exit code.
fn finish(
    check: bool,
    total: usize,
    run: Run,
    sink: Diagnostics,
    sources: &SourceMap,
    context: &Context,
    listing: String,
) -> Outcome {
    let report = sink.finish();
    let mut stderr = render_report(&report, sources, RenderOptions { color: context.color });
    for line in &run.io_errors {
        stderr.push_str(&format!("error: {line}\n"));
    }
    let mut code = exit_code(&report);
    if !run.io_errors.is_empty() {
        code = EXIT_INTERNAL;
    }
    if code == EXIT_OK && check && !run.changed.is_empty() {
        code = EXIT_ERRORS;
    }
    let changed = run.changed.len();
    let noun = |n: usize| if n == 1 { "file" } else { "files" };
    let mut stdout = listing;
    if code == EXIT_OK {
        let summary = match (check, changed) {
            (true, _) => format!("checked {total} {}: all formatted", noun(total)),
            (false, 0) => format!("{total} {} already formatted", noun(total)),
            (false, _) => format!(
                "formatted {changed} of {total} {}",
                noun(total)
            ),
        };
        stdout.push_str(&summary);
        stdout.push('\n');
    } else {
        let mut problems = Vec::new();
        if check && changed > 0 {
            problems.push(format!(
                "{changed} of {total} {} would be reformatted (run `mtek fmt` to format them)",
                noun(total)
            ));
        }
        if report.summary.errors > 0 {
            problems.push(format!(
                "{} {} not formatted: {}",
                run.refused,
                noun(run.refused),
                counts(&report.summary)
            ));
        }
        if !run.io_errors.is_empty() {
            let n = run.io_errors.len();
            problems.push(format!("{n} I/O {}", if n == 1 { "error" } else { "errors" }));
        }
        stderr.push_str(&format!(
            "fmt {}failed: {}\n",
            if check { "--check " } else { "" },
            problems.join("; ")
        ));
    }
    Outcome {
        stdout,
        stderr,
        code,
    }
}
