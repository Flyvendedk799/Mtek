//! The layout fixtures of `tests/gpu-layout/`, shared by the examples that dump them
//! (`layout_fixtures`, `bridge_spike`). Included with `#[path = "support/fixtures.rs"]`;
//! cargo does not treat files below `examples/support/` as examples.

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::layout::fixture::parse_type_json;
use mtek_compiler::layout::{LayoutRecord, compute};

/// The directory holding the `<name>.type.json` fixtures.
pub fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/gpu-layout")
}

/// Record id and WGSL struct name by the fixture naming rule (`spec/gpu-layout.md` section 5).
fn identity(name: &str) -> (String, String) {
    match name {
        "builtin_frame" => ("builtin:frame".to_owned(), "MtekFrame".to_owned()),
        "builtin_object" => ("builtin:object".to_owned(), "MtekObject".to_owned()),
        other => (format!("fixture:{other}"), format!("MtekFixture_{other}")),
    }
}

/// Fixture names (`<name>.type.json`) in sorted order.
pub fn fixture_names(dir: &Path) -> Result<Vec<String>, Box<dyn Error>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let file = entry?.file_name();
        if let Some(name) = file.to_str().and_then(|f| f.strip_suffix(".type.json")) {
            names.push(name.to_owned());
        }
    }
    names.sort();
    Ok(names)
}

/// The layout record the layout engine computes for the fixture `name`.
pub fn record_of(dir: &Path, name: &str) -> Result<LayoutRecord, Box<dyn Error>> {
    let text = fs::read_to_string(dir.join(format!("{name}.type.json")))?;
    let ty = parse_type_json(&text).map_err(|e| format!("fixture {name}: {e}"))?;
    let (id, wgsl_struct) = identity(name);
    compute(&ty, &id, &wgsl_struct).map_err(|e| format!("fixture {name}: {e}").into())
}
