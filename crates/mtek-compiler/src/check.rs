//! The front end of the pipeline as far as this build goes
//! (`spec/compiler-architecture.md` sections 3 and 4.12, decision 0028).
//!
//! Load the project (`mtek.toml`, the entry module), lex and parse the entry
//! module and every module it imports (in load order, decision 0036), report
//! import cycles, bind every module's imported names to the exports of the
//! modules they import and resolve its names, select the entry scene, then
//! type-check every module — the modules a module imports first, so the
//! constants it imports are known — fold the constant expressions and run
//! the scene checks. Every stage reports to one [`Diagnostics`] sink and the
//! next stage runs on whatever the previous one recovered.
//!
//! Two entry points share the front end:
//!
//! * [`check`] is the public `check` of section 4.12: diagnostics only (the
//!   report, with the project name and the source map needed to render it);
//! * [`analyze`] keeps everything the front end produced ([`Analysis`]): the
//!   input of [`crate::ir::lower_to_ir`], and what tests and tools that look
//!   inside the checker read.

use std::collections::BTreeMap;

use crate::diagnostics::{Code, Diagnostic, Diagnostics, Report};
use crate::prelude::{compile_materials, uses_builtin_material};
use crate::project::{
    LoadedModule, ModuleId, Project, ProjectRoot, SceneSelection, edit_distance, load_modules,
    report_cycles, select_scene,
};
use crate::resolve::{DefId, DefKind, Resolution, bind_imports, resolve_module_with_imports};
use crate::source::{Fs, SourceMap};
use crate::syntax::ast::{ItemKind, Module};
use crate::types::effects::{ProgramUnit, RootBody, check_program};
use crate::types::{
    FnRef, ImportedConst, ImportedConsts, ImportedFn, ImportedMaterial, ImportedStruct, Imports,
    ProgramEffects, Roots, Typeck, check_module_with_imports,
};

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
    /// Every other module of the project, in load order (`ModuleId` 1, 2, …).
    pub dependencies: Vec<ModuleUnit>,
    /// The effect level and reachability of every function of the program
    /// (decision 0038).
    pub effects: ProgramEffects,
    /// Every diagnostic, in report order.
    pub report: Report,
}

/// Options of the front end that are not part of the project.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AnalyzeOptions {
    /// Functions, by symbol (`src/main.mtek::shade`), to treat as called
    /// from a material stage function: the GPU roots of decision 0038
    /// until M2-04 implements stage functions. A test hook; a symbol that
    /// names no function is ignored.
    pub gpu_root_functions: Vec<String>,
}

/// A module other than the entry module, as the front end left it.
#[derive(Debug)]
pub struct ModuleUnit {
    /// Its place in the module graph ([`Project::modules`]).
    pub id: ModuleId,
    /// The parsed module.
    pub module: Module,
    /// Its names; imported names point into other modules
    /// ([`Resolution::import_target`]).
    pub resolution: Resolution,
    /// Its types, folded constants and checked scenes.
    pub types: Typeck,
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
    pub(crate) dependencies: Vec<ModuleUnit>,
    pub(crate) effects: ProgramEffects,
}

impl FrontEnd {
    /// The front end of a project that did not get as far as `project`.
    fn stopped(project: Option<Project>) -> Self {
        FrontEnd {
            project,
            module: None,
            resolution: None,
            types: None,
            dependencies: Vec::new(),
            effects: ProgramEffects::default(),
        }
    }

