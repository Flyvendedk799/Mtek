//! The Mtek compiler library.
//!
//! The public entry points (`spec/compiler-architecture.md` section 4.12):
//! [`check`] (diagnostics only), [`inspect`] (the typed IR, decision 0028),
//! [`analyze`] (everything the front end produced) and [`build`] (the
//! `dist/` file set in memory, decision 0030), plus the version constants the
//! command line tool and the runtime agree on.

pub mod emit_js;
pub mod emit_wgsl;
pub mod ir;
pub mod layout;
pub mod lowering;
pub mod package;
pub mod plan;
pub mod stdlib;

/// Version of this compiler build (the workspace package version).
pub const COMPILER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Version of the Mtek language this compiler implements.
pub const LANGUAGE_VERSION: &str = "0.1";

/// Version of the runtime ABI emitted programs target.
pub const RUNTIME_ABI: u32 = 1;

pub mod diagnostics;
pub mod project;
pub mod resolve;
pub mod source;
pub mod syntax;
pub mod types;

mod build;
mod check;
mod inspect;
pub use build::{
    BuildMode, BuildResult, CompileOptions, STUB_RUNTIME_BUNDLE, STUB_RUNTIME_DECLARATIONS,
    TargetProfile, build,
};
pub use check::{Analysis, CheckResult, analyze, check};
pub use inspect::{Inspect, InspectFormat, InspectResult, inspect};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_constants_match_the_specification() {
        assert_eq!(COMPILER_VERSION, "0.1.0-dev");
        assert_eq!(LANGUAGE_VERSION, "0.1");
        assert_eq!(RUNTIME_ABI, 1);
    }
}
