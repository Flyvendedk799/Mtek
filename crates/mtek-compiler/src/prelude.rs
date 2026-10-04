//! The embedded prelude modules (`spec/materials.md` section 9, decision 0044).
//!
//! The built-in materials are ordinary Mtek source: `std/materials.mtek`, embedded in the
//! compiler (`stdlib/std/materials.mtek`, registered in the registry's `prelude_sources`).
//! When a program uses a built-in material — an entity of one of its scenes has a material
//! descriptor of a registry material schema such as `Unlit` — the front end compiles that
//! module through the same passes as a project module: it is added to the source map after
//! the project's sources (so the manifest's `sources` and `spans` cover it, decision 0030
//! item 7) and to the module graph after the project's modules, lexed, parsed, resolved,
//! type-checked and included in the effect analysis; the typed IR then holds it as its last
//! module, and its materials are lowered to WGSL like user materials.
//!
//! Two things differ from a project module:
//!
//! - its material declarations take the names of the registry's built-in materials, which
//!   they define (the resolver's prelude mode, [`crate::resolve::resolve_prelude_module`]);
//! - a declaration of a built-in material whose registry milestone this build has not reached
//!   (`Pbr`, M4) is left out before resolution, so the build compiles exactly the built-ins it
//!   implements; using `Pbr` stays the resolver's `E9010` in the user's module.
//!
//! The prelude is fixed text, so any diagnostic it produced would be a compiler defect: it is
//! compiled into a sink of its own and reported as one `E9999` naming each diagnostic.
//! `std/` stays reserved for it (decisions 0030 and 0036): a project module there is `E9001`
//! or `E2031`, and built-in materials need no import.

use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::project::{ModuleId, Project};
use crate::resolve::gate::is_implemented;
use crate::resolve::{Resolution, resolve_prelude_module};
use crate::source::ProjectPath;
use crate::stdlib::{SchemaCategory, registry};
use crate::syntax::ast::{ItemKind, Module};
use crate::syntax::{lex, parse_module};
use crate::types::{CheckedEntity, ConstValue, Imports, Typeck, check_module_with_imports};

/// The prelude module that declares the built-in materials; their symbols are
/// `std/materials.mtek::Unlit`, … (decision 0028).
pub const MATERIALS_PATH: &str = "std/materials.mtek";

/// The embedded text of [`MATERIALS_PATH`].
#[must_use]
pub fn materials_text() -> Option<&'static str> {
    registry().prelude_source(MATERIALS_PATH)
}

/// Whether `name` is a built-in material: a registry schema of the material category,
/// declared in [`MATERIALS_PATH`].
#[must_use]
pub fn is_builtin_material(name: &str) -> bool {
    registry()
        .schema(name)
        .is_some_and(|schema| schema.category == SchemaCategory::Material)
}

/// Whether a built-in material declaration is compiled by this build: its registry schema's
/// milestone has been reached. Declarations of other names (helpers the prelude might add)
/// are always compiled.
fn implemented(name: &str) -> bool {
    registry()
        .schema(name)
        .is_none_or(|schema| is_implemented(schema.since))
}

/// Whether the checked modules use a built-in material: an entity of a scene of any of them
/// has a material that is a descriptor of a built-in material (a user material's instance
/// is a [`ConstValue::Material`] instead).
pub(crate) fn uses_builtin_material(types: &[Option<Typeck>]) -> bool {
    fn entity_uses(entity: &CheckedEntity) -> bool {
        let own = entity.field("material").is_some_and(|field| {
            matches!(&field.value, Some(ConstValue::Struct { name, .. }) if is_builtin_material(name))
        });
        own || entity.children.iter().any(entity_uses)
    }
    types
        .iter()
        .flatten()
        .flat_map(Typeck::scenes)
        .any(|scene| scene.entities.iter().any(entity_uses))
}

/// The compiled materials prelude: its place in the module graph and what the front end
/// produced for it.
pub(crate) struct CompiledPrelude {
    pub(crate) id: ModuleId,
    pub(crate) module: Module,
    pub(crate) resolution: Resolution,
    pub(crate) types: Typeck,
}

/// `E9999` for a prelude that does not compile.
fn defect(text: impl Into<String>) -> Diagnostic {
    Diagnostic::new(
        Code::E9999,
        format!(
            "The embedded prelude '{MATERIALS_PATH}' could not be compiled; this is a compiler bug."
        ),
    )
    .note(text.into())
    .help("please report it with the program that caused it")
}

