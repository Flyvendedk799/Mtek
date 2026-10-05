//! Types and constant evaluation (`spec/compiler-architecture.md` section
//! 4.7, `spec/language.md` sections 5–8, decisions 0026, 0035 and 0038).
//!
//! [`check_module`] types every expression of the constructs this build
//! implements and folds every constant expression. It reports to the
//! [`Diagnostics`] sink:
//!
//! * `E3001` a type mismatch: a constant's value against its declared type, a
//!   constructor or function argument against its parameter, a name that is
//!   not a value, a call of something that is not a function;
//! * `E3002` the wrong number of arguments; `E3003` type arguments on a type
//!   that takes none (unknown type names are the resolver's `E3003`);
//! * `E3010` arithmetic on `color`, `E3011` negation of `u32`, `E3012`
//!   equality of vectors, `E3014` an operator without a row for its operand
//!   types;
//! * `E3013` an invalid component or swizzle; `E5001` a field a named entity
//!   or camera does not have;
//! * `E3020` a struct that contains itself, `E3021`–`E3023` a missing,
//!   duplicate or unknown struct field; `E3030` a constant index out of
//!   range, `E3031` an invalid array length, `E3032` a type nested deeper than
//!   256 levels (decision 0035);
//! * `E3041` a literal not representable in the type its context requires;
//! * `W3050` a conversion to the type the value already has;
//! * `E3040` overflow, division by zero or a non-finite `f32` while folding;
//! * `E2020` a constant that depends on itself; `E3090` a constant whose
//!   value is not a constant expression;
//! * in functions (`body`, decision 0038): `E3061` an assignment to a place
//!   that is not assignable, `E3060` to a multi-component swizzle, `W2010`
//!   a `var` never assigned, `E3070` a condition that is not `bool`, `E3080`
//!   a missing return, `W3081` unreachable code.
//!
//! The program-wide pass ([`effects`]) then joins the functions of every
//! module into one call graph: `E4001` recursion, `E4002`/`W4003` effect
//! levels, `E5080` handler-only built-ins, and the GPU reachability rules
//! `E4010`–`E4013`.
//!
//! The scene checks ([`scene`], decision 0027) then validate every scene,
//! camera and entity body and every descriptor literal against the registry
//! (`E5001`–`E5003`, `E3102`, `E5006`, `E5010`–`E5013`, `E5020`, `E5081`,
//! `E5090`, `E5092`, `E5100`, `E3090` for fields) and record a
//! [`CheckedScene`] per scene ([`Typeck::scenes`]), the input of the typed IR.
//!
//! Modules:
//!
//! - [`ty`]: the type catalogue ([`Ty`]) and the [`TyInterner`];
//! - [`value`]: constant values ([`ConstValue`]) and the exact operations on
//!   them;
//! - `ops`: the operator typing table;
//! - `check`: the checker; `consteval`: folding and constant declarations;
//!   `intrinsics`: the compile-time semantics of the global intrinsics;
//!   `body`: function signatures and statements; [`facts`]: what a body
//!   calls and declares; [`effects`]: the program-wide pass;
//! - [`scene`]: the scene and schema checks and their result.

mod body;
mod check;
mod consteval;
pub mod effects;
#[cfg(test)]
mod effects_tests;
pub mod facts;
mod intrinsics;
mod material;
mod ops;
pub mod scene;
mod bind;
mod scene_body;
#[cfg(test)]
mod scene_tests;
mod structs;
#[cfg(test)]
mod tests;
pub mod ty;
pub mod value;

use std::collections::BTreeMap;

pub use check::{CallKind, FieldKind};
pub use effects::{EffectLevel, FnEffect, FnRef, ProgramEffects, Roots};
pub use facts::{BodyFacts, BuiltinCall, CallFact, Callee, CpuOnlySite};
pub use material::MAX_MATERIAL_PARAMS;
pub use scene::{CheckedEntity, CheckedField, CheckedObject, CheckedScene, FieldOrigin};
pub use ty::{MaterialKey, StructDef, StructKey, Ty, TyId, TyInterner};
pub use value::{ArithOp, ConstValue, EvalError, EvalResult, Scalar};

