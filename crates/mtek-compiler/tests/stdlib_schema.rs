//! `spec/stdlib-schema.json` is generated from the registry, checked in, and never edited by
//! hand: this test fails when the committed file differs from what the generator produces.
//!
//! To regenerate after changing the registry: `MTEK_BLESS=1 cargo test -p mtek-compiler
//! --test stdlib_schema`.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::stdlib::{Registry, export_schema_json, registry};
use serde_json::Value;

fn schema_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/stdlib-schema.json")
}

#[test]
fn committed_schema_matches_the_generator() {
    let generated = export_schema_json(registry());
    let path = schema_path();
    if std::env::var_os("MTEK_BLESS").is_some_and(|v| v == "1") {
        fs::write(&path, &generated).unwrap();
        return;
    }
    let committed = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e}\nGenerate it with: MTEK_BLESS=1 cargo test -p mtek-compiler --test stdlib_schema",
            path.display()
        )
    });
    assert!(
        committed == generated,
        "spec/stdlib-schema.json is stale: it differs from the registry. Never edit it by hand; \
         regenerate it with: MTEK_BLESS=1 cargo test -p mtek-compiler --test stdlib_schema"
    );
}

#[test]
fn generation_is_deterministic() {
    let first = export_schema_json(&Registry::v0_1());
    let second = export_schema_json(&Registry::v0_1());
    assert_eq!(first, second);
    assert_eq!(first, export_schema_json(registry()));
}

#[test]
fn output_format_is_canonical() {
    let text = export_schema_json(registry());
    assert!(text.ends_with("}\n"), "ends with one newline");
    assert!(!text.ends_with("\n\n"));
    assert!(!text.contains('\r'), "LF line endings");
    assert!(text.starts_with("{\n  \"registryVersion\": 1,\n  \"languageVersion\": \"0.1\",\n"));
    // Pretty-printed with two-space indentation and no trailing whitespace.
    assert!(text.lines().all(|line| line == line.trim_end()));
    // Only strings, booleans, null and integers: no number can print differently per host.
    fn no_floats(value: &Value) {
        match value {
            Value::Number(n) => assert!(n.is_u64() || n.is_i64(), "float {n} in the schema"),
            Value::Array(items) => items.iter().for_each(no_floats),
            Value::Object(map) => map.values().for_each(no_floats),
            _ => {}
        }
    }
    let parsed: Value = serde_json::from_str(&text).unwrap();
    no_floats(&parsed);
    // Nothing host- or time-dependent: no absolute paths.
    assert!(!text.contains(":\\") && !text.contains("/home/") && !text.contains("/Users/"));
}

#[test]
fn arrays_are_sorted_by_name() {
    let parsed: Value = serde_json::from_str(&export_schema_json(registry())).unwrap();
    let sorted_by = |array: &Value, key: &str| {
        let names: Vec<&str> = array
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item[key].as_str().unwrap())
            .collect();
        let mut expected = names.clone();
        expected.sort_unstable();
        assert_eq!(names, expected, "array sorted by `{key}`");
    };
    for key in [
        "schemas",
        "events",
        "enums",
        "intrinsics",
        "namespaces",
        "types",
        "bodyCommands",
        "bodyProperties",
        "typeClasses",
    ] {
        sorted_by(&parsed[key], "name");
    }
    sorted_by(&parsed["sceneObjects"], "keyword");
    for schema in parsed["schemas"].as_array().unwrap() {
        sorted_by(&schema["fields"], "name");
    }
    for namespace in parsed["namespaces"].as_array().unwrap() {
        sorted_by(&namespace["members"], "name");
    }
    for def in parsed["enums"].as_array().unwrap() {
        sorted_by(&def["members"], "name");
    }
}

#[test]
fn schema_json_follows_the_documented_format() {
    let parsed: Value = serde_json::from_str(&export_schema_json(registry())).unwrap();
    assert_eq!(parsed["registryVersion"], 1);
    assert_eq!(parsed["languageVersion"], "0.1");
    for key in [
        "schemas",
        "events",
        "enums",
        "intrinsics",
        "namespaces",
        "types",
    ] {
        assert!(parsed[key].is_array(), "{key}");
    }
    // The example of spec/stdlib.md section 1.2: Box.size.
    let schemas = parsed["schemas"].as_array().unwrap();
    let box_schema = schemas.iter().find(|s| s["name"] == "Box").unwrap();
    assert_eq!(box_schema["category"], "mesh");
    let size = &box_schema["fields"][0];
    assert_eq!(size["name"], "size");
    assert_eq!(size["type"], "vec3");
    assert_eq!(size["default"], "vec3(1.0, 1.0, 1.0)");
    assert_eq!(size["required"], false);
    assert_eq!(size["writable"], false);
    assert_eq!(size["bindable"], false);
    assert_eq!(size["range"], "every component > 0");
    // A field without a default or range prints null, not a missing key.
    let entity = schemas.iter().find(|s| s["name"] == "Entity").unwrap();
    let mesh = entity["fields"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["name"] == "mesh")
        .unwrap();
    assert!(mesh["default"].is_null());
    assert!(mesh["range"].is_null());
    assert_eq!(mesh["constructionOnly"], true);
    // Key.Space <-> "Space".
    let key = parsed["enums"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["name"] == "Key")
        .unwrap();
    let space = key["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["name"] == "Space")
        .unwrap();
    assert_eq!(space["code"], "Space");
}

#[test]
fn the_generator_reflects_registry_changes() {
    let mut changed = Registry::v0_1();
    let schema = changed
        .schemas
        .iter_mut()
        .find(|s| s.name == "Box")
        .unwrap();
    schema.fields[0].doc = "A different description.";
    assert_ne!(export_schema_json(&changed), export_schema_json(registry()));
}
