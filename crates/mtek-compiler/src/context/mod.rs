//! The AI context export, `mtek context` (`spec/ai-and-benchmarks.md` section 2, decision 0072).
//!
//! [`context`] turns a project and a list of symbols into a versioned, deterministic JSON
//! document that tells an agent what this compiler build supports, how the syntax works and what
//! the part of the project it is working on looks like. It is built only from the registry, the
//! build's gates and the resolved project; nothing in it is typed in by hand except wording.
//!
//! * [`capabilities`]: `supported.features` and `supported.notSupported`, derived from the
//!   resolver's construct table, the registry, the hard gates, the lexer's reserved words and the
//!   catalogue's unsupported-feature codes;
//! * [`syntax_info`]: keywords and precedence from the lexer and parser tables, and the syntax
//!   rules, each paired with the program that breaks it and the code the compiler reports;
//! * [`program`]: the declarations of the project, the references between them and the library
//!   names used in them;
//! * [`examples`]: complete programs the tests check, selected by shared features;
//! * [`fit`]: dropping the lowest-priority items to fit `--max-bytes`;
//! * [`model`]: the serialised shape.
//!
//! # The neighbourhood
//!
//! The *seeds* are the declarations named by `--symbol`, or, without it, the entry scene (or
//! every declaration of the entry module when no scene is selected). The context holds the seeds
//! and everything nested in them, the declarations one reference away in either direction, the
//! schemas the seeds use and the examples that share the seeds' features.

pub mod capabilities;
pub mod examples;
mod fit;
pub mod model;
mod program;
pub mod syntax_info;

use std::collections::BTreeSet;
use std::fmt;

use crate::check::{CheckResult, analyze};
use crate::project::{ProjectRoot, edit_distance};
use crate::resolve::PreludeItem;
use crate::resolve::gate::is_implemented;
use crate::source::Fs;
use crate::stdlib::{FieldDef, Registry, SchemaDef, registry};
use crate::{COMPILER_VERSION, LANGUAGE_VERSION};

pub use model::{CONTEXT_FORMAT, Context};

use fit::{Draft, fit};
use model::{
    ExampleEntry, FieldEntry, ProjectSection, SchemaEntry, Supported, SymbolEntry, SyntaxSection,
};
use program::{ModuleCtx, Program};

/// The default of `--max-bytes`.
pub const DEFAULT_MAX_BYTES: usize = 24_000;

/// The `diagnosticsGuide` text. A test checks that every field it names exists in
/// `spec/diagnostic.schema.json`.
pub const DIAGNOSTICS_GUIDE: &str = "`mtek check --format json` prints one JSON report; each diagnostic has code, severity, title, message, source (file, startByte, endByte, startLine, startColumn, endLine, endColumn), expected and actual (when relevant), related, notes, suggestedEdits and phase. Fix errors in report order, apply a suggestedEdit only when it is present (they are validated), and never delete the feature a diagnostic is about.";

/// What to export.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextOptions {
    /// The entry module as the caller spelled it, relative to the project root. It must be the
    /// project's entry (`project.entry` of `mtek.toml`); `None` takes the project's own.
    pub entry: Option<String>,
    /// The symbols to focus on, by name (`Demo.Cube`) or by file and name
    /// (`src/main.mtek::Demo.Cube`). Empty: the entry scene.
    pub symbols: Vec<String>,
    /// The most bytes the text may have.
    pub max_bytes: usize,
}

impl Default for ContextOptions {
    fn default() -> Self {
        ContextOptions {
            entry: None,
            symbols: Vec::new(),
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

/// A finished export.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextOutput {
    /// The document.
    pub context: Context,
    /// Its text: what `mtek context` prints.
    pub text: String,
}

/// Why there is no export.
#[derive(Debug)]
pub enum ContextError {
    /// The project could not be loaded (`E9001`, `E9004`, `E9005`, ...); the diagnostics are
    /// the report of `mtek check` for it.
    Project(Box<CheckResult>),
    /// `--entry` is not the project's entry module.
    EntryMismatch { given: String, configured: String },
    /// A requested symbol names no declaration.
    UnknownSymbol {
        name: String,
        suggestions: Vec<String>,
    },
    /// The smallest context there is does not fit `--max-bytes`.
    BudgetTooSmall { max_bytes: usize, minimum: usize },
}

impl fmt::Display for ContextError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ContextError::Project(_) => f.write_str("the project could not be loaded"),
            ContextError::EntryMismatch { given, configured } => write!(
                f,
                "'--entry {given}' is not the entry module of the project, which is '{configured}' (project.entry in mtek.toml)"
            ),
            ContextError::UnknownSymbol { name, suggestions } => {
                write!(f, "no declaration is named '{name}' in the project")?;
                match suggestions.as_slice() {
                    [] => Ok(()),
                    [one] => write!(f, "; did you mean '{one}'?"),
                    many => write!(f, "; did you mean one of '{}'?", many.join("', '")),
                }
            }
            ContextError::BudgetTooSmall { max_bytes, minimum } => write!(
                f,
                "'--max-bytes {max_bytes}' is too small: the smallest context for this project is {minimum} bytes"
            ),
        }
    }
}

