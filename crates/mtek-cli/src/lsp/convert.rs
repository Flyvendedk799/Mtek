//! The compiler's diagnostics as the protocol's (decision 0076 item 3), and the validated
//! suggested edits of `spec/diagnostics.md` section 6 as code actions (item 10).
//!
//! The mapping is direct:
//!
//! * the primary span is the range (byte offsets of the file as the compiler read it, which is
//!   the editor's buffer, converted to the negotiated position encoding); a diagnostic without
//!   a location (a problem of the project file, a file that could not be read) is put at the
//!   start of the file the caller names (`mtek.toml` for a project, the document itself for a
//!   file without a project);
//! * `code` is the catalogue code (`MTEK-E3001`), `source` is `mtek`, the severity is the
//!   code's (error, warning; a note is information);
//! * the message is the diagnostic's message, then the text of the primary label, then every
//!   note (`note:` and `help:` lines): everything a person needs in one tooltip;
//! * every related span with a text is `relatedInformation`;
//! * every validated suggested edit is a quick fix whose `WorkspaceEdit` holds exactly the
//!   edits of that suggestion (and so can touch another file than the diagnostic's);
//!   the validation is the compiler's (decision 0071), the server adds none and drops none.

use std::collections::{BTreeMap, HashMap};

use lsp_types::{
    CodeAction, CodeActionKind, Diagnostic, DiagnosticRelatedInformation, DiagnosticSeverity,
    DocumentChanges, Location, NumberOrString, OneOf, OptionalVersionedTextDocumentIdentifier,
    Range, TextDocumentEdit, TextEdit, Uri, WorkspaceEdit,
};
use mtek_compiler::diagnostics::{
    Diagnostic as CompilerDiagnostic, Diagnostics, HELP_PREFIX, Report, Severity,
};
use mtek_compiler::project::RESERVED_DIRECTORY;
use mtek_compiler::source::{ProjectPath, SourceFile, SourceMap};
use mtek_compiler::syntax::{lex, parse_module};

use super::position::PositionEncoding;

/// A diagnostic of the compiler, as published, with what a code action needs.
#[derive(Clone, Debug)]
pub struct Located {
    pub lsp: Diagnostic,
    /// The byte range of the primary span in its file (empty at 0 for a diagnostic without a
    /// location).
    pub bytes: (u32, u32),
    /// The validated suggested edits.
    pub fixes: Vec<Fix>,
}

/// One validated suggested edit: a title and the edits, by file.
#[derive(Clone, Debug)]
pub struct Fix {
    pub title: String,
    pub edits: Vec<(ProjectPath, TextEdit)>,
}

/// The URI of a project file, and the version of the document if it is open.
pub trait Uris {
    fn uri(&self, path: &ProjectPath) -> Option<Uri>;
    fn version(&self, path: &ProjectPath) -> Option<i32>;
}

/// The diagnostics of `report` by the file they are in; `sources` is the source map the spans
/// refer to and `fallback` the file diagnostics without a location go to.
pub fn convert(
    report: &Report,
    sources: &SourceMap,
    encoding: PositionEncoding,
    uris: &dyn Uris,
    fallback: &ProjectPath,
) -> BTreeMap<ProjectPath, Vec<Located>> {
    let mut files: BTreeMap<ProjectPath, Vec<Located>> = BTreeMap::new();
    for diagnostic in &report.diagnostics {
        let (path, range, bytes) = place(diagnostic, sources, encoding, fallback);
        let located = Located {
            lsp: Diagnostic {
                range,
                severity: Some(severity(diagnostic.severity)),
                code: Some(NumberOrString::String(diagnostic.code.as_str().to_owned())),
                source: Some("mtek".to_owned()),
                message: message(diagnostic),
                related_information: related(diagnostic, sources, encoding, uris),
                ..Diagnostic::default()
            },
            bytes,
            fixes: diagnostic
                .edits
                .iter()
                .filter_map(|edit| fix(edit, sources, encoding))
                .collect(),
        };
        files.entry(path).or_default().push(located);
    }
    files
}