use crate::diagnostics::Diagnostics;
use crate::resolve::{DefId, Resolution};
use crate::source::Span;
use crate::syntax::ast::{Module, NodeId};

/// The type and value of one constant declaration.
#[derive(Clone, Debug, PartialEq)]
pub struct ConstInfo {
    /// The declared type, or the type of the value when none is declared;
    /// `Error` if it could not be typed.
    pub ty: TyId,
    /// The value, unless the constant has an error.
    pub value: Option<ConstValue>,
}

/// Why an expression is not a constant expression: the first non-constant
/// form in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NonConstant {
    /// The non-constant form (a call, a field read, a name).
    pub span: Span,
    /// What kind of form it is.
    pub kind: NonConstantKind,
    /// A clause for a diagnostic: "it calls the function 'f', …".
    pub reason: String,
}

/// The kinds of form that make an expression non-constant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NonConstantKind {
    /// A call of a user function or of a built-in function that is not
    /// const-eligible.
    Call,
    /// The name of a declaration without a constant value: `state`, a param,
    /// a parameter, a local, a bare entity name.
    Declaration,
    /// A read of a field of a named entity or scene object (`Cube.position`);
    /// in a field initialiser that is `E5081` (`spec/scenes.md` section 11).
    ObjectField,
    /// A value that changes at run time (`frame.time`).
    RunTimeValue,
}

/// The signature of a function: its parameters and result, in its module's
/// interner.
#[derive(Clone, Debug, PartialEq)]
pub struct FnSig {
    /// The parameters' names and types, in order.
    pub params: Vec<(String, TyId)>,
    /// The result type; [`TyId::UNIT`] for a function without `->`.
    pub ret: TyId,
    /// Declared `cpu fn`.
    pub cpu: bool,
}

/// A checked function declaration (decision 0038).
#[derive(Clone, Debug, PartialEq)]
pub struct FnInfo {
    pub name: String,
    /// The declared name.
    pub name_span: Span,
    /// The whole declaration.
    pub span: Span,
    pub sig: FnSig,
    /// What its body calls and declares, for the program-wide passes.
    pub facts: BodyFacts,
}

/// A checked material declaration (`spec/materials.md` sections 1–3,
/// decision 0039).
#[derive(Clone, Debug, PartialEq)]
pub struct MaterialInfo {
    pub name: String,
    /// Its identity in every module.
    pub key: MaterialKey,
    /// The declared name.
    pub name_span: Span,
    /// The whole declaration.
    pub span: Span,
    /// The params in declaration order.
    pub params: Vec<MaterialParam>,
    /// The fragment stage, if the material declares one (the first stage
    /// function; any further one is an error).
    pub fragment: Option<StageInfo>,
}

impl MaterialInfo {
    /// The param `name`.
    #[must_use]
    pub fn param(&self, name: &str) -> Option<&MaterialParam> {
        self.params.iter().find(|p| p.name == name)
    }
}

/// One `param` of a material.
#[derive(Clone, Debug, PartialEq)]
pub struct MaterialParam {
    pub name: String,
    /// The param's declaration (`None` for a material imported from another
    /// module, whose declarations live in that module's resolution).
    pub def: Option<DefId>,
    /// Its type; `Error` if the annotation has an error.
    pub ty: TyId,
    /// The folded default, if one is written and valid.
    pub default: Option<ConstValue>,
    /// A default is written (valid or not): an instance need not supply the
    /// param.
    pub has_default: bool,
    /// The declared name.
    pub name_span: Span,
    /// The whole `param name: T = default;`.
    pub span: Span,
}

/// The checked stage function of a material.
#[derive(Clone, Debug, PartialEq)]
pub struct StageInfo {
    /// The declared name.
    pub name_span: Span,
    /// The whole stage function.
    pub span: Span,
    /// The `SurfaceInput` parameter (a function parameter of the stage).
    pub surface: Option<DefId>,
    /// The `SurfaceInput` fields the stage reads, in the registry's field
    /// order (`spec/materials.md` section 3.1).
    pub surface_inputs: Vec<&'static str>,
    /// What the body calls and declares: the stage is a GPU root
    /// ([`effects::Roots::gpu_bodies`]).
    pub facts: BodyFacts,
}

