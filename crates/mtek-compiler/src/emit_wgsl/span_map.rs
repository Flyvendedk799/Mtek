//! The WGSL span map (`spec/runtime-abi.md` section 5.4): which Mtek span every emitted
//! WGSL declaration, statement and expression originates from.
//!
//! The compiler keeps [`SpanMap`] in memory with real [`Span`]s; it translates Naga
//! errors at compile time ([`super::validate()`]). The packager writes it as
//! `shaders/<h16>.mtek-map.json` through [`SpanMap::document`], which replaces every span
//! by its index in the manifest's `spans` table. The runtime maps `GPUCompilationInfo`
//! messages with the same lookup rule as [`SpanMap::find`].
//!
//! Positions are 1-based lines and columns; `colEnd` is exclusive. Columns count Unicode
//! scalar values; generated WGSL is ASCII, so they equal bytes and UTF-16 units.

use serde::Serialize;

use crate::source::Span;

/// A range on one line of the WGSL text: 1-based `line` and `colStart`, exclusive
/// `colEnd`. Serialised as `{ "line", "colStart", "colEnd" }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WgslRange {
    pub line: u32,
    pub col_start: u32,
    pub col_end: u32,
}

impl WgslRange {
    /// Whether the 1-based position lies in the range.
    pub fn contains(&self, line: u32, column: u32) -> bool {
        self.line == line && self.col_start <= column && column < self.col_end
    }

    /// The number of columns covered.
    pub fn width(&self) -> u32 {
        self.col_end.saturating_sub(self.col_start)
    }
}

/// One entry: a WGSL range, the Mtek span it originates from and the symbol of the
/// declaration that span belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpanMapEntry {
    pub wgsl: WgslRange,
    pub span: Span,
    /// `std/materials.mtek::Unlit` for generated wrapper code,
    /// `std/materials.mtek::Unlit.fragment` for the fragment body.
    pub symbol: String,
}

/// The span map of one emitted module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpanMap {
    /// The material the module was generated for.
    pub symbol: String,
    /// The material declaration: where a WGSL position without an entry maps to.
    pub declaration: Span,
    /// Entries sorted by line, then start column, then widest first.
    pub entries: Vec<SpanMapEntry>,
}

impl SpanMap {
    /// The entry covering a 1-based WGSL position: same line, `colStart <= column <
    /// colEnd`; the narrowest such entry wins (the most specific expression), the first in
    /// entry order on a tie. This is the rule of the runtime's `findSpanMapEntry`.
    pub fn find(&self, line: u32, column: u32) -> Option<&SpanMapEntry> {
        let mut best: Option<&SpanMapEntry> = None;
        for entry in &self.entries {
            if !entry.wgsl.contains(line, column) {
                continue;
            }
            if best.is_none_or(|b| entry.wgsl.width() < b.wgsl.width()) {
                best = Some(entry);
            }
        }
        best
    }

    /// The Mtek span and symbol of a 1-based WGSL position: the entry found by
    /// [`SpanMap::find`], else the material declaration.
    pub fn resolve(&self, line: u32, column: u32) -> (Span, &str) {
        match self.find(line, column) {
            Some(entry) => (entry.span, entry.symbol.as_str()),
            None => (self.declaration, self.symbol.as_str()),
        }
    }

    /// The `shaders/<h16>.mtek-map.json` document: `shader_sha256` is the full hash of the
    /// WGSL file and `span_id` gives the index of a span in the manifest's `spans` table
    /// (the packager adds spans it has not seen yet). Entries keep their order.
    pub fn document(
        &self,
        shader_sha256: &str,
        mut span_id: impl FnMut(Span) -> u32,
    ) -> SpanMapDocument {
        SpanMapDocument {
            shader: shader_sha256.to_owned(),
            entries: self
                .entries
                .iter()
                .map(|entry| SpanMapDocumentEntry {
                    wgsl: entry.wgsl,
                    span: span_id(entry.span),
                    symbol: entry.symbol.clone(),
                })
                .collect(),
        }
    }
}

