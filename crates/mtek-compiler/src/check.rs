//! `check`: the front end of the pipeline as far as this build goes
//! (`spec/compiler-architecture.md` sections 3 and 4.12).
//!
//! Load the project (`mtek.toml`, the entry module), lex and parse the entry
//! module, resolve its names, select the entry scene, type-check the module
//! and fold its constant expressions. Every stage reports
//! to one [`Diagnostics`] sink and the next stage runs on whatever the
//! previous one recovered.

use crate::diagnostics::{Code, Diagnostic, Diagnostics, Report};
use crate::project::{Project, ProjectRoot, SceneSelection, edit_distance, select_scene};
use crate::resolve::{Resolution, resolve_module};
use crate::source::Fs;
use crate::syntax::ast::{ItemKind, Module};
use crate::syntax::{lex, parse_module};
use crate::types::{Typeck, check_module};

/// What [`check`] produced.
#[derive(Debug)]
pub struct CheckResult {
    /// The loaded project; `None` if it could not be loaded (`E9001`,
    /// `E9004`, `E9005`, …).
    pub project: Option<Project>,
    /// The parsed entry module (with `Error` nodes where it did not parse).
    pub module: Option<Module>,
    /// The names of the entry module, with the selected entry scene.
    pub resolution: Option<Resolution>,
    /// The types and folded constants of the entry module.
    pub types: Option<Typeck>,
    /// Every diagnostic, in report order.
    pub report: Report,
}

/// Check the project at `root`. Never panics; problems are diagnostics.
#[must_use]
pub fn check(root: &ProjectRoot, fs: &dyn Fs) -> CheckResult {
    let mut sink = Diagnostics::new();
    let Some(project) = Project::load(root, fs, &mut sink) else {
        return CheckResult {
            project: None,
            module: None,
            resolution: None,
            types: None,
            report: sink.finish(),
        };
    };
    let Some(source) = project.sources.get(project.entry_file()) else {
        sink.push(Diagnostic::new(
            Code::E9999,
            "The entry module is missing from the source map; this is a compiler bug.",
        ));
        return CheckResult {
            project: Some(project),
            module: None,
            resolution: None,
            types: None,
            report: sink.finish(),
        };
    };
    let mut lexed = lex(source);
    lexed.report_into(&mut sink);
    let parsed = parse_module(source.text(), &lexed.tokens, &lexed.trivia, &mut sink);
    let module = parsed.module;

    let mut resolution = resolve_module(&module, &mut sink);
    let entry = source.path().to_string();
    select_entry_scene(
        &module,
        &mut resolution,
        project.config.project.scene.as_deref(),
        &entry,
        &mut sink,
    );
    let types = check_module(&module, source.text(), &resolution, &mut sink);
    CheckResult {
        project: Some(project),
        module: Some(module),
        resolution: Some(resolution),
        types: Some(types),
        report: sink.finish(),
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
        let result = check(&ProjectRoot::at_base(), &MemFs::new());
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
        let result = check(
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
        let result = check(
            &ProjectRoot::at_base(),
            &project("const A = 007;\nconst B = ;\nconst C = MISSING;\nscene Demo { }\n"),
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
        let result = check(&ProjectRoot::at_base(), &project("scene { }\n"));
        let codes: Vec<&str> = result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.short())
            .collect();
        assert!(!codes.contains(&"E9006"), "{codes:?}");
        assert!(!codes.is_empty());
    }
}