/// A `state` declaration of a scene or an entity (`spec/scenes.md` sections 2 and 4.4).
#[derive(Clone, Debug, PartialEq)]
pub struct StateInfo {
    pub def: DefId,
    pub name: String,
    /// The declared name.
    pub name_span: Span,
    /// The whole `state name: T = value;`.
    pub span: Span,
    /// The declared type; `Error` if the annotation has an error.
    pub ty: TyId,
    /// The scene or entity that declares it.
    pub owner: Option<DefId>,
    /// The initialiser expression.
    pub init: NodeId,
    /// Its position among the state of its owner, in declaration order.
    pub index: u32,
}

/// What kind of CPU root body a [`CpuBody`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CpuBodyKind {
    /// The initialiser of a `state`.
    StateInit,
    /// `update` or `fixed_update`.
    Lifecycle,
    /// `on event(…)`.
    Handler,
    /// The expression of a `bind(..)`.
    Binding,
}

/// A body that runs on the CPU and is not a function: a state initialiser, a
/// lifecycle function or an event handler (a CPU root of the program-wide
/// pass, [`effects::Roots::cpu_bodies`]).
#[derive(Clone, Debug, PartialEq)]
pub struct CpuBody {
    pub kind: CpuBodyKind,
    /// The syntax node: the `StateDecl`, `LifecycleFn` or `Handler`.
    pub node: NodeId,
    /// The scene or entity that holds it.
    pub owner: Option<DefId>,
    /// How diagnostics name it: "the handler `on key_down` of scene 'Demo'".
    pub label: String,
    pub span: Span,
    /// What it calls and declares.
    pub facts: BodyFacts,
}

/// What an assignment in a handler writes (single-writer analysis,
/// `spec/scenes.md` section 8.2).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum WriteTarget {
    /// Scene or entity `state`.
    State(DefId),
    /// A field of a named entity or camera (`Cube.position`, `Main.target`), by the
    /// declaration of the object and the registry field name.
    Field { object: DefId, field: String },
    /// A param of the material instance of a named entity (`Cube.material.phase`).
    MaterialParam { entity: DefId, param: String },
}

/// What a `bind(..)` writes (`spec/scenes.md` section 8.4).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum BindTarget {
    /// A field of a named entity or camera (`Cube.position`, `Main.target`).
    Field { object: DefId, field: String },
    /// A param of the material instance of a named entity.
    MaterialParam { entity: DefId, param: String },
}

/// What a binding expression reads: its dependencies (`spec/runtime-abi.md` section 5.2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BindDep {
    /// Scene state.
    State(DefId),
    /// `frame.time`, `frame.delta`, `frame.index` (the member name).
    Frame(String),
    /// A field of a named entity or camera.
    Field { object: DefId, field: String },
    /// The state of an entity.
    EntityState { entity: DefId, state: DefId },
    /// A param of the material instance of a named entity.
    MaterialParam { entity: DefId, param: String },
}

impl BindDep {
    /// Whether reading this dependency reads what `target` writes.
    #[must_use]
    pub fn reads(&self, target: &BindTarget) -> bool {
        match (self, target) {
            (
                BindDep::Field { object, field },
                BindTarget::Field {
                    object: o,
                    field: f,
                },
            ) => object == o && field == f,
            (
                BindDep::MaterialParam { entity, param },
                BindTarget::MaterialParam {
                    entity: e,
                    param: p,
                },
            ) => entity == e && param == p,
            _ => false,
        }
    }
}

/// One `bind(expr)` of a scene, after the checks (decision 0051).
#[derive(Clone, Debug, PartialEq)]
pub struct BindInfo {
    /// The scene it belongs to.
    pub scene: Option<DefId>,
    /// The `bind(..)` node.
    pub node: NodeId,
    /// The whole `bind(..)`.
    pub span: Span,
    /// The bound expression.
    pub source: NodeId,
    /// The field or param's type, which the expression has exactly.
    pub ty: TyId,
    pub target: BindTarget,
    /// What the expression reads, in source order, each once.
    pub deps: Vec<BindDep>,
    /// The binding's index among the bindings of its scene, in declaration order.
    pub id: u32,
    /// Its position in the evaluation order of phase 5 (topological, ties by declaration order).
    pub order: u32,
}

