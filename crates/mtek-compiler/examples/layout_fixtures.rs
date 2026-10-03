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
use std::path::PathBuf;

use mtek_compiler::emit_js::{emit_test_module, writer_qualifier};

#[path = "support/fixtures.rs"]
mod fixtures;

fn main() -> Result<(), Box<dyn Error>> {
    let out_dir: PathBuf = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: layout_fixtures <out_dir>")?;
    let fixture_dir = fixtures::fixture_dir();
    fs::create_dir_all(&out_dir)?;

    let names = fixtures::fixture_names(&fixture_dir)?;
    if names.is_empty() {
        return Err(format!("no fixtures found in {}", fixture_dir.display()).into());
    }
    for name in &names {
        let record = fixtures::record_of(&fixture_dir, name)?;
        let mut json = serde_json::to_string_pretty(&record)?;
        json.push('\n');
        fs::write(out_dir.join(format!("{name}.layout.json")), json)?;
        let module = emit_test_module(&record, &writer_qualifier(&record));
        fs::write(out_dir.join(format!("{name}.writers.js")), module)?;
    }
    println!("wrote {} fixtures to {}", names.len(), out_dir.display());
    Ok(())
}
