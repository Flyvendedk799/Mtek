//! The manifest's `spans` table (`spec/runtime-abi.md` section 5, decision 0019).
//!
//! Generated code, span maps and manifest entries refer to source locations by **span id**,
//! the index of an entry of this table. [`SpanTable::intern`] gives each distinct span one id,
//! in first-request order (the packager requests them in a fixed order, so ids are
//! deterministic), and fills the line and column fields from the source map's line index
//! exactly as the JSON diagnostics do: 1-based lines, 1-based columns counted in Unicode scalar
//! values, the end position being the position of the exclusive end byte.

use std::collections::BTreeMap;

use crate::source::{SourceMap, Span};

use super::manifest::SpanEntry;

/// Interns spans into the manifest's `spans` table.
#[derive(Debug)]
pub struct SpanTable<'a> {
    sources: &'a SourceMap,
    entries: Vec<SpanEntry>,
    ids: BTreeMap<(u32, u32, u32), u32>,
}

impl<'a> SpanTable<'a> {
    /// An empty table over the files of `sources`.
    #[must_use]
    pub fn new(sources: &'a SourceMap) -> Self {
        Self {
            sources,
            entries: Vec::new(),
            ids: BTreeMap::new(),
        }
    }

    /// The id of `span`, adding it on first use.
    ///
    /// # Errors
    /// A text describing the defect when the span's file is not in the source map or the range
    /// does not lie inside it.
    pub fn intern(&mut self, span: Span) -> Result<u32, String> {
        let key = (span.file.0, span.start, span.end);
        if let Some(id) = self.ids.get(&key) {
            return Ok(*id);
        }
        let file = self
            .sources
            .get(span.file)
            .ok_or_else(|| format!("the span {span:?} refers to a file that is not a source"))?;
        if span.start > span.end || file.slice(span.start, span.end).is_none() {
            return Err(format!(
                "the span {span:?} does not lie inside '{}'",
                file.path()
            ));
        }
        let start = file.line_col(span.start);
        let end = file.line_col(span.end);
        let id = u32::try_from(self.entries.len())
            .map_err(|_| "the spans table has more than 2^32 entries".to_owned())?;
        self.entries.push(SpanEntry {
            file: span.file.0,
            start: span.start,
            end: span.end,
            start_line: start.line,
            start_column: start.column,
            end_line: end.line,
            end_column: end.column,
        });
        self.ids.insert(key, id);
        Ok(id)
    }

    /// The table's entries, by id.
    #[must_use]
    pub fn into_entries(self) -> Vec<SpanEntry> {
        self.entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::{FileId, ProjectPath};

    fn sources() -> SourceMap {
        let mut map = SourceMap::new();
        map.add(
            ProjectPath::new("src/main.mtek").expect("path"),
            "scene A {\n  // \u{e9}\u{1f600}x\n}\n".as_bytes(),
        )
        .expect("added");
        map
    }

    #[test]
    fn spans_get_one_id_each_in_first_use_order() {
        let map = sources();
        let mut table = SpanTable::new(&map);
        let a = Span::new(FileId(0), 0, 5);
        let b = Span::new(FileId(0), 6, 7);
        assert_eq!(table.intern(a), Ok(0));
        assert_eq!(table.intern(b), Ok(1));
        assert_eq!(table.intern(a), Ok(0));
        assert_eq!(table.into_entries().len(), 2);
    }

    #[test]
    fn line_and_column_count_scalar_values_and_the_end_is_exclusive() {
        let map = sources();
        let mut table = SpanTable::new(&map);
        // "x" on line 2: after two spaces, "//", a space, é (2 bytes) and an astral character
        // (4 bytes): byte offset 10 + 2 + 2 + 1 + 2 + 4 = 21, column 1 + 2 + 2 + 1 + 1 + 1 = 8.
        let text = map.get(FileId(0)).expect("file").text();
        let x = u32::try_from(text.find('x').expect("x")).expect("small");
        assert_eq!(x, 21);
        table.intern(Span::new(FileId(0), x, x + 1)).expect("ok");
        // The whole file: ends after the final line break, at line 4 column 1.
        let len = u32::try_from(text.len()).expect("small");
        table.intern(Span::new(FileId(0), 0, len)).expect("ok");
        let entries = table.into_entries();
        assert_eq!((entries[0].start_line, entries[0].start_column), (2, 8));
        assert_eq!((entries[0].end_line, entries[0].end_column), (2, 9));
        assert_eq!(
            (
                entries[1].start_line,
                entries[1].start_column,
                entries[1].end_line,
                entries[1].end_column
            ),
            (1, 1, 4, 1)
        );
    }

    #[test]
    fn unknown_files_and_ranges_outside_the_file_are_defects() {
        let map = sources();
        let mut table = SpanTable::new(&map);
        assert!(table.intern(Span::new(FileId(1), 0, 1)).is_err());
        assert!(table.intern(Span::new(FileId(0), 0, 999)).is_err());
        // Splitting the astral character.
        assert!(table.intern(Span::new(FileId(0), 18, 19)).is_err());
    }
}
