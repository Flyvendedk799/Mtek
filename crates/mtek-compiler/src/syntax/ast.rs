//! The abstract syntax tree of the whole v0.1 language
//! (`spec/grammar.ebnf`, `spec/compiler-architecture.md` section 4.3).
//!
//! The tree is owned and plain data. Every node carries a [`NodeId`] and a
//! [`Span`] and nothing else the parser could not know: no resolved names, no
//! types, no GPU handles. Later stages attach what they compute in side
//! tables keyed by `NodeId`.
//!
//! # Node ids
//!
//! The parser allocates ids from 0 upwards at the moment a node is
//! completed, so a node's children always have smaller ids than the node
//! itself (post-order) and the [`Module`] has the largest id of its file.
//! [`Module::node_count`] is one past the largest id, so a table with
//! `node_count` slots can be indexed by [`NodeId::index`]. In a parse without
//! errors the ids are exactly `0..node_count`; error recovery may discard
//! already numbered nodes, which leaves gaps (ids stay unique).
//!
//! # Recovery
//!
//! Where the parser could not build what the grammar asks for it inserts an
//! `Error` node (`ExprKind::Error`, `Stmt::Error`, ...) so that later stages
//! can carry on with the rest of the tree. An `Error` node always comes with
//! a diagnostic, except for a literal the lexer already reported
//! ([`TokenValue::Malformed`](super::TokenValue::Malformed)).
//!
//! # Shape
//!
//! Optional grammar parts are `Option`s, repeated parts are `Vec`s, and the
//! alternatives of a production are an enum with one variant per
//! alternative. Expressions, types and items are a struct with `id`, `span`
//! and a `kind` enum, because tools treat every expression alike; every other
//! node is its own struct. Parentheses are kept ([`ExprKind::Paren`]):
//! `-(5)` and `-5` differ semantically (`spec/language.md` 6.6) and a
//! formatter must not lose the author's grouping.

use crate::source::Span;

/// Identity of a syntax node within one parsed file. See the module
/// documentation for how ids are allocated.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct NodeId(pub u32);

impl NodeId {
    /// The id as an index into per-node tables.
    #[must_use]
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// What every syntax node offers: its id and the bytes it covers.
pub trait Node {
    /// The node's identity.
    fn id(&self) -> NodeId;
    /// The source bytes the node covers, including everything nested in it.
    fn span(&self) -> Span;
}

macro_rules! impl_node {
    ($($ty:ty),+ $(,)?) => {
        $(
            impl Node for $ty {
                fn id(&self) -> NodeId {
                    self.id
                }
                fn span(&self) -> Span {
                    self.span
                }
            }
        )+
    };
}

macro_rules! impl_node_for_enum {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        impl Node for $name {
            fn id(&self) -> NodeId {
                match self {
                    $( $name::$variant(node) => node.id(), )+
                }
            }
            fn span(&self) -> Span {
                match self {
                    $( $name::$variant(node) => node.span(), )+
                }
            }
        }
    };
}

/// A placeholder for syntax the parser could not make sense of; its span is
/// the skipped text (possibly empty).
#[derive(Clone, PartialEq, Debug)]
pub struct ErrorNode {
    pub id: NodeId,
    pub span: Span,
}

/// A name: the declared name of an item, member, parameter, local or field,
/// or the field name after a `.`. A name used as an expression is
/// [`ExprKind::Name`] and carries no separate node.
///
/// Words reserved for future use (`spec/language.md` 2.3) and the single
/// identifier `_` are accepted as names here: the parser reports `E0013` for
/// the former where they appear, `E0012` for `_` is the resolver's.
#[derive(Clone, PartialEq, Debug)]
pub struct Ident {
    pub id: NodeId,
    pub span: Span,
    pub name: String,
}

/// A string literal with its escapes decoded (the specifier of an import).
#[derive(Clone, PartialEq, Debug)]
pub struct StrLit {
    pub id: NodeId,
    pub span: Span,
    /// `None` if the lexer reported the literal as malformed.
    pub value: Option<String>,
}

impl_node!(ErrorNode, Ident, StrLit);

// ---------------------------------------------------------------------------
// Modules and items (`spec/grammar.ebnf` section 2)
// ---------------------------------------------------------------------------

