//! The node types of the typed IR (decision 0028).
//!
//! Every type derives [`Serialize`]; the JSON keys are camelCase and appear in
//! field declaration order, which is therefore part of the format: new fields
//! are added where they belong, never by reordering. Spans serialise as
//! `{ "file": <file id>, "start": <byte>, "end": <byte> }` (half-open byte
//! offsets into the file as stored, the file id of the [`Module`] it belongs
//! to). `f32` values serialise as the shortest decimal that reads back as the
//! same binary32 value (`serde_json`'s `f32` formatting), so the JSON is
//! lossless and identical on every host.

use std::fmt;

use serde::{Serialize, Serializer};

use crate::source::Span;

/// The serialised form of a [`Span`].
#[derive(Serialize)]
struct SpanJson {
    file: u32,
    start: u32,
    end: u32,
}

/// Serialise a [`Span`] as `{ file, start, end }`.
fn span<S: Serializer>(span: &Span, serializer: S) -> Result<S::Ok, S::Error> {
    SpanJson {
        file: span.file.0,
        start: span.start,
        end: span.end,
    }
    .serialize(serializer)
}

/// A symbol: `normalised/module/path.mtek::Qualified.Name`, the identity of a
/// declaration across builds (`spec/runtime-abi.md` sections 5 and 11). The
/// qualified name is the chain of declaration names from the module item
/// down: `src/main.mtek::Demo`, `src/main.mtek::Demo.Main`,
/// `src/main.mtek::Demo.Ground.Fountain`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct Symbol(String);

impl Symbol {
    /// The symbol of the module item `name` declared in the module at `path`.
    #[must_use]
    pub fn item(path: &str, name: &str) -> Symbol {
        Symbol(format!("{path}::{name}"))
    }

    /// The symbol of `name` declared inside the declaration `self`.
    #[must_use]
    pub fn child(&self, name: &str) -> Symbol {
        Symbol(format!("{}.{name}", self.0))
    }

    /// The symbol as text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Symbol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A whole program: every module the build compiles and the entry scene.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    /// The scene that runs (`project.scene`, or the entry module's only
    /// scene): the symbol of one of the [`Scene`] items.
    pub entry_scene: Symbol,
    /// The modules in load order, the entry module first (only the entry
    /// module in M1).
    pub modules: Vec<Module>,
}

impl Program {
    /// The entry scene.
    #[must_use]
    pub fn entry(&self) -> Option<&Scene> {
        self.scenes().find(|scene| scene.symbol == self.entry_scene)
    }

    /// Every scene of every module, in order.
    pub fn scenes(&self) -> impl Iterator<Item = &Scene> {
        self.modules
            .iter()
            .flat_map(|module| module.items.iter())
            .filter_map(|item| match item {
                Item::Scene(scene) => Some(scene),
                Item::Const(_) | Item::Struct(_) | Item::Function(_) | Item::Material(_) => None,
            })
    }

    /// Every material of every module, in order.
    pub fn materials(&self) -> impl Iterator<Item = &MaterialItem> {
        self.modules
            .iter()
            .flat_map(|module| module.items.iter())
            .filter_map(|item| match item {
                Item::Material(material) => Some(material),
                Item::Const(_) | Item::Struct(_) | Item::Function(_) | Item::Scene(_) => None,
            })
    }
}

/// One module (source file).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    /// The normalised project-relative path (`src/main.mtek`), the prefix of
    /// every symbol the module declares.
    pub path: String,
    /// The file id every span of this module refers to (load order).
    pub file: u32,
    /// The whole file.
    #[serde(serialize_with = "span")]
    pub span: Span,
    /// The module items, in source order. M1 populates constants and scenes;
    /// functions, structs, materials and prefabs join as their milestones
    /// implement them (decision 0028).
    pub items: Vec<Item>,
}

