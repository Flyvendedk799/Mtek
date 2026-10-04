//! The Rust manifest model (`mtek_compiler::package::manifest`) against the shared examples of
//! `tests/abi/manifests/` (M1-13), which the runtime's TypeScript tests use as well
//! (`packages/runtime-web/src/abi/abi.test.ts`).
//!
//! * Every valid example validates against `spec/manifest.schema.json`, reads into the model
//!   and prints back **byte-identically**: the model has the schema's key order and keeps
//!   every number as written.
//! * Every invalid example is checked against its case in `expectations.json` (the code and
//!   the dotted `field` of the runtime's first failure):
//!   * `E8006` (schema failure): the schema rejects it here too, at the expected `field`; the
//!     model's types reject exactly the examples in [`REJECTED_BY_THE_MODEL`] and read the others,
//!     whose violations are constraints the model leaves to the schema by design.
//!   * `E8003` (incompatible program): the expected `field` is the first of `manifestSchema`,
//!     `runtimeAbi`, `languageVersion` (the order of the runtime's `checkCompatibility`) whose
//!     value differs from what this compiler writes. Apart from the one example that is also
//!     malformed on purpose, these are schema-valid and the model reads them, keeping the
//!     incompatible value: neither the schema nor the model can detect an incompatible
//!     program, only the compatibility check of `spec/runtime-abi.md` section 5.1 can.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::manifest_schema::{assert_valid, errors, validator};
use jsonschema::error::ValidationErrorKind;
use jsonschema::{ValidationError, Validator};
use mtek_compiler::package::manifest::{MANIFEST_SCHEMA, Manifest};
use mtek_compiler::{LANGUAGE_VERSION, RUNTIME_ABI};
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

