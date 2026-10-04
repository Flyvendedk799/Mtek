//! The typed IR through `mtek_compiler::inspect` (decision 0028).
//!
//! * Goldens: `tests/codegen/ir/<fixture>.ir.json` (`--format json`) and
//!   `<fixture>.ir.txt` (`--format human`) for the two structurally
//!   different M1 scenes, the pass fixtures `scene_a_target_camera_box` and
//!   `scene_b_orthographic_nested` of `tests/semantics/pass/`. Rewrite them
//!   with `MTEK_BLESS=1 cargo test -p mtek-compiler --test ir_goldens` and
//!   review the diff like code.
//! * Determinism (`spec/compiler-architecture.md` section 5): every semantic
//!   pass fixture inspected twice, and with shuffled directory listings,
//!   gives byte-identical IR in both formats.
//! * Shape: every symbol is `src/main.mtek::Qualified.Name`, every node has a
//!   span inside its file, the entity list is in pre-order with parent
//!   indices, and a program with errors has no IR.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{Inspect, InspectFormat, InspectResult, check, inspect};
use serde_json::Value;

/// The fixtures with IR goldens: pass scenes A and B of M1-11.
const GOLDEN_FIXTURES: [&str; 2] = ["scene_a_target_camera_box", "scene_b_orthographic_nested"];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn semantics_dir(suite: &str) -> PathBuf {
    repo().join("tests/semantics").join(suite)
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

/// The fixture directories of a semantic suite, sorted.
fn fixtures(suite: &str) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(semantics_dir(suite))
        .unwrap()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            entry.file_type().ok()?.is_dir().then_some(())?;
            entry.file_name().into_string().ok()
        })
        .collect();
    names.sort();
    names
}

/// Every file below `dir` except the expected diagnostics, relative to
/// `root`, sorted.
fn files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            files(root, &path, out);
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .unwrap()
            .components()
            .map(|c| c.as_os_str().to_str().unwrap().to_owned())
            .collect::<Vec<_>>()
            .join("/");
        if relative != "expected.diag.json" {
            out.push((relative, fs::read(&path).unwrap()));
        }
    }
}

/// The in-memory project of a semantic fixture, optionally with shuffled
/// directory listings.
fn fixture_fs(suite: &str, name: &str, shuffle: Option<u64>) -> MemFs {
    let root = semantics_dir(suite).join(name);
    let mut found = Vec::new();
    files(&root, &root, &mut found);
    let mut memory = match shuffle {
        Some(seed) => MemFs::new().with_shuffled_listing(seed),
        None => MemFs::new(),
    };
    for (path, bytes) in found {
        memory.insert(ProjectPath::new(&path).unwrap(), bytes);
    }
    memory
}

fn inspect_fixture(suite: &str, name: &str, shuffle: Option<u64>) -> InspectResult {
    inspect(
        &ProjectRoot::at_base(),
        &fixture_fs(suite, name, shuffle),
        Inspect::Ir,
    )
}

/// Both renderings of a fixture's IR.
fn rendered(result: &InspectResult, label: &str) -> (String, String) {
    let json = result
        .render(InspectFormat::Json)
        .unwrap_or_else(|| panic!("{label} has no IR: {:#?}", result.report));
    let human = result.render(InspectFormat::Human).unwrap();
    (json, human)
}

fn check_golden(path: &Path, actual: &str) {
    if blessing() {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, actual).unwrap();
        return;
    }
    let expected = fs::read_to_string(path).unwrap_or_else(|e| {
        panic!(
            "missing golden {} ({e}); run `MTEK_BLESS=1 cargo test -p mtek-compiler --test ir_goldens` and review it",
            path.display()
        )
    });
    assert_eq!(
        expected,
        actual,
        "golden {} differs; if the change is intended run `MTEK_BLESS=1 cargo test -p mtek-compiler --test ir_goldens` and review the diff",
        path.display()
    );
}

