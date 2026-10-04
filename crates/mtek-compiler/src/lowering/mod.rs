//! Lowering from the typed IR to the code-generation IRs
//! (`spec/compiler-architecture.md` section 4.9).
//!
//! - [`shader_ir`]: the shader IR of section 7.1, printed to WGSL by
//!   [`crate::emit_wgsl::printer`].

pub mod shader_ir;
