//! Packaging (`spec/compiler-architecture.md` section 4.11, `spec/runtime-abi.md` sections 2
//! and 5): the manifest model and builder, the build identity, `index.html`, and the
//! assembly of the `dist/` file set as an in-memory `BTreeMap<String, Vec<u8>>`.
//!
//! - [`manifest`]: serde types of `program.manifest.json`, mirroring
//!   `spec/manifest.schema.json`.

pub mod manifest;
pub mod spans;
