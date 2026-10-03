//! Line starts and offset/position conversions.
//!
//! Two position systems are supported, both over the text exactly as stored:
//!
//! * [`LineCol`]: 1-based line and 1-based column counted in Unicode scalar
//!   values. This is what diagnostics print (`spec/diagnostics.md` 2.1).
//! * [`LspPosition`]: 0-based line and 0-based character counted in UTF-16
//!   code units, the language server protocol's default encoding.
//!
//! Lines end at `\n`; a `\r` immediately before it belongs to the terminator
//! and never counts as a column of the line. A `\r` that is not followed by
//! `\n` is an ordinary character here (the lexer reports it as `E0003`).
//!
//! A leading byte-order mark is zero-width: line 1 column 1 is the first byte
//! after it, and offsets inside the mark clamp to that byte.
//!
//! Every conversion is total. Offsets past the end clamp to the end of the
//! text, offsets inside a multi-byte character round down to its first byte,
//! and out-of-range lines or columns clamp to the end of the line or file.

use std::ops::Range;
use std::sync::Arc;

/// Length of the UTF-8 byte-order mark.
pub(crate) const BOM_LEN: u32 = 3;

/// 1-based line and column; the column counts Unicode scalar values.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct LineCol {
    pub line: u32,
    pub column: u32,
}

/// 0-based line and character; the character counts UTF-16 code units.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct LspPosition {
    pub line: u32,
    pub character: u32,
}

/// Line table for one text.
#[derive(Clone, Debug)]
pub struct LineIndex {
    text: Arc<str>,
    /// Byte offset of the first byte of every line; never empty, starts at 0.
    line_starts: Vec<u32>,
    /// 3 if the text starts with a byte-order mark, else 0.
    content_start: u32,
}

impl LineIndex {
    /// Index `text`. Texts longer than `u32::MAX` bytes are indexed only up to
    /// that length (the source manager rejects files above 4 MiB long before).
    #[must_use]
    pub fn new(text: Arc<str>) -> Self {
        let mut line_starts = vec![0u32];
        for (i, b) in text.bytes().enumerate() {
            if b == b'\n' {
                match u32::try_from(i + 1) {
                    Ok(next) => line_starts.push(next),
                    Err(_) => break,
                }
            }
        }
        let content_start = if text.starts_with('\u{FEFF}') {
            BOM_LEN
        } else {
            0
        };
        Self {
            text,
            line_starts,
            content_start,
        }
    }

