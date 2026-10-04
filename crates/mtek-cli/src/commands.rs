//! The commands: thin over the compiler library (`spec/compiler-architecture.md` section 4.12).
//!
//! [`execute`] runs one [`Request`] and returns its [`Outcome`] — the text for stdout and for
//! stderr and the exit code — without printing anything, so that the whole command runs inside
//! the panic guard and output is written once, at the end (`spec/tooling.md` section 1):
//!
//! * `--format json`: exactly one JSON document on stdout (the report of
//!   `spec/diagnostics.md` section 2.2, or the inspection), nothing else on stdout;
//! * `--format human`: diagnostics on stderr (colour only when enabled), the result line or
//!   the inspection on stdout;
//! * exit code `0` success (warnings allowed), `1` the program has errors, `2` an `--out` that
//!   would replace the project, `3` an internal error (`E9999`) or a failure to write the build
//!   output (`E9031`). Other usage errors are found by the argument parser.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use mtek_compiler::diagnostics::{
    Code, Diagnostic, Diagnostics, Phase, RenderOptions, Report, Severity, Summary, render_report,
    to_pretty_string, to_report,
};
use mtek_compiler::project::{PROJECT_FILE, ProjectRoot};
use mtek_compiler::source::{Fs as _, FsError, ProjectPath, SourceMap};
use mtek_compiler::{
    BuildMode, CompileOptions, Inspect, InspectFormat, TargetProfile, build, check, inspect,
};

use crate::args::{Format, Request};
use crate::dist;
use crate::real_fs::RealFs;
use crate::runtime::Runtime;

/// Exit code: success (warnings allowed).
pub const EXIT_OK: u8 = 0;
/// Exit code: the program has errors.
pub const EXIT_ERRORS: u8 = 1;
/// Exit code: a usage error (bad arguments).
pub const EXIT_USAGE: u8 = 2;
/// Exit code: an internal error (`E9999`) or an I/O failure.
pub const EXIT_INTERNAL: u8 = 3;

/// What a command produced.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub stdout: String,
    pub stderr: String,
    pub code: u8,
}

impl Outcome {
    /// Success with `text` on stdout.
    pub fn stdout(text: impl Into<String>) -> Self {
        Self {
            stdout: text.into(),
            ..Self::default()
        }
    }
}

/// Everything a command needs from its environment.
#[derive(Clone, Debug)]
pub struct Context {
    /// The working directory: relative `PATH` arguments start here.
    pub cwd: PathBuf,
    /// Colour the human diagnostics.
    pub color: bool,
    /// The runtime bundle compiled into the binary, if any.
    pub runtime: Option<Runtime>,
}

/// Whether human diagnostics are coloured: only on a terminal and only while `NO_COLOR` is
/// unset (`spec/diagnostics.md` section 4).
pub fn color_enabled(is_terminal: bool, no_color: Option<&std::ffi::OsStr>) -> bool {
    is_terminal && no_color.is_none()
}

/// The exit code of a finished report.
pub fn exit_code(report: &Report) -> u8 {
    if report
        .diagnostics
        .iter()
        .any(|d| matches!(d.code, Code::E9999 | Code::E9031))
    {
        EXIT_INTERNAL
    } else if report.summary.errors > 0 {
        EXIT_ERRORS
    } else {
        EXIT_OK
    }
}

/// "2 errors, 1 warning".
fn counts(summary: &Summary) -> String {
    fn count(n: usize, word: &str) -> String {
        if n == 1 {
            format!("1 {word}")
        } else {
            format!("{n} {word}s")
        }
    }
    format!(
        "{}, {}",
        count(summary.errors, "error"),
        count(summary.warnings, "warning")
    )
}

/// How a command prints diagnostics.
#[derive(Clone, Copy, Debug)]
struct Printer {
    verb: &'static str,
    format: Format,
    color: bool,
}

impl Printer {
    fn human(&self, report: &Report, sources: &SourceMap) -> String {
        render_report(report, sources, RenderOptions { color: self.color })
    }

    /// The outcome of a command whose result is its report: the JSON report, or the human
    /// diagnostics followed by `success` (stdout, exit code 0) or a failure line (stderr).
    fn report(
        &self,
        project: Option<&str>,
        sources: &SourceMap,
        report: &Report,
        success: impl FnOnce() -> String,
    ) -> Outcome {
        let code = exit_code(report);
        match self.format {
            Format::Json => Outcome {
                stdout: format!(
                    "{}\n",
                    to_pretty_string(&to_report(report, project, sources))
                ),
                stderr: String::new(),
                code,
            },
            Format::Human => {
                let mut stderr = self.human(report, sources);
                let mut stdout = String::new();
                if code == EXIT_OK {
                    stdout = format!("{}\n", success());
                } else {
                    stderr.push_str(&format!(
                        "{} failed: {}\n",
                        self.verb,
                        counts(&report.summary)
                    ));
                }
                Outcome {
                    stdout,
                    stderr,
                    code,
                }
            }
        }
    }

