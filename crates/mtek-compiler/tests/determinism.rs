//! Determinism guard (`spec/compiler-architecture.md` section 5, `spec/testing.md` section 7).
//!
//! Hash-map iteration order must never influence generated output. The modules that produce
//! output (`layout`, `emit_*`, `package`, `plan`, and the typed IR in `ir` and `inspect`)
//! therefore may not use `HashMap` or `HashSet` at all: use `BTreeMap`, `IndexMap` or a `Vec`
//! sorted by a total key.

use std::fs;
use std::path::{Path, PathBuf};

const FORBIDDEN: [&str; 2] = ["HashMap", "HashSet"];

/// Top-level entries of `src/` (directory names or file stems) that are guarded.
fn is_guarded(stem: &str) -> bool {
    matches!(stem, "layout" | "package" | "plan" | "ir" | "inspect") || stem.starts_with("emit_")
}

/// Every `.rs` file below `dir`, in sorted order.
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

/// Lines of `source` that mention a forbidden collection, as `(line number, line)`.
fn violations(source: &str) -> Vec<(usize, String)> {
    source
        .lines()
        .enumerate()
        .filter(|(_, line)| FORBIDDEN.iter().any(|word| line.contains(word)))
        .map(|(index, line)| (index + 1, line.trim().to_owned()))
        .collect()
}

/// Guarded source files below `src/`, as paths relative to `src/`.
fn guarded_files() -> Vec<PathBuf> {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut all = Vec::new();
    rust_files(&src, &mut all);
    all.into_iter()
        .filter_map(|path| {
            let relative = path.strip_prefix(&src).ok()?.to_path_buf();
            let first = relative.components().next()?;
            let stem = Path::new(first.as_os_str())
                .file_stem()?
                .to_str()?
                .to_owned();
            is_guarded(&stem).then_some(relative)
        })
        .collect()
}

#[test]
fn no_hash_collections_in_output_producing_modules() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let files = guarded_files();
    assert!(
        files.iter().any(|f| f.starts_with("layout")),
        "the guard must at least cover src/layout/ (found {files:?})"
    );
    let mut report = Vec::new();
    for relative in &files {
        let source = fs::read_to_string(src.join(relative)).unwrap_or_default();
        for (line_number, line) in violations(&source) {
            report.push(format!("src/{}:{line_number}: {line}", relative.display()));
        }
    }
    assert!(
        report.is_empty(),
        "HashMap/HashSet is forbidden in layout/, emit_*, package/, plan/, ir/ and inspect \
         (spec/compiler-architecture.md section 5):\n{}",
        report.join("\n")
    );
}

#[test]
fn the_scanner_detects_forbidden_collections() {
    let sample =
        "use std::collections::BTreeMap;\nuse std::collections::HashMap;\nlet s: HashSet<u32>;\n";
    let found = violations(sample);
    assert_eq!(
        found,
        vec![
            (2, "use std::collections::HashMap;".to_owned()),
            (3, "let s: HashSet<u32>;".to_owned())
        ]
    );
    assert!(violations("use std::collections::BTreeMap;").is_empty());
}

#[test]
fn guarded_module_names() {
    for name in [
        "layout",
        "package",
        "plan",
        "ir",
        "inspect",
        "emit_wgsl",
        "emit_js",
    ] {
        assert!(is_guarded(name), "{name}");
    }
    for name in ["lib", "check", "emit", "layouts"] {
        assert!(!is_guarded(name), "{name}");
    }
}