    /// The indexed text.
    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Byte offset of the first byte after a leading byte-order mark (0 if
    /// there is none).
    #[must_use]
    pub fn content_start(&self) -> u32 {
        self.content_start
    }

    /// Raw byte offsets of every line start (the first is always 0, even
    /// with a byte-order mark).
    #[must_use]
    pub fn line_starts(&self) -> &[u32] {
        &self.line_starts
    }

    /// Number of lines; a text ending in `\n` has a final empty line, and the
    /// empty text has one line.
    #[must_use]
    pub fn line_count(&self) -> u32 {
        u32::try_from(self.line_starts.len()).unwrap_or(u32::MAX)
    }

    /// Byte length of the text as a `u32` (saturating).
    #[must_use]
    pub fn len(&self) -> u32 {
        u32::try_from(self.text.len()).unwrap_or(u32::MAX)
    }

    /// True for the empty text.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    /// Byte range of the content of `line` (1-based): from the first column
    /// to just before the line terminator (`\n` or `\r\n`). `None` if the line
    /// does not exist.
    #[must_use]
    pub fn line_range(&self, line: u32) -> Option<Range<u32>> {
        let index = usize::try_from(line.checked_sub(1)?).ok()?;
        let start = self.column_origin(index)?;
        let end = self.line_end(index)?;
        Some(start..end.max(start))
    }

    /// The content of `line` (1-based) without its terminator.
    #[must_use]
    pub fn line_text(&self, line: u32) -> Option<&str> {
        let range = self.line_range(line)?;
        self.text.get(range.start as usize..range.end as usize)
    }

    /// Diagnostic position of `offset`. Offsets past the end clamp to the end
    /// of the text; offsets inside a character or the byte-order mark round to
    /// the nearest valid position at or before.
    #[must_use]
    pub fn line_col(&self, offset: u32) -> LineCol {
        let offset = self.clamp(offset);
        let index = self.line_of(offset);
        let origin = self.column_origin(index).unwrap_or(0);
        let chars = self.chars_between(origin, offset);
        LineCol {
            line: to_u32(index) + 1,
            column: to_u32(chars) + 1,
        }
    }

    /// LSP position of `offset`, with the same clamping as [`Self::line_col`].
    #[must_use]
    pub fn lsp_position(&self, offset: u32) -> LspPosition {
        let offset = self.clamp(offset);
        let index = self.line_of(offset);
        let origin = self.column_origin(index).unwrap_or(0);
        let units: usize = self
            .slice(origin, offset)
            .chars()
            .map(char::len_utf16)
            .sum();
        LspPosition {
            line: to_u32(index),
            character: to_u32(units),
        }
    }

    /// Inverse of [`Self::line_col`]. A line past the last clamps to the end
    /// of the text; a column past the end of its line clamps to the end of the
    /// line content (before the terminator). Line or column 0 count as 1.
    #[must_use]
    pub fn offset_of(&self, position: LineCol) -> u32 {
        let wanted = position.column.saturating_sub(1);
        self.offset_in_line(position.line.saturating_sub(1), wanted, |_| 1)
    }

    /// Inverse of [`Self::lsp_position`], with the clamping of
    /// [`Self::offset_of`]. A character that points into the middle of a
    /// surrogate pair rounds down to the start of that character.
    #[must_use]
    pub fn offset_of_lsp(&self, position: LspPosition) -> u32 {
        self.offset_in_line(position.line, position.character, |c| to_u32(c.len_utf16()))
    }

    /// Walk the characters of line `line0` (0-based) accumulating `width(c)`
    /// until `wanted` is reached; return the byte offset reached.
    fn offset_in_line(&self, line0: u32, wanted: u32, width: impl Fn(char) -> u32) -> u32 {
        let Some(index) = usize::try_from(line0)
            .ok()
            .filter(|i| *i < self.line_starts.len())
        else {
            return self.len();
        };
        let (Some(origin), Some(end)) = (self.column_origin(index), self.line_end(index)) else {
            return self.len();
        };
        let mut seen = 0u32;
        let mut offset = origin;
        for c in self.slice(origin, end).chars() {
            let w = width(c);
            if seen.saturating_add(w) > wanted {
                return offset;
            }
            seen += w;
            offset += to_u32(c.len_utf8());
        }
        end.max(origin)
    }

    /// Clamp to the text, floor to a character boundary, and move out of a
    /// leading byte-order mark.
    fn clamp(&self, offset: u32) -> u32 {
        let mut o = offset.min(self.len());
        while o > 0 && !self.text.is_char_boundary(o as usize) {
            o -= 1;
        }
        o.max(self.content_start.min(self.len()))
    }

    /// Index of the line containing `offset`.
    fn line_of(&self, offset: u32) -> usize {
        self.line_starts
            .partition_point(|&start| start <= offset)
            .saturating_sub(1)
    }

    /// Offset at which column 1 of line `index` (0-based) starts.
    fn column_origin(&self, index: usize) -> Option<u32> {
        let start = *self.line_starts.get(index)?;
        Some(if index == 0 {
            start.max(self.content_start).min(self.len())
        } else {
            start
        })
    }

    /// Offset just past the content of line `index` (0-based), excluding the
    /// terminator.
    fn line_end(&self, index: usize) -> Option<u32> {
        let start = *self.line_starts.get(index)?;
        match self.line_starts.get(index + 1) {
            None => Some(self.len()),
            Some(&next) => {
                let newline = next.saturating_sub(1);
                let has_cr = newline > start
                    && self.text.as_bytes().get(newline as usize - 1) == Some(&b'\r');
                Some(if has_cr { newline - 1 } else { newline })
            }
        }
    }

    fn slice(&self, start: u32, end: u32) -> &str {
        self.text.get(start as usize..end as usize).unwrap_or("")
    }

    fn chars_between(&self, start: u32, end: u32) -> usize {
        self.slice(start, end).chars().count()
    }
}

fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idx(text: &str) -> LineIndex {
        LineIndex::new(Arc::from(text))
    }

