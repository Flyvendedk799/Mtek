//! The runtime bundles compiled into this binary by `build.rs` (`spec/tooling.md` section 1):
//! `runtime.js`, `runtime.dev.js` and `runtime.d.ts` from `packages/runtime-web/dist/` when they
//! were built, else from the prebuilt copy in `crates/mtek-cli/prebuilt/` (decision 0161), or
//! nothing if neither existed (`mtek build` then reports `E9030`); and, separately, `physics.js`
//! from `packages/physics-rapier/dist/` or the prebuilt copy (decision 0063).

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
    /// `packages/physics-rapier/dist/physics.js`, written as `physics/<h16>.js` by builds of
    /// programs that use physics (decision 0063); `None` if it did not exist when the binary was
    /// built.
    pub physics_bundle: Option<&'static [u8]>,
}

/// The physics bundle embedded in this binary (only meaningful together with the runtime).
#[cfg(all(mtek_runtime_embedded, mtek_physics_embedded))]
const PHYSICS_BUNDLE: Option<&[u8]> = Some(include_bytes!(concat!(env!("OUT_DIR"), "/physics.js")));

/// The physics bundle embedded in this binary: none (built without `npm run build`).
#[cfg(all(mtek_runtime_embedded, not(mtek_physics_embedded)))]
const PHYSICS_BUNDLE: Option<&[u8]> = None;

/// The runtime embedded in this binary.
#[cfg(mtek_runtime_embedded)]
pub fn embedded() -> Option<Runtime> {
    Some(Runtime {
        bundle: include_bytes!(concat!(env!("OUT_DIR"), "/runtime.js")),
        dev_bundle: include_bytes!(concat!(env!("OUT_DIR"), "/runtime.dev.js")),
        declarations: include_bytes!(concat!(env!("OUT_DIR"), "/runtime.d.ts")),
        physics_bundle: PHYSICS_BUNDLE,
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
        // `dist/` when the runtime was built, the prebuilt copy otherwise (decision 0161).
        let dist = env!("MTEK_RUNTIME_ORIGIN_DIR");
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

    #[cfg(all(mtek_runtime_embedded, mtek_physics_embedded))]
    #[test]
    fn the_embedded_physics_bundle_is_the_built_adapter() {
        let physics = embedded().unwrap().physics_bundle.unwrap();
        assert_eq!(
            physics,
            std::fs::read(concat!(env!("MTEK_PHYSICS_ORIGIN_DIR"), "/physics.js")).unwrap()
        );
        // The adapter and Rapier's WebAssembly, not a stub.
        assert!(physics.len() > 1_000_000);
        assert!(String::from_utf8_lossy(physics).contains("rapier3d-compat@"));
    }

    /// The real runtime and physics bundles through the compiler: a physics build carries
    /// `physics/<h16>.js` with the embedded bytes, and a program without physics does not, though
    /// the same options carry the bundle (decision 0063).
    #[cfg(all(mtek_runtime_embedded, mtek_physics_embedded))]
    #[test]
    fn physics_builds_carry_the_real_bundle_and_others_do_not() {
        use mtek_compiler::package::Manifest;
        use mtek_compiler::package::identity::h16;
        use mtek_compiler::project::ProjectRoot;
        use mtek_compiler::source::{MemFs, ProjectPath};
        use mtek_compiler::{BuildMode, CompileOptions, build};
        use std::sync::Arc;

        let runtime = embedded().unwrap();
        let mut project = MemFs::new();
        project
            .insert(
                ProjectPath::new("mtek.toml").unwrap(),
                "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n",
            )
            .insert(
                ProjectPath::new("src/main.mtek").unwrap(),
                "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Box {}; }\n}\n",
            );
        let options = |force: bool| CompileOptions {
            mode: BuildMode::Release,
            runtime_bundle: Some(Arc::from(runtime.bundle)),
            dev_runtime_bundle: Some(Arc::from(runtime.dev_bundle)),
            runtime_declarations: Some(Arc::from(runtime.declarations)),
            physics_bundle: runtime.physics_bundle.map(Arc::from),
            force_physics_subsystem: force,
            ..CompileOptions::default()
        };
        let physics = runtime.physics_bundle.unwrap();
        let name = format!("physics/{}.js", h16(physics));

        let without = build(&ProjectRoot::at_base(), &project, &options(false));
        assert!(!without.has_errors(), "{:?}", without.report.diagnostics);
        assert!(
            without
                .files
                .keys()
                .all(|path| !path.starts_with("physics"))
        );

        let with = build(&ProjectRoot::at_base(), &project, &options(true));
        assert!(!with.has_errors(), "{:?}", with.report.diagnostics);
        assert_eq!(with.files[&name], physics);
        let manifest =
            Manifest::from_json(std::str::from_utf8(&with.files["program.manifest.json"]).unwrap())
                .unwrap();
        assert!(manifest.subsystems.physics);

        // A body in the source is enough, with no option (decision 0065).
        let mut with_body = MemFs::new();
        with_body
            .insert(
                ProjectPath::new("mtek.toml").unwrap(),
                "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n",
            )
            .insert(
                ProjectPath::new("src/main.mtek").unwrap(),
                "scene Demo {\n    camera Main {}\n    entity Floor {\n        mesh: Box {};\n        body: Static {};\n        collider: BoxCollider { size: vec3(1.0, 1.0, 1.0); };\n    }\n}\n",
            );
        let by_source = build(&ProjectRoot::at_base(), &with_body, &options(false));
        assert!(
            !by_source.has_errors(),
            "{:?}",
            by_source.report.diagnostics
        );
        assert_eq!(by_source.files[&name], physics);
        let manifest = Manifest::from_json(
            std::str::from_utf8(&by_source.files["program.manifest.json"]).unwrap(),
        )
        .unwrap();
        assert!(manifest.subsystems.physics);
    }

    #[cfg(not(mtek_runtime_embedded))]
    #[test]
    fn nothing_is_embedded_without_the_built_runtime() {
        assert!(embedded().is_none());
    }
}
