//! Source text: file identities, spans, project paths, the file-system
//! abstraction, validated source files and position conversions.
//!
//! Text is stored exactly as on disk (`spec/language.md` section 1.2), so
//! every byte offset in this crate refers to the file as stored.

mod fs;
mod line_index;
mod map;
mod path;
mod span;

pub use fs::{Fs, FsError, MemFs};
pub use line_index::{LineCol, LineIndex, LspPosition};
pub use map::{MAX_SOURCE_BYTES, SourceError, SourceFile, SourceMap};
pub use path::{PathError, ProjectPath};
pub use span::{FileId, Span};