/// A module item.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Item {
    Const(Const),
    Scene(Scene),
    /// A user struct declaration (M2-01, decision 0035 item 6).
    Struct(StructItem),
    /// A `fn` or `cpu fn` with its typed body (M2-02, decision 0038).
    Function(Function),
    /// A user material: params, parameter block and fragment stage (M2-04,
    /// decision 0039).
    Material(MaterialItem),
}

/// A material declaration (decision 0039): the input of shader lowering
/// (M2-05: the fragment body and the `SurfaceInput` fields it reads) and of
/// the resource plan (M2-09: the parameter block).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialItem {
    pub name: String,
    pub symbol: Symbol,
    /// The params in declaration order (the order of the parameter block's
    /// members and of instance params).
    pub params: Vec<MaterialParamItem>,
    /// The parameter block (`spec/gpu-layout.md` section 5): id
    /// `material:<path>::<Name>`, WGSL struct `MtekParams_<hash8>_<Name>`,
    /// named from the declaring module's path (`layout::naming`) and laid out
    /// by `layout::compute`; `None` for a material without params.
    pub layout: Option<crate::layout::LayoutRecord>,
    pub fragment: StageItem,
    /// The whole declaration, `material Name { … }`.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// One param of a [`MaterialItem`].
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialParamItem {
    pub name: String,
    /// The param's type, as Mtek spells it.
    #[serde(rename = "type")]
    pub ty: String,
    /// The folded default; `None` when every instance must supply the param.
    pub default: Option<Value>,
    /// The whole `param name: T = default;`.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// The fragment stage of a material with its typed body. Material params
/// appear in it as [`ExprKind::Param`]; the `SurfaceInput` parameter is the
/// first local.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageItem {
    /// `<material symbol>.fragment` (the span-map symbol of
    /// `spec/runtime-abi.md` section 5.4).
    pub symbol: Symbol,
    /// The `SurfaceInput` fields the body reads, in varying order
    /// (`local_position`, `world_position`, `world_normal`, `uv`): the
    /// generated vertex stage outputs, and meshes must provide, only those
    /// (`spec/materials.md` section 3.1).
    pub surface_inputs: Vec<&'static str>,
    /// The result type (`color`).
    pub result: String,
    /// The `SurfaceInput` parameter, then the locals in declaration order.
    pub locals: Vec<LocalItem>,
    pub body: Block,
    /// The whole stage function.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// A function declaration with its typed body (decision 0038): the input of
/// shader lowering (the GPU-reachable `fn`s) and of the CPU emitter.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Function {
    pub name: String,
    pub symbol: Symbol,
    /// `pure` for `fn`, `cpu` for `cpu fn` (`spec/language.md` 8.3).
    pub effect: &'static str,
    /// A GPU root (a material stage function) reaches it through `fn`s: it
    /// is compiled to WGSL.
    pub gpu_reachable: bool,
    /// CPU code (a `cpu fn`, a lifecycle function or handler) reaches it: it
    /// is compiled for the CPU.
    pub cpu_reachable: bool,
    /// The result type as Mtek spells it; `None` for a function without
    /// `->`.
    pub result: Option<String>,
    /// Every parameter, local and loop variable: the parameters first, in
    /// order, then the others in the order they are declared. Statements and
    /// expressions refer to them by `index` (names may repeat in sibling
    /// blocks).
    pub locals: Vec<LocalItem>,
    pub body: Block,
    /// The whole declaration.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

impl Function {
    /// The parameters, in order.
    pub fn params(&self) -> impl Iterator<Item = &LocalItem> {
        self.locals
            .iter()
            .filter(|local| local.kind == LocalKind::Param)
    }
}

/// A parameter, local or loop variable of a [`Function`].
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalItem {
    /// Its position in [`Function::locals`].
    pub index: u32,
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub kind: LocalKind,
    /// The declared name.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// What declares a local.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalKind {
    Param,
    Let,
    Var,
    /// The variable of a `for` loop.
    Loop,
}

/// `{ statements }`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub stmts: Vec<Stmt>,
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// A statement (`spec/language.md` section 7).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Stmt {
    /// `let`: the local `local` (an index into [`Function::locals`]).
    Let {
        local: u32,
        value: Expr,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// `var`.
    Var {
        local: u32,
        value: Expr,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// A block constant; its uses are folded, it is listed for completeness.
    Const {
        name: String,
        #[serde(rename = "type")]
        ty: String,
        value: Value,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// `target = value;` or `target op= value;` (`op` is `=`, `+=`, `-=`,
    /// `*=` or `/=`; a compound assignment evaluates the place once).
    Assign {
        target: Place,
        op: &'static str,
        value: Expr,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// `if c0 { … } else if c1 { … } else { … }`: the branches in order and
    /// the final `else`.
    If {
        branches: Vec<Branch>,
        #[serde(rename = "else")]
        otherwise: Option<Block>,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// `for local in start..end { … }` (`i32` or `u32`, `end` exclusive).
    ForRange {
        local: u32,
        start: Expr,
        end: Expr,
        body: Block,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// `for local in array { … }`, each element by value.
    ForEach {
        local: u32,
        array: Expr,
        body: Block,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    Return {
        value: Option<Expr>,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    Break {
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    Continue {
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// A nested block.
    Block { body: Block },
    /// A call whose result (if any) is discarded.
    Expr {
        expr: Expr,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
}

/// One `if`/`else if` branch.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub cond: Expr,
    pub body: Block,
}

/// An assignable place (`spec/language.md` 7.2, decision 0045): a root and a chain of
/// steps applied to it in order — struct fields, array elements (a constant or run-time
/// index, clamped like a read) and at most one final vector component. `a[i].offset.y`
/// is the root `a` with the steps `[i]`, `.offset`, `.y`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub root: PlaceRoot,
    pub steps: Vec<PlaceStep>,
    /// The type of the whole place (the root's type when there are no steps).
    #[serde(rename = "type")]
    pub ty: String,
    /// The whole target as written.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// What a [`Place`] starts from. In this build only a `var` local; scene state and entity
/// fields (M3) are further roots that compose with the same steps.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlaceRoot {
    /// A `var` local (an index into the function's locals).
    Local {
        local: u32,
        name: String,
        #[serde(rename = "type")]
        ty: String,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// Scene or entity `state` (`spec/scenes.md` section 8.1).
    State {
        owner: Owner,
        name: String,
        #[serde(rename = "type")]
        ty: String,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// A field of a named entity (`Cube.position`, `self.rotation`), written through the
    /// context's setters.
    EntityField {
        entity: u32,
        field: String,
        #[serde(rename = "type")]
        ty: String,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// A field of a camera (`Main.position`).
    CameraField {
        camera: String,
        field: String,
        #[serde(rename = "type")]
        ty: String,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// A param of the material instance of a named entity (`Cube.material.phase`).
    InstanceParam {
        entity: u32,
        param: String,
        #[serde(rename = "type")]
        ty: String,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
}

impl PlaceRoot {
    /// The root's type.
    pub fn ty(&self) -> &str {
        match self {
            PlaceRoot::Local { ty, .. }
            | PlaceRoot::State { ty, .. }
            | PlaceRoot::EntityField { ty, .. }
            | PlaceRoot::CameraField { ty, .. }
            | PlaceRoot::InstanceParam { ty, .. } => ty,
        }
    }
}

/// The scene or entity that owns a `state`, or whose body a behaviour is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Owner {
    Scene,
    /// An entity, by its static index ([`Scene::entities`]).
    Entity {
        index: u32,
    },
}

/// One step of a [`Place`]; `ty` is the type of the place up to and including this step,
/// `span` the text from the root to the end of this step (`a[i]` for the step `[i]` of
/// `a[i].x`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlaceStep {
    /// The field `field` of a struct place, with its position in the declaration.
    Field {
        field: String,
        index: u32,
        #[serde(rename = "type")]
        ty: String,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// The element `index` (an `i32` or `u32` expression; a constant is in range, `E3030`)
    /// of an array place.
    Index {
        index: Expr,
        #[serde(rename = "type")]
        ty: String,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
    /// Component `component` (0 for `.x`) of a vector place; always the last step.
    Component {
        component: u32,
        #[serde(rename = "type")]
        ty: String,
        #[serde(serialize_with = "self::span")]
        span: Span,
    },
}

impl PlaceStep {
    /// The type of the place up to and including this step.
    pub fn ty(&self) -> &str {
        match self {
            PlaceStep::Field { ty, .. }
            | PlaceStep::Index { ty, .. }
            | PlaceStep::Component { ty, .. } => ty,
        }
    }

    /// The text from the root to the end of this step.
    pub fn span(&self) -> Span {
        match self {
            PlaceStep::Field { span, .. }
            | PlaceStep::Index { span, .. }
            | PlaceStep::Component { span, .. } => *span,
        }
    }
}

/// A typed expression: what it computes, its type and its span. Every
/// constant expression is folded into an [`ExprKind::Const`] (folding is
/// mandatory, `spec/language.md` 6.3).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Expr {
    #[serde(flatten)]
    pub kind: ExprKind,
    /// The type as Mtek spells it.
    #[serde(rename = "type")]
    pub ty: String,
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// The forms of an [`Expr`].
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExprKind {
    /// A folded constant.
    Const { value: Value },
    /// A parameter, local or loop variable.
    Local { local: u32, name: String },
    /// `-x` or `!x`.
    Unary {
        op: &'static str,
        operand: Box<Expr>,
    },
    /// `a op b`; `&&` and `||` short-circuit on the CPU.
    Binary {
        op: &'static str,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
    },
    /// A call of a user function.
    Call { function: Symbol, args: Vec<Expr> },
    /// A call of a built-in function: a global intrinsic (`sin`) or a
    /// namespace function (`quat.axis_angle`), the overload given by the
    /// argument types.
    Builtin { function: String, args: Vec<Expr> },
    /// A vector constructor (`vec3(…)`: components, splat or composition, by
    /// the argument types).
    Construct { args: Vec<Expr> },
    /// A numeric conversion to the expression's type (`f32(x)`).
    Convert { arg: Box<Expr> },
    /// Components of a vector, `quat` or `color` (0 for `.x`/`.r`); several
    /// for a swizzle.
    Components {
        base: Box<Expr>,
        components: Vec<u32>,
    },
    /// A field of a struct value, with its position in the declaration.
    Field {
        base: Box<Expr>,
        field: String,
        index: u32,
    },
    /// `base[index]` of an array or `mat4`; a run-time index is clamped.
    Index { base: Box<Expr>, index: Box<Expr> },
    /// An array literal.
    Array { elements: Vec<Expr> },
    /// A struct literal, its fields in declaration order (decision 0038).
    Struct { fields: Vec<NamedExpr> },
    /// A descriptor literal of a registry schema, its fields as written.
    Descriptor {
        schema: String,
        fields: Vec<NamedExpr>,
    },
    /// A read of scene or entity `state`.
    State { owner: Owner, name: String },
    /// A read of a field of a named entity (`Cube.position`) or of `self`.
    EntityField { entity: u32, field: String },
    /// A read of a camera field (`Main.position`).
    CameraField { camera: String, field: String },
    /// A read of a param of the material instance of a named entity.
    InstanceParam { entity: u32, param: String },
    /// `frame.time`, `frame.delta`, `frame.index`.
    Frame { member: String },
    /// A member of a registry enum (`Key.Space`) with the DOM code it maps from.
    EnumMember {
        enumeration: String,
        member: String,
        code: String,
    },
    /// A param of the material whose stage this is (decision 0039): its
    /// position in [`MaterialItem::params`] and its name. Params are read
    /// from the instance's parameter block, never folded.
    Param { param: u32, name: String },
    /// A descriptor literal of a user material that is not constant: every
    /// param in declaration order, the written value or the default as a
    /// constant (decision 0039).
    Material {
        material: Symbol,
        params: Vec<NamedExpr>,
    },
}

/// A named field value of a struct or descriptor literal.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct NamedExpr {
    pub name: String,
    pub value: Expr,
}

/// A struct declaration: its fields in declaration order with their types.
/// Values of the struct are `Value::Struct` with the fields in this order.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructItem {
    pub name: String,
    pub symbol: Symbol,
    pub fields: Vec<StructFieldItem>,
    /// The whole declaration, `struct Name { … }`.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// One field of a [`StructItem`].
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructFieldItem {
    pub name: String,
    /// The field's type, as Mtek spells it.
    #[serde(rename = "type")]
    pub ty: String,
}

/// A constant declaration (at module level, or in a scene or entity body)
/// with its folded value. Uses of constants are already folded into the
/// values that read them, so code generation never needs these; they are
/// part of the IR so that it is a complete account of the program.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Const {
    pub name: String,
    pub symbol: Symbol,
    /// The constant's type, as Mtek spells it (`f32`, `color`, `Box`).
    #[serde(rename = "type")]
    pub ty: String,
    pub value: Value,
    /// The whole declaration, `const NAME: T = value;`.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// A scene: its fields, constants, cameras and entities.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub name: String,
    pub symbol: Symbol,
    /// The whole declaration, `scene Name { … }`.
    #[serde(serialize_with = "span")]
    pub span: Span,
    pub fields: SceneFields,
    /// The constants declared in the scene body and in the bodies of its
    /// entities, in source order.
    pub constants: Vec<Const>,
    /// The cameras, in declaration order; exactly one is active.
    pub cameras: Vec<Camera>,
    /// Every entity, flat, in stable instance order (depth-first pre-order
    /// over the nesting, `spec/scenes.md` section 10.1): `entities[i].index
    /// == i`, and a child follows its parent.
    pub entities: Vec<Entity>,
    /// The `state` of the scene and of its entities in initialisation order
    /// (`spec/scenes.md` section 11): scene state in declaration order, then each
    /// entity's state in stable instance order.
    pub state: Vec<State>,
    /// Lifecycle functions and event handlers: the scene's in declaration order,
    /// then each entity's in stable instance order.
    pub behaviors: Vec<Behavior>,
    /// The `bind(..)` of the scene, by id (declaration order).
    pub bindings: Vec<Binding>,
}

/// A `bind(expr)` (`spec/scenes.md` section 8.4).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    /// The index into the scene's `bindings` (declaration order).
    pub id: u32,
    /// `path::Scene.bind_<id>`.
    pub symbol: Symbol,
    pub target: BindingTarget,
    /// What the expression reads, in source order.
    pub deps: Vec<BindingDep>,
    /// Its position in the phase 5 evaluation order.
    pub order: u32,
    /// The target's type.
    #[serde(rename = "type")]
    pub ty: String,
    /// The bound expression; it has no locals.
    pub expr: Expr,
    /// The whole `bind(..)`.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// What a binding writes (`spec/runtime-abi.md` section 5.2).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BindingTarget {
    Transform {
        entity: u32,
        field: String,
    },
    Visible {
        entity: u32,
    },
    /// A param of the material instance of an entity.
    Param {
        entity: u32,
        name: String,
    },
    Camera {
        field: String,
    },
}

/// What a binding reads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BindingDep {
    /// Scene state.
    State {
        name: String,
    },
    Frame {
        name: String,
    },
    EntityField {
        entity: u32,
        field: String,
    },
    EntityState {
        entity: u32,
        name: String,
    },
    Param {
        entity: u32,
        name: String,
    },
}

/// A `state` declaration with its initialiser (`spec/scenes.md` sections 2, 4.4 and 11).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub name: String,
    /// `path::Scene.name` or `path::Scene.Entity.name`.
    pub symbol: Symbol,
    #[serde(rename = "type")]
    pub ty: String,
    pub owner: Owner,
    /// The initialiser; it has no locals.
    pub init: Expr,
    /// The whole `state name: T = value;`.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// A lifecycle function or an event handler with its typed body.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Behavior {
    pub kind: BehaviorKind,
    pub owner: Owner,
    /// `path::Scene.update`, `path::Scene.Cube.on_key_down`, with a number when a body
    /// has several handlers of one event.
    pub symbol: Symbol,
    /// The parameter first (`dt`, the event parameter), then the locals.
    pub locals: Vec<LocalItem>,
    pub body: Block,
    /// The whole `update(dt: f32) { … }` or `on …` member.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// What a [`Behavior`] is.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BehaviorKind {
    Update,
    FixedUpdate,
    /// `on event(…)`: a filter (`Key.Space` as its DOM `code`) or a parameter (local 0).
    Event {
        event: String,
        filter: Option<String>,
    },
}

impl Scene {
    /// The active camera.
    #[must_use]
    pub fn active_camera(&self) -> Option<&Camera> {
        self.cameras.iter().find(|camera| camera.active)
    }
}

/// The scene fields this build implements (`spec/scenes.md` section 2).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneFields {
    /// `clear_color`: a linear colour.
    pub clear_color: Field,
}

/// The value of one field of a scene, camera or entity body.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    /// How the value is obtained (a constant in M1).
    pub source: Source,
    pub origin: Origin,
    /// The written `name: value;` member, or for a registry default the
    /// declaration that holds the field.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// How a field or material parameter gets its initial value. M1 has only
/// constants; initialisers that read scene state (M3, `spec/scenes.md`
/// section 11) and bindings add variants.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// A compile-time constant.
    Const(Value),
    /// The value of binding `id` of the scene, evaluated at run time (`bind(..)`): the field or
    /// param has no initial constant, the runtime evaluates every binding once after `init`.
    Bound(u32),
}

impl Source {
    /// The constant value, if the source is one.
    #[must_use]
    pub fn as_const(&self) -> Option<&Value> {
        match self {
            Source::Const(value) => Some(value),
            Source::Bound(_) => None,
        }
    }
}

/// Where a value comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// The source declares it.
    Written,
    /// The registry default (`spec/stdlib.md` section 3).
    Default,
}

/// A camera scene object.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub name: String,
    pub symbol: Symbol,
    /// The whole declaration, `camera Name { … }`.
    #[serde(serialize_with = "span")]
    pub span: Span,
    /// Whether this is the scene's active camera.
    pub active: bool,
    /// World-space position.
    pub position: Field,
    /// The point looked at, if declared (the manifest's `hasTarget`).
    pub target: Option<Field>,
    /// Orientation when there is no target.
    pub rotation: Field,
    pub projection: Projection,
}

/// A camera's projection descriptor.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub desc: ProjectionDesc,
    pub origin: Origin,
    /// The `projection: …;` member, or the camera for the default.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// The projection kinds (`spec/scenes.md` section 3), with every field.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectionDesc {
    Perspective {
        /// Vertical field of view, radians.
        #[serde(rename = "fovY")]
        fov_y: f32,
        near: f32,
        far: f32,
    },
    Orthographic {
        /// Visible height, metres.
        height: f32,
        near: f32,
        far: f32,
    },
}

impl ProjectionDesc {
    /// The kind as the manifest spells it (`perspective`).
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            ProjectionDesc::Perspective { .. } => "perspective",
            ProjectionDesc::Orthographic { .. } => "orthographic",
        }
    }
}

/// An entity.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    /// The static entity index: its position in [`Scene::entities`].
    pub index: u32,
    pub name: String,
    /// `path::Scene.Parent.Name`: the chain of enclosing entities.
    pub symbol: Symbol,
    /// The index of the parent entity; `None` for a root.
    pub parent: Option<u32>,
    /// The whole declaration, `entity Name { … }`.
    #[serde(serialize_with = "span")]
    pub span: Span,
    /// Local position (`vec3`).
    pub position: Field,
    /// Local rotation (`quat`).
    pub rotation: Field,
    /// Local scale (`vec3`, every component finite and positive).
    pub scale: Field,
    /// Whether the mesh is drawn (`bool`).
    pub visible: Field,
    /// The mesh, if the entity draws one.
    pub mesh: Option<Mesh>,
    /// The material instance; present exactly when `mesh` is.
    pub material: Option<MaterialInstanceDesc>,
}

/// An entity's mesh descriptor.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mesh {
    pub desc: MeshDesc,
    pub origin: Origin,
    /// The `mesh: …;` member.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// The built-in mesh shapes (`spec/stdlib.md` section 3), with every field;
/// the same keys as the manifest's `meshes` entries
/// (`spec/runtime-abi.md` section 5).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MeshDesc {
    /// Full extents along X, Y and Z.
    Box { size: [f32; 3] },
    Sphere {
        radius: f32,
        segments: u32,
        rings: u32,
    },
    /// Extent along X and Z.
    Plane { size: [f32; 2] },
}

