//! The Rust manifest model (`mtek_compiler::package::manifest`) against the shared examples of
//! `tests/abi/manifests/` (M1-13), which the runtime's TypeScript tests use as well.
//!
//! * Every valid example validates against `spec/manifest.schema.json`, reads into the model
//!   and prints back **byte-identically**: the model has the schema's key order and keeps
//!   every number as written.
//! * Every invalid example that `expectations.json` maps to `E8006` (schema failure) is
//!   rejected by the schema here too; the `E8003` examples are schema-valid by design
//!   (`spec/runtime-abi.md` section 5.1: the compatibility check runs first).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::manifest_schema::{assert_valid, errors, validator};
use mtek_compiler::package::manifest::Manifest;
use serde_json::Value;

fn manifests_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/abi/manifests")
}

/// The `.json` files of `tests/abi/manifests/<dir>`, sorted.
fn examples(dir: &str) -> Vec<(String, String)> {
    let mut names: Vec<String> = fs::read_dir(manifests_dir().join(dir))
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|name| name.ends_with(".json"))
        .collect();
    names.sort();
    names
        .into_iter()
        .map(|name| {
            let text = fs::read_to_string(manifests_dir().join(dir).join(&name)).unwrap();
            (format!("{dir}/{name}"), text)
        })
        .collect()
}

#[test]
fn every_valid_example_round_trips_byte_identically() {
    let schema = validator();
    let valid = examples("valid");
    assert!(valid.len() >= 2, "{valid:?}");
    for (label, text) in valid {
        assert_valid(&schema, &label, &text);
        let manifest =
            Manifest::from_json(&text).unwrap_or_else(|e| panic!("{label} does not read: {e}"));
        let printed = manifest.to_json();
        if printed != text {
            let line = printed
                .lines()
                .zip(text.lines())
                .position(|(a, b)| a != b)
                .map_or(0, |i| i + 1);
            panic!("{label} does not print back identically; first difference at line {line}");
        }
    }
}

#[test]
fn schema_failures_of_the_runtime_are_schema_failures_here() {
    let schema = validator();
    let expectations: Value = serde_json::from_str(
        &fs::read_to_string(manifests_dir().join("expectations.json")).unwrap(),
    )
    .unwrap();
    let cases = expectations["cases"].as_object().unwrap();
    let invalid = examples("invalid");
    assert_eq!(
        invalid.len(),
        cases.len(),
        "every invalid example has a case"
    );
    for (label, text) in invalid {
        let case = cases
            .get(&label)
            .unwrap_or_else(|| panic!("{label} has no expectation"));
        let instance: Value = serde_json::from_str(&text).unwrap();
        let problems = errors(&schema, &instance);
        match case["code"].as_str() {
            Some("E8006") => assert!(!problems.is_empty(), "{label} passes the schema"),
            Some("E8003") => {}
            other => panic!("{label}: unexpected code {other:?}"),
        }
    }
}
