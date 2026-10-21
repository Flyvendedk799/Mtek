//! The prebuilt runtime of `crates/mtek-cli/prebuilt/` (decision 0161): `build.rs` embeds it when
//! `packages/runtime-web/dist/` was not built, so it must be complete and match its provenance
//! record. Whether it is *current* (built from today's sources) is `npm run check:prebuilt`, which
//! hashes the sources; this test needs no Node.

// Test-only code.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::Path;

use mtek_compiler::package::identity::sha256_hex;
use serde_json::Value;

const FILES: [&str; 4] = ["runtime.js", "runtime.dev.js", "runtime.d.ts", "physics.js"];

fn prebuilt() -> &'static Path {
    Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/prebuilt"))
}

#[test]
fn every_prebuilt_file_is_present_and_matches_its_provenance() {
    let provenance: Value =
        serde_json::from_str(&fs::read_to_string(prebuilt().join("PROVENANCE.json")).unwrap())
            .unwrap();
    for name in FILES {
        let bytes = fs::read(prebuilt().join(name))
            .unwrap_or_else(|e| panic!("prebuilt/{name} is missing ({e})"));
        let recorded = &provenance["files"][name];
        assert_eq!(
            recorded["sha256"].as_str(),
            Some(sha256_hex(&bytes).as_str()),
            "prebuilt/{name} differs from PROVENANCE.json; refresh with `npm run build && npm run prebuilt:write`"
        );
        assert_eq!(recorded["bytes"].as_u64(), Some(bytes.len() as u64));
    }
}

#[test]
fn the_prebuilt_bundles_are_the_real_ones() {
    let read = |name: &str| fs::read(prebuilt().join(name)).unwrap();
    let release = String::from_utf8_lossy(&read("runtime.js")).into_owned();
    let dev = String::from_utf8_lossy(&read("runtime.dev.js")).into_owned();
    // The development flavour has the overlay and the release flavour does not (decision 0055).
    assert!(dev.contains("data-mtek-dev-overlay"));
    assert!(!release.contains("data-mtek-dev-overlay"));
    assert!(String::from_utf8_lossy(&read("runtime.d.ts")).contains("mountMtek"));
    let physics = read("physics.js");
    assert!(
        physics.len() > 1_000_000,
        "the physics bundle carries Rapier's WebAssembly"
    );
}
