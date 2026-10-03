//! The layout engine: one authoritative layout record per GPU block
//! (`spec/gpu-layout.md`, decision 0010).
//!
//! - [`types`]: [`LayoutType`], the typed block description,
//! - [`compute`]: the uniform-address-space algorithm and [`compute()`](compute::compute),
//! - [`record`]: [`LayoutRecord`] / [`LayoutNode`], the serialisable result,
//! - [`builtin`]: the compiler-owned frame and object blocks,
//! - [`fixture`]: the JSON type format of the layout fixtures.
//!
//! The WGSL emitter, the JavaScript writers and the manifest are all generated from the
//! record; none of them computes an offset on its own.

pub mod builtin;
pub mod compute;
pub mod error;
pub mod fixture;
pub mod record;
pub mod types;

pub use builtin::{BuiltinBlock, builtin_blocks};
pub use compute::{compute, layout_struct, u_align, u_size, u_stride};
pub use error::LayoutError;
pub use record::{LayoutMember, LayoutNode, LayoutRecord, ScalarKind};
pub use types::LayoutType;