    fn lc(line: u32, column: u32) -> LineCol {
        LineCol { line, column }
    }

    fn lsp(line: u32, character: u32) -> LspPosition {
        LspPosition { line, character }
    }

    #[test]
    fn ascii_lines() {
        let i = idx("ab\ncd\n\nef");
        assert_eq!(i.line_starts(), [0, 3, 6, 7]);
        assert_eq!(i.line_count(), 4);
        assert_eq!(i.line_col(0), lc(1, 1));
        assert_eq!(i.line_col(1), lc(1, 2));
        assert_eq!(i.line_col(2), lc(1, 3)); // the '\n' itself, end of line 1
        assert_eq!(i.line_col(3), lc(2, 1));
        assert_eq!(i.line_col(5), lc(2, 3));
        assert_eq!(i.line_col(6), lc(3, 1)); // empty line
        assert_eq!(i.line_col(7), lc(4, 1));
        assert_eq!(i.line_col(9), lc(4, 3)); // EOF
        assert_eq!(i.lsp_position(4), lsp(1, 1));
    }

    #[test]
    fn crlf_terminators_are_not_columns() {
        let i = idx("a\r\nb\r\n");
        assert_eq!(i.line_starts(), [0, 3, 6]);
        assert_eq!(i.line_col(0), lc(1, 1));
        assert_eq!(i.line_col(1), lc(1, 2)); // at the '\r': end of line content
        assert_eq!(i.line_col(3), lc(2, 1));
        assert_eq!(i.line_col(6), lc(3, 1));
        assert_eq!(i.line_text(1), Some("a"));
        assert_eq!(i.line_text(2), Some("b"));
        assert_eq!(i.line_text(3), Some(""));
        assert_eq!(i.line_range(1), Some(0..1));
        assert_eq!(i.line_range(2), Some(3..4));
        // Inverse never lands inside the terminator.
        assert_eq!(i.offset_of(lc(1, 99)), 1);
        assert_eq!(i.offset_of_lsp(lsp(0, 99)), 1);
    }

    #[test]
    fn mixed_line_endings() {
        let i = idx("a\nb\r\nc\n\r\nd");
        assert_eq!(i.line_starts(), [0, 2, 5, 7, 9]);
        assert_eq!(i.line_text(1), Some("a"));
        assert_eq!(i.line_text(2), Some("b"));
        assert_eq!(i.line_text(3), Some("c"));
        assert_eq!(i.line_text(4), Some(""));
        assert_eq!(i.line_text(5), Some("d"));
        assert_eq!(i.line_col(9), lc(5, 1));
        assert_eq!(i.line_col(10), lc(5, 2));
    }

    #[test]
    fn lone_carriage_return_is_an_ordinary_character() {
        let i = idx("a\rb\nc");
        assert_eq!(i.line_starts(), [0, 4]);
        assert_eq!(i.line_col(2), lc(1, 3));
        assert_eq!(i.line_text(1), Some("a\rb"));
        // A trailing lone '\r' before EOF stays in the last line.
        assert_eq!(idx("a\r").line_text(1), Some("a\r"));
    }

    #[test]
    fn two_byte_characters() {
        // 'é' is 2 bytes, 1 scalar value, 1 UTF-16 unit.
        let i = idx("éa\nxé!");
        assert_eq!(i.line_col(0), lc(1, 1));
        assert_eq!(i.line_col(2), lc(1, 2));
        assert_eq!(i.line_col(3), lc(1, 3));
        assert_eq!(i.line_col(4), lc(2, 1));
        assert_eq!(i.line_col(7), lc(2, 3));
        assert_eq!(i.lsp_position(7), lsp(1, 2));
        // Inside the character: rounds down to its start.
        assert_eq!(i.line_col(1), lc(1, 1));
        assert_eq!(i.line_col(6), lc(2, 2));
        assert_eq!(i.offset_of(lc(1, 2)), 2);
        assert_eq!(i.offset_of_lsp(lsp(1, 2)), 7);
    }

