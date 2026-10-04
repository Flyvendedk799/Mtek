//! Validation of manifests against `spec/manifest.schema.json` (JSON Schema draft 2020-12)
//! with the `jsonschema` dev-dependency (decision 0007).

use jsonschema::Validator;
use serde_json::Value;

const SCHEMA: &str = include_str!("../../../../spec/manifest.schema.json");

/// The compiled manifest schema.
pub fn validator() -> Validator {
    let schema: Value =
        serde_json::from_str(SCHEMA).unwrap_or_else(|e| panic!("manifest schema: {e}"));
    jsonschema::draft202012::new(&schema).unwrap_or_else(|e| panic!("manifest schema: {e}"))
}

/// Every schema violation of `instance`, with its location.
pub fn errors(validator: &Validator, instance: &Value) -> Vec<String> {
    validator
        .iter_errors(instance)
        .map(|e| format!("{e} (at {})", e.instance_path()))
        .collect()
}

/// Panics with the violations if `text` is not a schema-valid manifest.
pub fn assert_valid(validator: &Validator, label: &str, text: &str) {
    let instance: Value =
        serde_json::from_str(text).unwrap_or_else(|e| panic!("{label} is not JSON: {e}"));
    let problems = errors(validator, &instance);
    assert!(
        problems.is_empty(),
        "{label} violates spec/manifest.schema.json:\n{}",
        problems.join("\n")
    );
}
