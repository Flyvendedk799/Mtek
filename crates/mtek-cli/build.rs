//! Embeds the runtime bundle into the `mtek` binary (`spec/tooling.md` section 1).
//!
//! If `packages/runtime-web/dist/runtime.js` and `runtime.d.ts` both exist (`npm run build`
//! produces them), they are copied into `OUT_DIR`, where `src/runtime.rs` includes them with
//! `include_bytes!`, and the cfg `mtek_runtime_embedded` is set. Otherwise the binary is built
//! without them and `mtek build` reports `E9030`. This script never runs npm.

use std::path::{Path, PathBuf};
use std::{env, fs};

/// The two files, relative to `packages/runtime-web/dist/`, and their names in `OUT_DIR`.
const FILES: [&str; 2] = ["runtime.js", "runtime.d.ts"];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo::rustc-check-cfg=cfg(mtek_runtime_embedded)");
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let dist = manifest_dir.join("../../packages/runtime-web/dist");
    let sources: Vec<PathBuf> = FILES.iter().map(|name| dist.join(name)).collect();
    for source in &sources {
        println!("cargo::rerun-if-changed={}", source.display());
    }
    if !sources.iter().all(|source| source.is_file()) {
        return Ok(());
    }
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    for (source, name) in sources.iter().zip(FILES) {
        copy(source, &out_dir.join(name))?;
    }
    println!("cargo::rustc-cfg=mtek_runtime_embedded");
    Ok(())
}

/// Copies `from` to `to`, naming both on failure.
fn copy(from: &Path, to: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::copy(from, to)
        .map(|_| ())
        .map_err(|error| format!("copying {} to {}: {error}", from.display(), to.display()).into())
}
