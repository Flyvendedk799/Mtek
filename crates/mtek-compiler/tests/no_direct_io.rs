//! The compiler library performs no I/O of its own: files are read through the
//! `Fs` trait only (`spec/compiler-architecture.md` sections 1 and 4.1), which
//! keeps the library testable with an in-memory file system, usable for the
//! language server's unsaved buffers and independent of the host operating
//! system. This guard fails if library code names the standard file-system,
//! environment, process or network modules.

use std::fs;
use std::path::{Path, PathBuf};

/// Module paths that mean direct I/O or dependence on the process environment.
const FORBIDDEN: [&str; 4] = ["std::fs", "std::env", "std::net", "std::process"];

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<PathBuf> = read.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

/// `(line number, line)` of every line that names a forbidden module,
/// ignoring comments.
fn violations(source: &str) -> Vec<(usize, String)> {
    source
        .lines()
        .enumerate()
        .filter(|(_, line)| {
            let code = line.split("//").next().unwrap_or_default();
            FORBIDDEN.iter().any(|word| code.contains(word))
        })
        .map(|(index, line)| (index + 1, line.trim().to_owned()))
        .collect()
}

#[test]
fn library_sources_use_no_direct_file_system_access() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    rust_files(&src, &mut files);
    assert!(
        files.iter().any(|f| f.ends_with("project/load.rs")),
        "the guard must cover src/project/ (found {files:?})"
    );
    let mut report = Vec::new();
    for path in &files {
        let source = fs::read_to_string(path).unwrap_or_default();
        for (line_number, line) in violations(&source) {
            report.push(format!("{}:{line_number}: {line}", path.display()));
        }
    }
    assert!(
        report.is_empty(),
        "mtek-compiler must read files only through the Fs trait:\n{}",
        report.join("\n")
    );
}

#[test]
fn the_guard_recognises_violations() {
    assert_eq!(violations("let _ = std::fs::read(p);").len(), 1);
    assert_eq!(violations("use std::env;").len(), 1);
    assert!(violations("let x = 1; // std::fs is only mentioned in a comment").is_empty());
    assert!(violations("use crate::source::Fs;").is_empty());
}
