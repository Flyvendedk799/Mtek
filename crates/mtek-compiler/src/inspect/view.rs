//! What the `--shaders` and `--bindings` views share: source locations and plain-text
//! tables.

use serde::Serialize;

use crate::source::{SourceMap, Span};

/// A span with its file and line/column range: the `source` object of the JSON diagnostics
/// (`spec/diagnostics.md` section 2.1). Lines and columns are 1-based; columns count Unicode
/// scalar values.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    pub file: String,
    pub start_byte: u32,
    pub end_byte: u32,
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

impl SourceLocation {
    /// The location of `span`, or a defect text if its file is not in `sources`.
    pub fn of(span: Span, sources: &SourceMap) -> Result<Self, String> {
        let file = sources
            .get(span.file)
            .ok_or_else(|| format!("the span {span:?} is not in the source map"))?;
        let start = file.line_col(span.start);
        let end = file.line_col(span.end);
        Ok(SourceLocation {
            file: file.path().as_str().to_owned(),
            start_byte: span.start,
            end_byte: span.end,
            start_line: start.line,
            start_column: start.column,
            end_line: end.line,
            end_column: end.column,
        })
    }

    /// `src/main.mtek:12:9-12:44`.
    #[must_use]
    pub fn human(&self) -> String {
        format!(
            "{}:{}:{}-{}:{}",
            self.file, self.start_line, self.start_column, self.end_line, self.end_column
        )
    }
}

/// Pretty JSON with a final line break. Serialising the views cannot fail: every key is a
/// string and every number an integer.
pub fn to_json<T: Serialize>(value: &T) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap_or_default();
    text.push('\n');
    text
}

/// How a column of a [`table`] is aligned.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Align {
    Left,
    Right,
}

/// A plain-text table indented by `indent` spaces: the header, then one line per row,
/// columns separated by two spaces and as wide as their widest cell (counted in `char`s),
/// trailing spaces removed.
pub fn table(out: &mut String, indent: usize, columns: &[(&str, Align)], rows: &[Vec<String>]) {
    let mut widths: Vec<usize> = columns.iter().map(|(h, _)| h.chars().count()).collect();
    for row in rows {
        for (width, cell) in widths.iter_mut().zip(row) {
            *width = (*width).max(cell.chars().count());
        }
    }
    let header: Vec<String> = columns.iter().map(|(h, _)| (*h).to_owned()).collect();
    for row in std::iter::once(&header).chain(rows) {
        let mut line = " ".repeat(indent);
        for (index, ((cell, width), (_, align))) in row.iter().zip(&widths).zip(columns).enumerate()
        {
            if index > 0 {
                line.push_str("  ");
            }
            let pad = width.saturating_sub(cell.chars().count());
            match align {
                Align::Left => {
                    line.push_str(cell);
                    line.push_str(&" ".repeat(pad));
                }
                Align::Right => {
                    line.push_str(&" ".repeat(pad));
                    line.push_str(cell);
                }
            }
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::ProjectPath;

    #[test]
    fn tables_align_columns_and_trim_lines() {
        let mut out = String::new();
        table(
            &mut out,
            2,
            &[
                ("name", Align::Left),
                ("size", Align::Right),
                ("x", Align::Left),
            ],
            &[
                vec!["color".into(), "16".into(), String::new()],
                vec!["a".into(), "4".into(), "é".into()],
            ],
        );
        assert_eq!(out, "  name   size  x\n  color    16\n  a         4  é\n");
    }

    #[test]
    fn locations_carry_lines_and_columns() {
        let mut sources = SourceMap::new();
        let file = sources
            .add(ProjectPath::new("src/main.mtek").unwrap(), b"ab\ncd\n")
            .unwrap();
        let location = SourceLocation::of(Span::new(file, 3, 5), &sources).unwrap();
        assert_eq!(location.human(), "src/main.mtek:2:1-2:3");
        assert!(SourceLocation::of(Span::new(crate::source::FileId(9), 0, 1), &sources).is_err());
    }
}
