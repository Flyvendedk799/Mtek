//! Helpers shared by the WGSL block tests: the layout fixtures of `tests/gpu-layout/` and the
//! WGSL module the oracle and the goldens are built from.

// Helpers outside `#[test]` functions report broken fixtures by panicking, and each test
// crate uses only part of this module.
#![allow(clippy::panic, dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::emit_wgsl::{emit_bindings, emit_block_structs};
use mtek_compiler::layout::fixture::parse_type_json;
use mtek_compiler::layout::{LayoutRecord, compute};

/// Group, binding and variable name every fixture block is bound to in the oracle module.
pub const GROUP: u32 = 1;
pub const BINDING: u32 = 0;
pub const VAR_NAME: &str = "mtek_params";

pub fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/gpu-layout")
}

pub fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/codegen/wgsl-blocks")
}

pub fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read file {}: {e}", path.display()))
}

/// Fixture names (`<name>.type.json`) in sorted order.
pub fn fixture_names() -> Vec<String> {
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

pub fn compute_fixture(name: &str) -> LayoutRecord {
    let ty = parse_type_json(&read(&fixture_dir().join(format!("{name}.type.json"))))
        .unwrap_or_else(|e| panic!("fixture {name}: {e}"));
    let (id, wgsl_struct) = identity(name);
    compute(&ty, &id, &wgsl_struct).unwrap_or_else(|e| panic!("fixture {name}: {e}"))
}

/// The structs of a block followed by its uniform binding: the text of a golden file.
pub fn block_declarations(record: &LayoutRecord) -> String {
    format!(
        "{}\n{}",
        emit_block_structs(record),
        emit_bindings(GROUP, BINDING, VAR_NAME, &record.wgsl_struct)
    )
}
