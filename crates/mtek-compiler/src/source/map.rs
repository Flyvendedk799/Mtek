//! Source files and the map that owns them.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::Arc;

use sha2::{Digest, Sha256};

use super::line_index::{BOM_LEN, LineCol, LineIndex, LspPosition};
use super::path::ProjectPath;
use super::span::{FileId, Span};

/// Largest source file the compiler accepts: 4 MiB (`spec/language.md` 1.3,
/// `spec/compiler-architecture.md` section 9).
pub const MAX_SOURCE_BYTES: u32 = 4 * 1024 * 1024;

/// Why a file could not be added to a [`SourceMap`]. Each variant maps to one
/// catalogue code (`spec/diagnostics.md` section 5), so the diagnostics layer
/// can turn it into a diagnostic without re-inspecting the bytes. No file id
/// exists for a rejected file; the diagnostic locates it by path and byte
/// offset.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum SourceError {
    /// `E0001`: the bytes are not valid UTF-8. `offset` is the first byte of
    /// the invalid sequence; `len` its length, or `None` if the input ends in
    /// the middle of a character.
    InvalidUtf8 {
        path: ProjectPath,
        offset: u32,
        len: Option<u32>,
    },
    /// `E0002`: a byte-order mark (U+FEFF) that is not at the very start of
    /// the file. `offset` is the first such mark; the error spans 3 bytes.
    MisplacedBom { path: ProjectPath, offset: u32 },
    /// `E0004`: the file is larger than [`MAX_SOURCE_BYTES`].
    TooLarge { path: ProjectPath, size: u64 },
    /// `E9002`: more files than a [`FileId`] can number.
    TooManyFiles { path: ProjectPath },
}

impl SourceError {
    /// The catalogue code, without the `MTEK-` prefix.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            SourceError::InvalidUtf8 { .. } => "E0001",
            SourceError::MisplacedBom { .. } => "E0002",
            SourceError::TooLarge { .. } => "E0004",
            SourceError::TooManyFiles { .. } => "E9002",
        }
    }

    /// The file that was rejected.
    #[must_use]
    pub fn path(&self) -> &ProjectPath {
        match self {
            SourceError::InvalidUtf8 { path, .. }
            | SourceError::MisplacedBom { path, .. }
            | SourceError::TooLarge { path, .. }
            | SourceError::TooManyFiles { path } => path,
        }
    }

    /// Byte range of the offending bytes, if the error has a location.
    #[must_use]
    pub fn byte_range(&self) -> Option<(u32, u32)> {
        match self {
            SourceError::InvalidUtf8 { offset, len, .. } => {
                // An unexpected end of input is reported as one byte.
                Some((*offset, offset.saturating_add(len.unwrap_or(1))))
            }
            SourceError::MisplacedBom { offset, .. } => Some((*offset, offset + BOM_LEN)),
            SourceError::TooLarge { .. } | SourceError::TooManyFiles { .. } => None,
        }
    }
}

impl fmt::Display for SourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SourceError::InvalidUtf8 { path, offset, .. } => write!(
                f,
                "File '{path}' is not valid UTF-8 (invalid byte sequence at byte {offset})."
            ),
            SourceError::MisplacedBom { path, offset } => write!(
                f,
                "File '{path}' contains a byte-order mark at byte {offset}; it is only allowed at the start of the file."
            ),
            SourceError::TooLarge { path, size } => write!(
                f,
                "File '{path}' is {size} bytes, larger than the limit of {MAX_SOURCE_BYTES} bytes."
            ),
            SourceError::TooManyFiles { path } => {
                write!(f, "Cannot add '{path}': too many source files.")
            }
        }
    }
}

impl std::error::Error for SourceError {}

/// One validated source file. The text is exactly the bytes that were added
/// (a leading byte-order mark included, line endings untouched), so every
/// [`Span`] indexes the file as stored on disk.
#[derive(Clone, Debug)]
pub struct SourceFile {
    id: FileId,
    path: ProjectPath,
    text: Arc<str>,
    sha256: [u8; 32],
    lines: LineIndex,
}

impl SourceFile {
    #[must_use]
    pub fn id(&self) -> FileId {
        self.id
    }

    #[must_use]
    pub fn path(&self) -> &ProjectPath {
        &self.path
    }

    /// The full text exactly as stored, including a leading byte-order mark.
    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    /// The text as a shared handle.
    #[must_use]
    pub fn text_arc(&self) -> Arc<str> {
        Arc::clone(&self.text)
    }

    /// Byte offset at which lexing starts: 3 after a byte-order mark, else 0.
    #[must_use]
    pub fn content_start(&self) -> u32 {
        self.lines.content_start()
    }

