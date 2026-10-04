//! The front end of the pipeline as far as this build goes
//! (`spec/compiler-architecture.md` sections 3 and 4.12, decision 0028).
//!
//! Load the project (`mtek.toml`, the entry module), lex and parse the entry
//! module, resolve its names, select the entry scene, type-check the module,
//! fold its constant expressions and run the scene checks. Every stage
//! reports to one [`Diagnostics`] sink and the next stage runs on whatever
//! the previous one recovered.
//!
//! Two entry points share the front end:
//!
//! * [`check`] is the public `check` of section 4.12: diagnostics only (the
//!   report, with the project name and the source map needed to render it);
//! * [`analyze`] keeps everything the front end produced ([`Analysis`]): the
//!   input of [`crate::ir::lower_to_ir`], and what tests and tools that look
//!   inside the checker read.

use crate::diagnostics::{Code, Diagnostic, Diagnostics, Report};
use crate::project::{Project, ProjectRoot, SceneSelection, edit_distance, select_scene};
use crate::resolve::{Resolution, resolve_module};
use crate::source::{Fs, SourceMap};
use crate::syntax::ast::{ItemKind, Module};
use crate::syntax::{lex, parse_module};
use crate::types::{Typeck, check_module};

/// What [`check`] produced: diagnostics only (`spec/compiler-architecture.md`
/// section 4.12).
#[derive(Debug)]
pub struct CheckResult {
    /// The project name from `mtek.toml`; `None` if the project could not be
    /// loaded (the `project` of the JSON report, `spec/diagnostics.md` 2.2).
    pub project_name: Option<String>,
    /// The project's source files, to render the diagnostics with; empty if
    /// the project could not be loaded.
    pub sources: SourceMap,
    /// Every diagnostic, in report order.
    pub report: Report,
}

impl CheckResult {
    /// Whether the report has an error (`mtek check` then exits with 1).
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.report.summary.errors > 0
    }
}

/// Everything the front end produced (decision 0028): what [`analyze`]
/// returns and [`crate::ir::lower_to_ir`] reads.
#[derive(Debug)]
pub struct Analysis {
    /// The loaded project; `None` if it could not be loaded (`E9001`,
    /// `E9004`, `E9005`, …).
    pub project: Option<Project>,
    /// The parsed entry module (with `Error` nodes where it did not parse).
    pub module: Option<Module>,
    /// The names of the entry module, with the selected entry scene.
    pub resolution: Option<Resolution>,
    /// The types, folded constants and checked scenes of the entry module.
    pub types: Option<Typeck>,
    /// Every diagnostic, in report order.
    pub report: Report,
}

impl Analysis {
    /// Whether the report has an error; the typed IR is built only from an
    /// analysis without errors.
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.report.summary.errors > 0
    }
}

impl From<Analysis> for CheckResult {
    fn from(analysis: Analysis) -> Self {
        let (project_name, sources) = match analysis.project {
            Some(project) => (Some(project.config.project.name), project.sources),
            None => (None, SourceMap::new()),
        };
        CheckResult {
            project_name,
            sources,
            report: analysis.report,
        }
    }
}

/// The front end's results before the report is finished, so that later
/// stages ([`crate::inspect`]) can still report to the same sink.
pub(crate) struct FrontEnd {
    pub(crate) project: Option<Project>,
    pub(crate) module: Option<Module>,
    pub(crate) resolution: Option<Resolution>,
    pub(crate) types: Option<Typeck>,
}

impl FrontEnd {
    /// The analysis with the finished `report`.
    pub(crate) fn finish(self, report: Report) -> Analysis {
        Analysis {
            project: self.project,
            module: self.module,
            resolution: self.resolution,
            types: self.types,
            report,
        }
    }
}

/// Check the project at `root`: diagnostics only. Never panics; problems are
/// diagnostics.
#[must_use]
pub fn check(root: &ProjectRoot, fs: &dyn Fs) -> CheckResult {
    analyze(root, fs).into()
}

