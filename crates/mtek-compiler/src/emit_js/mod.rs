//! JavaScript emission (`spec/compiler-architecture.md` section 6).
//!
//! - [`printer`]: the small text printer every emitter writes through (indentation and the
//!   escaping rules that keep user-visible strings out of code),
//! - [`ast`]: the JavaScript AST of the program module and its deterministic printer,
//! - [`writers`]: the generated block writers of `spec/gpu-layout.md` section 7,
//! - [`program`]: [`emit_program`], the program module `app.js` of `spec/runtime-abi.md`
//!   section 3,
//! - [`source_map`]: the Source Map v3 of `app.js` and its VLQ writer,
//! - [`dts`]: the host declarations `app.d.ts`.
//!
//! Output is deterministic: it depends only on the IR, the resource plan and the layout
//! records.

pub mod ast;
pub mod dts;
pub mod printer;
pub mod program;
pub mod source_map;
pub mod writers;

pub use ast::{JsModule, Mapping};
pub use dts::emit_app_dts;
pub use program::{ProgramParts, emit_program};
pub use source_map::{SourceMapDocument, source_map};
pub use writers::{
    EmittedWriters, emit_test_module, emit_writer_parts, emit_writers, writer_qualifier,
};
