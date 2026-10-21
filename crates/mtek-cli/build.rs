//! Embeds the runtime bundles into the `mtek` binary (`spec/tooling.md` section 1).
//!
//! The runtime is `runtime.js`, `runtime.dev.js` and `runtime.d.ts` (the release flavour, the
//! development flavour with the overlay, and the declarations; decision 0055). They are taken from
//! the first of these directories that has all three:
//!
//! 1. `packages/runtime-web/dist/`, written by `npm run build`: a checkout that builds the runtime
//!    embeds what it built;
//! 2. `crates/mtek-cli/prebuilt/`, the prebuilt runtime checked into the repository (decision
//!    0131), so that `cargo build` on a fresh clone gives an `mtek` that can `build` without Node.
//!
//! They are copied into `OUT_DIR`, where `src/runtime.rs` includes them with `include_bytes!`, and
//! the cfg `mtek_runtime_embedded` is set; `MTEK_RUNTIME_ORIGIN` names the directory used (`dist`
//! or `prebuilt`). If neither directory has them the binary is built without a runtime and
//! `mtek build` reports `E9030`. This script never runs npm.
//!
//! The physics bundle `physics.js` (decision 0063) is chosen the same way, on its own, from
//! `packages/physics-rapier/dist/` and then `crates/mtek-cli/prebuilt/`, with the cfg
//! `mtek_physics_embedded`: without it only programs that use physics fail to build (`E9030`).

use std::path::{Path, PathBuf};
use std::{env, fs};

/// The runtime files and their names in `OUT_DIR`.
const FILES: [&str; 4] = [
    "runtime.js",
    "runtime.dev.js",
    "runtime.min.js",
    "runtime.d.ts",
];

/// The physics bundle; it keeps its name in `OUT_DIR`.
const PHYSICS_FILE: &str = "physics.js";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo::rustc-check-cfg=cfg(mtek_runtime_embedded)");
    println!("cargo::rustc-check-cfg=cfg(mtek_physics_embedded)");
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    let prebuilt = manifest_dir.join("prebuilt");

    let physics_dirs = [
        (
            "dist",
            manifest_dir.join("../../packages/physics-rapier/dist"),
        ),
        ("prebuilt", prebuilt.clone()),
    ];
    if let Some((origin, dir)) = first_with(&physics_dirs, &[PHYSICS_FILE]) {
        copy(&dir.join(PHYSICS_FILE), &out_dir.join(PHYSICS_FILE))?;
        println!("cargo::rustc-cfg=mtek_physics_embedded");
        println!("cargo::rustc-env=MTEK_PHYSICS_ORIGIN={origin}");
        println!("cargo::rustc-env=MTEK_PHYSICS_ORIGIN_DIR={}", dir.display());
    }

    let runtime_dirs = [
        ("dist", manifest_dir.join("../../packages/runtime-web/dist")),
        ("prebuilt", prebuilt),
    ];
    let Some((origin, dir)) = first_with(&runtime_dirs, &FILES) else {
        return Ok(());
    };
    for name in FILES {
        copy(&dir.join(name), &out_dir.join(name))?;
    }
    println!("cargo::rustc-cfg=mtek_runtime_embedded");
    println!("cargo::rustc-env=MTEK_RUNTIME_ORIGIN={origin}");
    println!("cargo::rustc-env=MTEK_RUNTIME_ORIGIN_DIR={}", dir.display());
    Ok(())
}

/// The first directory that has every one of `names`. Every candidate file is a rerun trigger, so
/// a later `npm run build` (or a deleted `dist/`) switches the source on the next `cargo build`.
fn first_with<'a>(
    dirs: &'a [(&'static str, PathBuf)],
    names: &[&str],
) -> Option<(&'static str, &'a Path)> {
    for (_, dir) in dirs {
        for name in names {
            println!("cargo::rerun-if-changed={}", dir.join(name).display());
        }
    }
    dirs.iter()
        .find(|(_, dir)| names.iter().all(|name| dir.join(name).is_file()))
        .map(|(origin, dir)| (*origin, dir.as_path()))
}

/// Copies `from` to `to`, naming both on failure.
fn copy(from: &Path, to: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::copy(from, to)
        .map(|_| ())
        .map_err(|error| format!("copying {} to {}: {error}", from.display(), to.display()).into())
}
