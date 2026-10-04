//! The temporary M1 `Unlit` path of decision 0013 is gone (decision 0044): the built-in
//! materials are compiled from the embedded prelude source, and no file or symbol named after
//! the temporary module remains in the code, tests, scripts, tools or the normative
//! specification.
//!
//! Searched: `crates/`, `packages/`, `tests/`, `scripts/`, `tools/` and the specification
//! documents `spec/*.md` (file names and text), skipping build output and dependencies
//! (`target/`, `node_modules/`, `dist/`, `.git/`). Not searched: `benchmarks/` (never read
//! by tests), the decision records `spec/decisions/` and the milestone evidence `evidence/`,
//! which are history and describe the path as it was.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

/// The name of the deleted module, spelt in two halves so this file does not contain it.
fn needle() -> String {
    ["builtin", "unlit"].join("_")
}

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

const SKIPPED_DIRECTORIES: [&str; 4] = ["target", "node_modules", "dist", ".git"];

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if path.is_dir() {
            if !SKIPPED_DIRECTORIES.contains(&name) {
                walk(&path, out);
            }
        } else {
            out.push(path);
        }
    }
}

fn searched_files() -> Vec<PathBuf> {
    let root = repo();
    let mut files = Vec::new();
    for dir in ["crates", "packages", "tests", "scripts", "tools"] {
        walk(&root.join(dir), &mut files);
    }
    let mut spec: Vec<PathBuf> = fs::read_dir(root.join("spec"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e == "md"))
        .collect();
    spec.sort();
    files.extend(spec);
    files
}

#[test]
fn no_file_or_symbol_of_the_temporary_unlit_path_remains() {
    let needle = needle();
    let files = searched_files();
    assert!(
        files
            .iter()
            .any(|f| f.ends_with("crates/mtek-compiler/src/lowering/shader.rs")),
        "the search must cover the compiler sources"
    );
    assert!(
        files.iter().any(|f| f.ends_with("spec/materials.md")),
        "the search must cover the specification"
    );
    let mut found = Vec::new();
    for path in &files {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if name.contains(&needle) {
            found.push(format!("{}: file name", path.display()));
        }
        // Binary files are not text and cannot name a symbol.
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        for (index, line) in text.lines().enumerate() {
            if line.contains(&needle) {
                found.push(format!("{}:{}: {}", path.display(), index + 1, line.trim()));
            }
        }
    }
    assert!(found.is_empty(), "{}", found.join("\n"));
}

#[test]
fn the_built_in_materials_come_from_the_embedded_prelude_source() {
    let text =
        fs::read_to_string(repo().join("crates/mtek-compiler/src/stdlib/std/materials.mtek"))
            .unwrap()
            .replace("\r\n", "\n");
    assert_eq!(
        mtek_compiler::prelude::materials_text().map(|t| t.replace("\r\n", "\n")),
        Some(text)
    );
    assert!(
        !repo()
            .join(format!("crates/mtek-compiler/src/lowering/{}.rs", needle()))
            .exists()
    );
}