    /// The analysis with the finished `report`.
    pub(crate) fn finish(self, report: Report) -> Analysis {
        Analysis {
            project: self.project,
            module: self.module,
            resolution: self.resolution,
            types: self.types,
            dependencies: self.dependencies,
            effects: self.effects,
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
    analyze_with(root, fs, &AnalyzeOptions::default())
}

/// [`analyze`] with `options` (the GPU-root test hook of decision 0038).
#[must_use]
pub fn analyze_with(root: &ProjectRoot, fs: &dyn Fs, options: &AnalyzeOptions) -> Analysis {
    let mut sink = Diagnostics::new();
    let front = front_end_with(root, fs, options, &mut sink);
    front.finish(sink.finish())
}

/// The front end, reporting to `sink`.
pub(crate) fn front_end(root: &ProjectRoot, fs: &dyn Fs, sink: &mut Diagnostics) -> FrontEnd {
    front_end_with(root, fs, &AnalyzeOptions::default(), sink)
}

/// The front end with `options`, reporting to `sink`.
pub(crate) fn front_end_with(
    root: &ProjectRoot,
    fs: &dyn Fs,
    options: &AnalyzeOptions,
    sink: &mut Diagnostics,
) -> FrontEnd {
    let Some(mut project) = Project::load(root, fs, sink) else {
        return FrontEnd::stopped(None);
    };
    let loaded = load_modules(&mut project, root, fs, sink);
    if loaded.is_empty() {
        sink.push(Diagnostic::new(
            Code::E9999,
            "The entry module is missing from the source map; this is a compiler bug.",
        ));
        return FrontEnd::stopped(Some(project));
    }
    report_cycles(&project, &project.modules.find_cycles(), sink);

    let mut resolutions: Vec<Resolution> = loaded
        .iter()
        .map(|unit| {
            let bindings = bind_imports(&unit.ast, &unit.imports, &loaded, &project.modules, sink);
            resolve_module_with_imports(&unit.ast, &bindings, sink)
        })
        .collect();
    if let (Some(entry_module), Some(entry_resolution)) = (loaded.first(), resolutions.first_mut())
    {
        let entry = project.modules.entry().path().to_string();
        select_entry_scene(
            &entry_module.ast,
            entry_resolution,
            project.config.project.scene.as_deref(),
            &entry,
            sink,
        );
    }

    let mut types: Vec<Option<Typeck>> = loaded.iter().map(|_| None).collect();
    for id in project.modules.dependency_order() {
        let index = id.index();
        let (Some(unit), Some(resolution), Some(source)) = (
            loaded.get(index),
            resolutions.get(index),
            project
                .modules
                .get(id)
                .and_then(|module| project.sources.get(module.file())),
        ) else {
            continue;
        };
        let imports = Imports {
            consts: imported_consts(resolution, &resolutions, &types),
            structs: imported_structs(resolution, &resolutions, &types),
            fns: imported_fns(resolution, &resolutions, &types),
            materials: imported_materials(resolution, &resolutions, &types),
        };
        let checked =
            check_module_with_imports(&unit.ast, source.text(), resolution, &imports, sink);
        if let Some(slot) = types.get_mut(index) {
            *slot = Some(checked);
        }
    }

    // The embedded prelude, when the program uses a built-in material: one
    // more module, after the project's (decision 0044).
    let mut loaded = loaded;
    if uses_builtin_material(&types)
        && let Some(prelude) = compile_materials(&mut project, sink)
    {
        let index = prelude.id.index();
        if index == loaded.len() && index == resolutions.len() && index == types.len() {
            loaded.push(LoadedModule {
                ast: prelude.module,
                imports: Vec::new(),
            });
            resolutions.push(prelude.resolution);
            types.push(Some(prelude.types));
        } else {
            sink.push(Diagnostic::new(
                Code::E9999,
                "The embedded prelude got a module id out of load order; this is a compiler bug.",
            ));
        }
    }

    // Effects, recursion and reachability over the whole program, once every
    // module is checked (decision 0038).
    let program: Vec<ProgramUnit<'_>> = project
        .modules
        .modules()
        .iter()
        .filter_map(|module| {
            let index = module.id().index();
            Some(ProgramUnit {
                id: module.id(),
                resolution: resolutions.get(index)?,
                types: types.get(index)?.as_ref()?,
            })
        })
        .collect();
    let roots = Roots {
        gpu_bodies: stage_roots(&program),
        gpu_functions: gpu_root_functions(&project, &program, &options.gpu_root_functions),
        cpu_bodies: cpu_roots(&program),
    };
    let effects = check_program(&program, &roots, sink);
    drop(program);

    let mut units = loaded
        .into_iter()
        .zip(resolutions)
        .zip(types)
        .enumerate()
        .map(|(index, ((unit, resolution), types))| (index, unit.ast, resolution, types));
    let Some((_, module, resolution, entry_types)) = units.next() else {
        return FrontEnd::stopped(Some(project));
    };
    let dependencies = units
        .filter_map(|(index, module, resolution, types)| {
            let id = project.modules.modules().get(index)?.id();
            Some(ModuleUnit {
                id,
                module,
                resolution,
                types: types?,
            })
        })
        .collect();
    FrontEnd {
        project: Some(project),
        module: Some(module),
        resolution: Some(resolution),
        types: entry_types,
        dependencies,
        effects,
    }
}

/// The fragment stage of every material of the program, in module and
/// declaration order: the GPU roots (decision 0039).
fn stage_roots(program: &[ProgramUnit<'_>]) -> Vec<RootBody> {
    program
        .iter()
        .flat_map(|unit| {
            unit.types.materials().filter_map(|(_, material)| {
                let stage = material.fragment.as_ref()?;
                Some(RootBody {
                    module: unit.id,
                    label: format!("the fragment stage of material '{}'", material.name),
                    span: stage.name_span,
                    facts: stage.facts.clone(),
                })
            })
        })
        .collect()
}

/// The state initialisers, lifecycle functions and handlers of every module: bodies that run on
/// the CPU and are not functions (decision 0049).
fn cpu_roots(program: &[ProgramUnit<'_>]) -> Vec<RootBody> {
    program
        .iter()
        .flat_map(|unit| {
            unit.types.cpu_bodies().iter().map(|body| RootBody {
                module: unit.id,
                label: body.label.clone(),
                span: body.span,
                facts: body.facts.clone(),
            })
        })
        .collect()
}

/// The materials `resolution`'s module imports, with their params in the
/// exporting modules (decision 0039).
fn imported_materials<'a>(
    resolution: &Resolution,
    resolutions: &[Resolution],
    types: &'a [Option<Typeck>],
) -> BTreeMap<DefId, ImportedMaterial<'a>> {
    resolution
        .imports()
        .filter(|(_, target)| target.kind == DefKind::Material)
        .filter_map(|(def, target)| {
            let exporter = types.get(target.module.index())?.as_ref()?;
            let exported = resolutions
                .get(target.module.index())?
                .def_of(target.node)?;
            let info = exporter.material(exported)?;
            Some((
                def,
                ImportedMaterial {
                    interner: exporter.interner(),
                    info,
                },
            ))
        })
        .collect()
}

/// The functions `symbols` name (`path::name`), for [`Roots::gpu_functions`].
fn gpu_root_functions(
    project: &Project,
    program: &[ProgramUnit<'_>],
    symbols: &[String],
) -> Vec<FnRef> {
    let mut roots = Vec::new();
    for symbol in symbols {
        let Some((path, name)) = symbol.split_once("::") else {
            continue;
        };
        for unit in program {
            let unit_path = project
                .modules
                .get(unit.id)
                .and_then(|m| project.sources.get(m.file()))
                .map(|source| source.path().as_str().to_owned());
            if unit_path.as_deref() != Some(path) {
                continue;
            }
            roots.extend(
                unit.types
                    .functions()
                    .filter(|(_, info)| info.name == name)
                    .map(|(def, _)| FnRef {
                        module: unit.id,
                        def,
                    }),
            );
        }
    }
    roots
}

/// The functions `resolution`'s module imports, with their signatures in
/// the exporting modules (decision 0038).
fn imported_fns<'a>(
    resolution: &Resolution,
    resolutions: &[Resolution],
    types: &'a [Option<Typeck>],
) -> BTreeMap<DefId, ImportedFn<'a>> {
    resolution
        .imports()
        .filter(|(_, target)| target.kind == DefKind::Fn)
        .filter_map(|(def, target)| {
            let exporter = types.get(target.module.index())?.as_ref()?;
            let exported = resolutions
                .get(target.module.index())?
                .def_of(target.node)?;
            let info = exporter.function(exported)?;
            Some((
                def,
                ImportedFn {
                    interner: exporter.interner(),
                    sig: &info.sig,
                },
            ))
        })
        .collect()
}

/// The constants the module resolved as `resolution` imports from modules
/// already checked (`types`, indexed like `resolutions` by module).
fn imported_consts<'a>(
    resolution: &Resolution,
    resolutions: &[Resolution],
    types: &'a [Option<Typeck>],
) -> ImportedConsts<'a> {
    resolution
        .imports()
        .filter(|(_, target)| target.kind == DefKind::Const)
        .filter_map(|(def, target)| {
            let exporter = types.get(target.module.index())?.as_ref()?;
            let exported = resolutions
                .get(target.module.index())?
                .def_of(target.node)?;
            let info = exporter.const_info(exported)?;
            Some((
                def,
                ImportedConst {
                    interner: exporter.interner(),
                    info,
                },
            ))
        })
        .collect()
}

/// The structs `resolution`'s module imports, with their types in the
/// exporting modules (decision 0035 item 5); a struct of a module not checked
/// yet (across the closing import of a cycle) is left out.
fn imported_structs<'a>(
    resolution: &Resolution,
    resolutions: &[Resolution],
    types: &'a [Option<Typeck>],
) -> BTreeMap<DefId, ImportedStruct<'a>> {
    resolution
        .imports()
        .filter(|(_, target)| target.kind == DefKind::Struct)
        .filter_map(|(def, target)| {
            let exporter = types.get(target.module.index())?.as_ref()?;
            let exported = resolutions
                .get(target.module.index())?
                .def_of(target.node)?;
            let ty = exporter.struct_ty(exported)?;
            Some((
                def,
                ImportedStruct {
                    interner: exporter.interner(),
                    ty,
                },
            ))
        })
        .collect()
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
