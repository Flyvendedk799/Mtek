//! WGSL emission for GPU blocks (`spec/gpu-layout.md` sections 3, 4.4 and 9.2).
//!
//! - [`blocks`]: struct declarations, typed leaf accessors and binding declarations
//!   generated from a [`LayoutRecord`](crate::layout::LayoutRecord),
//! - [`validate`]: parsing and validation of emitted WGSL with the pinned Naga
//!   (`spec/compiler-architecture.md` section 8).
//!
//! The emitter never computes an offset: every `@align` and `@size` attribute is derived
//! from offsets, sizes and strides already present in the layout record.

pub mod blocks;
pub mod validate;

pub use blocks::{
    Leaf, LeafKind, emit_bindings, emit_block_structs, leaf_accessors, member_wgsl_name,
    padded_element_name, wgsl_struct_name,
};
pub use validate::{WgslErrorStage, WgslLabel, WgslValidationError, validate_wgsl};
