//! The diagnostic data model (`spec/diagnostics.md` sections 2 and 6).

use std::fmt;

use super::codes::Code;
use crate::source::{FileId, SourceError, Span};

/// How serious a diagnostic is. The severity of a diagnostic is the severity
/// of its [`Code`]; it is also the letter inside the code.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Severity {
    Error,
    Warning,
    Note,
}

impl Severity {
    /// The JSON and human spelling: `error`, `warning`, `note`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Note => "note",
        }
    }

    /// The letter used inside codes: `E`, `W`, `N`.
    #[must_use]
    pub const fn letter(self) -> &'static str {
        match self {
            Severity::Error => "E",
            Severity::Warning => "W",
            Severity::Note => "N",
        }
    }
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The scheduler phase or mount step of a run-time diagnostic
/// (`spec/diagnostics.md` 2.3).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum RuntimePhase {
    Mount,
    Input,
    Tick,
    Update,
    Bindings,
    Render,
    Reload,
    Device,
}

impl RuntimePhase {
    /// Every run-time phase, in the order of the specification.
    pub const ALL: [RuntimePhase; 8] = [
        RuntimePhase::Mount,
        RuntimePhase::Input,
        RuntimePhase::Tick,
        RuntimePhase::Update,
        RuntimePhase::Bindings,
        RuntimePhase::Render,
        RuntimePhase::Reload,
        RuntimePhase::Device,
    ];

    /// The part after `runtime:`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            RuntimePhase::Mount => "mount",
            RuntimePhase::Input => "input",
            RuntimePhase::Tick => "tick",
            RuntimePhase::Update => "update",
            RuntimePhase::Bindings => "bindings",
            RuntimePhase::Render => "render",
            RuntimePhase::Reload => "reload",
            RuntimePhase::Device => "device",
        }
    }
}

/// The compilation or run-time phase that produced a diagnostic.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Phase {
    Parse,
    Check,
    Emit,
    /// Generated-shader validation (Naga).
    Validate,
    Runtime(RuntimePhase),
}

impl Phase {
    /// The envelope spelling: `parse`, `check`, `emit`, `validate` or
    /// `runtime:<phase>`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Phase::Parse => "parse",
            Phase::Check => "check",
            Phase::Emit => "emit",
            Phase::Validate => "validate",
            Phase::Runtime(RuntimePhase::Mount) => "runtime:mount",
            Phase::Runtime(RuntimePhase::Input) => "runtime:input",
            Phase::Runtime(RuntimePhase::Tick) => "runtime:tick",
            Phase::Runtime(RuntimePhase::Update) => "runtime:update",
            Phase::Runtime(RuntimePhase::Bindings) => "runtime:bindings",
            Phase::Runtime(RuntimePhase::Render) => "runtime:render",
            Phase::Runtime(RuntimePhase::Reload) => "runtime:reload",
            Phase::Runtime(RuntimePhase::Device) => "runtime:device",
        }
    }
}

impl fmt::Display for Phase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A span with an optional message, shown next to the carets (primary label)
/// or dashes (related labels) in the human rendering.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Label {
    pub span: Span,
    pub message: Option<String>,
}

impl Label {
    /// A label without text.
    #[must_use]
    pub fn new(span: Span) -> Self {
        Self {
            span,
            message: None,
        }
    }

    /// A label with text.
    #[must_use]
    pub fn with_message(span: Span, message: impl Into<String>) -> Self {
        Self {
            span,
            message: Some(message.into()),
        }
    }
}

/// One replacement of bytes of one file.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TextEdit {
    pub span: Span,
    pub replacement: String,
}

/// A mechanical fix (`spec/diagnostics.md` section 6). Attaching an edit is
/// the reporter's promise that it re-checked the program with the edit
/// applied; this crate does not verify that.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SuggestedEdit {
    pub description: String,
    pub edits: Vec<TextEdit>,
}

impl SuggestedEdit {
    #[must_use]
    pub fn new(description: impl Into<String>) -> Self {
        Self {
            description: description.into(),
            edits: Vec::new(),
        }
    }

    /// Add one replacement.
    #[must_use]
    pub fn replace(mut self, span: Span, replacement: impl Into<String>) -> Self {
        self.edits.push(TextEdit {
            span,
            replacement: replacement.into(),
        });
        self
    }
}

