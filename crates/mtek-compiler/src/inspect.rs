//! `inspect`: the library side of `mtek inspect` (`spec/compiler-architecture.md`
//! section 4.12, `spec/tooling.md` section 1, decision 0028).
//!
//! `inspect(project, fs, Inspect::Ir)` runs the front end and, when it
//! reports no error, lowers the program to the typed IR. The result holds the
//! report (for the diagnostics, exactly what `check` reports, plus `E9999`
//! should lowering hit a compiler defect) and the IR, which
//! [`InspectResult::render`] prints as pretty JSON (`--format json`) or as an
//! indented tree (`--format human`). `--bindings` and `--shaders` (M2) add
//! variants to [`Inspect`].

use crate::check::front_end;
use crate::diagnostics::{Code, Diagnostic, Diagnostics, Report};
use crate::ir::{self, LowerError, Program};
use crate::project::ProjectRoot;
use crate::source::{Fs, SourceMap};

/// What to inspect.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Inspect {
    /// The typed IR (`mtek inspect --ir`).
    Ir,
}

/// How to print an inspection (`--format human|json`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InspectFormat {
    /// An indented tree for people.
    Human,
    /// Pretty JSON, one document.
    Json,
}

/// What [`inspect`] produced.
#[derive(Debug)]
pub struct InspectResult {
    /// The project name from `mtek.toml`; `None` if the project could not be
    /// loaded.
    pub project_name: Option<String>,
    /// The project's source files (to render diagnostics and locations).
    pub sources: SourceMap,
    /// Every diagnostic, in report order.
    pub report: Report,
    /// The typed IR; `None` when the report has errors.
    pub ir: Option<Program>,
}

impl InspectResult {
    /// Whether the report has an error (nothing is inspected then).
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.report.summary.errors > 0
    }

    /// The inspection in `format`, ending with a line break; `None` when
    /// there is nothing to show (the program has errors).
    #[must_use]
    pub fn render(&self, format: InspectFormat) -> Option<String> {
        let program = self.ir.as_ref()?;
        Some(match format {
            InspectFormat::Json => ir::to_json(program),
            InspectFormat::Human => ir::to_human(program, &self.sources),
        })
    }
}

/// Inspect the project at `root`. Never panics; problems are diagnostics.
#[must_use]
pub fn inspect(root: &ProjectRoot, fs: &dyn Fs, what: Inspect) -> InspectResult {
    let mut sink = Diagnostics::new();
    let front = front_end(root, fs, &mut sink);
    let ir = match what {
        Inspect::Ir if !sink.has_errors() => match ir::lower_parts(
            front.project.as_ref(),
            front.module.as_ref(),
            front.resolution.as_ref(),
            front.types.as_ref(),
        ) {
            Ok(program) => Some(program),
            Err(LowerError::Internal(defect)) => {
                sink.push(internal_error(&defect));
                None
            }
            Err(LowerError::HasErrors) => None,
        },
        Inspect::Ir => None,
    };
    let (project_name, sources) = match front.project {
        Some(project) => (Some(project.config.project.name), project.sources),
        None => (None, SourceMap::new()),
    };
    InspectResult {
        project_name,
        sources,
        report: sink.finish(),
        ir,
    }
}

/// `E9999` for a checked program the typed IR cannot represent.
fn internal_error(defect: &str) -> Diagnostic {
    Diagnostic::new(
        Code::E9999,
        "The typed IR could not be built from the checked program; this is a compiler bug.",
    )
    .note(defect.to_owned())
    .help("please report it with the program that caused it")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_defect_is_an_internal_error_with_the_defect_as_a_note() {
        let diagnostic = internal_error("the field 'x' of scene 'Demo' is not lowered");
        assert_eq!(diagnostic.code, Code::E9999);
        assert_eq!(
            diagnostic.notes.first().map(String::as_str),
            Some("the field 'x' of scene 'Demo' is not lowered")
        );
    }
}