/// The file, range and byte range of the primary location of `diagnostic`.
fn place(
    diagnostic: &CompilerDiagnostic,
    sources: &SourceMap,
    encoding: PositionEncoding,
    fallback: &ProjectPath,
) -> (ProjectPath, Range, (u32, u32)) {
    let located = diagnostic.primary.as_ref().and_then(|label| {
        let file = sources.get(label.span.file)?;
        // A diagnostic in the embedded prelude is a compiler defect with no file to show.
        if file.path().segments().next() == Some(RESERVED_DIRECTORY) {
            return None;
        }
        Some((file, label.span.start, label.span.end))
    });
    match located {
        Some((file, start, end)) => (
            file.path().clone(),
            encoding.range(file.lines(), start, end),
            (start, end.max(start)),
        ),
        None => (fallback.clone(), Range::default(), (0, 0)),
    }
}

fn severity(severity: Severity) -> DiagnosticSeverity {
    match severity {
        Severity::Error => DiagnosticSeverity::ERROR,
        Severity::Warning => DiagnosticSeverity::WARNING,
        Severity::Note => DiagnosticSeverity::INFORMATION,
    }
}

/// The message, the text of the primary label and the notes, one per line.
fn message(diagnostic: &CompilerDiagnostic) -> String {
    let mut text = diagnostic.message.clone();
    if let Some(label) = diagnostic
        .primary
        .as_ref()
        .and_then(|label| label.message.as_deref())
        .filter(|label| !label.is_empty() && *label != diagnostic.message)
    {
        text.push('\n');
        text.push_str(label);
    }
    for note in &diagnostic.notes {
        text.push('\n');
        if note.starts_with(HELP_PREFIX) {
            text.push_str(note);
        } else {
            text.push_str("note: ");
            text.push_str(note);
        }
    }
    text
}

fn related(
    diagnostic: &CompilerDiagnostic,
    sources: &SourceMap,
    encoding: PositionEncoding,
    uris: &dyn Uris,
) -> Option<Vec<DiagnosticRelatedInformation>> {
    let items: Vec<DiagnosticRelatedInformation> = diagnostic
        .related
        .iter()
        .filter_map(|label| {
            let file = sources.get(label.span.file)?;
            let uri = uris.uri(file.path())?;
            Some(DiagnosticRelatedInformation {
                location: Location {
                    uri,
                    range: encoding.range(file.lines(), label.span.start, label.span.end),
                },
                message: label.message.clone().unwrap_or_default(),
            })
        })
        .collect();
    (!items.is_empty()).then_some(items)
}

/// The suggested edit as a fix; `None` if one of its files is not known (it cannot be shown).
fn fix(
    edit: &mtek_compiler::diagnostics::SuggestedEdit,
    sources: &SourceMap,
    encoding: PositionEncoding,
) -> Option<Fix> {
    let mut edits = Vec::with_capacity(edit.edits.len());
    for text_edit in &edit.edits {
        let file: &SourceFile = sources.get(text_edit.span.file)?;
        edits.push((
            file.path().clone(),
            TextEdit {
                range: encoding.range(file.lines(), text_edit.span.start, text_edit.span.end),
                new_text: text_edit.replacement.clone(),
            },
        ));
    }
    Some(Fix {
        title: edit.description.clone(),
        edits,
    })
}

/// The quick fixes of `located` (one per validated suggestion), as code actions.
pub fn code_actions(located: &Located, uris: &dyn Uris, document_changes: bool) -> Vec<CodeAction> {
    located
        .fixes
        .iter()
        .filter_map(|fix| {
            Some(CodeAction {
                title: fix.title.clone(),
                kind: Some(CodeActionKind::QUICKFIX),
                diagnostics: Some(vec![located.lsp.clone()]),
                edit: Some(workspace_edit(fix, uris, document_changes)?),
                is_preferred: Some(true),
                ..CodeAction::default()
            })
        })
        .collect()
}