/// Run the front end on the project at `root` and keep everything it
/// produced. Never panics; problems are diagnostics.
#[must_use]
pub fn analyze(root: &ProjectRoot, fs: &dyn Fs) -> Analysis {
    let mut sink = Diagnostics::new();
    let front = front_end(root, fs, &mut sink);
    front.finish(sink.finish())
}

/// The front end, reporting to `sink`.
pub(crate) fn front_end(root: &ProjectRoot, fs: &dyn Fs, sink: &mut Diagnostics) -> FrontEnd {
    let Some(project) = Project::load(root, fs, sink) else {
        return FrontEnd {
            project: None,
            module: None,
            resolution: None,
            types: None,
        };
    };
    let Some(source) = project.sources.get(project.entry_file()) else {
        sink.push(Diagnostic::new(
            Code::E9999,
            "The entry module is missing from the source map; this is a compiler bug.",
        ));
        return FrontEnd {
            project: Some(project),
            module: None,
            resolution: None,
            types: None,
        };
    };
    let mut lexed = lex(source);
    lexed.report_into(sink);
    let parsed = parse_module(source.text(), &lexed.tokens, &lexed.trivia, sink);
    let module = parsed.module;

    let mut resolution = resolve_module(&module, sink);
    let entry = source.path().to_string();
    select_entry_scene(
        &module,
        &mut resolution,
        project.config.project.scene.as_deref(),
        &entry,
        sink,
    );
    let types = check_module(&module, source.text(), &resolution, sink);
    FrontEnd {
        project: Some(project),
        module: Some(module),
        resolution: Some(resolution),
        types: Some(types),
    }
}

