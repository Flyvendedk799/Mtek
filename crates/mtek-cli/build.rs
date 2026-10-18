//! Embeds the runtime bundles into the `mtek` binary (`spec/tooling.md` section 1).
//!
//! If `packages/runtime-web/dist/runtime.js`, `runtime.dev.js` and `runtime.d.ts` all exist
//! (`npm run build` produces them: the release flavour, the development flavour with the overlay,
//! and the declarations; decision 0055), they are copied into `OUT_DIR`, where `src/runtime.rs`
//! includes them with `include_bytes!`, and the cfg `mtek_runtime_embedded` is set. Otherwise the
//! binary is built without them and `mtek build` reports `E9030`. This script never runs npm.
//!
//! The physics bundle `packages/physics-rapier/dist/physics.js` (decision 0063) is embedded the
//! same way but on its own, with the cfg `mtek_physics_embedded`: without it only programs that use
//! physics fail to build (`E9030`).

use std::path::{Path, PathBuf};
use std::{env, fs};

/// The files, relative to `packages/runtime-web/dist/`, and their names in `OUT_DIR`.
const FILES: [&str; 3] = ["runtime.js", "runtime.dev.js", "runtime.d.ts"];

/// The physics bundle, relative to `packages/physics-rapier/dist/`; it keeps its name in `OUT_DIR`.
const PHYSICS_FILE: &str = "physics.js";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo::rustc-check-cfg=cfg(mtek_runtime_embedded)");
    println!("cargo::rustc-check-cfg=cfg(mtek_physics_embedded)");
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);

    let physics = manifest_dir
        .join("../../packages/physics-rapier/dist")
        .join(PHYSICS_FILE);
    println!("cargo::rerun-if-changed={}", physics.display());
    if physics.is_file() {
        copy(&physics, &out_dir.join(PHYSICS_FILE))?;
        println!("cargo::rustc-cfg=mtek_physics_embedded");
    }

    let dist = manifest_dir.join("../../packages/runtime-web/dist");
    let sources: Vec<PathBuf> = FILES.iter().map(|name| dist.join(name)).collect();
    for source in &sources {
        println!("cargo::rerun-if-changed={}", source.display());
    }
    if !sources.iter().all(|source| source.is_file()) {
        return Ok(());
    }
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