/// The edits of `fix` as one `WorkspaceEdit`: grouped by file in order of first appearance,
/// with the version of the open document when the client takes `documentChanges`.
fn workspace_edit(fix: &Fix, uris: &dyn Uris, document_changes: bool) -> Option<WorkspaceEdit> {
    let mut order: Vec<&ProjectPath> = Vec::new();
    let mut by_file: BTreeMap<&ProjectPath, Vec<TextEdit>> = BTreeMap::new();
    for (path, edit) in &fix.edits {
        if !by_file.contains_key(path) {
            order.push(path);
        }
        by_file.entry(path).or_default().push(edit.clone());
    }
    if document_changes {
        let mut documents = Vec::new();
        for path in order {
            documents.push(TextDocumentEdit {
                text_document: OptionalVersionedTextDocumentIdentifier {
                    uri: uris.uri(path)?,
                    version: uris.version(path),
                },
                edits: by_file.remove(path)?.into_iter().map(OneOf::Left).collect(),
            });
        }
        Some(WorkspaceEdit {
            document_changes: Some(DocumentChanges::Edits(documents)),
            ..WorkspaceEdit::default()
        })
    } else {
        // `Uri` hashes and compares by its text; the cached parts of `fluent_uri` that clippy
        // sees as interior mutability never change its key.
        #[allow(clippy::mutable_key_type)]
        let mut changes: HashMap<Uri, Vec<TextEdit>> = HashMap::new();
        for path in order {
            changes.insert(uris.uri(path)?, by_file.remove(path)?);
        }
        Some(WorkspaceEdit {
            changes: Some(changes),
            ..WorkspaceEdit::default()
        })
    }
}

/// The path a file without a project is registered under in [`syntax_report`]'s source map.
pub const LOOSE_PATH: &str = "document.mtek";

/// The syntax diagnostics of a text on its own (a file that is in no project, or that no module
/// of its project imports): the lexical and syntax diagnostics of the compiler, whose names
/// and types need a project. No edit is attached: the proofs of `spec/diagnostics.md` section
/// 6.3 re-check a whole project.
pub fn syntax_report(text: &str) -> (SourceMap, Report) {
    let mut sources = SourceMap::new();
    let mut sink = Diagnostics::new();
    let path = ProjectPath::new(LOOSE_PATH).unwrap_or_else(|_| ProjectPath::root());
    match sources.add(path, text.as_bytes()) {
        Ok(id) => {
            if let Some(file) = sources.get(id) {
                let mut lexed = lex(file);
                lexed.report_into(&mut sink);
                let _ = parse_module(file.text(), &lexed.tokens, &lexed.trivia, &mut sink);
            }
        }
        Err(error) => sink.push(CompilerDiagnostic::from_source_error(&error)),
    }
    (sources, sink.finish())
}

/// A [`Uris`] for tests and single documents: one URI and version for every path.
pub struct OneDocument {
    pub uri: Uri,
    pub version: Option<i32>,
}

