//! Lowering from the typed IR to the code-generation IRs
//! (`spec/compiler-architecture.md` section 4.9).
//!
//! - [`shader_ir`]: the shader IR of section 7.1, printed to WGSL by
//!   [`crate::emit_wgsl::printer`],
//! - [`standard_stage`]: the generated vertex stage and fragment wrapper every material
//!   shares (`spec/materials.md` section 3).

pub mod shader_ir;
pub mod standard_stage;