/// One assignment to a [`WriteTarget`].
#[derive(Clone, Debug, PartialEq)]
pub struct WriteSite {
    pub target: WriteTarget,
    /// The whole assignment target as written.
    pub span: Span,
}

/// What type checking and constant evaluation produced for one module.
#[derive(Clone, Debug)]
pub struct Typeck {
    interner: TyInterner,
    types: Vec<Option<TyId>>,
    values: Vec<Option<ConstValue>>,
    non_constant: BTreeMap<NodeId, NonConstant>,
    consts: BTreeMap<DefId, ConstInfo>,
    /// The type of every struct the module declares, by its `DefId`.
    structs: BTreeMap<DefId, TyId>,
    scenes: Vec<CheckedScene>,
    /// Every function the module declares, by its `DefId`.
    functions: BTreeMap<DefId, FnInfo>,
    /// The type of every parameter, local and loop variable of a function.
    locals: BTreeMap<DefId, TyId>,
    /// What each call expression without errors calls.
    calls: BTreeMap<NodeId, CallKind>,
    /// What each field expression without errors reads.
    fields: BTreeMap<NodeId, FieldKind>,
    /// Every material the module declares, by its `DefId`.
    materials: BTreeMap<DefId, MaterialInfo>,
    /// Every `state` declaration, by its `DefId`.
    states: BTreeMap<DefId, StateInfo>,
    /// State initialisers, lifecycle functions and handlers, in source order.
    cpu_bodies: Vec<CpuBody>,
    /// Every assignment to state, entity and camera fields and material
    /// params, in source order.
    writes: Vec<WriteSite>,
    /// The type of the material instance of each named entity that has one.
    entity_materials: BTreeMap<DefId, TyId>,
    /// Every `bind(..)` of every scene, scene by scene in declaration order.
    bindings: Vec<BindInfo>,
}

impl Typeck {
    fn new(node_count: u32) -> Self {
        let slots = node_count as usize;
        Self {
            interner: TyInterner::new(),
            types: vec![None; slots],
            values: vec![None; slots],
            non_constant: BTreeMap::new(),
            consts: BTreeMap::new(),
            structs: BTreeMap::new(),
            scenes: Vec::new(),
            functions: BTreeMap::new(),
            locals: BTreeMap::new(),
            calls: BTreeMap::new(),
            fields: BTreeMap::new(),
            materials: BTreeMap::new(),
            states: BTreeMap::new(),
            cpu_bodies: Vec::new(),
            writes: Vec::new(),
            entity_materials: BTreeMap::new(),
            bindings: Vec::new(),
        }
    }

    /// Every `bind(..)` of the module, scene by scene, in declaration order.
    #[must_use]
    pub fn bindings(&self) -> &[BindInfo] {
        &self.bindings
    }

    /// The binding declared by the `bind` node `node`.
    #[must_use]
    pub fn binding_of(&self, node: NodeId) -> Option<&BindInfo> {
        self.bindings.iter().find(|b| b.node == node)
    }

    /// The `state` declared as `def`.
    #[must_use]
    pub fn state(&self, def: DefId) -> Option<&StateInfo> {
        self.states.get(&def)
    }

