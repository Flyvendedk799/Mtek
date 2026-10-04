//! Source Map v3 for `app.js` (`spec/runtime-abi.md` section 2,
//! `spec/compiler-architecture.md` sections 4.11 and 6): a small in-house Base64 VLQ writer and
//! the map document.
//!
//! Each [`Mapping`] becomes one segment `[generated column, source, original line, original
//! column]`; original lines and columns are 0-based and columns count UTF-16 code units, as
//! the format expects. `sources` lists the project-relative paths of the referenced `.mtek`
//! files in file-id order; the map carries no `sourcesContent` (no source text is shipped,
//! decision 0019). The statements of the scene initialiser, and every function, statement and
//! expression of the emitted CPU functions, are mapped (decision 0040); where several start at
//! one generated position, the outermost keeps it.

use serde::Serialize;

use crate::source::SourceMap;

use super::ast::Mapping;

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Appends the Base64 VLQ encoding of `value` to `out`.
pub fn encode_vlq(value: i64, out: &mut String) {
    // Sign in the lowest bit, magnitude above it.
    let mut rest: u64 = if value < 0 {
        (value.unsigned_abs() << 1) | 1
    } else {
        value.unsigned_abs() << 1
    };
    loop {
        let mut digit = (rest & 0b1_1111) as usize;
        rest >>= 5;
        if rest > 0 {
            digit |= 0b10_0000;
        }
        out.push(char::from(BASE64[digit]));
        if rest == 0 {
            break;
        }
    }
}

/// The source map document. Key order: `version, file, sources, names, mappings`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SourceMapDocument {
    pub version: u32,
    pub file: String,
    pub sources: Vec<String>,
    pub names: Vec<String>,
    pub mappings: String,
}

impl SourceMapDocument {
    /// The document as compact JSON with a final line break.
    #[must_use]
    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string(self).unwrap_or_default();
        text.push('\n');
        text
    }
}

/// The map of the generated file `file` with `mappings` (in text order) into `sources`.
///
/// # Errors
/// A text describing the defect when a mapping refers to a file that is not in `sources`.
pub fn source_map(
    file: &str,
    mappings: &[Mapping],
    sources: &SourceMap,
) -> Result<SourceMapDocument, String> {
    // The referenced files in file-id order; `index_of[file id]` is the position in `sources`.
    let mut referenced: Vec<u32> = mappings.iter().map(|m| m.span.file.0).collect();
    referenced.sort_unstable();
    referenced.dedup();
    let mut paths = Vec::with_capacity(referenced.len());
    for id in &referenced {
        let source = sources
            .get(crate::source::FileId(*id))
            .ok_or_else(|| format!("a mapping of {file} refers to the unknown file {id}"))?;
        paths.push(source.path().as_str().to_owned());
    }

    let mut text = String::new();
    let mut line = 0u32;
    let (mut previous_source, mut previous_line, mut previous_column) = (0i64, 0i64, 0i64);
    let mut previous_generated: Option<i64> = None;
    for mapping in mappings {
        while line < mapping.line {
            text.push(';');
            line += 1;
            previous_generated = None;
        }
        let source = sources
            .get(mapping.span.file)
            .ok_or_else(|| format!("a mapping of {file} refers to an unknown file"))?;
        let position = source.lsp_position(mapping.span.start);
        let source_index = referenced
            .iter()
            .position(|id| *id == mapping.span.file.0)
            .unwrap_or(0) as i64;
        let generated = i64::from(mapping.column);
        if previous_generated.is_some() {
            text.push(',');
        }
        encode_vlq(generated - previous_generated.unwrap_or(0), &mut text);
        encode_vlq(source_index - previous_source, &mut text);
        encode_vlq(i64::from(position.line) - previous_line, &mut text);
        encode_vlq(i64::from(position.character) - previous_column, &mut text);
        previous_generated = Some(generated);
        previous_source = source_index;
        previous_line = i64::from(position.line);
        previous_column = i64::from(position.character);
    }
    Ok(SourceMapDocument {
        version: 3,
        file: file.to_owned(),
        sources: paths,
        names: Vec::new(),
        mappings: text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::{FileId, ProjectPath, Span};

    fn vlq(value: i64) -> String {
        let mut out = String::new();
        encode_vlq(value, &mut out);
        out
    }

    /// Known vectors of the Base64 VLQ encoding used by Source Map v3.
    #[test]
    fn vlq_matches_known_vectors() {
        assert_eq!(vlq(0), "A");
        assert_eq!(vlq(1), "C");
        assert_eq!(vlq(-1), "D");
        assert_eq!(vlq(15), "e");
        assert_eq!(vlq(-15), "f");
        assert_eq!(vlq(16), "gB");
        assert_eq!(vlq(-16), "hB");
        assert_eq!(vlq(123), "2H");
        assert_eq!(vlq(1000), "w+B");
        assert_eq!(vlq(-2_147_483_648), "hgggggE");
        // Digit boundaries (5 bits per digit, the sign in the lowest bit of the first).
        assert_eq!(vlq(31), "+B");
        assert_eq!(vlq(-31), "/B");
        assert_eq!(vlq(32), "gC");
        assert_eq!(vlq(-32), "hC");
        assert_eq!(vlq(511), "+f");
        assert_eq!(vlq(512), "ggB");
        assert_eq!(vlq(-1000), "x+B");
        assert_eq!(vlq(1_000_000), "gkh9B");
        assert_eq!(vlq(2_147_483_647), "+/////D");
        assert_eq!(vlq(4_294_967_295), "+/////H");
    }

    #[test]
    fn mappings_are_relative_and_lines_are_separated_by_semicolons() {
        let mut sources = SourceMap::new();
        sources
            .add(
                ProjectPath::new("src/main.mtek").expect("path"),
                "ab\ncd\u{e9}\u{1f600}x\n".as_bytes(),
            )
            .expect("added");
        let at = |start| Span::new(FileId(0), start, start + 1);
        let mappings = [
            Mapping {
                line: 1,
                column: 2,
                span: at(0),
            },
            Mapping {
                line: 1,
                column: 6,
                span: at(3),
            },
            // "x" after é (1 unit) and an astral character (2 units): column 5.
            Mapping {
                line: 3,
                column: 2,
                span: at(11),
            },
        ];
        let document = source_map("app.js", &mappings, &sources).expect("mapped");
        assert_eq!(document.sources, ["src/main.mtek"]);
        // Line 0 empty; line 1: [2,0,0,0] and [+4,0,+1,0]; line 2 empty; line 3: [2,0,0,+5].
        assert_eq!(document.mappings, ";EAAA,IACA;;EAAK");
        assert_eq!(
            document.to_json(),
            "{\"version\":3,\"file\":\"app.js\",\"sources\":[\"src/main.mtek\"],\"names\":[],\"mappings\":\";EAAA,IACA;;EAAK\"}\n"
        );
    }

    #[test]
    fn no_mappings_is_a_valid_empty_map() {
        let document = source_map("app.js", &[], &SourceMap::new()).expect("mapped");
        assert_eq!(document.mappings, "");
        assert!(document.sources.is_empty());
    }
}