impl std::error::Error for ContextError {}

/// Export the context of the project at `root`.
///
/// # Errors
///
/// See [`ContextError`]. A project that loads but has errors in its sources is not an error: the
/// context describes what parsed, and `mtek check` reports the rest.
pub fn context(
    root: &ProjectRoot,
    fs: &dyn Fs,
    options: &ContextOptions,
) -> Result<ContextOutput, ContextError> {
    let analysis = analyze(root, fs);
    let Some(project) = analysis.project.as_ref() else {
        return Err(ContextError::Project(Box::new(analysis.into())));
    };
    let configured = project.config.project.entry.as_str().to_owned();
    if let Some(given) = &options.entry
        && *given != configured
    {
        return Err(ContextError::EntryMismatch {
            given: given.clone(),
            configured,
        });
    }

    let mut modules: Vec<Option<ModuleCtx<'_>>> = Vec::new();
    for module in project.modules.modules() {
        let index = module.id().index();
        let path = module.path().as_str();
        let source = project.sources.get(module.file());
        let parts = if index == 0 {
            analysis
                .module
                .as_ref()
                .zip(analysis.resolution.as_ref())
                .map(|(ast, resolution)| (ast, resolution, analysis.types.as_ref()))
        } else {
            analysis
                .dependencies
                .iter()
                .find(|unit| unit.id == module.id())
                .map(|unit| (&unit.module, &unit.resolution, Some(&unit.types)))
        };
        let ctx = match (source, parts) {
            // The embedded prelude is not the project's.
            (Some(source), Some((ast, resolution, types)))
                if path != crate::prelude::MATERIALS_PATH =>
            {
                Some(ModuleCtx::new(
                    path.to_owned(),
                    source,
                    ast,
                    resolution,
                    types,
                ))
            }
            _ => None,
        };
        modules.push(ctx);
    }
    let paths: Vec<String> = modules
        .iter()
        .flatten()
        .map(|ctx| ctx.path.clone())
        .collect();
    let program = Program::new(modules);

    let seeds = seeds(&program, &options.symbols)?;
    let inside = program.closure(&seeds);
    let neighbours = program.neighbours(&inside);
    let registry = registry();

    let mut symbols = Vec::new();
    let mut neighbour = Vec::new();
    for (index, decl) in program.decls.iter().enumerate() {
        let is_neighbour = neighbours.contains(&index);
        if !(inside.contains(&index) || is_neighbour) {
            continue;
        }
        let Some(Some(ctx)) = program.modules.get(decl.module) else {
            continue;
        };
        symbols.push(SymbolEntry {
            name: decl.name.clone(),
            kind: decl.kind.clone(),
            ty: decl.ty.clone(),
            doc: decl.doc.clone(),
            file: ctx.path.clone(),
            line: decl.line,
        });
        neighbour.push(is_neighbour);
    }

    let capabilities = capabilities::derive(registry);
    let used = program.used_features(&inside);
    let context = Context {
        language_version: LANGUAGE_VERSION,
        compiler_version: COMPILER_VERSION,
        context_format: CONTEXT_FORMAT,
        supported: Supported {
            features: capabilities.features,
            not_supported: capabilities.not_supported,
        },
        syntax: SyntaxSection {
            keywords: syntax_info::keywords(),
            precedence: syntax_info::precedence(),
            rules: syntax_info::rules(),
        },
        project: ProjectSection {
            entry: project.config.project.entry.as_str().to_owned(),
            scene: program
                .entry_scene()
                .and_then(|index| program.decls.get(index))
                .map(|decl| decl.name.clone()),
            modules: paths,
        },
        symbols,
        schemas: schemas_used(&program, &inside, registry),
        examples: examples::select(&used)
            .into_iter()
            .map(|example| ExampleEntry {
                title: example.title.to_owned(),
                source: example.source.to_owned(),
            })
            .collect(),
        diagnostics_guide: DIAGNOSTICS_GUIDE,
        truncated: None,
    };
    match fit(Draft { context, neighbour }, options.max_bytes) {
        Ok((context, text)) => Ok(ContextOutput { context, text }),
        Err(minimum) => Err(ContextError::BudgetTooSmall {
            max_bytes: options.max_bytes,
            minimum,
        }),
    }
}