#[test]
fn ir_goldens_of_the_m1_scene_fixtures() {
    let dir = repo().join("tests/codegen/ir");
    for name in GOLDEN_FIXTURES {
        let result = inspect_fixture("pass", name, None);
        let (json, human) = rendered(&result, name);
        check_golden(&dir.join(format!("{name}.ir.json")), &json);
        check_golden(&dir.join(format!("{name}.ir.txt")), &human);
    }
    // No stray goldens: every file in the directory belongs to a fixture.
    let mut stray: Vec<String> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|file| {
            !GOLDEN_FIXTURES
                .iter()
                .any(|name| *file == format!("{name}.ir.json") || *file == format!("{name}.ir.txt"))
        })
        .collect();
    stray.sort();
    assert!(stray.is_empty(), "files without a fixture: {stray:?}");
}

#[test]
fn ir_is_byte_identical_across_runs_and_shuffled_listings() {
    let names = fixtures("pass");
    assert!(names.len() >= 5, "{names:?}");
    for name in &names {
        let first = rendered(&inspect_fixture("pass", name, None), name);
        let second = rendered(&inspect_fixture("pass", name, None), name);
        assert_eq!(first, second, "pass/{name}");
        for seed in [1, 2, 3, 0x5eed] {
            let shuffled = rendered(&inspect_fixture("pass", name, Some(seed)), name);
            assert_eq!(first, shuffled, "pass/{name} with seed {seed}");
        }
    }
}

/// Every object in `value` (depth first), with its JSON path.
fn objects<'v>(
    value: &'v Value,
    path: String,
    out: &mut Vec<(String, &'v serde_json::Map<String, Value>)>,
) {
    match value {
        Value::Object(map) => {
            out.push((path.clone(), map));
            for (key, child) in map {
                objects(child, format!("{path}.{key}"), out);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                objects(child, format!("{path}[{index}]"), out);
            }
        }
        _ => {}
    }
}

/// `path::Qualified.Name`: a normalised module path, `::`, and one or more
/// identifiers joined by `.`.
fn is_symbol(text: &str) -> bool {
    let Some((path, qualified)) = text.split_once("::") else {
        return false;
    };
    let identifier = |part: &str| {
        let mut chars = part.chars();
        chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    };
    path.ends_with(".mtek")
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        && !qualified.is_empty()
        && qualified.split('.').all(identifier)
}