/// A material instance of an entity.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialInstanceDesc {
    /// The material: `std/materials.mtek::Unlit` for a built-in material
    /// (the prelude source that declares it), `src/main.mtek::Pulse` for a
    /// user material (a [`MaterialItem`] of the program).
    pub material: Symbol,
    /// Every parameter of the material, in declaration order, with its
    /// initial value (written or the material's default).
    pub params: Vec<Param>,
    pub origin: Origin,
    /// The `material: …;` member, or the entity for the default material.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// One parameter of a material instance.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Param {
    pub name: String,
    /// The parameter's type, as Mtek spells it.
    #[serde(rename = "type")]
    pub ty: String,
    pub source: Source,
    /// When the value is uploaded (`spec/materials.md` section 4); every
    /// param of this build is `initial` (decision 0039).
    pub update: UpdateClass,
    /// The material instance's span (decision 0028).
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// The update class of a material instance param (`spec/materials.md`
/// section 4). `imperative` and `bound` arrive with handlers and `bind`
/// (M3), `resource` with textures (M4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateClass {
    /// A default or constant initialiser, never written: uploaded once at
    /// creation.
    Initial,
    /// Some lifecycle function or handler writes it: uploaded in the render
    /// phase of a frame in which it was written.
    Imperative,
    /// A `bind(..)` supplies it: evaluated every frame, uploaded when the value changed.
    Bound,
}

