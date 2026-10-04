//! Lowering from the typed IR to the code-generation IRs
//! (`spec/compiler-architecture.md` section 4.9).
//!
//! - [`shader_ir`]: the shader IR of section 7.1, printed to WGSL by
//!   [`crate::emit_wgsl::printer`],
//! - [`standard_stage`]: the generated vertex stage and fragment wrapper every material
//!   shares (`spec/materials.md` section 3),
//! - [`shader`]: the typed IR of a material (fragment stage and GPU-reachable functions)
//!   to the shader IR (decision 0041),
//! - [`builtin_unlit`]: **temporary** (decision 0013, removed in M2-09): the compiler-built
//!   shader of the built-in `Unlit` material.

// TEMPORARY (decision 0013): removed in M2-09
pub mod builtin_unlit;
pub mod shader;
pub mod shader_ir;
pub mod standard_stage;