    /// A report that consists of `diagnostic` alone (no project could be read).
    fn single(&self, diagnostic: Diagnostic) -> Outcome {
        let mut sink = Diagnostics::new();
        sink.push(diagnostic);
        self.report(None, &SourceMap::new(), &sink.finish(), String::new)
    }
}

/// The `E9999` of a compiler defect (a panic, or a result that cannot happen).
pub fn internal_diagnostic(note: &str) -> Diagnostic {
    Diagnostic::new(
        Code::E9999,
        "The compiler stopped because of an internal error; this is a compiler bug.",
    )
    .note(note)
    .help("please report it with the program that caused it and this message")
}

/// The outcome of a panic in the command `verb` (exit code 3).
pub fn internal_error(verb: &'static str, format: Format, color: bool, note: &str) -> Outcome {
    Printer {
        verb,
        format,
        color,
    }
    .single(internal_diagnostic(note))
}

/// `path` made absolute against `cwd`, with `.` and `..` resolved lexically.
fn absolute(cwd: &Path, path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in cwd.join(path).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// The project directory for the `PATH` argument: the nearest directory at or above it that
/// contains `mtek.toml` (`spec/tooling.md` section 1). A file argument starts at its directory.
fn locate_project(cwd: &Path, path: Option<&Path>) -> Result<PathBuf, Box<Diagnostic>> {
    let project_file = ProjectPath::new(PROJECT_FILE).map_err(|error| {
        Box::new(internal_diagnostic(&format!(
            "invalid project file name: {error}"
        )))
    })?;
    let start = absolute(cwd, path.unwrap_or(Path::new(".")));
    let start = if start.is_file() {
        start.parent().map(Path::to_path_buf).unwrap_or(start)
    } else {
        start
    };
    for dir in start.ancestors() {
        match RealFs::new(dir).read(&project_file) {
            Ok(_) => return Ok(dir.to_path_buf()),
            Err(FsError::NotFound(_) | FsError::IsADirectory(_) | FsError::NotADirectory(_)) => {}
            Err(error @ FsError::Other { .. }) => {
                return Err(Box::new(ProjectRoot::unreadable(&error)));
            }
        }
    }
    let place = match path {
        None => "the current directory".to_owned(),
        Some(path) => format!("'{}'", path.display()),
    };
    Err(Box::new(ProjectRoot::not_found(&place)))
}

/// Run `request` (any request but `--version` and `--help`).
pub fn execute(request: &Request, context: &Context) -> Outcome {
    let printer = Printer {
        verb: request.verb(),
        format: request.format(),
        color: context.color,
    };
    let path = match request {
        Request::Check { path, .. }
        | Request::Build { path, .. }
        | Request::InspectIr { path, .. } => path.as_deref(),
        Request::Version | Request::Help(_) => {
            return printer.single(internal_diagnostic(
                "--version and --help are answered before any command runs",
            ));
        }
    };
    let dir = match locate_project(&context.cwd, path) {
        Ok(dir) => dir,
        Err(diagnostic) => return printer.single(*diagnostic),
    };
    let fs = RealFs::new(&dir);
    let root = ProjectRoot::at_base();
    match request {
        Request::InspectIr { format, .. } => inspect_ir(&printer, &root, &fs, *format),
        Request::Build { mode, out, .. } => {
            let project = Located { dir: &dir, fs: &fs };
            build_project(&printer, context, &project, *mode, out.as_deref())
        }
        _ => {
            let result = check(&root, &fs);
            let name = result.project_name.as_deref();
            printer.report(name, &result.sources, &result.report, || {
                format!(
                    "checked '{}': {}",
                    name.unwrap_or_default(),
                    counts(&result.report.summary)
                )
            })
        }
    }
}

/// A project found on disk.
struct Located<'a> {
    /// The project directory (absolute).
    dir: &'a Path,
    /// The file system rooted at it.
    fs: &'a RealFs,
}

/// The `--mode` spelling of `mode`.
fn mode_name(mode: BuildMode) -> &'static str {
    match mode {
        BuildMode::Release => "release",
        BuildMode::Dev => "dev",
        BuildMode::Test => "test",
        BuildMode::Preview => "preview",
    }
}