/// Prefix that marks a note as a `help:` hint (`spec/diagnostics.md` 2.1:
/// notes include "help:" hints). The human renderer prints such notes as
/// `= help: ...` and all others as `= note: ...`.
pub const HELP_PREFIX: &str = "help: ";

/// One problem report.
///
/// `primary` is `None` for project-level diagnostics that have no location
/// in a loaded file (the envelope then has `"source": null`).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Diagnostic {
    pub code: Code,
    pub severity: Severity,
    pub message: String,
    pub primary: Option<Label>,
    pub related: Vec<Label>,
    pub expected: Option<String>,
    pub actual: Option<String>,
    pub notes: Vec<String>,
    pub edits: Vec<SuggestedEdit>,
    pub phase: Phase,
}

impl Diagnostic {
    /// A diagnostic of `code` (severity and phase come from the catalogue;
    /// see [`Code::default_phase`]) with a specific, complete `message`
    /// (`spec/diagnostics.md` section 7). It has no location until
    /// [`Self::at`] or [`Self::label`] is called.
    #[must_use]
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        Self {
            code,
            severity: code.severity(),
            message: message.into(),
            primary: None,
            related: Vec::new(),
            expected: None,
            actual: None,
            notes: Vec::new(),
            edits: Vec::new(),
            phase: code.default_phase(),
        }
    }

    /// Diagnostic for a file that could not be added to the source map. The
    /// code is the one [`SourceError::code`] names and the message the error's
    /// text, which names the file and the byte offset. The rejected file has
    /// no [`FileId`], so there is no source location.
    #[must_use]
    pub fn from_source_error(error: &SourceError) -> Self {
        let code = Code::parse_short(error.code()).unwrap_or(Code::E9999);
        Self::new(code, error.to_string())
    }

    /// Set the primary location, without label text.
    #[must_use]
    pub fn at(mut self, span: Span) -> Self {
        self.primary = Some(Label::new(span));
        self
    }

    /// Set the primary location with label text.
    #[must_use]
    pub fn label(mut self, span: Span, message: impl Into<String>) -> Self {
        self.primary = Some(Label::with_message(span, message));
        self
    }

    /// Add a secondary location with its own message.
    #[must_use]
    pub fn related(mut self, span: Span, message: impl Into<String>) -> Self {
        self.related.push(Label::with_message(span, message));
        self
    }

    /// Add a secondary location without text.
    #[must_use]
    pub fn related_span(mut self, span: Span) -> Self {
        self.related.push(Label::new(span));
        self
    }

    /// The expected type or form.
    #[must_use]
    pub fn expected(mut self, expected: impl Into<String>) -> Self {
        self.expected = Some(expected.into());
        self
    }

    /// The type or form that was found.
    #[must_use]
    pub fn actual(mut self, actual: impl Into<String>) -> Self {
        self.actual = Some(actual.into());
        self
    }

    /// Add an explanatory note.
    #[must_use]
    pub fn note(mut self, note: impl Into<String>) -> Self {
        self.notes.push(note.into());
        self
    }

    /// Add a `help:` hint (stored as a note with the `help: ` prefix).
    #[must_use]
    pub fn help(mut self, help: impl AsRef<str>) -> Self {
        self.notes.push(format!("{HELP_PREFIX}{}", help.as_ref()));
        self
    }

    /// Attach a validated suggested edit.
    #[must_use]
    pub fn edit(mut self, edit: SuggestedEdit) -> Self {
        self.edits.push(edit);
        self
    }

    /// Override the phase.
    #[must_use]
    pub fn phase(mut self, phase: Phase) -> Self {
        self.phase = phase;
        self
    }

    /// The file of the primary location.
    #[must_use]
    pub fn file(&self) -> Option<FileId> {
        self.primary.as_ref().map(|label| label.span.file)
    }

    /// The key diagnostics are ordered by (`spec/diagnostics.md` 2.2):
    /// file load order, start, end, code. Diagnostics without a location sort
    /// before all others; ties keep their insertion order (stable sort).
    #[must_use]
    pub(crate) fn sort_key(&self) -> (Option<FileId>, u32, u32, &'static str) {
        match &self.primary {
            Some(label) => (
                Some(label.span.file),
                label.span.start,
                label.span.end,
                self.code.as_str(),
            ),
            None => (None, 0, 0, self.code.as_str()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::{ProjectPath, SourceMap};

    const F: FileId = FileId(0);

    #[test]
    fn new_takes_severity_and_phase_from_the_catalogue() {
        let d = Diagnostic::new(Code::W3081, "unreachable");
        assert_eq!(d.severity, Severity::Warning);
        assert_eq!(d.phase, Phase::Check);
        assert_eq!(d.primary, None);
        assert_eq!(d.file(), None);
        assert!(d.related.is_empty() && d.notes.is_empty() && d.edits.is_empty());
    }

    #[test]
    fn builder_sets_every_field() {
        let edit = SuggestedEdit::new("use a float literal").replace(Span::new(F, 1, 3), "1.0");
        let d = Diagnostic::new(Code::E3102, "Material parameter 'phase' expects f32.")
            .label(Span::new(F, 10, 20), "expected f32, found vec3")
            .related(Span::new(F, 2, 5), "declared here")
            .related_span(Span::new(F, 6, 7))
            .expected("f32")
            .actual("vec3")
            .note("a note")
            .help("pass an f32")
            .edit(edit.clone())
            .phase(Phase::Runtime(RuntimePhase::Tick));
        assert_eq!(d.file(), Some(F));
        assert_eq!(
            d.primary,
            Some(Label::with_message(
                Span::new(F, 10, 20),
                "expected f32, found vec3"
            ))
        );
        assert_eq!(d.related.len(), 2);
        assert_eq!(d.related[1], Label::new(Span::new(F, 6, 7)));
        assert_eq!(d.expected.as_deref(), Some("f32"));
        assert_eq!(d.actual.as_deref(), Some("vec3"));
        assert_eq!(d.notes, ["a note", "help: pass an f32"]);
        assert_eq!(d.edits, [edit]);
        assert_eq!(d.phase.as_str(), "runtime:tick");
    }

    #[test]
    fn sort_key_orders_file_start_end_code() {
        let a = Diagnostic::new(Code::E3001, "").at(Span::new(F, 5, 9));
        let b = Diagnostic::new(Code::E1001, "").at(Span::new(F, 5, 9));
        let none = Diagnostic::new(Code::E9001, "");
        assert!(none.sort_key() < b.sort_key());
        assert!(b.sort_key() < a.sort_key());
        let other_file = Diagnostic::new(Code::E0001, "").at(Span::new(FileId(1), 0, 0));
        assert!(a.sort_key() < other_file.sort_key());
    }

    #[test]
    fn phase_strings_match_the_specification() {
        assert_eq!(Phase::Parse.as_str(), "parse");
        assert_eq!(Phase::Validate.to_string(), "validate");
        let names: Vec<_> = RuntimePhase::ALL
            .iter()
            .map(|p| Phase::Runtime(*p).as_str())
            .collect();
        assert_eq!(
            names,
            [
                "runtime:mount",
                "runtime:input",
                "runtime:tick",
                "runtime:update",
                "runtime:bindings",
                "runtime:render",
                "runtime:reload",
                "runtime:device",
            ]
        );
        for p in RuntimePhase::ALL {
            assert_eq!(
                Phase::Runtime(p).as_str(),
                format!("runtime:{}", p.as_str())
            );
        }
    }

    #[test]
    fn from_source_error_uses_the_error_code_and_text() {
        let mut map = SourceMap::new();
        let path = ProjectPath::new("src/a.mtek").unwrap();
        let err = map.add(path, b"ok\xFF").unwrap_err();
        let d = Diagnostic::from_source_error(&err);
        assert_eq!(d.code, Code::E0001);
        assert_eq!(d.message, err.to_string());
        assert_eq!(d.primary, None);
        assert_eq!(d.phase, Phase::Parse);

        let too_large = SourceError::TooLarge {
            path: ProjectPath::new("big.mtek").unwrap(),
            size: 5_000_000,
        };
        assert_eq!(Diagnostic::from_source_error(&too_large).code, Code::E0004);
        let too_many = SourceError::TooManyFiles {
            path: ProjectPath::new("x.mtek").unwrap(),
        };
        assert_eq!(Diagnostic::from_source_error(&too_many).code, Code::E9002);
    }
}
