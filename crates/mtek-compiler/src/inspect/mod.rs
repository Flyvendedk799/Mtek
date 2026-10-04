//! `inspect`: the library side of `mtek inspect` (`spec/compiler-architecture.md`
//! section 4.12, `spec/tooling.md` section 1, decisions 0028 and 0044).
//!
//! `inspect(project, fs, what)` runs the front end and, when it reports no error, lowers
//! the program to the typed IR. The result holds the report (for the diagnostics, exactly
//! what `check` reports, plus what the later stages of the view report) and the view, which
//! [`InspectResult::render`] prints as pretty JSON (`--format json`) or for people
//! (`--format human`):
//!
//! - [`Inspect::Ir`]: the typed IR (an indented tree for people);
//! - [`Inspect::Shaders`]: the resource plan of the entry scene, checked against the target
//!   profile's limits (`E6001`), and the validated WGSL of every material it uses, with its
//!   interface and span map — the shaders `build` writes ([`shaders`]);
//! - [`Inspect::Bindings`]: the same checked plan as blocks and material instances
//!   (`spec/gpu-layout.md` section 10, [`bindings`]).
//!
//! The target profile is `webgpu-core-2026`, the only one of v0.1.

pub mod bindings;
pub mod shaders;
pub mod view;

use crate::TargetProfile;
use crate::check::front_end;
use crate::diagnostics::{Code, Diagnostic, Diagnostics, Report};
use crate::ir::{self, LowerError, Program};
use crate::package::{checked_plan, material_shaders};
use crate::project::ProjectRoot;
use crate::source::{Fs, SourceMap};

pub use bindings::BindingsView;
pub use shaders::ShadersView;

/// What to inspect.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Inspect {
    /// The typed IR (`mtek inspect --ir`).
    Ir,
    /// The WGSL of every material of the entry scene (`mtek inspect --shaders`).
    Shaders,
    /// The blocks and material instances of the entry scene (`mtek inspect --bindings`).
    Bindings,
}

/// How to print an inspection (`--format human|json`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InspectFormat {
    /// An indented tree or tables for people.
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
    /// The project's source files and the prelude modules the program uses (to render
    /// diagnostics and locations).
    pub sources: SourceMap,
    /// Every diagnostic, in report order.
    pub report: Report,
    /// The typed IR; `None` when the report has errors.
    pub ir: Option<Program>,
    /// What was inspected.
    pub what: Inspect,
    /// The `--shaders` view; `None` for other views and when the report has errors.
    pub shaders: Option<ShadersView>,
    /// The `--bindings` view; `None` for other views and when the report has errors.
    pub bindings: Option<BindingsView>,
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
        if self.has_errors() {
            return None;
        }
        match self.what {
            Inspect::Ir => {
                let program = self.ir.as_ref()?;
                Some(match format {
                    InspectFormat::Json => ir::to_json(program),
                    InspectFormat::Human => ir::to_human(program, &self.sources),
                })
            }
            Inspect::Shaders => {
                let view = self.shaders.as_ref()?;
                Some(match format {
                    InspectFormat::Json => view.to_json(),
                    InspectFormat::Human => view.to_human(),
                })
            }
            Inspect::Bindings => {
                let view = self.bindings.as_ref()?;
                Some(match format {
                    InspectFormat::Json => view.to_json(),
                    InspectFormat::Human => view.to_human(),
                })
            }
        }
    }
}

/// Inspect the project at `root`. Never panics; problems are diagnostics.
#[must_use]
pub fn inspect(root: &ProjectRoot, fs: &dyn Fs, what: Inspect) -> InspectResult {
    let mut sink = Diagnostics::new();
    let front = front_end(root, fs, &mut sink);
    let ir = if sink.has_errors() {
        None
    } else {
        match ir::lower_parts(
            front.project.as_ref(),
            front.module.as_ref(),
            front.resolution.as_ref(),
            front.types.as_ref(),
            &front.dependencies,
            &front.effects,
        ) {
            Ok(program) => Some(program),
            Err(LowerError::Internal(defect)) => {
                sink.push(internal_error(&defect));
                None
            }
            Err(LowerError::HasErrors) => None,
        }
    };
    let (project_name, sources) = match front.project {
        Some(project) => (Some(project.config.project.name), project.sources),
        None => (None, SourceMap::new()),
    };
    let mut shaders = None;
    let mut bindings = None;
    if let (Some(program), Inspect::Shaders | Inspect::Bindings) = (ir.as_ref(), what) {
        match views(program, what, &sources) {
            Ok((s, b)) => (shaders, bindings) = (s, b),
            Err(diagnostics) => sink.extend(diagnostics),
        }
    }
    InspectResult {
        project_name,
        sources,
        report: sink.finish(),
        ir,
        what,
        shaders,
        bindings,
    }
}

/// The `--shaders` or `--bindings` view of `program`: the checked resource plan (`E6001`),
/// then the shaders or the bindings.
fn views(
    program: &Program,
    what: Inspect,
    sources: &SourceMap,
) -> Result<(Option<ShadersView>, Option<BindingsView>), Vec<Diagnostic>> {
    let profile = TargetProfile::default();
    let plan = checked_plan(program, profile)?;
    let scene = program.entry_scene.as_str();
    let view_defect = |defect: String| vec![view_error(&defect)];
    match what {
        Inspect::Shaders => {
            let artifacts = material_shaders(program, &plan)?;
            let view = shaders::shaders_view(scene, profile.as_str(), &plan, &artifacts, sources)
                .map_err(view_defect)?;
            Ok((Some(view), None))
        }
        Inspect::Bindings => {
            let view = bindings::bindings_view(scene, profile.as_str(), &plan, sources)
                .map_err(view_defect)?;
            Ok((None, Some(view)))
        }
        Inspect::Ir => Ok((None, None)),
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

/// `E9999` for a plan or shaders the inspection cannot show.
fn view_error(defect: &str) -> Diagnostic {
    Diagnostic::new(
        Code::E9999,
        "The inspection could not be built from the checked program; this is a compiler bug.",
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
        let diagnostic = view_error("a planned material has no shader");
        assert_eq!(diagnostic.code, Code::E9999);
        assert_eq!(
            diagnostic.notes.first().map(String::as_str),
            Some("a planned material has no shader")
        );
    }
}