/// One `.mtek` file: a sequence of items.
#[derive(Clone, PartialEq, Debug)]
pub struct Module {
    pub id: NodeId,
    pub span: Span,
    pub items: Vec<Item>,
    /// One past the largest [`NodeId`] used in the file.
    pub node_count: u32,
}

/// A top-level item. `export` is part of the item node, not of the
/// declaration inside it, so a `const` inside a block or a scene shares the
/// declaration type without a flag that could never be set.
#[derive(Clone, PartialEq, Debug)]
pub struct Item {
    pub id: NodeId,
    /// Starts at `export` if there is one.
    pub span: Span,
    /// `export` was written. Never true for an import (`export import` is a
    /// syntax error).
    pub export: bool,
    pub kind: ItemKind,
}

/// The alternatives of `Item` (`spec/grammar.ebnf` section 2).
#[derive(Clone, PartialEq, Debug)]
pub enum ItemKind {
    Import(ImportDecl),
    Const(ConstDecl),
    Fn(FnDecl),
    Struct(StructDecl),
    Material(MaterialDecl),
    Prefab(PrefabDecl),
    Scene(SceneDecl),
    /// Text the parser skipped while recovering at item level (the span of
    /// the enclosing [`Item`]).
    Error,
}

/// `import { A, B } from "./path.mtek";`
#[derive(Clone, PartialEq, Debug)]
pub struct ImportDecl {
    pub id: NodeId,
    pub span: Span,
    pub names: Vec<Ident>,
    pub source: StrLit,
}

/// `const NAME: Type = expr;` (at module level, in a scene, entity or prefab
/// body, or as a statement).
#[derive(Clone, PartialEq, Debug)]
pub struct ConstDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub ty: Option<Type>,
    pub value: Expr,
}

/// `fn name(params) -> T { ... }` or `cpu fn ...`.
#[derive(Clone, PartialEq, Debug)]
pub struct FnDecl {
    pub id: NodeId,
    pub span: Span,
    /// `cpu fn`.
    pub cpu: bool,
    pub name: Ident,
    pub params: Vec<Param>,
    /// `None` for a function without `->` (unit result).
    pub ret: Option<Type>,
    pub body: Block,
}

/// `name: Type` in a parameter list.
#[derive(Clone, PartialEq, Debug)]
pub struct Param {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub ty: Type,
}

/// `struct Name { field: Type; ... }`.
#[derive(Clone, PartialEq, Debug)]
pub struct StructDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub fields: Vec<StructField>,
}

/// `field: Type;` inside a struct.
#[derive(Clone, PartialEq, Debug)]
pub struct StructField {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub ty: Type,
}

// ---------------------------------------------------------------------------
// Materials (`spec/grammar.ebnf` section 3)
// ---------------------------------------------------------------------------

/// `material Name { ... }`.
#[derive(Clone, PartialEq, Debug)]
pub struct MaterialDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub members: Vec<MaterialMember>,
}

/// The members of a material body.
#[derive(Clone, PartialEq, Debug)]
pub enum MaterialMember {
    Param(ParamDecl),
    Stage(StageFn),
    Error(ErrorNode),
}

/// `param name: Type = default;` in a material or a prefab.
#[derive(Clone, PartialEq, Debug)]
pub struct ParamDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub ty: Type,
    pub default: Option<Expr>,
}

/// `fragment(input: SurfaceInput) -> color { ... }`. Which stage names are
/// valid is a semantic rule, so the name is an ordinary [`Ident`].
#[derive(Clone, PartialEq, Debug)]
pub struct StageFn {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub params: Vec<Param>,
    pub ret: Option<Type>,
    pub body: Block,
}

// ---------------------------------------------------------------------------
// Scenes, entities, prefabs (`spec/grammar.ebnf` section 4)
// ---------------------------------------------------------------------------

/// `scene Name { ... }`.
#[derive(Clone, PartialEq, Debug)]
pub struct SceneDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub members: Vec<SceneMember>,
}

/// The members of a scene body.
#[derive(Clone, PartialEq, Debug)]
pub enum SceneMember {
    Field(FieldInit),
    Const(ConstDecl),
    State(StateDecl),
    Object(SceneObject),
    Entity(EntityDecl),
    Lifecycle(LifecycleFn),
    Handler(Handler),
    Error(ErrorNode),
}