/// `mtek build`: compile, then write the file set with replace-on-success
/// (`spec/runtime-abi.md` section 2) into `--out` (relative to the working directory) or
/// `build.out_dir` (relative to the project).
fn build_project(
    printer: &Printer,
    context: &Context,
    project: &Located<'_>,
    mode: BuildMode,
    out: Option<&Path>,
) -> Outcome {
    let options = CompileOptions {
        profile: TargetProfile::WebGpuCore2026,
        mode,
        runtime_bundle: context.runtime.map(|runtime| Arc::from(runtime.bundle)),
        runtime_declarations: context
            .runtime
            .map(|runtime| Arc::from(runtime.declarations)),
    };
    let result = build(&ProjectRoot::at_base(), project.fs, &options);
    let name = result.project_name.as_deref();
    if result.has_errors() {
        return printer.report(name, &result.sources, &result.report, String::new);
    }
    let (Some(build_id), Some(out_dir)) = (&result.build_id, &result.out_dir) else {
        return printer.single(internal_diagnostic(
            "a build without errors has no build id or output directory",
        ));
    };
    let (target, shown) = match out {
        Some(out) => (absolute(&context.cwd, out), out.display().to_string()),
        None => (
            out_dir
                .segments()
                .fold(project.dir.to_path_buf(), |path, segment| {
                    path.join(segment)
                }),
            out_dir.as_str().to_owned(),
        ),
    };
    if let Some(problem) = replaces_project(&target, project.dir, &result.sources) {
        return Outcome {
            stdout: String::new(),
            stderr: format!(
                "error: the output directory '{shown}' {problem}; the build would replace it\n"
            ),
            code: EXIT_USAGE,
        };
    }
    match dist::write_dist(&target, build_id, &result.files) {
        Ok(()) => printer.report(name, &result.sources, &result.report, || {
            format!(
                "built '{}' ({}): {} files in {shown}, build {}; {}",
                name.unwrap_or_default(),
                mode_name(mode),
                result.files.len(),
                build_id.get(..16).unwrap_or(build_id),
                counts(&result.report.summary)
            )
        }),
        Err(error) => {
            let report = with_diagnostic(&result.report, write_failed(&shown, &error));
            printer.report(name, &result.sources, &report, String::new)
        }
    }
}

/// Why writing to `target` would destroy the project (it is the project directory, contains
/// it, or contains one of its source files), or `None`. Paths are compared as given and, when
/// the output directory exists, canonicalised (case and links resolved).
fn replaces_project(target: &Path, dir: &Path, sources: &SourceMap) -> Option<String> {
    let canonical = |path: &Path| std::fs::canonicalize(path).ok();
    let pairs = [
        Some((target.to_path_buf(), dir.to_path_buf())),
        canonical(target).zip(canonical(dir)),
    ];
    for (target, dir) in pairs.into_iter().flatten() {
        if dir.starts_with(&target) {
            return Some("is the project directory or contains it".to_owned());
        }
        for file in sources.files() {
            let path = file
                .path()
                .segments()
                .fold(dir.clone(), |path, segment| path.join(segment));
            if path.starts_with(&target) && path.is_file() {
                return Some(format!("contains the source file '{}'", file.path()));
            }
        }
    }
    None
}

/// The `E9031` of a build output that could not be written.
fn write_failed(shown: &str, error: &std::io::Error) -> Diagnostic {
    Diagnostic::new(
        Code::E9031,
        format!("Could not write the build output to '{shown}' ({error})."),
    )
    .phase(Phase::Emit)
    .note("the previous output, if there was one, is left in place")
    .help("check that the output directory and its parent directory are writable")
}

/// `report` with `diagnostic` (which has no location) added after the other diagnostics
/// without a location, keeping the report order of `spec/diagnostics.md` section 2.2.
fn with_diagnostic(report: &Report, diagnostic: Diagnostic) -> Report {
    let mut report = report.clone();
    match diagnostic.severity {
        Severity::Error => report.summary.errors += 1,
        Severity::Warning => report.summary.warnings += 1,
        Severity::Note => report.summary.notes += 1,
    }
    let at = report
        .diagnostics
        .iter()
        .take_while(|d| d.primary.is_none())
        .count();
    report.diagnostics.insert(at, diagnostic);
    report
}

