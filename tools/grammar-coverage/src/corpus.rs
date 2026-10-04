//! Reading the [`Corpus`] from the repository:
//!
//! * `spec/grammar.ebnf`;
//! * `tests/syntax/pass/*.mtek`, the positive fixtures;
//! * `tests/syntax/fail/<name>.mtek` with `<name>.diag.json`;
//! * `tests/semantics/fail/<name>/` and `tests/semantics/fail/<group>/<name>/`
//!   (a directory with `mtek.toml`): every `.mtek` file below it, and
//!   `expected.diag.json`.
//!
//! Everything is read in sorted order, so the measurement is deterministic.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::{Corpus, Expected, FailFixture, PassFixture, Source};

fn read(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))
}

/// The entries of `dir`, sorted by name.
fn entries(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let listing = fs::read_dir(dir).map_err(|e| format!("cannot list {}: {e}", dir.display()))?;
    let mut paths = Vec::new();
    for entry in listing {
        paths.push(
            entry
                .map_err(|e| format!("cannot list {}: {e}", dir.display()))?
                .path(),
        );
    }
    paths.sort();
    Ok(paths)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The diagnostics of an expected-diagnostics file.
fn expected(path: &Path) -> Result<Vec<Expected>, String> {
    let text = read(path)?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
    let items = value
        .as_array()
        .ok_or_else(|| format!("{} is not a JSON array", path.display()))?;
    let mut out = Vec::new();
    for item in items {
        let text_field = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default();
        let number = |key: &str| {
            item.get(key)
                .and_then(Value::as_u64)
                .and_then(|n| usize::try_from(n).ok())
                .unwrap_or_default()
        };
        let code = text_field("code");
        out.push(Expected {
            code: code.strip_prefix("MTEK-").unwrap_or(code).to_owned(),
            file: text_field("file").to_owned(),
            start: number("startByte"),
            end: number("endByte"),
            message: text_field("message").to_owned(),
        });
    }
    Ok(out)
}

/// Every `.mtek` file below `dir`, with its path relative to `root` (with
/// `/`), in sorted order.
fn sources(root: &Path, dir: &Path, out: &mut Vec<Source>) -> Result<(), String> {
    for path in entries(dir)? {
        if path.is_dir() {
            sources(root, &path, out)?;
        } else if path.extension().is_some_and(|e| e == "mtek") {
            let relative = path
                .strip_prefix(root)
                .map_err(|e| format!("{}: {e}", path.display()))?
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            out.push(Source {
                path: relative,
                text: read(&path)?,
            });
        }
    }
    Ok(())
}

/// A semantic fail fixture directory.
fn semantic_fixture(name: String, dir: &Path) -> Result<FailFixture, String> {
    let mut found = Vec::new();
    sources(dir, dir, &mut found)?;
    Ok(FailFixture {
        name,
        sources: found,
        diagnostics: expected(&dir.join("expected.diag.json"))?,
    })
}

/// Read the corpus of the repository at `root`.
///
/// # Errors
///
/// A file or directory that cannot be read, an expected-diagnostics file
/// that is not a JSON array, a fail fixture without its expectation.
pub fn load(root: &Path) -> Result<Corpus, String> {
    let grammar = read(&root.join("spec/grammar.ebnf"))?;
    let syntax = root.join("tests/syntax");
    let mut pass = Vec::new();
    for path in entries(&syntax.join("pass"))? {
        let file = file_name(&path);
        if let Some(name) = file.strip_suffix(".mtek") {
            pass.push(PassFixture {
                name: format!("syntax/pass/{name}"),
                text: read(&path)?,
            });
        }
    }
    let mut fail = Vec::new();
    for path in entries(&syntax.join("fail"))? {
        let file = file_name(&path);
        if let Some(name) = file.strip_suffix(".mtek") {
            fail.push(FailFixture {
                name: format!("syntax/fail/{name}"),
                sources: vec![Source {
                    path: file.clone(),
                    text: read(&path)?,
                }],
                diagnostics: expected(&path.with_file_name(format!("{name}.diag.json")))?,
            });
        }
    }
    let semantics = root.join("tests/semantics/fail");
    for dir in entries(&semantics)? {
        if !dir.is_dir() {
            continue;
        }
        let name = file_name(&dir);
        if dir.join("mtek.toml").is_file() {
            fail.push(semantic_fixture(format!("semantics/fail/{name}"), &dir)?);
        } else {
            for inner in entries(&dir)? {
                if inner.join("mtek.toml").is_file() {
                    let label = format!("semantics/fail/{name}/{}", file_name(&inner));
                    fail.push(semantic_fixture(label, &inner)?);
                }
            }
        }
    }
    Ok(Corpus {
        grammar,
        pass,
        fail,
    })
}

/// The repository this crate belongs to (`tools/grammar-coverage/../..`).
#[must_use]
pub fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}