    /// SHA-256 of the file's bytes as stored (the byte-order mark included).
    #[must_use]
    pub fn sha256(&self) -> &[u8; 32] {
        &self.sha256
    }

    /// The SHA-256 as 64 lowercase hex digits.
    #[must_use]
    pub fn sha256_hex(&self) -> String {
        let mut out = String::with_capacity(64);
        for byte in self.sha256 {
            out.push(hex_digit(byte >> 4));
            out.push(hex_digit(byte & 0x0f));
        }
        out
    }

    /// The line table.
    #[must_use]
    pub fn lines(&self) -> &LineIndex {
        &self.lines
    }

    /// Diagnostic position (1-based, scalar-value columns) of a byte offset.
    #[must_use]
    pub fn line_col(&self, offset: u32) -> LineCol {
        self.lines.line_col(offset)
    }

    /// LSP position (0-based, UTF-16 columns) of a byte offset.
    #[must_use]
    pub fn lsp_position(&self, offset: u32) -> LspPosition {
        self.lines.lsp_position(offset)
    }

    /// The text covered by `[start, end)`, or `None` if the range is out of
    /// bounds or splits a character.
    #[must_use]
    pub fn slice(&self, start: u32, end: u32) -> Option<&str> {
        self.text.get(start as usize..end as usize)
    }
}

fn hex_digit(nibble: u8) -> char {
    char::from_digit(u32::from(nibble), 16).unwrap_or('0')
}

/// All source files of one compilation, in insertion order.
#[derive(Clone, Debug, Default)]
pub struct SourceMap {
    files: Vec<SourceFile>,
    by_path: BTreeMap<ProjectPath, FileId>,
}

impl SourceMap {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Validate `bytes` and register them as the file at `path`.
    ///
    /// Checks, in this order: size (`E0004`), UTF-8 (`E0001`), byte-order mark
    /// only at the start (`E0002`). A leading mark is kept in the stored text
    /// and reported by [`SourceFile::content_start`]. The text is never
    /// rewritten.
    ///
    /// Callers add each path once; if a path is added again it gets a new
    /// [`FileId`] and [`SourceMap::id_of`] keeps answering with the first.
    ///
    /// # Errors
    /// [`SourceError`] describing the first problem found.
    pub fn add(&mut self, path: ProjectPath, bytes: &[u8]) -> Result<FileId, SourceError> {
        if u32::try_from(bytes.len()).map_or(true, |len| len > MAX_SOURCE_BYTES) {
            return Err(SourceError::TooLarge {
                path,
                size: bytes.len() as u64,
            });
        }
        let text = match std::str::from_utf8(bytes) {
            Ok(text) => text,
            Err(e) => {
                return Err(SourceError::InvalidUtf8 {
                    path,
                    // The size check above bounds every offset below 4 MiB.
                    offset: u32::try_from(e.valid_up_to()).unwrap_or(u32::MAX),
                    len: e.error_len().and_then(|n| u32::try_from(n).ok()),
                });
            }
        };
        let body_start = if text.starts_with('\u{FEFF}') {
            BOM_LEN as usize
        } else {
            0
        };
        if let Some(rel) = text.get(body_start..).and_then(|t| t.find('\u{FEFF}')) {
            return Err(SourceError::MisplacedBom {
                path,
                offset: u32::try_from(body_start + rel).unwrap_or(u32::MAX),
            });
        }
        let Ok(raw_id) = u32::try_from(self.files.len()) else {
            return Err(SourceError::TooManyFiles { path });
        };
        let id = FileId(raw_id);
        let text: Arc<str> = Arc::from(text);
        let sha256: [u8; 32] = Sha256::digest(bytes).into();
        let lines = LineIndex::new(Arc::clone(&text));
        self.by_path.entry(path.clone()).or_insert(id);
        self.files.push(SourceFile {
            id,
            path,
            text,
            sha256,
            lines,
        });
        Ok(id)
    }

    /// The file with this id.
    #[must_use]
    pub fn get(&self, id: FileId) -> Option<&SourceFile> {
        self.files.get(id.index())
    }

    /// The id of the file added under `path`.
    #[must_use]
    pub fn id_of(&self, path: &ProjectPath) -> Option<FileId> {
        self.by_path.get(path).copied()
    }

