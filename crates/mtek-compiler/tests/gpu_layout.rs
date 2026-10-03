//! Golden layout tests: every fixture in `tests/gpu-layout/` is parsed, laid out and compared
//! with its hand-maintained `<name>.layout.json` (`spec/testing.md` section 4.2).
//!
//! The goldens are written and reviewed by hand and are never regenerated from the engine's
//! output: there is deliberately no bless mode for them.

// Test helpers outside `#[test]` functions report broken fixtures by panicking.
#![allow(clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::layout::fixture::parse_type_json;
use mtek_compiler::layout::{LayoutNode, LayoutRecord, builtin_blocks, compute};
use serde_json::Value;

/// The fixtures `spec/testing.md` section 4.2 requires.
const REQUIRED: [&str; 14] = [
    "all_types",
    "array_bool",
    "array_f32",
    "array_of_structs",
    "array_vec2",
    "builtin_frame",
    "builtin_object",
    "mat4_and_quat",
    "mixed",
    "nested_struct_in_array",
    "scalar_f32",
    "struct_then_scalar",
    "vec3",
    "vec3_then_f32",
];

/// Fixtures whose record contains at least one padded array, and no others.
const PADDED: [&str; 4] = [
    "array_bool",
    "array_f32",
    "array_vec2",
    "nested_struct_in_array",
];

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/gpu-layout")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read fixture file {}: {e}", path.display()))
}

/// Fixture names (`<name>.type.json`) in sorted order.
fn fixture_names() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(fixture_dir())
        .unwrap_or_else(|e| panic!("cannot list the fixture directory: {e}"))
        .filter_map(|entry| {
            let file = entry.ok()?.file_name().into_string().ok()?;
            file.strip_suffix(".type.json").map(str::to_owned)
        })
        .collect();
    names.sort();
    names
}

/// Record id and WGSL struct name by the fixture naming rule (`spec/gpu-layout.md` section 5).
fn identity(name: &str) -> (String, String) {
    match name {
        "builtin_frame" => ("builtin:frame".to_owned(), "MtekFrame".to_owned()),
        "builtin_object" => ("builtin:object".to_owned(), "MtekObject".to_owned()),
        other => (format!("fixture:{other}"), format!("MtekFixture_{other}")),
    }
}

fn compute_fixture(name: &str) -> LayoutRecord {
    let ty = parse_type_json(&read(&fixture_dir().join(format!("{name}.type.json"))))
        .unwrap_or_else(|e| panic!("fixture {name}: {e}"));
    let (id, wgsl_struct) = identity(name);
    compute(&ty, &id, &wgsl_struct).unwrap_or_else(|e| panic!("fixture {name}: {e}"))
}

/// Path and description of the first difference between two JSON values, or `None` if equal.
fn first_difference(path: &str, expected: &Value, actual: &Value) -> Option<String> {
    match (expected, actual) {
        (Value::Object(e), Value::Object(a)) => {
            for (key, ev) in e {
                match a.get(key) {
                    Some(av) => {
                        if let Some(d) = first_difference(&format!("{path}.{key}"), ev, av) {
                            return Some(d);
                        }
                    }
                    None => return Some(format!("{path}.{key}: missing in actual output")),
                }
            }
            a.keys()
                .find(|key| !e.contains_key(*key))
                .map(|key| format!("{path}.{key}: unexpected key in actual output"))
        }
        (Value::Array(e), Value::Array(a)) => {
            for (index, (ev, av)) in e.iter().zip(a).enumerate() {
                if let Some(d) = first_difference(&format!("{path}[{index}]"), ev, av) {
                    return Some(d);
                }
            }
            (e.len() != a.len()).then(|| {
                format!(
                    "{path}: expected {} elements, actual output has {}",
                    e.len(),
                    a.len()
                )
            })
        }
        _ if expected == actual => None,
        _ => Some(format!("{path}: expected {expected}, actual {actual}")),
    }
}

/// The object keys of a JSON text in document order (a string followed by a colon).
fn key_sequence(text: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut literal = String::new();
        while let Some(d) = chars.next() {
            match d {
                '\\' => {
                    literal.push(d);
                    if let Some(escaped) = chars.next() {
                        literal.push(escaped);
                    }
                }
                '"' => break,
                _ => literal.push(d),
            }
        }
        while chars.peek().is_some_and(|d| d.is_whitespace()) {
            chars.next();
        }
        if chars.peek() == Some(&':') {
            keys.push(literal);
        }
    }
    keys
}

fn count_padded_arrays(node: &LayoutNode) -> usize {
    match node {
        LayoutNode::Struct { members, .. } => {
            members.iter().map(|m| count_padded_arrays(&m.node)).sum()
        }
        LayoutNode::Array {
            padded, element, ..
        } => usize::from(*padded) + count_padded_arrays(element),
        _ => 0,
    }
}