/// The `cases` of `expectations.json`, checked to cover the invalid examples exactly.
fn invalid_cases() -> Vec<(String, String, String, String)> {
    let expectations: Value = serde_json::from_str(
        &fs::read_to_string(manifests_dir().join("expectations.json")).unwrap(),
    )
    .unwrap();
    let cases = expectations["cases"].as_object().unwrap();
    let invalid = examples("invalid");
    let mut listed: Vec<&String> = cases.keys().collect();
    listed.sort();
    let found: Vec<&String> = invalid.iter().map(|(label, _)| label).collect();
    assert_eq!(
        listed, found,
        "every invalid example has a case and vice versa"
    );
    assert!(invalid.len() >= 40, "{}", invalid.len());
    invalid
        .into_iter()
        .map(|(label, text)| {
            let case = &cases[&label];
            let code = case["code"].as_str().unwrap().to_owned();
            let field = case["field"].as_str().unwrap().to_owned();
            assert!(
                code == "E8003" || code == "E8006",
                "{label}: unexpected code {code}"
            );
            (label, text, code, field)
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

/// `/scene/entities/0/name` (plus `extra`) as the runtime's dotted field
/// `scene.entities[0].name`; the root is `manifest` (`pointerToField` in
/// `packages/runtime-web/src/abi/validate.ts`).
fn pointer_to_field(pointer: &str, extra: Option<&str>) -> String {
    let mut segments: Vec<String> = if pointer.is_empty() {
        Vec::new()
    } else {
        pointer[1..]
            .split('/')
            .map(|s| s.replace("~1", "/").replace("~0", "~"))
            .collect()
    };
    segments.extend(extra.map(str::to_owned));
    let mut field = String::new();
    for segment in segments {
        if !segment.is_empty() && segment.bytes().all(|b| b.is_ascii_digit()) {
            field.push_str(&format!("[{segment}]"));
        } else {
            if !field.is_empty() {
                field.push('.');
            }
            field.push_str(&segment);
        }
    }
    if field.is_empty() {
        "manifest".to_owned()
    } else {
        field
    }
}

/// The fields at which `error` reports a violation, named the way the runtime names them
/// (`fieldOf` in `validate.ts`): a missing or unexpected property and a bad property name are
/// the property itself. The runtime's Ajv validator honours the schema's `discriminator`
/// keyword, which `jsonschema` ignores; a `oneOf` failure is therefore resolved the same way
/// here: the branches whose `kind` matches are searched, and when no branch's `kind` matches,
/// the failure is the tag itself.
fn fields_of(error: &ValidationError<'_>, out: &mut Vec<String>) {
    let pointer = error.instance_path().as_str();
    match error.kind() {
        ValidationErrorKind::Required { property } => {
            out.push(pointer_to_field(pointer, property.as_str()));
        }
        ValidationErrorKind::AdditionalProperties { unexpected } => {
            for name in unexpected {
                out.push(pointer_to_field(pointer, Some(name)));
            }
        }
        ValidationErrorKind::PropertyNames { error } => {
            out.push(pointer_to_field(pointer, error.instance().as_str()));
        }
        ValidationErrorKind::OneOfNotValid { context } | ValidationErrorKind::AnyOf { context } => {
            // A branch's tag is a `const` on a direct property (`kind`, or `class` for an
            // instance parameter); a branch whose tag does not match fails on that property.
            let tag_of = |e: &ValidationError<'_>| -> Option<String> {
                let child = e.instance_path().as_str().strip_prefix(pointer)?;
                let name = child.strip_prefix('/')?;
                let is_const = matches!(e.kind(), ValidationErrorKind::Constant { .. });
                (is_const && !name.contains('/')).then(|| name.to_owned())
            };
            let matching: Vec<&Vec<ValidationError<'static>>> = context
                .iter()
                .filter(|branch| !branch.iter().any(|e| tag_of(e).is_some()))
                .collect();
            if matching.is_empty() {
                let tag = context.iter().flatten().find_map(tag_of);
                out.push(pointer_to_field(pointer, tag.as_deref()));
            }
            for branch in matching {
                for inner in branch {
                    fields_of(inner, out);
                }
            }
        }
        _ => out.push(pointer_to_field(pointer, None)),
    }
}

/// The distinct fields at which the schema rejects `instance`, in report order.
fn schema_fields(schema: &Validator, instance: &Value) -> Vec<String> {
    let mut fields = Vec::new();
    for error in schema.iter_errors(instance) {
        fields_of(&error, &mut fields);
    }
    let mut distinct = Vec::new();
    for field in fields {
        if !distinct.contains(&field) {
            distinct.push(field);
        }
    }
    distinct
}

/// The schema-invalid (`E8006`) examples that the model's types reject: a missing key, a value
/// of the wrong JSON type, an unknown tag or a tag without its variant's keys. The model reads
/// every other schema-invalid example, because what they violate (patterns, ranges, lengths,
/// enumerations kept as strings, unknown keys) is a constraint the model leaves to the schema
/// by design (module documentation of `package::manifest`); the compiler validates every
/// manifest it builds against the schema instead.
const REJECTED_BY_THE_MODEL: &[&str] = &[
    "invalid/asset-image-without-color-space.json",
    "invalid/asset-unknown-kind.json",
    "invalid/binding-missing-order.json",
    "invalid/binding-unknown-target-kind.json",
    "invalid/body-unknown-kind.json",
    "invalid/capabilities-limit-not-integer.json",
    "invalid/entity-missing-name.json",
    "invalid/entity-negative-parent.json",
    "invalid/instance-bound-without-binding.json",
    "invalid/instance-resource-without-value.json",
    "invalid/instance-unknown-class.json",
    "invalid/language-version-number.json",
    "invalid/layout-scalar-unknown-type.json",
    "invalid/layout-unknown-node-kind.json",
    "invalid/light-point-without-range.json",
    "invalid/manifest-schema-fractional.json",
    "invalid/mesh-sphere-missing-rings.json",
    "invalid/mesh-unknown-kind.json",
    "invalid/missing-build-id.json",
    "invalid/negative-span.json",
    "invalid/physics-not-boolean.json",
    "invalid/runtime-abi-as-string.json",
    "invalid/scene-missing-gravity.json",
    "invalid/span-missing-end-column.json",
    "invalid/unknown-symbol-kind.json",
];

#[test]
fn schema_failures_of_the_runtime_fail_the_schema_here_at_the_same_field() {
    let schema = validator();
    let cases = invalid_cases();
    let mut checked = 0;
    for (label, text, code, field) in &cases {
        if code != "E8006" {
            continue;
        }
        let instance: Value = serde_json::from_str(text).unwrap();
        // Each example breaks exactly one rule, so the schema reports exactly that field.
        assert_eq!(
            schema_fields(&schema, &instance),
            std::slice::from_ref(field),
            "{label}: the schema must reject it at `{field}` only"
        );
        let rejected = Manifest::from_json(text).is_err();
        let listed = REJECTED_BY_THE_MODEL.contains(&label.as_str());
        assert_eq!(
            rejected,
            listed,
            "{label}: the model {} it; update REJECTED_BY_THE_MODEL if the model changed",
            if rejected { "rejects" } else { "reads" }
        );
        checked += 1;
    }
    assert!(
        checked > REJECTED_BY_THE_MODEL.len(),
        "{checked} E8006 examples"
    );
    for label in REJECTED_BY_THE_MODEL {
        assert!(
            cases
                .iter()
                .any(|(l, _, code, _)| l == label && code == "E8006"),
            "{label} is not an E8006 example"
        );
    }
}

/// Schema-invalid `E8003` examples: incompatible **and** malformed, to show that the
/// compatibility check runs before the schema (`spec/runtime-abi.md` section 5.1).
const INCOMPATIBLE_AND_SCHEMA_INVALID: &[&str] = &["invalid/incompatible-and-invalid.json"];

/// The first of `manifestSchema`, `runtimeAbi`, `languageVersion` (in the order the runtime's
/// `checkCompatibility` reports them) whose value is not the one this compiler writes, with
/// the check that the value is comparable (an integer, or a string for the language version);
/// an incomparable value would be an `E8006`, not an `E8003`.
fn first_incompatible_field(label: &str, instance: &Value) -> Option<&'static str> {
    let written = [
        ("manifestSchema", Value::from(MANIFEST_SCHEMA)),
        ("runtimeAbi", Value::from(RUNTIME_ABI)),
        ("languageVersion", Value::from(LANGUAGE_VERSION)),
    ];
    for (name, ours) in &written {
        let value = &instance[*name];
        let comparable = if ours.is_string() {
            value.is_string()
        } else {
            value.is_u64() || value.is_i64()
        };
        assert!(comparable, "{label}: `{name}` is {value}, not comparable");
    }
    written
        .into_iter()
        .find(|(name, ours)| instance[*name] != *ours)
        .map(|(name, _)| name)
}

#[test]
fn incompatible_programs_differ_from_this_compiler_in_the_expected_field() {
    let schema = validator();
    let mut checked = 0;
    for (label, text, code, field) in invalid_cases() {
        if code != "E8003" {
            continue;
        }
        let instance: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            first_incompatible_field(&label, &instance),
            Some(field.as_str()),
            "{label}: the first incompatible field"
        );
        let problems = errors(&schema, &instance);
        if INCOMPATIBLE_AND_SCHEMA_INVALID.contains(&label.as_str()) {
            assert!(!problems.is_empty(), "{label} passes the schema");
        } else {
            // The schema accepts any version number, so only the compatibility check can
            // reject the program. The model cannot either: like the schema, it reads any
            // version (it describes the shape, the constants the compatibility), so it must
            // read the example and keep the incompatible value for that check.
            assert!(problems.is_empty(), "{label}:\n{}", problems.join("\n"));
            let manifest =
                Manifest::from_json(&text).unwrap_or_else(|e| panic!("{label} does not read: {e}"));
            let kept = match field.as_str() {
                "manifestSchema" => manifest.manifest_schema != MANIFEST_SCHEMA,
                "runtimeAbi" => manifest.runtime_abi != RUNTIME_ABI,
                "languageVersion" => manifest.language_version != LANGUAGE_VERSION,
                other => panic!("{label}: `{other}` is not a compatibility field"),
            };
            assert!(kept, "{label}: the model lost the incompatible `{field}`");
        }
        checked += 1;
    }
    assert!(checked >= 5, "{checked} E8003 examples");
}