/// Add [`MATERIALS_PATH`] to `project` (source map and module graph) and compile it: lex,
/// parse, leave out the built-in materials this build does not implement, resolve in prelude
/// mode and type-check. `None` (with an `E9999` in `sink`) if it cannot be added or produced
/// any diagnostic; `None` without a diagnostic if the project already has a module at that
/// path (which the project loader reported as `E9001` or `E2031`).
pub(crate) fn compile_materials(
    project: &mut Project,
    sink: &mut Diagnostics,
) -> Option<CompiledPrelude> {
    let path = match ProjectPath::new(MATERIALS_PATH) {
        Ok(path) => path,
        Err(error) => {
            sink.push(defect(format!("its path is not a project path: {error}")));
            return None;
        }
    };
    if project.modules.find(&path).is_some() || project.sources.id_of(&path).is_some() {
        return None;
    }
    let Some(text) = materials_text() else {
        sink.push(defect("it is not embedded in the registry"));
        return None;
    };
    let file = match project.sources.add(path.clone(), text.as_bytes()) {
        Ok(file) => file,
        Err(error) => {
            sink.push(defect(format!(
                "it could not be added to the source map: {error}"
            )));
            return None;
        }
    };
    let id = match project.modules.add_module(path, file) {
        Ok(id) => id,
        Err(error) => {
            sink.push(defect(format!(
                "it could not be added to the module graph: {error}"
            )));
            return None;
        }
    };
    let source = project.sources.get(file)?;
    let mut own = Diagnostics::new();
    let mut lexed = lex(source);
    lexed.report_into(&mut own);
    let mut module = parse_module(source.text(), &lexed.tokens, &lexed.trivia, &mut own).module;
    module.items.retain(|item| match &item.kind {
        ItemKind::Material(decl) => implemented(&decl.name.name),
        _ => true,
    });
    let resolution = resolve_prelude_module(&module, &mut own);
    let types = check_module_with_imports(
        &module,
        source.text(),
        &resolution,
        &Imports::default(),
        &mut own,
    );
    let report = own.finish();
    if !report.diagnostics.is_empty() {
        let mut diagnostic = defect(format!(
            "it produced {} diagnostic(s)",
            report.diagnostics.len()
        ));
        for found in &report.diagnostics {
            diagnostic = diagnostic.note(format!("{}: {}", found.code.short(), found.message));
        }
        sink.push(diagnostic);
        return None;
    }
    Some(CompiledPrelude {
        id,
        module,
        resolution,
        types,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::SourceMap;
    use crate::stdlib::CURRENT_MILESTONE;

    #[test]
    fn the_materials_prelude_is_embedded_and_declares_every_builtin_material() {
        let text = materials_text().expect("embedded");
        for schema in registry()
            .schemas
            .iter()
            .filter(|s| s.category == SchemaCategory::Material)
        {
            assert!(
                text.contains(&format!("export material {} {{", schema.name)),
                "{} is not declared in the prelude",
                schema.name
            );
            assert!(is_builtin_material(schema.name));
        }
        assert!(!is_builtin_material("Box"));
        assert!(!is_builtin_material("Pulse"));
    }

    #[test]
    fn only_builtin_materials_of_reached_milestones_are_compiled() {
        assert!(implemented("Unlit"));
        assert_eq!(
            implemented("Pbr"),
            is_implemented(registry().schema("Pbr").expect("Pbr").since)
        );
        assert!(
            !implemented("Pbr"),
            "Pbr is M4; this build is {CURRENT_MILESTONE:?}"
        );
        assert!(implemented("helper"));
    }

    #[test]
    fn a_project_module_at_the_prelude_path_keeps_the_prelude_out() {
        let mut sources = SourceMap::new();
        let path = ProjectPath::new(MATERIALS_PATH).expect("path");
        let file = sources.add(path.clone(), b"scene S {}\n").expect("added");
        let mut project = Project {
            config: crate::project::parse_config(
                "[project]\nname = \"p\"\nlanguage = \"0.1\"\n",
                &mut Diagnostics::new(),
            )
            .expect("config"),
            config_text: std::sync::Arc::from(""),
            sources,
            modules: crate::project::ModuleGraph::new(path, file),
        };
        let mut sink = Diagnostics::new();
        assert!(compile_materials(&mut project, &mut sink).is_none());
        assert!(sink.finish().diagnostics.is_empty());
        assert_eq!(project.sources.files().count(), 1);
    }
}
