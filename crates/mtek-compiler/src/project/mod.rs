//! Project loading: the `mtek.toml` model, project-root discovery, the entry
//! module and the module graph (`spec/compiler-architecture.md` section 4.4,
//! `spec/tooling.md` section 3).

mod config;
mod graph;
mod parse;
mod root;
mod scene;

pub use config::{
    AssetsSection, BuildSection, BuildTarget, DEFAULT_DEV_PORT, DEFAULT_ENTRY, DEFAULT_FIXED_STEP,
    DEFAULT_MAX_ASSET_FILE_BYTES, DEFAULT_MAX_CATCH_UP_STEPS, DEFAULT_MAX_ENTITIES,
    DEFAULT_MAX_FRAME_DELTA, DEFAULT_OUT_DIR, DEV_PORT_RANGE, DevSection,
    MAX_ASSET_FILE_BYTES_RANGE, MAX_CATCH_UP_STEPS_RANGE, MAX_ENTITIES_RANGE, MAX_TIME_SECONDS,
    PROJECT_FILE, ProjectConfig, ProjectSection, RuntimeSection, SOURCE_EXTENSION,
};
pub use graph::{GraphError, Import, ImportCycle, MAX_MODULES, Module, ModuleGraph, ModuleId};
pub use parse::parse_config;
pub use root::{ProjectFs, ProjectRoot};
pub use scene::{SceneSelection, select_scene};
