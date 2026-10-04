//! WGSL emission (`spec/gpu-layout.md` sections 3, 4.4 and 9.2,
//! `spec/compiler-architecture.md` sections 7 and 8).
//!
//! - [`blocks`]: struct declarations, typed leaf accessors and binding declarations
//!   generated from a [`LayoutRecord`](crate::layout::LayoutRecord),
//! - [`printer`]: the WGSL printer of the shader IR
//!   ([`crate::lowering::shader_ir`]) and its span map,
//! - [`span_map`]: the WGSL span map (`spec/runtime-abi.md` section 5.4),
//! - [`validate`](mod@validate): parsing and validation of emitted WGSL with the pinned
//!   Naga.
//!
//! The emitter never computes an offset: every `@align` and `@size` attribute is derived
//! from offsets, sizes and strides already present in the layout record.

pub mod blocks;
pub mod printer;
pub mod span_map;
pub mod validate;

pub use blocks::{
    Leaf, LeafKind, emit_bindings, emit_block_structs, leaf_accessors, member_wgsl_name,
    padded_element_name, wgsl_struct_name,
};
pub use printer::{PrintedModule, print_module};
pub use span_map::{SpanMap, SpanMapDocument, SpanMapEntry, WgslRange};
pub use validate::{WgslErrorStage, WgslLabel, WgslValidationError, validate_wgsl};