    /// Every `state` declaration, in `DefId` (source) order.
    pub fn states(&self) -> impl Iterator<Item = &StateInfo> + '_ {
        self.states.values()
    }

    /// The state initialisers, lifecycle functions and handlers of the
    /// module, in source order.
    #[must_use]
    pub fn cpu_bodies(&self) -> &[CpuBody] {
        &self.cpu_bodies
    }

    /// Every assignment to state, fields and material params, in source
    /// order.
    #[must_use]
    pub fn writes(&self) -> &[WriteSite] {
        &self.writes
    }

    /// The material instance type of the named entity `entity`.
    #[must_use]
    pub fn entity_material(&self, entity: DefId) -> Option<TyId> {
        self.entity_materials.get(&entity).copied()
    }

    /// The material declared as `def`.
    #[must_use]
    pub fn material(&self, def: DefId) -> Option<&MaterialInfo> {
        self.materials.get(&def)
    }

    /// Every material the module declares, in `DefId` (source) order.
    pub fn materials(&self) -> impl Iterator<Item = (DefId, &MaterialInfo)> + '_ {
        self.materials.iter().map(|(def, info)| (*def, info))
    }

    /// Every scene the build checks, in source order, as the scene checks
    /// left it (decision 0027).
    #[must_use]
    pub fn scenes(&self) -> &[CheckedScene] {
        &self.scenes
    }

    /// The checked scene declared as `def` (for the entry scene, pass
    /// [`Resolution::entry_scene`]).
    #[must_use]
    pub fn scene(&self, def: DefId) -> Option<&CheckedScene> {
        self.scenes.iter().find(|scene| scene.def == Some(def))
    }

    /// The types of this module.
    #[must_use]
    pub fn interner(&self) -> &TyInterner {
        &self.interner
    }

    /// The type of the expression `node`, if the checker typed it.
    #[must_use]
    pub fn ty(&self, node: NodeId) -> Option<TyId> {
        self.types.get(node.index()).copied().flatten()
    }

    /// The folded value of the expression `node`, if it is a constant
    /// expression without errors.
    #[must_use]
    pub fn value(&self, node: NodeId) -> Option<&ConstValue> {
        self.values.get(node.index()).and_then(Option::as_ref)
    }

    /// Why the field value `node` (the root of a scene, entity or camera field
    /// value, or the value of a field of a descriptor literal) is not a
    /// constant expression, if it is not.
    #[must_use]
    pub fn non_constant(&self, node: NodeId) -> Option<&NonConstant> {
        self.non_constant.get(&node)
    }

    /// The type and value of the constant declared as `def`.
    #[must_use]
    pub fn const_info(&self, def: DefId) -> Option<&ConstInfo> {
        self.consts.get(&def)
    }

    /// The type of the struct declared as `def` (its fields:
    /// [`TyInterner::struct_def`]).
    #[must_use]
    pub fn struct_ty(&self, def: DefId) -> Option<TyId> {
        self.structs.get(&def).copied()
    }

    /// The Mtek spelling of `ty`.
    #[must_use]
    pub fn display(&self, ty: TyId) -> String {
        self.interner.display(ty)
    }

    /// The function declared as `def`.
    #[must_use]
    pub fn function(&self, def: DefId) -> Option<&FnInfo> {
        self.functions.get(&def)
    }

    /// Every function the module declares, in `DefId` (source) order.
    pub fn functions(&self) -> impl Iterator<Item = (DefId, &FnInfo)> + '_ {
        self.functions.iter().map(|(def, info)| (*def, info))
    }

    /// The type of the parameter, local or loop variable `def`.
    #[must_use]
    pub fn local_ty(&self, def: DefId) -> Option<TyId> {
        self.locals.get(&def).copied()
    }

    /// What the call expression `node` calls, if it was typed without errors.
    #[must_use]
    pub fn call_kind(&self, node: NodeId) -> Option<&CallKind> {
        self.calls.get(&node)
    }

    /// What the field expression `node` reads, if it was typed without
    /// errors.
    #[must_use]
    pub fn field_kind(&self, node: NodeId) -> Option<&FieldKind> {
        self.fields.get(&node)
    }
}

/// A constant another module exports, as the module that imports it sees
/// it (decision 0036): its type in the exporting module's interner and its
/// value.
#[derive(Clone, Copy, Debug)]
pub struct ImportedConst<'a> {
    /// The exporting module's types.
    pub interner: &'a TyInterner,
    /// The constant's type (an id of `interner`) and value.
    pub info: &'a ConstInfo,
}

/// The constants a module imports, by the `DefId` of the imported name in
/// the importing module.
pub type ImportedConsts<'a> = BTreeMap<DefId, ImportedConst<'a>>;

/// A struct another module exports (decision 0035 item 5): its type in the
/// exporting module's interner, which carries its fields.
#[derive(Clone, Copy, Debug)]
pub struct ImportedStruct<'a> {
    /// The exporting module's types.
    pub interner: &'a TyInterner,
    /// The struct type (an id of `interner`).
    pub ty: TyId,
}