/// `mtek inspect --ir`: the IR on stdout; with errors, the report instead.
fn inspect_ir(printer: &Printer, root: &ProjectRoot, fs: &RealFs, format: Format) -> Outcome {
    let result = inspect(root, fs, Inspect::Ir);
    if result.has_errors() {
        let name = result.project_name.as_deref();
        return printer.report(name, &result.sources, &result.report, String::new);
    }
    let format = match format {
        Format::Human => InspectFormat::Human,
        Format::Json => InspectFormat::Json,
    };
    match result.render(format) {
        Some(text) => Outcome {
            stdout: text,
            // Warnings have no place in the IR document; they go to stderr in both formats.
            stderr: printer.human(&result.report, &result.sources),
            code: EXIT_OK,
        },
        None => printer.single(internal_diagnostic(
            "inspect produced no IR for a program without errors",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn colour_needs_a_terminal_and_no_no_color() {
        assert!(color_enabled(true, None));
        assert!(!color_enabled(false, None));
        assert!(!color_enabled(true, Some(OsStr::new("1"))));
        assert!(
            !color_enabled(true, Some(OsStr::new(""))),
            "NO_COLOR set at all, even empty, disables colour"
        );
    }

    #[test]
    fn exit_codes_follow_the_report() {
        let finish = |diagnostics: Vec<Diagnostic>| {
            let mut sink = Diagnostics::new();
            sink.extend(diagnostics);
            sink.finish()
        };
        assert_eq!(exit_code(&finish(vec![])), EXIT_OK);
        assert_eq!(
            exit_code(&finish(vec![Diagnostic::new(Code::W0007, "w")])),
            EXIT_OK
        );
        assert_eq!(
            exit_code(&finish(vec![Diagnostic::new(Code::E9004, "e")])),
            EXIT_ERRORS
        );
        assert_eq!(
            exit_code(&finish(vec![
                Diagnostic::new(Code::E9004, "e"),
                internal_diagnostic("x")
            ])),
            EXIT_INTERNAL
        );
    }

    #[test]
    fn counts_are_pluralised() {
        let summary = |errors, warnings| Summary {
            errors,
            warnings,
            ..Summary::default()
        };
        assert_eq!(counts(&summary(0, 0)), "0 errors, 0 warnings");
        assert_eq!(counts(&summary(1, 1)), "1 error, 1 warning");
        assert_eq!(counts(&summary(2, 3)), "2 errors, 3 warnings");
    }

    #[test]
    fn paths_are_made_absolute_lexically() {
        let cwd = std::env::temp_dir().join("a").join("b");
        assert_eq!(absolute(&cwd, Path::new(".")), cwd);
        assert_eq!(
            absolute(&cwd, Path::new("../c/./d")),
            std::env::temp_dir().join("a").join("c").join("d")
        );
        let elsewhere = std::env::temp_dir().join("x");
        assert_eq!(absolute(&cwd, &elsewhere), elsewhere);
    }

    #[test]
    fn a_panic_becomes_e9999_in_both_formats() {
        // The path `main` takes: the guarded job panics, the panic text becomes the note.
        let panic = crate::guard::run_guarded(|| -> Outcome { panic!("boom") }).unwrap_err();
        let outcome = internal_error("check", Format::Json, false, &panic);
        assert_eq!(outcome.code, EXIT_INTERNAL);
        assert!(outcome.stderr.is_empty());
        assert!(outcome.stdout.contains("\"MTEK-E9999\""));
        assert!(outcome.stdout.contains("boom"));
        let outcome = internal_error("check", Format::Human, false, "boom");
        assert_eq!(outcome.code, EXIT_INTERNAL);
        assert!(outcome.stdout.is_empty());
        assert!(
            outcome.stderr.starts_with("error[MTEK-E9999]"),
            "{}",
            outcome.stderr
        );
        assert!(outcome.stderr.contains("= note: boom"));
        assert!(
            outcome
                .stderr
                .ends_with("check failed: 1 error, 0 warnings\n")
        );
    }

    #[test]
    fn a_write_failure_is_e9031_after_the_unlocated_diagnostics_and_exits_3() {
        use mtek_compiler::source::{FileId, Span};
        let mut sink = Diagnostics::new();
        sink.push(Diagnostic::new(Code::W0007, "located").at(Span {
            file: FileId(0),
            start: 1,
            end: 2,
        }));
        sink.push(Diagnostic::new(Code::W9003, "unlocated"));
        let report = sink.finish();
        let error = std::io::Error::other("disk full");
        let report = with_diagnostic(&report, write_failed("out/web", &error));
        let order: Vec<Code> = report.diagnostics.iter().map(|d| d.code).collect();
        assert_eq!(order, [Code::W9003, Code::E9031, Code::W0007]);
        assert_eq!(report.summary.errors, 1);
        assert_eq!(report.summary.warnings, 2);
        assert_eq!(exit_code(&report), EXIT_INTERNAL);
        let e9031 = &report.diagnostics[1];
        assert_eq!(
            e9031.message,
            "Could not write the build output to 'out/web' (disk full)."
        );
        assert_eq!(e9031.phase, Phase::Emit);
    }
}