/// `prefab Name { ... }`.
#[derive(Clone, PartialEq, Debug)]
pub struct PrefabDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub members: Vec<EntityMember>,
}

/// `entity Name { ... }` or `entity Name: Prefab { ... }`.
#[derive(Clone, PartialEq, Debug)]
pub struct EntityDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    /// The prefab after `:`, if any.
    pub prefab: Option<Ident>,
    pub members: Vec<EntityMember>,
}

/// The members of an entity or prefab body. `Param` is only valid inside a
/// prefab and a nested `Entity` only inside an entity; those are semantic
/// rules (`E1040`, `E5040`).
#[derive(Clone, PartialEq, Debug)]
pub enum EntityMember {
    Field(FieldInit),
    Const(ConstDecl),
    State(StateDecl),
    Param(ParamDecl),
    Entity(EntityDecl),
    Lifecycle(LifecycleFn),
    Handler(Handler),
    Error(ErrorNode),
}

/// `camera Main { ... }`: a scene object of a registered kind.
#[derive(Clone, PartialEq, Debug)]
pub struct SceneObject {
    pub id: NodeId,
    pub span: Span,
    /// The kind word (`camera`); whether it is a registered kind is a
    /// semantic rule (`E5014`).
    pub kind: Ident,
    pub name: Ident,
    pub fields: Vec<FieldInit>,
}

/// `state name: Type = expr;`.
#[derive(Clone, PartialEq, Debug)]
pub struct StateDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub ty: Type,
    pub value: Expr,
}

/// `name: value;` in a scene, entity, prefab or scene object.
#[derive(Clone, PartialEq, Debug)]
pub struct FieldInit {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub value: FieldValue,
}

/// The value of a field: an expression or a live binding.
#[derive(Clone, PartialEq, Debug)]
pub enum FieldValue {
    Expr(Box<Expr>),
    Bind(Bind),
}

/// `bind(expr)`.
#[derive(Clone, PartialEq, Debug)]
pub struct Bind {
    pub id: NodeId,
    pub span: Span,
    pub source: Box<Expr>,
}

/// `update(dt: f32) { ... }` or `fixed_update(...)`. Whether the name is a
/// lifecycle name is a semantic rule (`E5050`).
#[derive(Clone, PartialEq, Debug)]
pub struct LifecycleFn {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub params: Vec<Param>,
    pub body: Block,
}

/// `on event(args) { ... }`.
#[derive(Clone, PartialEq, Debug)]
pub struct Handler {
    pub id: NodeId,
    pub span: Span,
    pub event: Ident,
    pub args: Vec<HandlerArg>,
    pub body: Block,
}

/// An argument of an event handler: a parameter (`other: entity_ref`) or a
/// filter expression (`Key.Space`).
#[derive(Clone, PartialEq, Debug)]
pub enum HandlerArg {
    Param(Param),
    Filter(Expr),
}

// ---------------------------------------------------------------------------
// Types (`spec/grammar.ebnf` section 5)
// ---------------------------------------------------------------------------

/// A type as written.
#[derive(Clone, PartialEq, Debug)]
pub struct Type {
    pub id: NodeId,
    pub span: Span,
    pub kind: TypeKind,
}

/// The shapes of a type. Which names take arguments is a semantic rule: the
/// grammar accepts `name<Type, N>` for every name.
#[derive(Clone, PartialEq, Debug)]
pub enum TypeKind {
    /// `f32`, `vec3`, a user struct, ...
    Named(Ident),
    /// `array<T, N>`.
    Generic {
        name: Ident,
        element: Box<Type>,
        length: ArrayLength,
    },
    Error,
}

/// The length of an array type: an integer literal or a constant's name.
#[derive(Clone, PartialEq, Debug)]
pub struct ArrayLength {
    pub id: NodeId,
    pub span: Span,
    pub kind: ArrayLengthKind,
}

/// The two forms of [`ArrayLength`].
#[derive(Clone, PartialEq, Debug)]
pub enum ArrayLengthKind {
    /// `value` is `None` when the literal does not fit in `u64`.
    Int {
        value: Option<u64>,
    },
    Name(String),
    Error,
}

// ---------------------------------------------------------------------------
// Statements (`spec/grammar.ebnf` section 6)
// ---------------------------------------------------------------------------

