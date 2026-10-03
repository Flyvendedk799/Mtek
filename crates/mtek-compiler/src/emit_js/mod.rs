//! JavaScript emission (`spec/compiler-architecture.md` section 6).
//!
//! - [`printer`]: the small text printer every emitter writes through (indentation and the
//!   escaping rules that keep user-visible strings out of code),
//! - [`writers`]: the generated block writers of `spec/gpu-layout.md` section 7.
//!
//! Output is deterministic: it depends only on the layout record and the qualifier.

pub mod printer;
pub mod writers;

pub use writers::{
    EmittedWriters, emit_test_module, emit_writer_parts, emit_writers, writer_qualifier,
};