    /// Number of files.
    #[must_use]
    pub fn len(&self) -> usize {
        self.files.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// All files in insertion order.
    pub fn files(&self) -> impl Iterator<Item = &SourceFile> {
        self.files.iter()
    }

    /// The text a span covers, or `None` for an unknown file or a range that
    /// is out of bounds or splits a character.
    #[must_use]
    pub fn slice(&self, span: Span) -> Option<&str> {
        self.get(span.file)?.slice(span.start, span.end)
    }

    /// Diagnostic position of the start of `span`.
    #[must_use]
    pub fn line_col(&self, file: FileId, offset: u32) -> Option<LineCol> {
        Some(self.get(file)?.line_col(offset))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    fn add_ok(map: &mut SourceMap, path: &str, bytes: &[u8]) -> FileId {
        map.add(p(path), bytes).unwrap()
    }

    fn add_err(bytes: &[u8]) -> SourceError {
        SourceMap::new().add(p("a.mtek"), bytes).unwrap_err()
    }

    #[test]
    fn adds_files_with_sequential_ids_and_lookup() {
        let mut map = SourceMap::new();
        assert!(map.is_empty());
        let a = add_ok(&mut map, "src/a.mtek", b"let a = 1;");
        let b = add_ok(&mut map, "src/b.mtek", b"let b = 2;");
        assert_eq!((a, b), (FileId(0), FileId(1)));
        assert_eq!(map.len(), 2);
        assert_eq!(map.id_of(&p("src/b.mtek")), Some(b));
        assert_eq!(map.id_of(&p("src/c.mtek")), None);
        assert_eq!(map.get(a).map(SourceFile::text), Some("let a = 1;"));
        assert_eq!(map.get(b).map(|f| f.path().as_str()), Some("src/b.mtek"));
        assert_eq!(map.get(FileId(2)).map(SourceFile::id), None);
        let order: Vec<_> = map.files().map(SourceFile::id).collect();
        assert_eq!(order, [a, b]);
    }

    #[test]
    fn text_is_stored_exactly_as_given() {
        let bytes = "a\r\nb\nc\rd\r\n\u{e9}\u{1F600}".as_bytes();
        let mut map = SourceMap::new();
        let id = add_ok(&mut map, "a.mtek", bytes);
        let file = map.get(id).unwrap();
        assert_eq!(file.text().as_bytes(), bytes);
        assert_eq!(file.content_start(), 0);
        // A span indexes the stored bytes: 'b' sits after "a\r\n".
        assert_eq!(map.slice(Span::new(id, 3, 4)), Some("b"));
        assert_eq!(map.slice(Span::new(id, 0, 3)), Some("a\r\n"));
    }

    #[test]
    fn leading_bom_is_kept_and_reported() {
        let bytes = b"\xEF\xBB\xBFlet x;";
        let mut map = SourceMap::new();
        let id = add_ok(&mut map, "a.mtek", bytes);
        let file = map.get(id).unwrap();
        assert_eq!(file.content_start(), 3);
        // Offsets still match the disk bytes: 'l' is at byte 3.
        assert_eq!(file.text().as_bytes(), bytes);
        assert_eq!(file.slice(3, 6), Some("let"));
        assert_eq!(file.line_col(3), LineCol { line: 1, column: 1 });
        assert_eq!(
            file.lsp_position(4),
            LspPosition {
                line: 0,
                character: 1
            }
        );
    }

    #[test]
    fn bom_only_file_is_valid() {
        let mut map = SourceMap::new();
        let id = add_ok(&mut map, "a.mtek", b"\xEF\xBB\xBF");
        assert_eq!(map.get(id).map(SourceFile::content_start), Some(3));
    }

    #[test]
    fn bom_elsewhere_is_e0002() {
        let err = add_err(b"ab\xEF\xBB\xBFcd");
        assert_eq!(err.code(), "E0002");
        assert_eq!(
            err,
            SourceError::MisplacedBom {
                path: p("a.mtek"),
                offset: 2
            }
        );
        assert_eq!(err.byte_range(), Some((2, 5)));
        assert_eq!(err.path(), &p("a.mtek"));
    }

    #[test]
    fn second_bom_after_the_leading_one_is_e0002() {
        let err = add_err(b"\xEF\xBB\xBF\xEF\xBB\xBFx");
        assert_eq!(err.code(), "E0002");
        assert_eq!(err.byte_range(), Some((3, 6)));
    }

    #[test]
    fn bom_inside_a_string_literal_is_still_e0002() {
        let err = add_err("let s = \"\u{FEFF}\";".as_bytes());
        assert_eq!(err.code(), "E0002");
        assert_eq!(err.byte_range(), Some((9, 12)));
    }

    #[test]
    fn invalid_utf8_is_e0001_with_the_offending_offset() {
        let err = add_err(b"ok\xFFbad");
        assert_eq!(err.code(), "E0001");
        assert_eq!(
            err,
            SourceError::InvalidUtf8 {
                path: p("a.mtek"),
                offset: 2,
                len: Some(1)
            }
        );
        assert_eq!(err.byte_range(), Some((2, 3)));
    }

    #[test]
    fn invalid_utf8_variants_are_all_rejected() {
        // Overlong encoding, UTF-8-encoded surrogate, stray continuation byte.
        for bytes in [
            &b"\xC0\x80"[..],
            b"\xED\xA0\x80",
            b"\x80",
            b"\xF8\x88\x80\x80\x80",
        ] {
            assert_eq!(add_err(bytes).code(), "E0001", "{bytes:x?}");
        }
    }

    #[test]
    fn truncated_character_at_eof_has_no_length() {
        let err = add_err(b"ab\xE2\x82");
        assert_eq!(
            err,
            SourceError::InvalidUtf8 {
                path: p("a.mtek"),
                offset: 2,
                len: None
            }
        );
        assert_eq!(err.byte_range(), Some((2, 3)));
    }

    #[test]
    fn size_limit_is_four_mebibytes() {
        let limit = MAX_SOURCE_BYTES as usize;
        let mut map = SourceMap::new();
        assert!(map.add(p("ok.mtek"), &vec![b'a'; limit]).is_ok());
        let err = map.add(p("big.mtek"), &vec![b'a'; limit + 1]).unwrap_err();
        assert_eq!(err.code(), "E0004");
        assert_eq!(
            err,
            SourceError::TooLarge {
                path: p("big.mtek"),
                size: limit as u64 + 1
            }
        );
        assert_eq!(err.byte_range(), None);
        // The rejected file was not registered.
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn size_is_checked_before_encoding() {
        let mut bytes = vec![0xFF; MAX_SOURCE_BYTES as usize + 1];
        bytes[0] = 0xFF;
        assert_eq!(add_err(&bytes).code(), "E0004");
    }

    #[test]
    fn empty_file_is_valid() {
        let mut map = SourceMap::new();
        let id = add_ok(&mut map, "empty.mtek", b"");
        let file = map.get(id).unwrap();
        assert_eq!(file.text(), "");
        assert_eq!(file.lines().line_count(), 1);
    }

    #[test]
    fn rejected_files_do_not_consume_ids() {
        let mut map = SourceMap::new();
        assert!(map.add(p("bad.mtek"), b"\xFF").is_err());
        assert_eq!(add_ok(&mut map, "good.mtek", b"x"), FileId(0));
    }

    #[test]
    fn sha256_matches_known_vectors_and_covers_the_whole_file() {
        let mut map = SourceMap::new();
        let abc = add_ok(&mut map, "abc.mtek", b"abc");
        assert_eq!(
            map.get(abc).unwrap().sha256_hex(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let empty = add_ok(&mut map, "empty.mtek", b"");
        assert_eq!(
            map.get(empty).unwrap().sha256_hex(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // The BOM is part of the hashed bytes, as are line endings.
        let bom = add_ok(&mut map, "bom.mtek", b"\xEF\xBB\xBFabc");
        assert_ne!(
            map.get(bom).unwrap().sha256(),
            map.get(abc).unwrap().sha256()
        );
        let lf = add_ok(&mut map, "lf.mtek", b"a\nb");
        let crlf = add_ok(&mut map, "crlf.mtek", b"a\r\nb");
        assert_ne!(
            map.get(lf).unwrap().sha256(),
            map.get(crlf).unwrap().sha256()
        );
    }

    #[test]
    fn slice_rejects_bad_spans_without_panicking() {
        let mut map = SourceMap::new();
        let id = add_ok(&mut map, "a.mtek", "h\u{e9}llo".as_bytes());
        assert_eq!(map.slice(Span::new(id, 1, 3)), Some("\u{e9}"));
        assert_eq!(map.slice(Span::new(id, 2, 3)), None); // splits 'é'
        assert_eq!(map.slice(Span::new(id, 0, 99)), None);
        assert_eq!(map.slice(Span::new(id, 99, 100)), None);
        assert_eq!(map.slice(Span::new(FileId(7), 0, 1)), None);
        assert_eq!(map.slice(Span::at(id, 6)), Some(""));
    }

    #[test]
    fn positions_through_the_map() {
        let mut map = SourceMap::new();
        let id = add_ok(&mut map, "a.mtek", "a\u{1F600}b\r\nc".as_bytes());
        assert_eq!(map.line_col(id, 5), Some(LineCol { line: 1, column: 3 }));
        assert_eq!(map.line_col(FileId(9), 0), None);
        let file = map.get(id).unwrap();
        assert_eq!(
            file.lsp_position(5),
            LspPosition {
                line: 0,
                character: 3
            }
        );
        assert_eq!(file.text_arc().as_ref(), file.text());
        assert_eq!(file.lines().line_count(), 2);
    }

    #[test]
    fn error_messages_name_file_and_position() {
        assert_eq!(
            add_err(b"ok\xFF").to_string(),
            "File 'a.mtek' is not valid UTF-8 (invalid byte sequence at byte 2)."
        );
        assert!(add_err(b"x\xEF\xBB\xBF").to_string().contains("byte 1"));
    }
}
