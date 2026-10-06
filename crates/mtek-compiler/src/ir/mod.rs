//! The typed high-level IR (`spec/compiler-architecture.md` section 4.8,
//! decision 0028): the semantic contract between the language and code
//! generation (blueprint section 5.1).
//!
//! The IR is self-contained (no AST references, no `DefId`s: declarations
//! are named by their [`Symbol`], `normalised/path.mtek::Qualified.Name`),
//! every node carries its [`Span`](crate::source::Span), and every value is
//! typed ([`Value`] is tagged by its type; fields have the registry's
//! types). It is designed to grow with the language — functions, materials,
//! prefabs, state, handlers, bindings and host inputs join the
//! [`Item`]/[`Scene`] shapes as their milestones implement them — and in M1
//! it holds what M1 programs contain: module constants, and scenes with their
//! fields, constants, cameras and a flat entity list (stable instance order,
//! with parent indices) whose meshes and material instances are complete
//! descriptors. Structs (decision 0035) and functions with typed bodies,
//! effect level and reachability (decision 0038) are items too.
//!
//! [`lower_to_ir`] builds it from an [`Analysis`] without errors;
//! [`to_json`] and [`to_human`] are the two forms of `mtek inspect --ir`
//! ([`crate::inspect`]).

mod lower;
mod lower_fn;
mod model;
mod render;
#[cfg(test)]
mod tests;

pub use model::{
    Block, Branch, Camera, Const, Entity, Expr, ExprKind, Field, Function, Item, LocalItem,
    LocalKind, MaterialInstanceDesc, MaterialItem, MaterialParamItem, Mesh, MeshDesc, Module,
    NamedExpr, NamedValue, Origin, Param, Place, PlaceRoot, PlaceStep, Program, Projection,
    ProjectionDesc, Scene, SceneFields, Source, StageItem, StateEntry, Stmt, StructFieldItem,
    StructItem, Symbol, UpdateClass, Value,
};
pub use render::{to_human, to_json};

use crate::project::Project;
use crate::resolve::Resolution;
use crate::syntax::ast;
use crate::types::{ProgramEffects, Typeck};
use crate::{Analysis, ModuleUnit};

/// Why [`lower_to_ir`] produced no program.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LowerError {
    /// The analysis has errors (or did not get as far as type checking):
    /// stages after type checking run only without errors
    /// (`spec/compiler-architecture.md` section 3).
    HasErrors,
    /// The checked program could not be represented: a compiler defect,
    /// reported as `E9999` by [`crate::inspect`]. The text says what was
    /// wrong.
    Internal(String),
}

/// Lower a checked program to the typed IR. Runs only when the analysis has
/// no errors; never panics.
pub fn lower_to_ir(analysis: &Analysis) -> Result<Program, LowerError> {
    if analysis.has_errors() {
        return Err(LowerError::HasErrors);
    }
    lower_parts(
        analysis.project.as_ref(),
        analysis.module.as_ref(),
        analysis.resolution.as_ref(),
        analysis.types.as_ref(),
        &analysis.dependencies,
        &analysis.effects,
    )
}

/// [`lower_to_ir`] on the front end's parts (the caller has checked that
/// there are no errors).
pub(crate) fn lower_parts(
    project: Option<&Project>,
    module: Option<&ast::Module>,
    resolution: Option<&Resolution>,
    types: Option<&Typeck>,
    dependencies: &[ModuleUnit],
    effects: &ProgramEffects,
) -> Result<Program, LowerError> {
    let (Some(project), Some(module), Some(resolution), Some(types)) =
        (project, module, resolution, types)
    else {
        return Err(LowerError::HasErrors);
    };
    let entry = lower::Unit {
        id: project.modules.entry().id(),
        module,
        resolution,
        types,
    };
    let units: Vec<lower::Unit<'_>> = std::iter::once(entry)
        .chain(dependencies.iter().map(|unit| lower::Unit {
            id: unit.id,
            module: &unit.module,
            resolution: &unit.resolution,
            types: &unit.types,
        }))
        .collect();
    lower::lower(project, &units, effects).map_err(LowerError::Internal)
}
