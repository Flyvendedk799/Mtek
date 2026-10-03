//! JSON rendering: the envelope of one diagnostic (`spec/diagnostics.md` 2.1)
//! and the report shape (2.2). `spec/diagnostic.schema.json` describes both.
//!
//! Output is deterministic: keys appear in the order of the specification and
//! contain no timestamps or absolute paths.
//!
//! These functions are total. A span whose file is not in the source map
//! (a compiler bug, never user input) makes the primary `source` `null` and is
//! left out of `related` and `suggestedEdits`, instead of panicking.

use serde_json::{Map, Value, json};

use super::model::{Diagnostic, Label, SuggestedEdit};
use super::sink::Report;
use crate::source::{SourceMap, Span};
use crate::{COMPILER_VERSION, LANGUAGE_VERSION};

/// The `schemaVersion` of envelopes and reports.
pub const SCHEMA_VERSION: u32 = 1;

/// The `source` object of a span: file, byte range (as stored on disk) and
/// 1-based lines and columns (columns count Unicode scalar values). `None`
/// if the span's file is unknown.
#[must_use]
pub fn source_object(span: Span, map: &SourceMap) -> Option<Value> {
    let file = map.get(span.file)?;
    let start = file.line_col(span.start);
    let end = file.line_col(span.end);
    Some(json!({
        "file": file.path().as_str(),
        "startByte": span.start,
        "endByte": span.end,
        "startLine": start.line,
        "startColumn": start.column,
        "endLine": end.line,
        "endColumn": end.column,
    }))
}

fn related_object(label: &Label, map: &SourceMap) -> Option<Value> {
    let source = source_object(label.span, map)?;
    let mut object = Map::new();
    if let Some(message) = &label.message {
        object.insert("message".into(), Value::String(message.clone()));
    }
    object.insert("source".into(), source);
    Some(Value::Object(object))
}

fn edit_object(edit: &SuggestedEdit, map: &SourceMap) -> Option<Value> {
    let mut edits = Vec::with_capacity(edit.edits.len());
    for text_edit in &edit.edits {
        let file = map.get(text_edit.span.file)?;
        edits.push(json!({
            "file": file.path().as_str(),
            "startByte": text_edit.span.start,
            "endByte": text_edit.span.end,
            "replacement": text_edit.replacement,
        }));
    }
    Some(json!({ "description": edit.description, "edits": edits }))
}

/// The envelope of one diagnostic, exactly as `spec/diagnostics.md` 2.1.
///
/// The text of the primary label is not part of the envelope (it is the
/// human renderer's caret annotation); machine-readable detail belongs in
/// `expected`, `actual`, `related` and `notes`.
#[must_use]
pub fn to_envelope(diagnostic: &Diagnostic, map: &SourceMap) -> Value {
    let source = diagnostic
        .primary
        .as_ref()
        .and_then(|label| source_object(label.span, map))
        .unwrap_or(Value::Null);
    let mut object = Map::new();
    object.insert("schemaVersion".into(), json!(SCHEMA_VERSION));
    object.insert("code".into(), json!(diagnostic.code.as_str()));
    object.insert("severity".into(), json!(diagnostic.severity.as_str()));
    object.insert("title".into(), json!(diagnostic.code.title()));
    object.insert("message".into(), json!(diagnostic.message));
    object.insert("source".into(), source);
    if let Some(expected) = &diagnostic.expected {
        object.insert("expected".into(), json!(expected));
    }
    if let Some(actual) = &diagnostic.actual {
        object.insert("actual".into(), json!(actual));
    }
    let related: Vec<Value> = diagnostic
        .related
        .iter()
        .filter_map(|label| related_object(label, map))
        .collect();
    object.insert("related".into(), Value::Array(related));
    object.insert("notes".into(), json!(diagnostic.notes));
    let edits: Vec<Value> = diagnostic
        .edits
        .iter()
        .filter_map(|edit| edit_object(edit, map))
        .collect();
    object.insert("suggestedEdits".into(), Value::Array(edits));
    object.insert("phase".into(), json!(diagnostic.phase.as_str()));
    object.insert("docs".into(), json!(diagnostic.code.docs()));
    Value::Object(object)
}

