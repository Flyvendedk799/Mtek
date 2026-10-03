//! Golden tests for the generated JavaScript writers (`spec/gpu-layout.md` section 7).
//!
//! For every fixture the test artifact of `emit_js::emit_test_module` is compared with the
//! checked-in `tests/codegen/writers/<name>.js`. The records come from the hand-maintained
//! `tests/gpu-layout/<name>.layout.json` goldens (which `gpu_layout.rs` proves equal to the
//! layout engine's output), so the writers are checked against the reviewed layouts.
//!
//! Run with `MTEK_BLESS=1` to rewrite the goldens; review the diff like code. The
//! byte-level behaviour of the writers is verified by `tests/codegen/layout.test.ts`.

// Test helpers outside `#[test]` functions report broken fixtures by panicking.
#![allow(clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::emit_js::{emit_test_module, emit_writers, writer_qualifier};
use mtek_compiler::layout::LayoutRecord;

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read file {}: {e}", path.display()))
}

/// Fixture names (`<name>.type.json`) in sorted order.
fn fixture_names() -> Vec<String> {
    let dir = repo_path("tests/gpu-layout");
    let mut names: Vec<String> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot list {}: {e}", dir.display()))
        .filter_map(|entry| {
            let file = entry.ok()?.file_name().into_string().ok()?;
            file.strip_suffix(".type.json").map(str::to_owned)
        })
        .collect();
    names.sort();
    names
}

fn record(name: &str) -> LayoutRecord {
    let path = repo_path(&format!("tests/gpu-layout/{name}.layout.json"));
    serde_json::from_str(&read(&path))
        .unwrap_or_else(|e| panic!("fixture {name}: invalid layout record: {e}"))
}

fn blessing() -> bool {
    std::env::var_os("MTEK_BLESS").is_some_and(|value| value == "1")
}

#[test]
fn there_is_a_golden_for_every_fixture_and_no_stale_one() {
    let dir = repo_path("tests/codegen/writers");
    let mut goldens: Vec<String> = fs::read_dir(&dir)
        .map(|entries| {
            entries
                .filter_map(|entry| {
                    let file = entry.ok()?.file_name().into_string().ok()?;
                    file.strip_suffix(".js").map(str::to_owned)
                })
                .collect()
        })
        .unwrap_or_default();
    goldens.sort();
    if blessing() {
        return;
    }
    assert_eq!(
        goldens,
        fixture_names(),
        "tests/codegen/writers must hold exactly one <name>.js per fixture; \
         run MTEK_BLESS=1 cargo test -p mtek-compiler --test js_writers to regenerate"
    );
}

#[test]
fn generated_writers_match_the_goldens() {
    let names = fixture_names();
    assert_eq!(names.len(), 14, "the fixture set changed: {names:?}");
    for name in &names {
        let record = record(name);
        let actual = emit_test_module(&record, &writer_qualifier(&record));
        let path = repo_path(&format!("tests/codegen/writers/{name}.js"));
        if blessing() {
            fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))
                .unwrap_or_else(|e| panic!("cannot create the golden directory: {e}"));
            fs::write(&path, &actual)
                .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
            continue;
        }
        let expected = read(&path);
        assert!(
            expected == actual,
            "writers of fixture `{name}` differ from {}; review the change and bless with \
             MTEK_BLESS=1 cargo test -p mtek-compiler --test js_writers\n--- expected\n{expected}\n--- actual\n{actual}",
            path.display()
        );
    }
}

#[test]
fn emission_is_deterministic_and_app_text_has_no_export() {
    for name in fixture_names() {
        let record = record(&name);
        let qual = writer_qualifier(&record);
        let first = emit_writers(&record, &qual);
        assert_eq!(first, emit_writers(&record, &qual), "fixture {name}");
        assert_eq!(
            emit_test_module(&record, &qual),
            emit_test_module(&record, &qual),
            "fixture {name}"
        );
        assert!(
            !first.contains("export"),
            "fixture {name}: writers must be module-private"
        );
        assert!(
            first.starts_with(&format!(
                "// Generated from layout {} (size {}). Do not edit.\n",
                record.id, record.size
            )),
            "fixture {name}: missing header comment"
        );
    }
}