/// The declarations the context is about.
fn seeds(program: &Program<'_>, symbols: &[String]) -> Result<Vec<usize>, ContextError> {
    if symbols.is_empty() {
        return Ok(match program.entry_scene() {
            Some(scene) => vec![scene],
            None => program
                .roots()
                .into_iter()
                .filter(|index| program.decls.get(*index).is_some_and(|d| d.module == 0))
                .collect(),
        });
    }
    let mut seeds = BTreeSet::new();
    for name in symbols {
        let found = program.find(name);
        if found.is_empty() {
            return Err(ContextError::UnknownSymbol {
                name: name.clone(),
                suggestions: suggestions(program, name),
            });
        }
        seeds.extend(found);
    }
    Ok(seeds.into_iter().collect())
}

/// The names of the declarations closest to `name` (at most three, within an edit distance of
/// two), nearest first.
fn suggestions(program: &Program<'_>, name: &str) -> Vec<String> {
    let mut near: Vec<(usize, &str)> = program
        .decls
        .iter()
        .map(|decl| (edit_distance(&decl.name, name), decl.name.as_str()))
        .filter(|(distance, _)| *distance <= 2)
        .collect();
    near.sort_unstable();
    near.dedup();
    near.into_iter()
        .take(3)
        .map(|(_, name)| name.to_owned())
        .collect()
}

/// The schemas the declarations in `inside` use, with the fields this build implements: the
/// schemas of the declarations themselves (`Scene`, `Entity`, the schema of a scene-object
/// kind) and every schema named in a descriptor literal, sorted by name.
fn schemas_used(
    program: &Program<'_>,
    inside: &BTreeSet<usize>,
    registry: &Registry,
) -> Vec<SchemaEntry> {
    let mut names: BTreeSet<&str> = BTreeSet::new();
    for decl in inside.iter().filter_map(|index| program.decls.get(*index)) {
        match decl.kind.as_str() {
            "scene" => {
                names.insert(registry.declaration_schemas.scene);
            }
            "entity" | "prefab" => {
                names.insert(registry.declaration_schemas.entity);
            }
            keyword => {
                if let Some(kind) = registry.scene_object(keyword) {
                    names.insert(kind.schema);
                }
            }
        }
    }
    for item in program.prelude_items(inside) {
        match item {
            PreludeItem::Schema(name) => {
                names.insert(name);
            }
            PreludeItem::SceneObject(keyword) => {
                if let Some(kind) = registry.scene_object(keyword) {
                    names.insert(kind.schema);
                }
            }
            _ => {}
        }
    }
    names
        .into_iter()
        .filter_map(|name| registry.schema(name))
        .filter(|schema| is_implemented(schema.since))
        .map(schema_entry)
        .collect()
}

fn schema_entry(schema: &SchemaDef) -> SchemaEntry {
    SchemaEntry {
        name: schema.name.to_owned(),
        fields: schema
            .fields
            .iter()
            .filter(|field| is_implemented(field.since))
            .map(field_entry)
            .collect(),
    }
}

fn field_entry(field: &FieldDef) -> FieldEntry {
    let flags = [
        (field.flags.is_required(), 'R'),
        (field.flags.is_writable(), 'W'),
        (field.flags.is_bindable(), 'B'),
        (field.flags.is_construction_only(), 'C'),
    ];
    FieldEntry {
        name: field.name.to_owned(),
        ty: field.ty.spelling().to_owned(),
        default: field.default_text(),
        flags: flags
            .iter()
            .filter(|(set, _)| *set)
            .map(|(_, letter)| *letter)
            .collect(),
    }
}