/// A constant value. Externally tagged by its type in JSON:
/// `{ "vec3": [0.0, 0.5, 0.0] }`, `{ "u32": 24 }`. Colours are linear RGBA;
/// quaternions `(x, y, z, w)`; `mat4` four columns of four rows.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Value {
    Bool(bool),
    I32(i32),
    U32(u32),
    F32(f32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
    Quat([f32; 4]),
    Color([f32; 4]),
    Mat4([[f32; 4]; 4]),
    /// A descriptor or struct value: the schema or struct name and its
    /// fields.
    Struct {
        name: String,
        fields: Vec<NamedValue>,
    },
    Array(Vec<Value>),
    /// A string (CPU only): `{ "string": "Showroom" }`.
    String(String),
}

/// A field of a [`Value::Struct`].
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct NamedValue {
    pub name: String,
    pub value: Value,
}

impl From<&crate::types::ConstValue> for Value {
    fn from(value: &crate::types::ConstValue) -> Self {
        use crate::types::ConstValue as C;
        match value {
            C::Bool(v) => Value::Bool(*v),
            C::I32(v) => Value::I32(*v),
            C::U32(v) => Value::U32(*v),
            C::F32(v) => Value::F32(*v),
            C::Vec2(v) => Value::Vec2(*v),
            C::Vec3(v) => Value::Vec3(*v),
            C::Vec4(v) => Value::Vec4(*v),
            C::Quat(v) => Value::Quat(*v),
            C::Color(v) => Value::Color(*v),
            C::Mat4(v) => Value::Mat4(*v),
            C::Struct { name, fields } => Value::Struct {
                name: name.clone(),
                fields: fields
                    .iter()
                    .map(|(name, value)| NamedValue {
                        name: name.clone(),
                        value: value.into(),
                    })
                    .collect(),
            },
            C::Array(items) => Value::Array(items.iter().map(Value::from).collect()),
            C::Str(text) => Value::String(text.clone()),
            // A material instance as a value: the material's name and its
            // parameters, like a descriptor (decision 0039); entities carry
            // instances as `MaterialInstanceDesc` with the material's symbol.
            C::Material { name, params, .. } => Value::Struct {
                name: name.clone(),
                fields: params
                    .iter()
                    .map(|(name, value)| NamedValue {
                        name: name.clone(),
                        value: value.into(),
                    })
                    .collect(),
            },
        }
    }
}