/// `{ statements }`.
#[derive(Clone, PartialEq, Debug)]
pub struct Block {
    pub id: NodeId,
    pub span: Span,
    pub stmts: Vec<Stmt>,
}

/// A statement.
#[derive(Clone, PartialEq, Debug)]
pub enum Stmt {
    /// `let x: T = e;`
    Let(LocalDecl),
    /// `var x: T = e;`
    Var(LocalDecl),
    Const(ConstDecl),
    If(IfStmt),
    For(ForStmt),
    Return(ReturnStmt),
    Break(JumpStmt),
    Continue(JumpStmt),
    Block(Block),
    /// `place op= value;`
    Assign(AssignStmt),
    /// An expression used as a statement (valid only for calls, `E1020`).
    Expr(ExprStmt),
    Error(ErrorNode),
}

/// The common shape of `let` and `var`.
#[derive(Clone, PartialEq, Debug)]
pub struct LocalDecl {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub ty: Option<Type>,
    pub value: Expr,
}

/// `if cond { ... } else ...`.
#[derive(Clone, PartialEq, Debug)]
pub struct IfStmt {
    pub id: NodeId,
    pub span: Span,
    pub cond: Expr,
    pub then_block: Block,
    pub else_branch: Option<ElseBranch>,
}

/// What follows `else`.
#[derive(Clone, PartialEq, Debug)]
pub enum ElseBranch {
    /// `else if ...`
    If(Box<IfStmt>),
    Block(Block),
}

/// `for x in a..b { ... }` or `for x in array { ... }`.
#[derive(Clone, PartialEq, Debug)]
pub struct ForStmt {
    pub id: NodeId,
    pub span: Span,
    pub var: Ident,
    pub iter: ForIter,
    pub body: Block,
}

/// What a `for` loop runs over.
#[derive(Clone, PartialEq, Debug)]
pub enum ForIter {
    /// `a..b`
    Range { start: Expr, end: Expr },
    /// An array.
    Each(Expr),
}

/// `return expr;` or `return;`.
#[derive(Clone, PartialEq, Debug)]
pub struct ReturnStmt {
    pub id: NodeId,
    pub span: Span,
    pub value: Option<Expr>,
}

/// `break;` or `continue;`.
#[derive(Clone, PartialEq, Debug)]
pub struct JumpStmt {
    pub id: NodeId,
    pub span: Span,
}

/// `place = value;`, `place += value;`, ...
#[derive(Clone, PartialEq, Debug)]
pub struct AssignStmt {
    pub id: NodeId,
    pub span: Span,
    pub target: Expr,
    pub op: AssignOp,
    pub op_span: Span,
    pub value: Expr,
}

/// An expression followed by `;`.
#[derive(Clone, PartialEq, Debug)]
pub struct ExprStmt {
    pub id: NodeId,
    pub span: Span,
    pub expr: Expr,
}

/// The assignment operators.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum AssignOp {
    /// `=`
    Assign,
    /// `+=`
    Add,
    /// `-=`
    Sub,
    /// `*=`
    Mul,
    /// `/=`
    Div,
}

impl AssignOp {
    /// The operator as written.
    #[must_use]
    pub fn symbol(self) -> &'static str {
        match self {
            AssignOp::Assign => "=",
            AssignOp::Add => "+=",
            AssignOp::Sub => "-=",
            AssignOp::Mul => "*=",
            AssignOp::Div => "/=",
        }
    }
}

// ---------------------------------------------------------------------------
// Expressions (`spec/grammar.ebnf` section 7)
// ---------------------------------------------------------------------------

/// An expression.
#[derive(Clone, PartialEq, Debug)]
pub struct Expr {
    pub id: NodeId,
    pub span: Span,
    pub kind: ExprKind,
}

