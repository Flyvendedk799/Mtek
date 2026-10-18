//! Position encodings: byte offsets of the compiler (UTF-8 text, `spec/compiler-architecture.md`
//! section 4.1) against the `line`/`character` pairs of the protocol.
//!
//! The protocol counts `character` in the encoding the server and the client agreed on at
//! `initialize`. UTF-16 code units are the default every client supports; UTF-8 (bytes) is
//! chosen when the client offers it, because it is the compiler's own unit and needs no
//! conversion beyond the line start (decision 0076 item 2). UTF-32 is never chosen.
//!
//! Every conversion is total, like the compiler's [`LineIndex`]: a position past the end of a
//! line clamps to the end of the line content (before `\r\n`), a line past the last clamps to
//! the end of the text, a character that points into the middle of a surrogate pair or of a
//! multi-byte character rounds down to the start of that character, and a byte offset inside a
//! character rounds down likewise. A `\r` that belongs to a `\r\n` terminator never counts as a
//! column. A leading byte-order mark is zero-width (`LineIndex`), as the compiler counts it.

use lsp_types::{Position, PositionEncodingKind, Range};
use mtek_compiler::source::{LineIndex, LspPosition};

/// The encoding of the `character` of every position of a session.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum PositionEncoding {
    /// Bytes of the UTF-8 text.
    Utf8,
    /// UTF-16 code units: the protocol's default.
    #[default]
    Utf16,
}

impl PositionEncoding {
    /// The encoding the server picks given the `general.positionEncodings` the client offers
    /// (`None` when the client sent none, which means UTF-16 only): UTF-8 if it is offered, else
    /// UTF-16. Unknown names are ignored.
    #[must_use]
    pub fn negotiate(offered: Option<&[String]>) -> Self {
        match offered {
            Some(list) if list.iter().any(|name| name == PositionEncodingKind::UTF8.as_str()) => {
                Self::Utf8
            }
            _ => Self::Utf16,
        }
    }

    /// The protocol's name of the encoding, for `ServerCapabilities::position_encoding`.
    #[must_use]
    pub fn kind(self) -> PositionEncodingKind {
        match self {
            Self::Utf8 => PositionEncodingKind::UTF8,
            Self::Utf16 => PositionEncodingKind::UTF16,
        }
    }

    /// The protocol position of the byte offset `offset` of the text `lines` indexes.
    #[must_use]
    pub fn position(self, lines: &LineIndex, offset: u32) -> Position {
        // `line_col` clamps like every conversion (past the end, inside a character, inside the
        // byte-order mark); an offset on a CRLF terminator lands at the end of the content.
        let line_col = lines.line_col(offset);
        let clamped = lines.offset_of(line_col);
        match self {
            Self::Utf16 => {
                let LspPosition { line, character } = lines.lsp_position(clamped);
                Position { line, character }
            }
            Self::Utf8 => {
                let origin = lines.line_range(line_col.line).map_or(0, |range| range.start);
                Position {
                    line: line_col.line.saturating_sub(1),
                    character: clamped.saturating_sub(origin),
                }
            }
        }
    }

    /// The byte offset of the protocol position `position` in the text `lines` indexes.
    #[must_use]
    pub fn offset(self, lines: &LineIndex, position: Position) -> u32 {
        match self {
            Self::Utf16 => lines.offset_of_lsp(LspPosition {
                line: position.line,
                character: position.character,
            }),
            Self::Utf8 => {
                let Some(range) = position
                    .line
                    .checked_add(1)
                    .and_then(|line| lines.line_range(line))
                else {
                    return lines.len();
                };
                let wanted = range.start.saturating_add(position.character);
                let mut offset = wanted.min(range.end);
                while offset > range.start && !lines.text().is_char_boundary(offset as usize) {
                    offset -= 1;
                }
                offset
            }
        }
    }

    /// The protocol range of the byte range `start..end`.
    #[must_use]
    pub fn range(self, lines: &LineIndex, start: u32, end: u32) -> Range {
        Range {
            start: self.position(lines, start),
            end: self.position(lines, end.max(start)),
        }
    }

