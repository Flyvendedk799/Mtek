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
//!    (`E9001`; host-input targets `E9020`/`E9021`);
//! 3. the entry module is read into the [`SourceMap`](crate::source::SourceMap)
//!    (`E9005`) and becomes the first module of the [`ModuleGraph`];
//! 4. [`load_modules`] parses the entry module and follows its imports
//!    ([`resolve_specifier`], `E2030`–`E2036`), and [`report_cycles`] reports
//!    the cycles of the finished graph (`E2035`, decision 0036).
//!
//! Entry scene selection happens in [`crate::check`]; [`select_scene`] is the
//! parser-independent rule it applies.

mod config;
mod graph;
mod host_inputs;
mod load;
mod modules;
mod parse;
mod root;
mod scene;
mod specifier;

pub use config::{
    AssetsSection, BuildSection, BuildTarget, DEFAULT_DEV_PORT, DEFAULT_ENTRY, DEFAULT_FIXED_STEP,
    DEFAULT_MAX_ASSET_FILE_BYTES, DEFAULT_MAX_CATCH_UP_STEPS, DEFAULT_MAX_ENTITIES,
    DEFAULT_MAX_FRAME_DELTA, DEFAULT_OUT_DIR, DEV_PORT_RANGE, DevSection,
    MAX_ASSET_FILE_BYTES_RANGE, MAX_CATCH_UP_STEPS_RANGE, MAX_ENTITIES_RANGE, MAX_TIME_SECONDS,
    PROJECT_FILE, ProjectConfig, ProjectSection, RESERVED_DIRECTORY, RuntimeSection,
    SOURCE_EXTENSION,
};
pub use graph::{GraphError, Import, ImportCycle, MAX_MODULES, Module, ModuleGraph, ModuleId};
pub use host_inputs::{ResolvedHostInput, states_feeding_opaque_color, validate_host_inputs};
pub use load::Project;
pub use modules::{ImportLink, LoadedModule, load_modules, report_cycles};
pub(crate) use parse::edit_distance;
pub use parse::parse_config;
pub use root::{ProjectFs, ProjectRoot};
pub use scene::{SceneSelection, select_scene};
pub use specifier::{InvalidSpecifier, SpecifierError, resolve_specifier};
