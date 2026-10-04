//! Packaging (`spec/compiler-architecture.md` section 4.11, `spec/runtime-abi.md` sections 2
//! and 5): the manifest model and builder, the build identity, `index.html`, and the
//! assembly of the `dist/` file set as an in-memory `BTreeMap<String, Vec<u8>>`.
//!
//! - [`manifest`]: serde types of `program.manifest.json`, mirroring
//!   `spec/manifest.schema.json`;
//! - [`spans`]: the manifest's `spans` table with line and column ranges (decision 0019);
//! - [`builder`]: [`package`], which turns the typed IR into the file set, with the steps
//!   `mtek inspect` shares ([`checked_plan`], [`material_shaders`]);
//! - [`identity`]: content hashes and the build id;
//! - [`html`]: `index.html` per build mode;
//! - [`replace`]: the pure replace-on-success plan the command line tool executes.

pub mod builder;
pub mod html;
pub mod identity;
pub mod manifest;
pub mod replace;
pub mod spans;

pub use builder::{
    APP_DTS, APP_JS, APP_JS_MAP, INDEX_HTML, MANIFEST_JSON, Package, PackageInput, RUNTIME_DTS,
    checked_plan, material_shaders, package,
};
pub use manifest::Manifest;
pub use replace::{ReplacePlan, ReplaceStep};