    /// The byte range of the protocol range `range`, `start <= end`.
    #[must_use]
    pub fn byte_range(self, lines: &LineIndex, range: Range) -> (u32, u32) {
        let start = self.offset(lines, range.start);
        let end = self.offset(lines, range.end);
        (start, end.max(start))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn index(text: &str) -> LineIndex {
        LineIndex::new(Arc::from(text))
    }

    fn pos(line: u32, character: u32) -> Position {
        Position { line, character }
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn negotiation_prefers_utf8_when_offered_and_defaults_to_utf16() {
        use PositionEncoding::{Utf8, Utf16};
        assert_eq!(PositionEncoding::negotiate(None), Utf16);
        assert_eq!(PositionEncoding::negotiate(Some(&[])), Utf16);
        assert_eq!(
            PositionEncoding::negotiate(Some(&strings(&["utf-16"]))),
            Utf16
        );
        assert_eq!(
            PositionEncoding::negotiate(Some(&strings(&["utf-32"]))),
            Utf16
        );
        assert_eq!(
            PositionEncoding::negotiate(Some(&strings(&["utf-16", "utf-8"]))),
            Utf8
        );
        assert_eq!(
            PositionEncoding::negotiate(Some(&strings(&["utf-8", "utf-16", "utf-32"]))),
            Utf8
        );
        assert_eq!(
            PositionEncoding::negotiate(Some(&strings(&["UTF-8"]))),
            Utf16,
            "encoding names are case-sensitive"
        );
        assert_eq!(Utf16.kind(), PositionEncodingKind::UTF16);
        assert_eq!(Utf8.kind(), PositionEncodingKind::UTF8);
    }

    // "aé😀b": a (1 byte, 1 unit), é (2 bytes, 1 unit), 😀 (4 bytes, 2 units), b.
    const MIXED: &str = "aé😀b";

    #[test]
    fn utf16_counts_code_units_and_astral_characters_as_two() {
        let i = index(MIXED);
        let e = PositionEncoding::Utf16;
        for (offset, character) in [(0, 0), (1, 1), (3, 2), (7, 4), (8, 5)] {
            assert_eq!(e.position(&i, offset), pos(0, character), "byte {offset}");
            assert_eq!(e.offset(&i, pos(0, character)), offset, "unit {character}");
        }
        // The middle of a surrogate pair rounds down to the character's start.
        assert_eq!(e.offset(&i, pos(0, 3)), 3);
        // Inside a multi-byte character the offset rounds down too.
        assert_eq!(e.position(&i, 2), pos(0, 1));
        assert_eq!(e.position(&i, 5), pos(0, 2));
    }

    #[test]
    fn utf8_counts_bytes() {
        let i = index(MIXED);
        let e = PositionEncoding::Utf8;
        for offset in [0, 1, 3, 7, 8] {
            assert_eq!(e.position(&i, offset), pos(0, offset), "byte {offset}");
            assert_eq!(e.offset(&i, pos(0, offset)), offset);
        }
        assert_eq!(e.position(&i, 2), pos(0, 1), "inside é rounds down");
        assert_eq!(e.offset(&i, pos(0, 2)), 1, "inside é rounds down");
        assert_eq!(e.offset(&i, pos(0, 5)), 3, "inside 😀 rounds down");
    }

    #[test]
    fn lines_start_after_every_line_feed_and_crlf_is_one_terminator() {
        let text = "é1\r\n😀2\nlast";
        let i = index(text);
        for e in [PositionEncoding::Utf8, PositionEncoding::Utf16] {
            let second = u32::try_from(text.find('😀').unwrap()).unwrap();
            let third = u32::try_from(text.find("last").unwrap()).unwrap();
            assert_eq!(e.position(&i, second), pos(1, 0), "{e:?}");
            assert_eq!(e.position(&i, third), pos(2, 0), "{e:?}");
            assert_eq!(e.offset(&i, pos(1, 0)), second);
            assert_eq!(e.offset(&i, pos(2, 0)), third);
        }
        // The line 0 content is "é1" (CRLF excluded): column 2 in UTF-16, 3 in UTF-8.
        let u16 = PositionEncoding::Utf16;
        let u8 = PositionEncoding::Utf8;
        assert_eq!(u16.offset(&i, pos(0, 2)), 3);
        assert_eq!(u8.offset(&i, pos(0, 3)), 3);
        // Past the end of the line content clamps before the `\r`, never into the terminator.
        assert_eq!(u16.offset(&i, pos(0, 99)), 3);
        assert_eq!(u8.offset(&i, pos(0, 99)), 3);
        // The `\r` of CRLF is not a column: its offset maps to the end of the content.
        for terminator in [3, 4] {
            assert_eq!(u16.position(&i, terminator), pos(0, 2), "byte {terminator}");
            assert_eq!(u8.position(&i, terminator), pos(0, 3), "byte {terminator}");
        }
        // The astral character of line 1: two units in UTF-16, four bytes in UTF-8.
        let second = u32::try_from(text.find('😀').unwrap()).unwrap();
        assert_eq!(u16.offset(&i, pos(1, 2)), second + 4);
        assert_eq!(u8.offset(&i, pos(1, 4)), second + 4);
        assert_eq!(u16.position(&i, second + 4), pos(1, 2));
        assert_eq!(u8.position(&i, second + 4), pos(1, 4));
    }

    #[test]
    fn every_character_boundary_round_trips_in_both_encodings() {
        let text = "let ñ = \"😀\";\r\n\r\n// 日本語 𝔘𝔫𝔦\nend";
        let i = index(text);
        for e in [PositionEncoding::Utf8, PositionEncoding::Utf16] {
            for (offset, c) in text.char_indices() {
                let offset = u32::try_from(offset).unwrap();
                let position = e.position(&i, offset);
                let back = e.offset(&i, position);
                if c == '\r' || c == '\n' {
                    // A terminator is not a column: it maps to the end of its line's content.
                    assert!(back <= offset, "{e:?} byte {offset}");
                } else {
                    assert_eq!(back, offset, "{e:?} byte {offset} -> {position:?}");
                }
            }
            let end = u32::try_from(text.len()).unwrap();
            assert_eq!(e.offset(&i, e.position(&i, end)), end, "{e:?} end of text");
        }
    }

    #[test]
    fn out_of_range_inputs_clamp_and_never_panic() {
        let i = index("ab\ncd");
        for e in [PositionEncoding::Utf8, PositionEncoding::Utf16] {
            assert_eq!(e.offset(&i, pos(99, 0)), 5, "{e:?}: a line past the end");
            assert_eq!(e.offset(&i, pos(0, u32::MAX)), 2, "{e:?}: a huge column");
            assert_eq!(e.offset(&i, pos(u32::MAX, u32::MAX)), 5, "{e:?}");
            assert_eq!(e.position(&i, u32::MAX), pos(1, 2), "{e:?}: a huge offset");
        }
        let empty = index("");
        for e in [PositionEncoding::Utf8, PositionEncoding::Utf16] {
            assert_eq!(e.position(&empty, 0), pos(0, 0));
            assert_eq!(e.offset(&empty, pos(3, 3)), 0);
        }
    }

    #[test]
    fn ranges_are_ordered_and_use_the_same_conversion() {
        let i = index("a😀b");
        let e = PositionEncoding::Utf16;
        assert_eq!(
            e.range(&i, 1, 5),
            Range {
                start: pos(0, 1),
                end: pos(0, 3)
            }
        );
        assert_eq!(e.byte_range(&i, e.range(&i, 1, 5)), (1, 5));
        // An inverted range is made empty at its start.
        assert_eq!(e.range(&i, 5, 1).end, e.range(&i, 5, 1).start);
        assert_eq!(
            e.byte_range(
                &i,
                Range {
                    start: pos(0, 3),
                    end: pos(0, 1)
                }
            ),
            (5, 5)
        );
    }
}