/// A function another module exports (decision 0038): its signature in the
/// exporting module's interner.
#[derive(Clone, Copy, Debug)]
pub struct ImportedFn<'a> {
    /// The exporting module's types.
    pub interner: &'a TyInterner,
    /// The function's signature (ids of `interner`).
    pub sig: &'a FnSig,
}

/// A material another module exports (decision 0039): its params in the
/// exporting module's interner.
#[derive(Clone, Copy, Debug)]
pub struct ImportedMaterial<'a> {
    /// The exporting module's types.
    pub interner: &'a TyInterner,
    pub info: &'a MaterialInfo,
}

/// Everything a module imports that has a type: constants, structs,
/// functions and materials, by the `DefId` of the imported name in the
/// importing module.
#[derive(Clone, Debug, Default)]
pub struct Imports<'a> {
    pub consts: ImportedConsts<'a>,
    pub structs: BTreeMap<DefId, ImportedStruct<'a>>,
    pub fns: BTreeMap<DefId, ImportedFn<'a>>,
    pub materials: BTreeMap<DefId, ImportedMaterial<'a>>,
}

/// Type-check `module` (whose source text is `text`) and fold its constant
/// expressions, reporting to `sink`. Names were resolved into `resolution`;
/// names the resolver could not resolve (`Res::Error`) are not reported
/// again. Never panics.
#[must_use]
pub fn check_module(
    module: &Module,
    text: &str,
    resolution: &Resolution,
    sink: &mut Diagnostics,
) -> Typeck {
    check_module_with_imports(module, text, resolution, &Imports::default(), sink)
}

/// [`check_module`] for a module that imports constants: an imported name
/// whose `DefId` is in `imports` has the constant's type (carried over into
/// this module's interner) and value, so uses fold exactly like uses of a
/// constant of the module. An imported name that is not there (its module
/// was not checked first, which only an import cycle causes, or it is not a
/// constant) has the type `Error` and no further diagnostic. An imported
/// struct keeps its identity and brings its fields along (decision 0035
/// item 5).
#[must_use]
pub fn check_module_with_imports(
    module: &Module,
    text: &str,
    resolution: &Resolution,
    imports: &Imports<'_>,
    sink: &mut Diagnostics,
) -> Typeck {
    let mut checker = check::Checker::new(module, text, resolution, sink);
    for (def, imported) in &imports.structs {
        let ty = checker
            .out
            .interner
            .import_from(imported.interner, imported.ty);
        if !checker.out.interner.is_error(ty) {
            checker.imported_structs.insert(*def, ty);
        }
    }
    for (def, imported) in &imports.consts {
        let ty = checker
            .out
            .interner
            .import_from(imported.interner, imported.info.ty);
        let value = if checker.out.interner.is_error(ty) {
            None
        } else {
            imported.info.value.clone()
        };
        checker.out.consts.insert(*def, ConstInfo { ty, value });
    }
    for (def, imported) in &imports.fns {
        let params = imported
            .sig
            .params
            .iter()
            .map(|(name, ty)| {
                let ty = checker.out.interner.import_from(imported.interner, *ty);
                (name.clone(), ty)
            })
            .collect();
        let ret = checker
            .out
            .interner
            .import_from(imported.interner, imported.sig.ret);
        checker.imported_fns.insert(
            *def,
            FnSig {
                params,
                ret,
                cpu: imported.sig.cpu,
            },
        );
    }
    for (def, imported) in &imports.materials {
        let info = imported.info;
        let params = info
            .params
            .iter()
            .map(|param| MaterialParam {
                def: None,
                ty: checker
                    .out
                    .interner
                    .import_from(imported.interner, param.ty),
                ..param.clone()
            })
            .collect();
        checker.out.interner.intern_material(info.key, &info.name);
        checker.imported_materials.insert(
            *def,
            MaterialInfo {
                params,
                fragment: None,
                ..info.clone()
            },
        );
    }
    checker.module(module);
    checker.scene_checks(module);
    checker.finish()
}