    #[test]
    fn astral_characters_differ_between_scalar_and_utf16_columns() {
        // U+1F600: 4 UTF-8 bytes, 1 scalar value, 2 UTF-16 code units.
        let text = "a\u{1F600}b";
        assert_eq!(text.len(), 6);
        let i = idx(text);
        // 'b' is at byte 5: the third scalar value, the fourth UTF-16 unit.
        assert_eq!(i.line_col(5), lc(1, 3));
        assert_eq!(i.lsp_position(5), lsp(0, 3));
        // EOF.
        assert_eq!(i.line_col(6), lc(1, 4));
        assert_eq!(i.lsp_position(6), lsp(0, 4));
        // The emoji itself starts after 1 scalar / 1 unit.
        assert_eq!(i.line_col(1), lc(1, 2));
        assert_eq!(i.lsp_position(1), lsp(0, 1));
        // Offsets inside the 4 bytes round down to the emoji start.
        for inside in 2..5 {
            assert_eq!(i.line_col(inside), lc(1, 2));
            assert_eq!(i.lsp_position(inside), lsp(0, 1));
        }
    }

    #[test]
    fn astral_inverse_conversions() {
        let i = idx("a\u{1F600}b\n\u{1F600}\u{1F600}x");
        // Scalar column 3 on line 1 is 'b'.
        assert_eq!(i.offset_of(lc(1, 3)), 5);
        // UTF-16 character 3 on line 1 is 'b' too.
        assert_eq!(i.offset_of_lsp(lsp(0, 3)), 5);
        // Character 2 points into the middle of the surrogate pair: round down.
        assert_eq!(i.offset_of_lsp(lsp(0, 2)), 1);
        // Line 2 starts at byte 7: two emoji (8 bytes, 4 units) then 'x' at byte 15.
        let x = i.text().find('x').unwrap() as u32;
        assert_eq!(i.offset_of(lc(2, 3)), x);
        assert_eq!(i.offset_of_lsp(lsp(1, 4)), x);
        assert_eq!(i.line_col(x), lc(2, 3));
        assert_eq!(i.lsp_position(x), lsp(1, 4));
    }

    #[test]
    fn eof_and_out_of_range_inputs_clamp() {
        let i = idx("ab\ncd");
        assert_eq!(i.line_col(5), lc(2, 3));
        assert_eq!(i.line_col(6), lc(2, 3));
        assert_eq!(i.line_col(u32::MAX), lc(2, 3));
        assert_eq!(i.lsp_position(u32::MAX), lsp(1, 2));
        assert_eq!(i.offset_of(lc(2, 99)), 5);
        assert_eq!(i.offset_of(lc(1, 99)), 2);
        assert_eq!(i.offset_of(lc(99, 1)), 5);
        assert_eq!(i.offset_of_lsp(lsp(99, 0)), 5);
        assert_eq!(i.offset_of(lc(0, 0)), 0);
        assert_eq!(i.offset_of_lsp(lsp(0, u32::MAX)), 2);
        assert_eq!(i.line_range(3), None);
        assert_eq!(i.line_range(0), None);
        assert_eq!(i.line_text(3), None);
    }

    #[test]
    fn trailing_newline_creates_a_final_empty_line() {
        let i = idx("ab\n");
        assert_eq!(i.line_count(), 2);
        assert_eq!(i.line_col(3), lc(2, 1));
        assert_eq!(i.offset_of(lc(2, 1)), 3);
        assert_eq!(i.offset_of(lc(2, 5)), 3);
        assert_eq!(i.line_text(2), Some(""));
    }