/// Select the entry scene (`project.scene`, or the module's only scene) and
/// record it in `resolution`; `E9006` when it is missing, unknown or
/// ambiguous (`spec/tooling.md` section 3).
fn select_entry_scene(
    module: &Module,
    resolution: &mut Resolution,
    configured: Option<&str>,
    entry: &str,
    sink: &mut Diagnostics,
) {
    let scenes: Vec<_> = module
        .items
        .iter()
        .filter_map(|item| match &item.kind {
            ItemKind::Scene(decl) => Some(decl),
            _ => None,
        })
        .collect();
    let names: Vec<&str> = scenes.iter().map(|s| s.name.name.as_str()).collect();
    match select_scene(configured, &names) {
        SceneSelection::Selected(index) => {
            let scene = scenes.get(index).and_then(|s| resolution.def_of(s.id));
            resolution.set_entry_scene(scene);
        }
        SceneSelection::Ambiguous => {
            let mut diagnostic = Diagnostic::new(
                Code::E9006,
                format!(
                    "The entry module '{entry}' declares {} scenes and project.scene is not set in mtek.toml, so the entry scene is ambiguous.",
                    scenes.len()
                ),
            );
            if let Some((first, rest)) = scenes.split_first() {
                if let Some(second) = rest.first() {
                    diagnostic = diagnostic.at(second.name.span);
                }
                diagnostic = diagnostic.related(
                    first.name.span,
                    format!("scene '{}' is declared here", first.name.name),
                );
            }
            sink.push(diagnostic.help(format!(
                "set project.scene in mtek.toml to one of: {}",
                names.join(", ")
            )));
        }
        SceneSelection::NotFound => {
            // A scene the parser could not read would make "no scene" a
            // cascade of the syntax error that is already reported.
            let unreadable = module
                .items
                .iter()
                .any(|item| matches!(item.kind, ItemKind::Error));
            match configured {
                Some(name) => {
                    let mut diagnostic = Diagnostic::new(
                        Code::E9006,
                        format!(
                            "The entry scene '{name}' (project.scene in mtek.toml) is not declared in the entry module '{entry}'."
                        ),
                    );
                    let close: Vec<&str> = names
                        .iter()
                        .copied()
                        .filter(|n| (1..=2).contains(&edit_distance(name, n)))
                        .collect();
                    if let [single] = close.as_slice() {
                        diagnostic = diagnostic.help(format!("did you mean '{single}'?"));
                    }
                    diagnostic = if names.is_empty() {
                        diagnostic.help("the entry module declares no scene")
                    } else {
                        diagnostic.help(format!("declared scenes: {}", names.join(", ")))
                    };
                    sink.push(diagnostic);
                }
                None if !unreadable => sink.push(
                    Diagnostic::new(
                        Code::E9006,
                        format!("The entry module '{entry}' declares no scene."),
                    )
                    .help("declare the scene to run, for example `scene Demo { … }`"),
                ),
                None => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve::DefKind;
    use crate::source::{MemFs, ProjectPath};

    const PROJECT: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

    fn project(source: &str) -> MemFs {
        let mut fs = MemFs::new();
        fs.insert(ProjectPath::new("mtek.toml").unwrap(), PROJECT)
            .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
        fs
    }

    #[test]
    fn a_project_that_does_not_load_stops_before_parsing() {
        let result = analyze(&ProjectRoot::at_base(), &MemFs::new());
        assert!(result.project.is_none() && result.module.is_none());
        assert!(result.resolution.is_none());
        let codes: Vec<&str> = result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.short())
            .collect();
        assert_eq!(codes, ["E9004"]);
    }

    #[test]
    fn the_single_scene_is_the_entry_scene() {
        let result = analyze(
            &ProjectRoot::at_base(),
            &project("const A = 1;\nscene Demo { camera Main {} }\n"),
        );
        assert!(result.report.diagnostics.is_empty(), "{:?}", result.report);
        let resolution = result.resolution.unwrap();
        let scene = resolution
            .entry_scene()
            .and_then(|id| resolution.def(id))
            .unwrap();
        assert_eq!((scene.kind, scene.name.as_str()), (DefKind::Scene, "Demo"));
    }

    #[test]
    fn lexical_syntax_and_name_errors_are_all_reported() {
        let result = analyze(
            &ProjectRoot::at_base(),
            &project(
                "const A = 007;\nconst B = ;\nconst C = MISSING;\nscene Demo { camera Main {} }\n",
            ),
        );
        let codes: Vec<&str> = result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.short())
            .collect();
        assert_eq!(codes, ["E0020", "E1001", "E2003"]);
        assert!(result.resolution.unwrap().entry_scene().is_some());
    }

    #[test]
    fn no_scene_after_a_syntax_error_is_not_a_cascade() {
        let result = analyze(&ProjectRoot::at_base(), &project("scene { }\n"));
        let codes: Vec<&str> = result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.short())
            .collect();
        assert!(!codes.contains(&"E9006"), "{codes:?}");
        assert!(!codes.is_empty());
    }

    #[test]
    fn check_reports_the_diagnostics_of_the_analysis_and_nothing_else() {
        let text = "const A: u32 = 1.5;\nscene Demo { camera Main {} }\n";
        let analysis = analyze(&ProjectRoot::at_base(), &project(text));
        let checked = check(&ProjectRoot::at_base(), &project(text));
        assert_eq!(checked.report.diagnostics, analysis.report.diagnostics);
        assert_eq!(checked.report.summary, analysis.report.summary);
        assert!(checked.has_errors() && analysis.has_errors());
        assert_eq!(checked.project_name.as_deref(), Some("demo"));
        let paths: Vec<&str> = checked
            .sources
            .files()
            .map(|file| file.path().as_str())
            .collect();
        assert_eq!(paths, ["src/main.mtek"]);
    }

    #[test]
    fn check_of_a_project_that_does_not_load_has_no_name_and_no_sources() {
        let checked = check(&ProjectRoot::at_base(), &MemFs::new());
        assert!(checked.project_name.is_none() && checked.sources.is_empty());
        assert!(checked.has_errors());
    }
}