/// The report of `mtek check --format json` / `mtek build --format json`
/// (`spec/diagnostics.md` 2.2). `project` is the project name, or `None`
/// (`null`) if no project could be read (for example `E9004`).
#[must_use]
pub fn to_report(report: &Report, project: Option<&str>, map: &SourceMap) -> Value {
    let diagnostics: Vec<Value> = report
        .diagnostics
        .iter()
        .map(|diagnostic| to_envelope(diagnostic, map))
        .collect();
    json!({
        "schemaVersion": SCHEMA_VERSION,
        "tool": "mtek",
        "compilerVersion": COMPILER_VERSION,
        "languageVersion": LANGUAGE_VERSION,
        "project": project,
        "diagnostics": diagnostics,
        "summary": {
            "errors": report.summary.errors,
            "warnings": report.summary.warnings,
            "notes": report.summary.notes,
            "suppressed": report.summary.suppressed,
        },
    })
}

/// Pretty-print a value with two-space indentation (no trailing newline).
#[must_use]
pub fn to_pretty_string(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::{Code, Diagnostics};
    use crate::source::{FileId, ProjectPath};

    fn map_with(files: &[(&str, &str)]) -> SourceMap {
        let mut map = SourceMap::new();
        for (path, text) in files {
            map.add(ProjectPath::new(path).unwrap(), text.as_bytes())
                .unwrap();
        }
        map
    }

    #[test]
    fn envelope_matches_the_specification_example_shape() {
        let map = map_with(&[(
            "src/main.mtek",
            "param phase: f32 = 0.0;\nphase: vec3(1.0, 0.0, 0.0);\n",
        )]);
        let f = FileId(0);
        let d = Diagnostic::new(
            Code::E3102,
            "Material parameter 'phase' expects f32, but received vec3.",
        )
        .at(Span::new(f, 31, 50))
        .expected("f32")
        .actual("vec3")
        .related(Span::new(f, 0, 23), "parameter 'phase' is declared here");
        let value = to_envelope(&d, &map);
        let expected = json!({
            "schemaVersion": 1,
            "code": "MTEK-E3102",
            "severity": "error",
            "title": "field or parameter type mismatch",
            "message": "Material parameter 'phase' expects f32, but received vec3.",
            "source": {
                "file": "src/main.mtek",
                "startByte": 31, "endByte": 50,
                "startLine": 2, "startColumn": 8, "endLine": 2, "endColumn": 27
            },
            "expected": "f32",
            "actual": "vec3",
            "related": [
                { "message": "parameter 'phase' is declared here", "source": {
                    "file": "src/main.mtek",
                    "startByte": 0, "endByte": 23,
                    "startLine": 1, "startColumn": 1, "endLine": 1, "endColumn": 24 } }
            ],
            "notes": [],
            "suggestedEdits": [],
            "phase": "check",
            "docs": "spec/diagnostics.md#mtek-e3102"
        });
        assert_eq!(value, expected);
        let keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        assert_eq!(
            keys,
            [
                "schemaVersion",
                "code",
                "severity",
                "title",
                "message",
                "source",
                "expected",
                "actual",
                "related",
                "notes",
                "suggestedEdits",
                "phase",
                "docs"
            ]
        );
    }

    #[test]
    fn optional_fields_are_omitted_and_project_level_source_is_null() {
        let map = SourceMap::new();
        let d = Diagnostic::new(Code::E9004, "No mtek.toml found.");
        let value = to_envelope(&d, &map);
        assert_eq!(value["source"], Value::Null);
        assert!(value.get("expected").is_none());
        assert!(value.get("actual").is_none());
        assert_eq!(value["related"], json!([]));
        assert_eq!(value["notes"], json!([]));
        assert_eq!(value["suggestedEdits"], json!([]));
    }

    #[test]
    fn columns_count_scalar_values_and_bytes_are_disk_offsets() {
        // 'é' is 2 bytes, U+1F600 is 4 bytes; the CRLF ends line 1.
        let text = "\u{FEFF}a\u{e9}\u{1F600}b\r\nc";
        let map = map_with(&[("a.mtek", text)]);
        let b = text.find('b').unwrap() as u32;
        let d = Diagnostic::new(Code::E1001, "x").at(Span::new(FileId(0), b, b + 1));
        let source = &to_envelope(&d, &map)["source"];
        assert_eq!(source["startByte"], json!(b));
        assert_eq!(source["startLine"], json!(1));
        assert_eq!(source["startColumn"], json!(4)); // a, é, emoji, then b
        assert_eq!(source["endColumn"], json!(5));
    }

    #[test]
    fn multi_line_span_and_crlf() {
        let map = map_with(&[("a.mtek", "ab\r\ncd\r\nef")]);
        let d = Diagnostic::new(Code::E1002, "x").at(Span::new(FileId(0), 1, 9));
        let source = &to_envelope(&d, &map)["source"];
        assert_eq!(
            (
                &source["startLine"],
                &source["startColumn"],
                &source["endLine"],
                &source["endColumn"]
            ),
            (&json!(1), &json!(2), &json!(3), &json!(2))
        );
    }

    #[test]
    fn notes_edits_and_phase() {
        let map = map_with(&[("a.mtek", "let x = 1.;")]);
        let f = FileId(0);
        let d = Diagnostic::new(Code::E0022, "Malformed float literal '1.'.")
            .at(Span::new(f, 8, 10))
            .help("write `1.0`")
            .note("float literals need digits on both sides of the point")
            .edit(SuggestedEdit::new("use a float literal").replace(Span::new(f, 8, 10), "1.0"));
        let value = to_envelope(&d, &map);
        assert_eq!(value["phase"], json!("parse"));
        assert_eq!(
            value["notes"],
            json!([
                "help: write `1.0`",
                "float literals need digits on both sides of the point"
            ])
        );
        assert_eq!(
            value["suggestedEdits"],
            json!([{
                "description": "use a float literal",
                "edits": [{ "file": "a.mtek", "startByte": 8, "endByte": 10, "replacement": "1.0" }]
            }])
        );
    }

    #[test]
    fn unknown_files_never_panic() {
        let map = SourceMap::new();
        let ghost = Span::new(FileId(7), 0, 1);
        let d = Diagnostic::new(Code::E1001, "x")
            .at(ghost)
            .related(ghost, "r")
            .edit(SuggestedEdit::new("e").replace(ghost, "y"));
        let value = to_envelope(&d, &map);
        assert_eq!(value["source"], Value::Null);
        assert_eq!(value["related"], json!([]));
        assert_eq!(value["suggestedEdits"], json!([]));
    }

    #[test]
    fn related_without_text_omits_message() {
        let map = map_with(&[("a.mtek", "abc")]);
        let d = Diagnostic::new(Code::E2002, "dup").related_span(Span::new(FileId(0), 0, 1));
        let value = to_envelope(&d, &map);
        assert!(value["related"][0].get("message").is_none());
        assert_eq!(value["related"][0]["source"]["startByte"], json!(0));
    }

    #[test]
    fn report_shape() {
        let map = map_with(&[("a.mtek", "abc")]);
        let mut sink = Diagnostics::new();
        sink.push(Diagnostic::new(Code::E1001, "x").at(Span::new(FileId(0), 0, 1)));
        sink.push(Diagnostic::new(Code::W0030, "w").at(Span::new(FileId(0), 1, 2)));
        let report = sink.finish();
        let value = to_report(&report, Some("pulse-cube"), &map);
        assert_eq!(value["schemaVersion"], json!(1));
        assert_eq!(value["tool"], json!("mtek"));
        assert_eq!(value["compilerVersion"], json!(COMPILER_VERSION));
        assert_eq!(value["languageVersion"], json!("0.1"));
        assert_eq!(value["project"], json!("pulse-cube"));
        assert_eq!(value["diagnostics"].as_array().map(Vec::len), Some(2));
        assert_eq!(
            value["summary"],
            json!({ "errors": 1, "warnings": 1, "notes": 0, "suppressed": 0 })
        );
        let keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        assert_eq!(
            keys,
            [
                "schemaVersion",
                "tool",
                "compilerVersion",
                "languageVersion",
                "project",
                "diagnostics",
                "summary"
            ]
        );
        assert_eq!(to_report(&report, None, &map)["project"], Value::Null);
    }

    #[test]
    fn pretty_output_is_stable() {
        let map = SourceMap::new();
        let d = Diagnostic::new(Code::E9004, "No mtek.toml found.");
        let text = to_pretty_string(&to_envelope(&d, &map));
        assert!(text.starts_with("{\n  \"schemaVersion\": 1,\n  \"code\": \"MTEK-E9004\","));
        assert!(!text.ends_with('\n'));
    }
}