/// The serialisable span map file. Key order: `shader, entries`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpanMapDocument {
    pub shader: String,
    pub entries: Vec<SpanMapDocumentEntry>,
}

/// One entry of the span map file. Key order: `wgsl, span, symbol`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpanMapDocumentEntry {
    pub wgsl: WgslRange,
    /// Index into the manifest's `spans` table.
    pub span: u32,
    pub symbol: String,
}

impl SpanMapDocument {
    /// Compact JSON, keys in the order above.
    ///
    /// # Errors
    /// Only if `serde_json` fails, which these plain types never cause.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

/// The 1-based line and column (in Unicode scalar values) of byte `offset` of `text`. An
/// offset past the end, or inside a character, is clamped to the preceding boundary.
pub fn wgsl_line_column(text: &str, offset: usize) -> (u32, u32) {
    let mut end = offset.min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    let before = text.get(..end).unwrap_or_default();
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    let line = before.matches('\n').count().saturating_add(1);
    let column = before
        .get(line_start..)
        .unwrap_or_default()
        .chars()
        .count()
        .saturating_add(1);
    (
        u32::try_from(line).unwrap_or(u32::MAX),
        u32::try_from(column).unwrap_or(u32::MAX),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::FileId;

    fn entry(line: u32, start: u32, end: u32, at: u32) -> SpanMapEntry {
        SpanMapEntry {
            wgsl: WgslRange {
                line,
                col_start: start,
                col_end: end,
            },
            span: Span::new(FileId(1), at, at + 1),
            symbol: format!("s{at}"),
        }
    }

    fn map() -> SpanMap {
        SpanMap {
            symbol: "std/materials.mtek::Unlit".to_owned(),
            declaration: Span::new(FileId(1), 0, 50),
            entries: vec![entry(2, 5, 30, 1), entry(2, 14, 20, 2), entry(2, 14, 20, 3)],
        }
    }

    #[test]
    fn the_narrowest_covering_entry_wins_and_ties_keep_the_first() {
        let map = map();
        assert_eq!(map.find(2, 5).map(|e| e.span.start), Some(1));
        assert_eq!(map.find(2, 14).map(|e| e.span.start), Some(2));
        assert_eq!(map.find(2, 19).map(|e| e.span.start), Some(2));
        assert_eq!(map.find(2, 20).map(|e| e.span.start), Some(1));
        assert!(map.find(2, 30).is_none());
        assert!(map.find(3, 10).is_none());
    }

    #[test]
    fn positions_without_an_entry_resolve_to_the_material_declaration() {
        let map = map();
        assert_eq!(
            map.resolve(9, 1),
            (map.declaration, "std/materials.mtek::Unlit")
        );
        assert_eq!(map.resolve(2, 15).1, "s2");
    }

    #[test]
    fn the_document_has_the_runtime_abi_shape() {
        let document = map().document("ab", |span| span.start * 10);
        let json = document.to_json().expect("serialisable");
        assert_eq!(
            json,
            concat!(
                r#"{"shader":"ab","entries":["#,
                r#"{"wgsl":{"line":2,"colStart":5,"colEnd":30},"span":10,"symbol":"s1"},"#,
                r#"{"wgsl":{"line":2,"colStart":14,"colEnd":20},"span":20,"symbol":"s2"},"#,
                r#"{"wgsl":{"line":2,"colStart":14,"colEnd":20},"span":30,"symbol":"s3"}]}"#
            )
        );
    }

    #[test]
    fn line_and_column_of_byte_offsets() {
        let text = "ab\ncdé\nf";
        assert_eq!(wgsl_line_column(text, 0), (1, 1));
        assert_eq!(wgsl_line_column(text, 2), (1, 3));
        assert_eq!(wgsl_line_column(text, 3), (2, 1));
        assert_eq!(wgsl_line_column(text, 7), (2, 4));
        // Inside `é` (bytes 5..7): clamped to its start.
        assert_eq!(wgsl_line_column(text, 6), (2, 3));
        assert_eq!(wgsl_line_column(text, 99), (3, 2));
    }
}