    #[test]
    fn empty_text() {
        let i = idx("");
        assert!(i.is_empty());
        assert_eq!(i.len(), 0);
        assert_eq!(i.line_count(), 1);
        assert_eq!(i.line_col(0), lc(1, 1));
        assert_eq!(i.line_col(10), lc(1, 1));
        assert_eq!(i.offset_of(lc(1, 1)), 0);
        assert_eq!(i.offset_of(lc(5, 5)), 0);
        assert_eq!(i.line_text(1), Some(""));
    }

    #[test]
    fn leading_bom_is_zero_width() {
        let i = idx("\u{FEFF}ab\ncd");
        assert_eq!(i.content_start(), 3);
        assert_eq!(i.line_starts(), [0, 6]);
        assert_eq!(i.line_col(0), lc(1, 1));
        assert_eq!(i.line_col(1), lc(1, 1)); // inside the BOM
        assert_eq!(i.line_col(3), lc(1, 1));
        assert_eq!(i.line_col(4), lc(1, 2));
        assert_eq!(i.lsp_position(4), lsp(0, 1));
        assert_eq!(i.line_col(6), lc(2, 1));
        assert_eq!(i.offset_of(lc(1, 1)), 3);
        assert_eq!(i.offset_of(lc(1, 3)), 5);
        assert_eq!(i.offset_of_lsp(lsp(0, 0)), 3);
        assert_eq!(i.line_text(1), Some("ab"));
        assert_eq!(i.line_range(1), Some(3..5));
    }

    #[test]
    fn bom_only_text() {
        let i = idx("\u{FEFF}");
        assert_eq!(i.line_col(0), lc(1, 1));
        assert_eq!(i.line_col(3), lc(1, 1));
        assert_eq!(i.offset_of(lc(1, 9)), 3);
        assert_eq!(i.line_text(1), Some(""));
    }

    #[test]
    fn bom_followed_by_newline() {
        let i = idx("\u{FEFF}\nx");
        assert_eq!(i.line_text(1), Some(""));
        assert_eq!(i.line_col(4), lc(2, 1));
    }

    #[test]
    fn conversions_round_trip_on_every_boundary() {
        let texts = [
            "",
            "plain ascii\nsecond line\n",
            "crlf\r\nlines\r\n\r\nend",
            "mix\nof\r\nends\n",
            "é\u{1F600}x\nü\u{1F600}\u{1F600}y\r\nz",
            "\u{FEFF}bom é\u{1F600}\nnext",
            "lone\rcr\nhere",
            "\n\n\n",
        ];
        for text in texts {
            let i = idx(text);
            for offset in 0..=text.len() {
                if !text.is_char_boundary(offset) {
                    continue;
                }
                let offset = offset as u32;
                // Offsets inside a leading BOM clamp forward; offsets between
                // '\r' and '\n' sit inside the terminator and clamp back.
                let in_bom = offset > 0 && offset < i.content_start();
                let in_crlf = offset > 0
                    && text.as_bytes().get(offset as usize - 1) == Some(&b'\r')
                    && text.as_bytes().get(offset as usize) == Some(&b'\n');
                if in_bom || in_crlf || (offset == 0 && i.content_start() > 0) {
                    continue;
                }
                assert_eq!(
                    i.offset_of(i.line_col(offset)),
                    offset,
                    "scalar {text:?}@{offset}"
                );
                assert_eq!(
                    i.offset_of_lsp(i.lsp_position(offset)),
                    offset,
                    "utf16 {text:?}@{offset}"
                );
            }
        }
    }

    #[test]
    fn scalar_and_utf16_columns_agree_without_astral_characters() {
        let i = idx("héllo wörld\nsecond ñ line");
        for offset in 0..=i.len() {
            let lc = i.line_col(offset);
            let lp = i.lsp_position(offset);
            assert_eq!(lc.line - 1, lp.line);
            assert_eq!(lc.column - 1, lp.character);
        }
    }

    #[test]
    fn stores_text_unmodified() {
        let text = "a\r\nb\rc\n";
        assert_eq!(idx(text).text(), text);
    }
}