/// The shapes of an expression.
#[derive(Clone, PartialEq, Debug)]
pub enum ExprKind {
    /// An integer literal. `value` is `None` when it does not fit in `u64`
    /// (the type checker reports `E3041`); the literal has no sign, a
    /// negative literal is a [`ExprKind::Unary`].
    Int {
        value: Option<u64>,
    },
    /// A float literal as parsed by the lexer (may be infinite).
    Float {
        value: f64,
    },
    /// A string literal, escapes decoded.
    Str {
        value: String,
    },
    /// A color literal as sRGB-encoded bytes (`spec/language.md` 5.4).
    Color {
        rgba: [u8; 4],
    },
    Bool(bool),
    /// `self`.
    SelfValue,
    /// A bare name. Resolution is the resolver's job.
    Name(String),
    /// `( expr )`.
    Paren(Box<Expr>),
    /// `[a, b, c]`.
    Array(Vec<Expr>),
    /// `Name { field: value; ... }`.
    Descriptor {
        name: Ident,
        fields: Vec<DescField>,
    },
    Unary {
        op: UnaryOp,
        operand: Box<Expr>,
    },
    Binary {
        op: BinaryOp,
        /// The operator token, for diagnostics.
        op_span: Span,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
    },
    /// `callee(args)`.
    Call {
        callee: Box<Expr>,
        args: Vec<Expr>,
    },
    /// `base.name`: a field access or a swizzle (told apart by the type
    /// checker).
    Field {
        base: Box<Expr>,
        name: Ident,
    },
    /// `base[index]`.
    Index {
        base: Box<Expr>,
        index: Box<Expr>,
    },
    /// An expression the parser could not build, or a literal the lexer
    /// already reported as malformed.
    Error,
}

/// `name: value` inside a descriptor literal.
#[derive(Clone, PartialEq, Debug)]
pub struct DescField {
    pub id: NodeId,
    pub span: Span,
    pub name: Ident,
    pub value: FieldValue,
}

/// The prefix operators.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum UnaryOp {
    /// `-`
    Neg,
    /// `!`
    Not,
}

impl UnaryOp {
    /// The operator as written.
    #[must_use]
    pub fn symbol(self) -> &'static str {
        match self {
            UnaryOp::Neg => "-",
            UnaryOp::Not => "!",
        }
    }
}

/// The binary operators.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Rem,
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
    And,
    Or,
}

impl BinaryOp {
    /// The operator as written.
    #[must_use]
    pub fn symbol(self) -> &'static str {
        match self {
            BinaryOp::Add => "+",
            BinaryOp::Sub => "-",
            BinaryOp::Mul => "*",
            BinaryOp::Div => "/",
            BinaryOp::Rem => "%",
            BinaryOp::Lt => "<",
            BinaryOp::Le => "<=",
            BinaryOp::Gt => ">",
            BinaryOp::Ge => ">=",
            BinaryOp::Eq => "==",
            BinaryOp::Ne => "!=",
            BinaryOp::And => "&&",
            BinaryOp::Or => "||",
        }
    }
}

impl_node!(
    Module,
    Item,
    ImportDecl,
    ConstDecl,
    FnDecl,
    Param,
    StructDecl,
    StructField,
    MaterialDecl,
    ParamDecl,
    StageFn,
    SceneDecl,
    PrefabDecl,
    EntityDecl,
    SceneObject,
    StateDecl,
    FieldInit,
    Bind,
    LifecycleFn,
    Handler,
    Type,
    ArrayLength,
    Block,
    LocalDecl,
    IfStmt,
    ForStmt,
    ReturnStmt,
    JumpStmt,
    AssignStmt,
    ExprStmt,
    Expr,
    DescField,
);

impl_node_for_enum!(MaterialMember {
    Param,
    Stage,
    Error
});
impl_node_for_enum!(SceneMember {
    Field,
    Const,
    State,
    Object,
    Entity,
    Lifecycle,
    Handler,
    Error
});
impl_node_for_enum!(EntityMember {
    Field,
    Const,
    State,
    Param,
    Entity,
    Lifecycle,
    Handler,
    Error
});
impl_node_for_enum!(FieldValue { Expr, Bind });
impl_node_for_enum!(Stmt {
    Let,
    Var,
    Const,
    If,
    For,
    Return,
    Break,
    Continue,
    Block,
    Assign,
    Expr,
    Error
});

impl Node for HandlerArg {
    fn id(&self) -> NodeId {
        match self {
            HandlerArg::Param(node) => node.id,
            HandlerArg::Filter(node) => node.id,
        }
    }
    fn span(&self) -> Span {
        match self {
            HandlerArg::Param(node) => node.span,
            HandlerArg::Filter(node) => node.span,
        }
    }
}