impl Uris for OneDocument {
    fn uri(&self, _: &ProjectPath) -> Option<Uri> {
        Some(self.uri.clone())
    }
    fn version(&self, _: &ProjectPath) -> Option<i32> {
        self.version
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use lsp_types::Position;
    use mtek_compiler::diagnostics::{Code, Diagnostic as D, SuggestedEdit};
    use mtek_compiler::source::{FileId, Span};

    use super::*;

    fn sources(text: &str) -> SourceMap {
        let mut map = SourceMap::new();
        map.add(ProjectPath::new("src/main.mtek").unwrap(), text.as_bytes())
            .unwrap();
        map
    }

    fn report(diagnostics: Vec<D>) -> Report {
        let mut sink = Diagnostics::new();
        for d in diagnostics {
            sink.push(d);
        }
        sink.finish()
    }

    fn uris() -> OneDocument {
        OneDocument {
            uri: Uri::from_str("file:///p/src/main.mtek").unwrap(),
            version: Some(3),
        }
    }

    fn fallback() -> ProjectPath {
        ProjectPath::new("mtek.toml").unwrap()
    }

    #[test]
    fn a_diagnostic_has_the_catalogue_code_severity_message_notes_and_related_spans() {
        let text = "const A: f32 = 1;\nconst B = A;\n";
        let map = sources(text);
        let f = FileId(0);
        let d = D::new(Code::E3001, "Constant 'A' expects f32, but received i32.")
            .label(Span::new(f, 15, 16), "expected f32, found i32")
            .related(Span::new(f, 6, 7), "declared here")
            .note("a plain note")
            .help("write `1.0`");
        let w = D::new(Code::W3081, "Unreachable code.").at(Span::new(f, 18, 23));
        let converted = convert(
            &report(vec![d, w]),
            &map,
            PositionEncoding::Utf16,
            &uris(),
            &fallback(),
        );
        let list = &converted[&ProjectPath::new("src/main.mtek").unwrap()];
        assert_eq!(list.len(), 2);
        let first = &list[0].lsp;
        assert_eq!(
            first.code,
            Some(NumberOrString::String("MTEK-E3001".to_owned()))
        );
        assert_eq!(first.source.as_deref(), Some("mtek"));
        assert_eq!(first.severity, Some(DiagnosticSeverity::ERROR));
        assert_eq!(
            first.message,
            "Constant 'A' expects f32, but received i32.\nexpected f32, found i32\nnote: a plain note\nhelp: write `1.0`"
        );
        assert_eq!(
            first.range,
            Range {
                start: Position {
                    line: 0,
                    character: 15
                },
                end: Position {
                    line: 0,
                    character: 16
                }
            }
        );
        assert_eq!(list[0].bytes, (15, 16));
        let related = first.related_information.as_ref().unwrap();
        assert_eq!(related.len(), 1);
        assert_eq!(related[0].message, "declared here");
        assert_eq!(related[0].location.range.start.character, 6);
        assert_eq!(list[1].lsp.severity, Some(DiagnosticSeverity::WARNING));
        assert_eq!(
            list[1].lsp.range.start,
            Position {
                line: 1,
                character: 0
            }
        );
        assert!(list[1].lsp.related_information.is_none());
    }

    #[test]
    fn positions_use_the_negotiated_encoding_with_multibyte_text_before_the_span() {
        // "é😀" is 3 UTF-16 units and 6 bytes before `x`.
        let text = "// \u{e9}\u{1f600} x\n";
        let map = sources(text);
        let start = u32::try_from(text.find('x').unwrap()).unwrap();
        let d = D::new(Code::E2003, "Unknown name 'x'.").at(Span::new(FileId(0), start, start + 1));
        let r = report(vec![d]);
        let utf16 = convert(&r, &map, PositionEncoding::Utf16, &uris(), &fallback());
        let utf8 = convert(&r, &map, PositionEncoding::Utf8, &uris(), &fallback());
        let path = ProjectPath::new("src/main.mtek").unwrap();
        assert_eq!(utf16[&path][0].lsp.range.start.character, 7);
        assert_eq!(utf16[&path][0].lsp.range.end.character, 8);
        assert_eq!(utf8[&path][0].lsp.range.start.character, 10);
        assert_eq!(utf8[&path][0].lsp.range.end.character, 11);
    }

    #[test]
    fn a_diagnostic_without_a_location_goes_to_the_fallback_file_at_the_start() {
        let map = sources("");
        let d = D::new(Code::E9001, "Invalid project configuration.");
        let converted = convert(
            &report(vec![d]),
            &map,
            PositionEncoding::Utf16,
            &uris(),
            &fallback(),
        );
        assert_eq!(converted.len(), 1);
        let list = &converted[&fallback()];
        assert_eq!(list[0].lsp.range, Range::default());
        assert_eq!(list[0].bytes, (0, 0));
    }

    #[test]
    fn validated_edits_become_quick_fixes_with_one_workspace_edit_each() {
        let text = "const A: f32 = 1.;\n";
        let map = sources(text);
        let f = FileId(0);
        let edit = SuggestedEdit::new("write the float literal as `1.0`")
            .replace(Span::new(f, 15, 17), "1.0");
        let d = D::new(Code::E0022, "Malformed float.")
            .at(Span::new(f, 15, 17))
            .edit(edit);
        let converted = convert(
            &report(vec![d]),
            &map,
            PositionEncoding::Utf16,
            &uris(),
            &fallback(),
        );
        let located = &converted[&ProjectPath::new("src/main.mtek").unwrap()][0];
        assert_eq!(located.fixes.len(), 1);
        // With `changes`.
        let actions = code_actions(located, &uris(), false);
        assert_eq!(actions.len(), 1);
        let action = &actions[0];
        assert_eq!(action.title, "write the float literal as `1.0`");
        assert_eq!(action.kind, Some(CodeActionKind::QUICKFIX));
        assert_eq!(action.is_preferred, Some(true));
        assert_eq!(action.diagnostics.as_ref().unwrap().len(), 1);
        #[allow(clippy::mutable_key_type)]
        let changes = action.edit.as_ref().unwrap().changes.as_ref().unwrap();
        let edits = &changes[&uris().uri];
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].new_text, "1.0");
        assert_eq!(edits[0].range.start.character, 15);
        assert_eq!(edits[0].range.end.character, 17);
        // With `documentChanges`, the version of the open document is there.
        let actions = code_actions(located, &uris(), true);
        let Some(DocumentChanges::Edits(documents)) =
            &actions[0].edit.as_ref().unwrap().document_changes
        else {
            panic!("no document changes");
        };
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].text_document.version, Some(3));
        assert_eq!(documents[0].edits.len(), 1);
    }

    #[test]
    fn diagnostics_in_the_reserved_prelude_directory_have_no_file_to_show() {
        let mut map = SourceMap::new();
        map.add(ProjectPath::new("std/materials.mtek").unwrap(), b"x")
            .unwrap();
        let d = D::new(Code::E9999, "Internal.").at(Span::new(FileId(0), 0, 1));
        let converted = convert(
            &report(vec![d]),
            &map,
            PositionEncoding::Utf16,
            &uris(),
            &fallback(),
        );
        assert!(converted.contains_key(&fallback()));
        assert_eq!(converted.len(), 1);
    }

    #[test]
    fn a_text_on_its_own_gets_its_syntax_diagnostics() {
        let (map, r) = syntax_report("const A: f32 = 1.;\nfn (\n");
        let codes: Vec<&str> = r.diagnostics.iter().map(|d| d.code.as_str()).collect();
        assert!(codes.contains(&"MTEK-E0022"), "{codes:?}");
        assert!(r.diagnostics.iter().all(|d| d.edits.is_empty()));
        let converted = convert(&r, &map, PositionEncoding::Utf16, &uris(), &fallback());
        assert_eq!(converted.len(), 1);
        // A text the compiler rejects as a whole is one diagnostic without a location.
        let huge = "a".repeat(5 * 1024 * 1024);
        let (map, r) = syntax_report(&huge);
        assert_eq!(r.diagnostics.len(), 1);
        assert_eq!(r.diagnostics[0].code.as_str(), "MTEK-E0004");
        let converted = convert(
            &r,
            &map,
            PositionEncoding::Utf16,
            &uris(),
            &ProjectPath::new(LOOSE_PATH).unwrap(),
        );
        assert_eq!(
            converted[&ProjectPath::new(LOOSE_PATH).unwrap()][0].bytes,
            (0, 0)
        );
    }
}
