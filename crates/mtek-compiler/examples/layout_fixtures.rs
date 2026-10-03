//! Dumps the layout record and the generated JavaScript writers of every layout fixture.
//!
//! ```text
//! cargo run -p mtek-compiler --example layout_fixtures -- <out_dir>
//! ```
//!
//! For each `tests/gpu-layout/<name>.type.json` this writes
//!
//! - `<out_dir>/<name>.layout.json`: the record computed by the layout engine,
//! - `<out_dir>/<name>.writers.js`: the private writer functions followed by a test-only
//!   `export` statement (`spec/gpu-layout.md` section 7). The export wrapper exists only in
//!   this test artifact and never in `app.js`.
//!
//! The JavaScript encoder cross-check (`tests/codegen/layout.test.ts`) consumes these files.
//! Output is deterministic: fixtures are processed in sorted order and nothing depends on
//! time, paths or hash-map order.

use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::emit_js::{emit_test_module, writer_qualifier};
use mtek_compiler::layout::fixture::parse_type_json;
use mtek_compiler::layout::{LayoutRecord, compute};

/// Record id and WGSL struct name by the fixture naming rule (`spec/gpu-layout.md` section 5).
fn identity(name: &str) -> (String, String) {
    match name {
        "builtin_frame" => ("builtin:frame".to_owned(), "MtekFrame".to_owned()),
        "builtin_object" => ("builtin:object".to_owned(), "MtekObject".to_owned()),
        other => (format!("fixture:{other}"), format!("MtekFixture_{other}")),
    }
}

/// Fixture names (`<name>.type.json`) in sorted order.
fn fixture_names(dir: &Path) -> Result<Vec<String>, Box<dyn Error>> {
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

fn record_of(dir: &Path, name: &str) -> Result<LayoutRecord, Box<dyn Error>> {
    let text = fs::read_to_string(dir.join(format!("{name}.type.json")))?;
    let ty = parse_type_json(&text).map_err(|e| format!("fixture {name}: {e}"))?;
    let (id, wgsl_struct) = identity(name);
    compute(&ty, &id, &wgsl_struct).map_err(|e| format!("fixture {name}: {e}").into())
}

fn main() -> Result<(), Box<dyn Error>> {
    let out_dir: PathBuf = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: layout_fixtures <out_dir>")?;
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/gpu-layout");
    fs::create_dir_all(&out_dir)?;

    let names = fixture_names(&fixtures)?;
    if names.is_empty() {
        return Err(format!("no fixtures found in {}", fixtures.display()).into());
    }
    for name in &names {
        let record = record_of(&fixtures, name)?;
        let mut json = serde_json::to_string_pretty(&record)?;
        json.push('\n');
        fs::write(out_dir.join(format!("{name}.layout.json")), json)?;
        let module = emit_test_module(&record, &writer_qualifier(&record));
        fs::write(out_dir.join(format!("{name}.writers.js")), module)?;
    }
    println!("wrote {} fixtures to {}", names.len(), out_dir.display());
    Ok(())
}