#[test]
fn every_node_has_a_span_in_its_file_and_every_symbol_is_qualified() {
    for name in fixtures("pass") {
        let result = inspect_fixture("pass", &name, None);
        let (json, _) = rendered(&result, &name);
        let value: Value = serde_json::from_str(&json).unwrap();
        // Every symbol of a module starts with that module's path, and every
        // span of a module is in that module's file (decision 0036).
        let mut found = Vec::new();
        for (index, module) in value["modules"].as_array().unwrap().iter().enumerate() {
            let mut inside = Vec::new();
            objects(module, format!("$.modules[{index}]"), &mut inside);
            let prefix = format!("{}::", module["path"].as_str().unwrap());
            let file = module["file"].as_u64().unwrap();
            found.extend(
                inside
                    .into_iter()
                    .map(|(path, object)| (path, object, prefix.clone(), file)),
            );
        }
        let mut symbols = 0;
        for (path, object, prefix, module_file) in &found {
            if let Some(Value::Object(span)) = object.get("span") {
                assert_eq!(
                    span["file"].as_u64(),
                    Some(*module_file),
                    "pass/{name} {path}"
                );
            }
            if let Some(symbol) = object.get("symbol") {
                let symbol = symbol.as_str().unwrap();
                assert!(is_symbol(symbol), "pass/{name} {path}: {symbol}");
                assert!(
                    symbol.starts_with(prefix.as_str()),
                    "pass/{name} {path}: {symbol}"
                );
                assert!(
                    object.contains_key("span"),
                    "pass/{name} {path} has no span"
                );
                symbols += 1;
            }
            // Nodes with an origin (fields, descriptors) have a span too.
            if object.contains_key("origin") {
                assert!(
                    object.contains_key("span"),
                    "pass/{name} {path} has no span"
                );
            }
            if let Some(Value::Object(span)) = object.get("span") {
                let file = span["file"].as_u64().unwrap();
                let (start, end) = (
                    span["start"].as_u64().unwrap(),
                    span["end"].as_u64().unwrap(),
                );
                let text = result
                    .sources
                    .files()
                    .find(|f| u64::from(f.id().0) == file)
                    .unwrap_or_else(|| panic!("pass/{name} {path}: unknown file {file}"))
                    .text();
                assert!(
                    start < end && end <= text.len() as u64,
                    "pass/{name} {path}: span {start}..{end}"
                );
            }
        }
        assert!(symbols >= 2, "pass/{name}: no symbols found");
        assert!(is_symbol(value["entryScene"].as_str().unwrap()));
        // No absolute paths, no host-specific text.
        assert!(!json.contains('\\') && !json.contains(":/"), "pass/{name}");
    }
    assert!(is_symbol("src/main.mtek::Demo.Cube") && is_symbol("std/materials.mtek::Unlit"));
    for bad in [
        "Demo.Cube",
        "src/main.mtek::",
        "/src/main.mtek::Demo",
        "src/../main.mtek::Demo",
        "src/main.mtek::Demo..Cube",
        "src/main.mtek::Demo.1",
    ] {
        assert!(!is_symbol(bad), "{bad}");
    }
}

#[test]
fn entities_are_in_pre_order_with_parent_indices() {
    let result = inspect_fixture("pass", "scene_b_orthographic_nested", None);
    let program = result.ir.as_ref().unwrap();
    let scene = program.entry().unwrap();
    let rows: Vec<(u32, &str, Option<u32>)> = scene
        .entities
        .iter()
        .map(|e| (e.index, e.symbol.as_str(), e.parent))
        .collect();
    assert_eq!(
        rows,
        [
            (0, "src/main.mtek::Courtyard.Ground", None),
            (1, "src/main.mtek::Courtyard.Ground.Fountain", Some(0)),
            (2, "src/main.mtek::Courtyard.Lamp", None),
        ]
    );
    for entity in &scene.entities {
        if let Some(parent) = entity.parent {
            assert!(parent < entity.index);
        }
    }
}

#[test]
fn a_program_with_errors_has_no_ir_and_the_diagnostics_of_check() {
    for name in fixtures("fail") {
        let memory = fixture_fs("fail", &name, None);
        let inspected = inspect(&ProjectRoot::at_base(), &memory, Inspect::Ir);
        assert!(inspected.has_errors(), "fail/{name}");
        assert!(inspected.ir.is_none(), "fail/{name}");
        assert!(inspected.render(InspectFormat::Json).is_none());
        assert!(inspected.render(InspectFormat::Human).is_none());
        let checked = check(&ProjectRoot::at_base(), &memory);
        assert_eq!(
            inspected.report.diagnostics, checked.report.diagnostics,
            "fail/{name}"
        );
        assert_eq!(inspected.project_name, checked.project_name, "fail/{name}");
    }
}

#[test]
fn a_program_without_errors_inspects_with_the_warnings_of_check() {
    // `redundant_conversion` checks with a warning (`W3050`) and still has
    // an IR.
    let inspected = inspect_fixture("pass", "redundant_conversion", None);
    let checked = check(
        &ProjectRoot::at_base(),
        &fixture_fs("pass", "redundant_conversion", None),
    );
    assert!(!inspected.report.diagnostics.is_empty());
    assert_eq!(inspected.report.diagnostics, checked.report.diagnostics);
    assert!(inspected.ir.is_some());
}
