//! Golden lexer fixtures: every `tests/syntax/lex/<name>.mtek` is lexed and
//! compared with `<name>.tokens` (the token and comment dump) and, when it has
//! lexical errors, with `<name>.diag.json` (code, file, byte span, message and
//! notes of each diagnostic, in the format of `spec/testing.md` section 3.1).
//! A fixture without a `.diag.json` must lex without diagnostics.
//!
//! `MTEK_BLESS=1 cargo test` rewrites the expected files; review the diff like
//! code (`spec/compiler-architecture.md` section 10). Fixtures use `\n` line
//! endings (`.gitattributes` normalises text files); carriage returns, byte
//! order marks and control characters are covered by unit tests in
//! `src/syntax/lexer_tests.rs`.

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::Diagnostic;
use mtek_compiler::source::{ProjectPath, SourceMap};
use mtek_compiler::syntax::lex;
use serde_json::{Map, Value};

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/syntax/lex")
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

/// Fixture names (`<name>.mtek`) in sorted order.
fn fixture_names() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(fixture_dir())
        .unwrap()
        .filter_map(|entry| {
            let file = entry.ok()?.file_name().into_string().ok()?;
            file.strip_suffix(".mtek").map(str::to_owned)
        })
        .collect();
    names.sort();
    names
}

/// The `.diag.json` content of the diagnostics of `file_name`.
fn diagnostics_json(file_name: &str, diagnostics: &[Diagnostic]) -> String {
    let items: Vec<Value> = diagnostics
        .iter()
        .map(|d| {
            let span = d.primary.as_ref().map(|label| label.span).unwrap();
            let mut object = Map::new();
            object.insert("code".into(), d.code.as_str().into());
            object.insert("file".into(), file_name.into());
            object.insert("startByte".into(), span.start.into());
            object.insert("endByte".into(), span.end.into());
            object.insert("message".into(), d.message.as_str().into());
            if !d.notes.is_empty() {
                object.insert("notes".into(), d.notes.clone().into());
            }
            Value::Object(object)
        })
        .collect();
    let mut text = serde_json::to_string_pretty(&Value::Array(items)).unwrap();
    text.push('\n');
    text
}

/// Compare `actual` with the file at `path`, or write it when blessing.
fn check_golden(path: &Path, actual: &str) {
    if blessing() {
        fs::write(path, actual).unwrap();
        return;
    }
    let expected = fs::read_to_string(path).unwrap_or_else(|e| {
        panic!(
            "missing golden {} ({e}); run `MTEK_BLESS=1 cargo test` and review it",
            path.display()
        )
    });
    assert_eq!(
        expected,
        actual,
        "golden {} differs; if the change is intended run `MTEK_BLESS=1 cargo test` and review the diff",
        path.display()
    );
}

#[test]
fn every_fixture_matches_its_goldens() {
    let names = fixture_names();
    assert!(names.len() >= 10, "fixtures are missing: {names:?}");
    for name in &names {
        let dir = fixture_dir();
        let bytes = fs::read(dir.join(format!("{name}.mtek"))).unwrap();
        let file_name = format!("{name}.mtek");
        let mut map = SourceMap::new();
        let id = map
            .add(ProjectPath::new(&file_name).unwrap(), &bytes)
            .unwrap_or_else(|e| panic!("{file_name}: {e}"));
        let file = map.get(id).unwrap();
        let lexed = lex(file);

        check_golden(
            &dir.join(format!("{name}.tokens")),
            &lexed.dump(file.text()),
        );

        let diag_path = dir.join(format!("{name}.diag.json"));
        if lexed.diagnostics.is_empty() {
            assert!(
                !diag_path.exists() || blessing(),
                "{name}: has a .diag.json but lexes without diagnostics"
            );
            if blessing() && diag_path.exists() {
                fs::remove_file(&diag_path).unwrap();
            }
        } else {
            check_golden(
                &diag_path,
                &diagnostics_json(&file_name, &lexed.diagnostics),
            );
        }
    }
}

#[test]
fn fixtures_named_fail_have_diagnostics_and_the_others_have_none() {
    for name in fixture_names() {
        let bytes = fs::read(fixture_dir().join(format!("{name}.mtek"))).unwrap();
        let mut map = SourceMap::new();
        let id = map
            .add(ProjectPath::new(&format!("{name}.mtek")).unwrap(), &bytes)
            .unwrap();
        let lexed = lex(map.get(id).unwrap());
        let expect_errors = name.starts_with("fail_") || name.starts_with("recovery_");
        assert_eq!(
            !lexed.diagnostics.is_empty(),
            expect_errors,
            "{name}: fixture naming and diagnostics disagree"
        );
    }
}

#[test]
fn the_blueprint_example_lexes_cleanly_with_the_expected_shape() {
    let bytes = fs::read(fixture_dir().join("blueprint_example.mtek")).unwrap();
    let mut map = SourceMap::new();
    let id = map
        .add(ProjectPath::new("blueprint_example.mtek").unwrap(), &bytes)
        .unwrap();
    let file = map.get(id).unwrap();
    let lexed = lex(file);
    assert!(lexed.diagnostics.is_empty());
    assert!(lexed.trivia.is_empty());
    assert_eq!(lexed.tokens.len(), 218, "217 tokens and Eof");
}

#[test]
fn every_lexer_diagnostic_code_has_a_fixture() {
    // `spec/testing.md` section 3.2: every diagnostic code needs at least one
    // negative fixture. E0001, E0002 and E0004 belong to the source map
    // (`src/source`); E0003 needs carriage returns, which `.gitattributes`
    // would normalise in a fixture file, so it is covered by the unit tests in
    // `src/syntax/lexer_tests.rs`; E0012 and E0013 are reported by the
    // resolver and parser, not the lexer.
    let mut seen = std::collections::BTreeSet::new();
    for name in fixture_names() {
        let bytes = fs::read(fixture_dir().join(format!("{name}.mtek"))).unwrap();
        let mut map = SourceMap::new();
        let id = map
            .add(ProjectPath::new(&format!("{name}.mtek")).unwrap(), &bytes)
            .unwrap();
        for diagnostic in lex(map.get(id).unwrap()).diagnostics {
            seen.insert(diagnostic.code.short());
        }
    }
    let expected = [
        "E0005", "E0006", "E0010", "E0011", "E0020", "E0021", "E0022", "E0023", "E0024", "E0025",
    ];
    for code in expected {
        assert!(seen.contains(code), "no fixture produces {code}: {seen:?}");
    }
}