#[test]
fn every_required_fixture_exists_with_all_three_files() {
    let names = fixture_names();
    for required in REQUIRED {
        assert!(
            names.iter().any(|n| n == required),
            "required fixture `{required}` is missing"
        );
    }
    assert_eq!(
        names.len(),
        REQUIRED.len(),
        "unexpected fixtures: {names:?}"
    );
    for name in &names {
        for suffix in ["layout.json", "notes.md"] {
            let path = fixture_dir().join(format!("{name}.{suffix}"));
            assert!(path.is_file(), "missing {}", path.display());
        }
    }
}

#[test]
fn computed_layouts_equal_the_hand_maintained_goldens() {
    let mut failures = Vec::new();
    for name in fixture_names() {
        let expected: Value =
            serde_json::from_str(&read(&fixture_dir().join(format!("{name}.layout.json"))))
                .unwrap_or_else(|e| panic!("golden {name}.layout.json is not valid JSON: {e}"));
        let record = compute_fixture(&name);
        let actual = serde_json::to_value(&record)
            .unwrap_or_else(|e| panic!("fixture {name}: record does not serialise: {e}"));
        if let Some(difference) = first_difference("$", &expected, &actual) {
            failures.push(format!(
                "fixture `{name}` differs from its golden at {difference}\n\
                 --- expected ({name}.layout.json)\n{}\n--- actual\n{}\n",
                serde_json::to_string_pretty(&expected).unwrap_or_default(),
                serde_json::to_string_pretty(&actual).unwrap_or_default(),
            ));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn serialised_key_order_equals_the_normative_golden_order() {
    for name in fixture_names() {
        let golden = read(&fixture_dir().join(format!("{name}.layout.json")));
        let actual = serde_json::to_string_pretty(&compute_fixture(&name))
            .unwrap_or_else(|e| panic!("fixture {name}: {e}"));
        assert_eq!(
            key_sequence(&actual),
            key_sequence(&golden),
            "fixture `{name}`: key order differs from the golden (spec/gpu-layout.md section 5)"
        );
    }
}

#[test]
fn identity_fields_follow_the_naming_rule() {
    for name in fixture_names() {
        let record = compute_fixture(&name);
        let (id, wgsl_struct) = identity(&name);
        assert_eq!(record.id, id);
        assert_eq!(record.wgsl_struct, wgsl_struct);
    }
}

#[test]
fn padded_flag_is_set_exactly_for_the_padded_array_fixtures() {
    for name in fixture_names() {
        let record = compute_fixture(&name);
        let padded = count_padded_arrays(&record.root);
        if PADDED.contains(&name.as_str()) {
            assert_eq!(padded, 1, "fixture `{name}` must contain one padded array");
        } else {
            assert_eq!(
                padded, 0,
                "fixture `{name}` must not contain a padded array"
            );
        }
    }
}

#[test]
fn precomputed_sizes_and_alignments_from_the_task() {
    let expected = [
        ("scalar_f32", 4, 4),
        ("vec3", 16, 16),
        ("vec3_then_f32", 16, 16),
        ("mixed", 64, 16),
        ("struct_then_scalar", 32, 16),
        ("array_f32", 64, 16),
        ("array_vec2", 48, 16),
        ("array_bool", 48, 16),
        ("array_of_structs", 48, 16),
        ("nested_struct_in_array", 64, 16),
        ("mat4_and_quat", 96, 16),
        ("all_types", 160, 16),
        ("builtin_frame", 288, 16),
        ("builtin_object", 128, 16),
    ];
    for (name, size, align) in expected {
        let record = compute_fixture(name);
        assert_eq!(
            (record.size, record.align),
            (size, align),
            "fixture `{name}`"
        );
        assert_eq!(record.root.size(), size, "fixture `{name}` root node size");
        assert_eq!(
            record.root.align(),
            align,
            "fixture `{name}` root node align"
        );
    }
}

#[test]
fn builtin_blocks_agree_with_the_builtin_fixtures() {
    let blocks = builtin_blocks();
    for (name, id) in [
        ("builtin_frame", "builtin:frame"),
        ("builtin_object", "builtin:object"),
    ] {
        let block = blocks
            .iter()
            .find(|b| b.id == id)
            .unwrap_or_else(|| panic!("no built-in block `{id}`"));
        let from_fixture = parse_type_json(&read(&fixture_dir().join(format!("{name}.type.json"))))
            .unwrap_or_else(|e| panic!("fixture {name}: {e}"));
        assert_eq!(
            block.ty, from_fixture,
            "built-in `{id}` differs from fixture `{name}`"
        );
        let computed = compute(&block.ty, block.id, block.wgsl_struct)
            .unwrap_or_else(|e| panic!("built-in `{id}`: {e}"));
        assert_eq!(computed, compute_fixture(name));
    }
}

#[test]
fn the_difference_reporter_names_the_path_of_a_mismatch() {
    let expected: Value = serde_json::json!({ "a": [ { "offset": 4 } ] });
    let actual: Value = serde_json::json!({ "a": [ { "offset": 8 } ] });
    assert_eq!(
        first_difference("$", &expected, &actual).as_deref(),
        Some("$.a[0].offset: expected 4, actual 8")
    );
    assert_eq!(first_difference("$", &expected, &expected), None);
}
