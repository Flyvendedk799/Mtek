//! Project loading: the `mtek.toml` model, project-root discovery, the entry
//! module and the module graph (`spec/compiler-architecture.md` section 4.4,
//! `spec/tooling.md` section 3).
//!
//! Everything goes through the [`Fs`](crate::source::Fs) trait; this module
//! performs no I/O of its own. [`Project::load`] is the entry point the
//! commands share:
//!
//! 1. [`ProjectRoot::discover`] finds the project directory (`E9004`);
//! 2. [`parse_config`] validates `mtek.toml` into a [`ProjectConfig`]
//!    (`E9001`, `E9010` for `[host.inputs]`);
//! 3. the entry module is read into the [`SourceMap`](crate::source::SourceMap)
//!    (`E9005`) and becomes the first module of the [`ModuleGraph`].
//!
//! Parsing, `import` gating and entry scene selection happen in [`crate::check`];
//! [`select_scene`] is the parser-independent rule it applies.

mod config;
mod graph;
mod load;
mod parse;
mod root;
mod scene;

pub use config::{
    AssetsSection, BuildSection, BuildTarget, DEFAULT_DEV_PORT, DEFAULT_ENTRY, DEFAULT_FIXED_STEP,
    DEFAULT_MAX_ASSET_FILE_BYTES, DEFAULT_MAX_CATCH_UP_STEPS, DEFAULT_MAX_ENTITIES,
    DEFAULT_MAX_FRAME_DELTA, DEFAULT_OUT_DIR, DEV_PORT_RANGE, DevSection,
    MAX_ASSET_FILE_BYTES_RANGE, MAX_CATCH_UP_STEPS_RANGE, MAX_ENTITIES_RANGE, MAX_TIME_SECONDS,
    PROJECT_FILE, ProjectConfig, ProjectSection, RESERVED_DIRECTORY, RuntimeSection,
    SOURCE_EXTENSION,
};
pub use graph::{GraphError, Import, ImportCycle, MAX_MODULES, Module, ModuleGraph, ModuleId};
pub use load::Project;
pub(crate) use parse::edit_distance;
pub use parse::parse_config;
pub use root::{ProjectFs, ProjectRoot};
pub use scene::{SceneSelection, select_scene};
