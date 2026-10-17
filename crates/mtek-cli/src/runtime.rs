//! The runtime bundles compiled into this binary by `build.rs` (`spec/tooling.md` section 1):
//! `packages/runtime-web/dist/runtime.js`, `runtime.dev.js` and `runtime.d.ts` as they were when
//! the binary was built, or nothing if they did not exist then (`mtek build` then reports
//! `E9030`).

/// The embedded runtime files.
#[derive(Clone, Copy, Debug)]
pub struct Runtime {
    /// `runtime.js`, the release flavour (no development overlay), written as
    /// `runtime.<h16>.js` by `release` builds.
    pub bundle: &'static [u8],
    /// `runtime.dev.js`, the development flavour (overlay, GPU timing), written as
    /// `runtime.<h16>.js` by `dev` and `test` builds (decision 0055).
    pub dev_bundle: &'static [u8],
    /// `runtime.d.ts`.
    pub declarations: &'static [u8],
}

/// The runtime embedded in this binary.
#[cfg(mtek_runtime_embedded)]
pub fn embedded() -> Option<Runtime> {
    Some(Runtime {
        bundle: include_bytes!(concat!(env!("OUT_DIR"), "/runtime.js")),
        dev_bundle: include_bytes!(concat!(env!("OUT_DIR"), "/runtime.dev.js")),
        declarations: include_bytes!(concat!(env!("OUT_DIR"), "/runtime.d.ts")),
    })
}

/// The runtime embedded in this binary: none (built without `npm run build`).
#[cfg(not(mtek_runtime_embedded))]
pub fn embedded() -> Option<Runtime> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(mtek_runtime_embedded)]
    #[test]
    fn the_embedded_files_are_the_built_runtime() {
        let runtime = embedded().unwrap();
        let dist = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/runtime-web/dist"
        );
        assert_eq!(
            runtime.bundle,
            std::fs::read(format!("{dist}/runtime.js")).unwrap()
        );
        assert_eq!(
            runtime.dev_bundle,
            std::fs::read(format!("{dist}/runtime.dev.js")).unwrap()
        );
        assert_eq!(
            runtime.declarations,
            std::fs::read(format!("{dist}/runtime.d.ts")).unwrap()
        );
    }

    /// The release flavour has no development code; the development flavour has the overlay
    /// (the contents are inspected from both embedded bundles, decision 0055).
    #[cfg(mtek_runtime_embedded)]
    #[test]
    fn only_the_development_bundle_has_the_overlay() {
        let runtime = embedded().unwrap();
        let contains =
            |bundle: &[u8], needle: &str| String::from_utf8_lossy(bundle).contains(needle);
        for needle in ["data-mtek-dev-overlay", "GPU time unavailable"] {
            assert!(
                contains(runtime.dev_bundle, needle),
                "the development bundle lacks {needle:?}"
            );
            assert!(
                !contains(runtime.bundle, needle),
                "the release bundle contains {needle:?}"
            );
        }
        assert_ne!(runtime.bundle, runtime.dev_bundle);
    }

    #[cfg(not(mtek_runtime_embedded))]
    #[test]
    fn nothing_is_embedded_without_the_built_runtime() {
        assert!(embedded().is_none());
    }
}