impl fmt::Display for Value {
    /// The human form: `vec3(0.0, 0.5, 0.0)`, `Box { size: vec3(1.0, 1.0,
    /// 1.0) }`. Floats are the shortest decimal that reads back as the same
    /// binary32 value.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fn list(f: &mut fmt::Formatter<'_>, name: &str, values: &[f32]) -> fmt::Result {
            write!(f, "{name}(")?;
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    f.write_str(", ")?;
                }
                write!(f, "{value:?}")?;
            }
            f.write_str(")")
        }
        match self {
            Value::Bool(v) => write!(f, "{v}"),
            Value::I32(v) => write!(f, "i32({v})"),
            Value::U32(v) => write!(f, "u32({v})"),
            Value::F32(v) => write!(f, "{v:?}"),
            Value::Vec2(v) => list(f, "vec2", v),
            Value::Vec3(v) => list(f, "vec3", v),
            Value::Vec4(v) => list(f, "vec4", v),
            Value::Quat(v) => list(f, "quat", v),
            Value::Color(v) => list(f, "color", v),
            Value::Mat4(columns) => {
                f.write_str("mat4(")?;
                for (index, column) in columns.iter().enumerate() {
                    if index > 0 {
                        f.write_str(", ")?;
                    }
                    list(f, "", column)?;
                }
                f.write_str(")")
            }
            Value::Struct { name, fields } => {
                write!(f, "{name} {{")?;
                for (index, field) in fields.iter().enumerate() {
                    f.write_str(if index > 0 { ", " } else { " " })?;
                    write!(f, "{}: {}", field.name, field.value)?;
                }
                f.write_str(if fields.is_empty() { "}" } else { " }" })
            }
            Value::Array(items) => {
                f.write_str("[")?;
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        f.write_str(", ")?;
                    }
                    write!(f, "{item}")?;
                }
                f.write_str("]")
            }
            Value::String(text) => {
                f.write_str("\"")?;
                for c in text.chars() {
                    match c {
                        '"' => f.write_str("\\\"")?,
                        '\\' => f.write_str("\\\\")?,
                        '\n' => f.write_str("\\n")?,
                        '\t' => f.write_str("\\t")?,
                        '\r' => f.write_str("\\r")?,
                        '\0' => f.write_str("\\0")?,
                        c if c.is_control() => write!(f, "\\u{{{:x}}}", u32::from(c))?,
                        c => write!(f, "{c}")?,
                    }
                }
                f.write_str("\"")
            }
        }
    }
}
