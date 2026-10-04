//! The runtime bundle compiled into this binary by `build.rs` (`spec/tooling.md` section 1):
//! `packages/runtime-web/dist/runtime.js` and `runtime.d.ts` as they were when the binary was
//! built, or nothing if they did not exist then (`mtek build` then reports `E9030`).

/// The embedded runtime files.
#[derive(Clone, Copy, Debug)]
pub struct Runtime {
    /// `runtime.js`, written as `runtime.<h16>.js`.
    pub bundle: &'static [u8],
    /// `runtime.d.ts`.
    pub declarations: &'static [u8],
}

/// The runtime embedded in this binary.
#[cfg(mtek_runtime_embedded)]
pub fn embedded() -> Option<Runtime> {
    Some(Runtime {
        bundle: include_bytes!(concat!(env!("OUT_DIR"), "/runtime.js")),
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
            runtime.declarations,
            std::fs::read(format!("{dist}/runtime.d.ts")).unwrap()
        );
    }

    #[cfg(not(mtek_runtime_embedded))]
    #[test]
    fn nothing_is_embedded_without_the_built_runtime() {
        assert!(embedded().is_none());
    }
}
