//! The typed model of `mtek.toml` (`spec/tooling.md` section 3).
//!
//! A [`ProjectConfig`] always holds a value for every key: keys the file
//! leaves out take the defaults of the specification. Values reaching this
//! model were validated by [`parse_config`](super::parse_config), so consumers
//! need no further range checks. The value ranges that the specification
//! leaves open are fixed in decision record 0018.

use std::collections::BTreeMap;

use crate::source::ProjectPath;

/// File name of the project file, searched for in the project root.
pub const PROJECT_FILE: &str = "mtek.toml";

/// Default of `project.entry`.
pub const DEFAULT_ENTRY: &str = "src/main.mtek";
/// Default of `build.out_dir`.
pub const DEFAULT_OUT_DIR: &str = "dist";
/// Extension every Mtek source file, and therefore the entry, carries.
pub const SOURCE_EXTENSION: &str = ".mtek";

/// The top-level directory reserved for the embedded standard library
/// (`std/materials.mtek`, decision 0028): `project.entry` may not lie in it,
/// so a project module never shares a path, a source id or a symbol prefix
/// with a prelude module (decision 0030).
pub const RESERVED_DIRECTORY: &str = "std";

/// Default of `runtime.fixed_step`: one sixtieth of a second as a binary32
/// value, as printed in `spec/runtime-abi.md`.
pub const DEFAULT_FIXED_STEP: f64 = 0.016_666_668;
/// Default of `runtime.max_catch_up_steps`.
pub const DEFAULT_MAX_CATCH_UP_STEPS: u32 = 4;
/// Default of `runtime.max_frame_delta` (seconds).
pub const DEFAULT_MAX_FRAME_DELTA: f64 = 0.1;
/// Default of `runtime.max_entities`.
pub const DEFAULT_MAX_ENTITIES: u32 = 16_384;
/// Default of `dev.port`.
pub const DEFAULT_DEV_PORT: u16 = 5173;
/// Default of `assets.max_file_bytes`: 64 MiB.
pub const DEFAULT_MAX_ASSET_FILE_BYTES: u64 = 67_108_864;

/// Largest accepted `runtime.fixed_step` and `runtime.max_frame_delta`
/// (seconds). Both must be finite and greater than zero (the manifest schema
/// requires `exclusiveMinimum: 0`); the upper bound rejects values that cannot
/// be meant as a simulation time step.
pub const MAX_TIME_SECONDS: f64 = 1.0;
/// Accepted range of `runtime.max_catch_up_steps` (the manifest schema
/// requires at least 1).
pub const MAX_CATCH_UP_STEPS_RANGE: (u32, u32) = (1, 1_000);
/// Accepted range of `runtime.max_entities` (the manifest schema requires at
/// least 1).
pub const MAX_ENTITIES_RANGE: (u32, u32) = (1, 1_048_576);
/// Accepted range of `dev.port`; port 0 would mean "any port" and contradicts
/// the documented default and fallback rule.
pub const DEV_PORT_RANGE: (u16, u16) = (1, u16::MAX);
/// Accepted range of `assets.max_file_bytes`: a binary glTF file stores its
/// lengths as 32-bit values, so no valid asset is larger than this.
pub const MAX_ASSET_FILE_BYTES_RANGE: (u64, u64) = (1, 4_294_967_295);

/// A constant, valid project path (the default paths above and
/// [`PROJECT_FILE`]). The fallback to the root is never taken: a unit test
/// checks every constant, which keeps this function free of `unwrap`.
pub(super) fn constant_path(text: &str) -> ProjectPath {
    ProjectPath::new(text).unwrap_or_else(|_| ProjectPath::root())
}

/// The platform a project is built for. Only `web` exists in v0.1.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BuildTarget {
    Web,
}

impl BuildTarget {
    /// The spelling in `mtek.toml`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            BuildTarget::Web => "web",
        }
    }
}

/// The `[project]` table.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ProjectSection {
    /// `name`, required: `[a-z0-9-]+`.
    pub name: String,
    /// `language`, required: always the compiler's language version.
    pub language: String,
    /// `entry`: the entry module, relative to the project root.
    pub entry: ProjectPath,
    /// `scene`: the entry scene to run. `None` when the key is absent, which
    /// is fine if the entry module declares exactly one scene
    /// ([`select_scene`](super::select_scene)).
    pub scene: Option<String>,
}

/// The `[build]` table.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct BuildSection {
    pub target: BuildTarget,
    /// `out_dir`, relative to the project root.
    pub out_dir: ProjectPath,
    /// `title`: the page title; the project name when the key is absent.
    pub title: String,
}

/// The `[runtime]` table.
#[derive(Clone, PartialEq, Debug)]
pub struct RuntimeSection {
    /// Seconds per fixed simulation step.
    pub fixed_step: f64,
    pub max_catch_up_steps: u32,
    /// Seconds; larger frame deltas are clamped to it.
    pub max_frame_delta: f64,
    pub max_entities: u32,
    pub pause_when_hidden: bool,
}

impl Default for RuntimeSection {
    fn default() -> Self {
        Self {
            fixed_step: DEFAULT_FIXED_STEP,
            max_catch_up_steps: DEFAULT_MAX_CATCH_UP_STEPS,
            max_frame_delta: DEFAULT_MAX_FRAME_DELTA,
            max_entities: DEFAULT_MAX_ENTITIES,
            pause_when_hidden: true,
        }
    }
}

/// The `[dev]` table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct DevSection {
    pub port: u16,
}

impl Default for DevSection {
    fn default() -> Self {
        Self {
            port: DEFAULT_DEV_PORT,
        }
    }
}

/// The `[assets]` table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct AssetsSection {
    pub max_file_bytes: u64,
}

impl Default for AssetsSection {
    fn default() -> Self {
        Self {
            max_file_bytes: DEFAULT_MAX_ASSET_FILE_BYTES,
        }
    }
}

/// A parsed and validated `mtek.toml`.
#[derive(Clone, PartialEq, Debug)]
pub struct ProjectConfig {
    pub project: ProjectSection,
    pub build: BuildSection,
    /// `[host.inputs]`: input name to the text `Scene.state_name`, sorted by
    /// name. Only the TOML type is checked here; the targets are validated
    /// against the scene in M3 (`E9020`, `E9021`), and until then a non-empty
    /// table is reported as `E9010`.
    pub host_inputs: BTreeMap<String, String>,
    pub runtime: RuntimeSection,
    pub dev: DevSection,
    pub assets: AssetsSection,
}
