//! The Mtek compiler library.
//!
//! At milestone M0 this crate only exposes the version constants that the
//! command line tool and the runtime agree on.

pub mod emit_js;
pub mod emit_wgsl;
pub mod layout;
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

mod check;
pub use check::{CheckResult, check};

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
