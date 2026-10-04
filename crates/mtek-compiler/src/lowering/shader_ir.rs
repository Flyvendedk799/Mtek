//! The shader IR (`spec/compiler-architecture.md` section 7.1): a typed, SSA-free tree
//! from which [`crate::emit_wgsl::printer`] prints WGSL. No WGSL text is ever assembled
//! from templates of logic; every statement and expression of an emitted module is a node
//! here, and every node carries the Mtek [`Span`] it originates from (the material
//! declaration for generated code).
//!
//! It covers the v0.1 GPU subset (decision 0041 extends the M1 subset of decision 0029):
//!
//! - [`ShaderType`] covers every WGSL type of `spec/gpu-layout.md` section 3 (a `bool`
//!   stored in a struct, array or block is the `u32` scalar; padded array elements are
//!   the `MtekPad16_*` wrapper structs);
//! - [`GlobalKind`] gains texture and sampler globals in M4;
//! - [`Statement`]: `let`, `var`, assignment, `if`, counted `for`, `break`,
//!   `continue`, blocks, call statements and `return`;
//! - [`ExprKind`]: literals, locals, globals, field, swizzle and index access, unary
//!   and binary operators, constructors (also the scalar conversions `f32(x)`),
//!   `bitcast`, `bool32` encode/decode, built-in and user function calls.
//!
//! Names: a [`Name`] keeps the Mtek view of an identifier (generated, or a user name of a
//! kind) and the printer mangles it (`spec/compiler-architecture.md` section 7.2):
//! generated names get the reserved `mtek_` prefix, user names become `u_<kind>_<name>`.
//! Struct names and struct member names come from the layout engine's naming rules
//! (`spec/gpu-layout.md` sections 3 and 5) and are stored as printed.

use std::collections::BTreeSet;

use crate::emit_wgsl::blocks::{member_wgsl_name, padded_element_name, wgsl_struct_name};
use crate::layout::{LayoutMember, LayoutNode, LayoutRecord, ScalarKind};
use crate::source::Span;

/// The alignment attribute of struct- and array-typed block members
/// (`spec/gpu-layout.md` section 4.4 rule 1).
const UNIFORM_ALIGN: u32 = 16;

/// A WGSL scalar type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Scalar {
    Bool,
    I32,
    U32,
    F32,
}

/// The number of components of a vector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum VectorSize {
    Two,
    Three,
    Four,
}

impl VectorSize {
    /// The component count, 2 to 4.
    pub fn count(self) -> u32 {
        match self {
            VectorSize::Two => 2,
            VectorSize::Three => 3,
            VectorSize::Four => 4,
        }
    }

    /// The size with `count` components, if `count` is 2, 3 or 4.
    pub fn from_count(count: u32) -> Option<VectorSize> {
        match count {
            2 => Some(VectorSize::Two),
            3 => Some(VectorSize::Three),
            4 => Some(VectorSize::Four),
            _ => None,
        }
    }
}

/// A WGSL type, exactly as `spec/gpu-layout.md` section 3 maps Mtek types (`color` and
/// `quat` are `vec4<f32>`, `mat4` is `mat4x4<f32>`, a stored `bool` is `u32`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ShaderType {
    Scalar(Scalar),
    Vector {
        size: VectorSize,
        scalar: Scalar,
    },
    /// `mat4x4<f32>`, column-major.
    Mat4,
    /// A struct declared in the module, by its WGSL name.
    Struct(String),
    /// `array<element, length>`.
    Array {
        element: Box<ShaderType>,
        length: u32,
    },
}

impl ShaderType {
    pub const BOOL: ShaderType = ShaderType::Scalar(Scalar::Bool);
    pub const I32: ShaderType = ShaderType::Scalar(Scalar::I32);
    pub const F32: ShaderType = ShaderType::Scalar(Scalar::F32);
    pub const U32: ShaderType = ShaderType::Scalar(Scalar::U32);
    pub const VEC2: ShaderType = ShaderType::Vector {
        size: VectorSize::Two,
        scalar: Scalar::F32,
    };
    pub const VEC3: ShaderType = ShaderType::Vector {
        size: VectorSize::Three,
        scalar: Scalar::F32,
    };
    pub const VEC4: ShaderType = ShaderType::Vector {
        size: VectorSize::Four,
        scalar: Scalar::F32,
    };

    /// A struct type by WGSL name.
    pub fn named(name: impl Into<String>) -> ShaderType {
        ShaderType::Struct(name.into())
    }

    /// The type of a layout node as it appears in a struct member or an array element:
    /// a stored bool is `u32`, a padded array element is its `MtekPad16_*` wrapper.
    pub fn from_layout_node(node: &LayoutNode) -> ShaderType {
        match node {
            LayoutNode::Scalar { scalar, .. } => ShaderType::Scalar(stored_scalar(*scalar)),
            LayoutNode::Vector {
                components, scalar, ..
            } => ShaderType::Vector {
                size: VectorSize::from_count(*components).unwrap_or(VectorSize::Four),
                scalar: stored_scalar(*scalar),
            },
            LayoutNode::Matrix { .. } => ShaderType::Mat4,
            LayoutNode::Struct { name, .. } => ShaderType::Struct(wgsl_struct_name(name)),
            LayoutNode::Array {
                length,
                padded,
                element,
                ..
            } => {
                let element = if *padded {
                    ShaderType::Struct(padded_element_name(element))
                } else {
                    ShaderType::from_layout_node(element)
                };
                ShaderType::Array {
                    element: Box::new(element),
                    length: *length,
                }
            }
        }
    }

    /// The type of a swizzle of `self` with `count` components, if `self` is a vector.
    pub fn swizzled(&self, count: usize) -> Option<ShaderType> {
        let ShaderType::Vector { scalar, .. } = self else {
            return None;
        };
        if count == 1 {
            return Some(ShaderType::Scalar(*scalar));
        }
        let size = VectorSize::from_count(u32::try_from(count).ok()?)?;
        Some(ShaderType::Vector {
            size,
            scalar: *scalar,
        })
    }
}

/// The WGSL scalar a block leaf is stored as (`bool32` is `u32`).
fn stored_scalar(kind: ScalarKind) -> Scalar {
    match kind {
        ScalarKind::F32 => Scalar::F32,
        ScalarKind::I32 => Scalar::I32,
        ScalarKind::U32 | ScalarKind::Bool32 => Scalar::U32,
    }
}

/// The kind of a user identifier; the printer emits `u_<kind>_<name>`
/// (`spec/compiler-architecture.md` section 7.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum UserNameKind {
    /// A user function: `u_fn_<name>`.
    Function,
    /// A local (`let`/`var`): `u_l_<name>`.
    Local,
    /// A function or stage parameter: `u_p_<name>`.
    Param,
}

impl UserNameKind {
    /// The `<kind>` part of the mangled name.
    pub fn tag(self) -> &'static str {
        match self {
            UserNameKind::Function => "fn",
            UserNameKind::Local => "l",
            UserNameKind::Param => "p",
        }
    }
}

/// An identifier of a function, parameter, local or global, before mangling.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Name {
    /// A compiler-generated identifier. The stored text is the part after the reserved
    /// prefix: `Generated("world")` prints `mtek_world`.
    Generated(String),
    /// A name from Mtek source: printed `u_<kind>_<name>`.
    User { kind: UserNameKind, name: String },
}

impl Name {
    /// A generated name; `suffix` is printed after `mtek_`.
    pub fn generated(suffix: impl Into<String>) -> Name {
        Name::Generated(suffix.into())
    }

    /// A user name of `kind`.
    pub fn user(kind: UserNameKind, name: impl Into<String>) -> Name {
        Name::User {
            kind,
            name: name.into(),
        }
    }
}

/// A built-in input or output value of a stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum BuiltinValue {
    /// `@builtin(position)`.
    Position,
}

/// How a stage parameter, result or IO struct member is bound.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum IoBinding {
    Builtin(BuiltinValue),
    /// `@location(n)`: a vertex attribute, a varying or a colour target.
    Location(u32),
}

/// One member of a struct declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StructMember {
    /// The member name as printed (`u_tint`, `view_proj`, `value`, `clip_position`).
    pub name: String,
    pub ty: ShaderType,
    /// `@align(n)`, for block members (`spec/gpu-layout.md` section 4.4).
    pub align: Option<u32>,
    /// `@size(n)`, for block members (`spec/gpu-layout.md` section 4.4).
    pub size: Option<u32>,
    /// `@builtin(..)` / `@location(..)`, for members of stage IO structs (varyings).
    pub binding: Option<IoBinding>,
    pub span: Span,
}

/// `struct Name { members }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StructDecl {
    /// The WGSL struct name (`MtekParams_<hash8>_<Name>`, `MtekFrame`, `S_<Name>`, ...).
    pub name: String,
    pub members: Vec<StructMember>,
    pub span: Span,
}

/// What a module-scope variable holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GlobalKind {
    /// `@group(g) @binding(b) var<uniform> name: ty;`
    Uniform {
        group: u32,
        binding: u32,
        ty: ShaderType,
    },
}

/// A module-scope variable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalDecl {
    pub name: Name,
    pub kind: GlobalKind,
    pub span: Span,
}

impl GlobalDecl {
    /// The type of the variable.
    pub fn ty(&self) -> &ShaderType {
        match &self.kind {
            GlobalKind::Uniform { ty, .. } => ty,
        }
    }
}

/// The pipeline stage of an entry point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ShaderStage {
    Vertex,
    Fragment,
}

/// A function parameter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionParam {
    pub name: Name,
    pub ty: ShaderType,
    /// Set on entry-point parameters (vertex attributes).
    pub binding: Option<IoBinding>,
    pub span: Span,
}

/// A function result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionResult {
    pub ty: ShaderType,
    /// Set on an entry point that returns a bare value (`@location(0)` colour target).
    pub binding: Option<IoBinding>,
}

/// A function: a helper, the fragment body or an entry point.
#[derive(Debug, Clone, PartialEq)]
pub struct Function {
    pub name: Name,
    /// `Some` for an entry point.
    pub stage: Option<ShaderStage>,
    pub params: Vec<FunctionParam>,
    pub result: Option<FunctionResult>,
    pub body: Vec<Statement>,
    /// The Mtek symbol the function's code belongs to, recorded in every span-map entry
    /// of the function (`std/materials.mtek::Unlit.fragment`, `src/main.mtek::Pulse`).
    pub symbol: String,
    pub span: Span,
}

/// A statement. A simple statement prints as one line; `if`, `for` and blocks print
/// their header and closing brace on lines of their own, with the nested statements
/// indented between them.
#[derive(Debug, Clone, PartialEq)]
pub enum Statement {
    /// `let name = value;`
    Let { name: Name, value: Expr, span: Span },
    /// `var name = value;`
    Var { name: Name, value: Expr, span: Span },
    /// `target = value;`; `target` is a reference: a `var` local or one component of one.
    Assign {
        target: Expr,
        value: Expr,
        span: Span,
    },
    /// `if c0 { .. } else if c1 { .. } else { .. }`.
    If {
        branches: Vec<(Expr, Vec<Statement>)>,
        otherwise: Option<Vec<Statement>>,
        span: Span,
    },
    /// `for (var name = start; name < end; name++) { body }`: a counted loop over the
    /// integer range `start..end` (`spec/compiler-architecture.md` section 7.1).
    For {
        name: Name,
        start: Expr,
        end: Expr,
        body: Vec<Statement>,
        span: Span,
    },
    /// `break;`
    Break { span: Span },
    /// `continue;`
    Continue { span: Span },
    /// `{ body }`.
    Block { body: Vec<Statement>, span: Span },
    /// `function(args);`: a call of a function without a result.
    Call {
        function: Name,
        args: Vec<Expr>,
        span: Span,
    },
    /// `_ = value;`: a value computed and discarded (a call with a result as a
    /// statement; WGSL's built-in functions must not be called as statements).
    Discard { value: Expr, span: Span },
    /// `return value;` or `return;`
    Return { value: Option<Expr>, span: Span },
}

impl Statement {
    /// The Mtek span of the statement.
    pub fn span(&self) -> Span {
        match self {
            Statement::Let { span, .. }
            | Statement::Var { span, .. }
            | Statement::Assign { span, .. }
            | Statement::If { span, .. }
            | Statement::For { span, .. }
            | Statement::Break { span }
            | Statement::Continue { span }
            | Statement::Block { span, .. }
            | Statement::Call { span, .. }
            | Statement::Discard { span, .. }
            | Statement::Return { span, .. } => *span,
        }
    }
}

/// A finite `f32`: WGSL has no literal for infinities or NaN.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct FiniteF32(f32);

impl FiniteF32 {
    pub const ZERO: FiniteF32 = FiniteF32(0.0);
    pub const ONE: FiniteF32 = FiniteF32(1.0);

    /// `Some` if `value` is finite.
    pub fn new(value: f32) -> Option<FiniteF32> {
        value.is_finite().then_some(FiniteF32(value))
    }

    /// The value.
    pub fn get(self) -> f32 {
        self.0
    }
}

/// A typed literal.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Literal {
    Bool(bool),
    I32(i32),
    U32(u32),
    F32(FiniteF32),
}

impl Literal {
    /// The type of the literal.
    pub fn ty(self) -> ShaderType {
        ShaderType::Scalar(match self {
            Literal::Bool(_) => Scalar::Bool,
            Literal::I32(_) => Scalar::I32,
            Literal::U32(_) => Scalar::U32,
            Literal::F32(_) => Scalar::F32,
        })
    }
}

/// A vector component of a swizzle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Component {
    X,
    Y,
    Z,
    W,
}

impl Component {
    /// The WGSL letter (`x`, `y`, `z`, `w`).
    pub fn letter(self) -> char {
        match self {
            Component::X => 'x',
            Component::Y => 'y',
            Component::Z => 'z',
            Component::W => 'w',
        }
    }
}

/// A binary operator. WGSL's typing rules apply (for example `mat4x4<f32> * vec4<f32>`
/// is a `vec4<f32>`); WGSL's integer `/` and `%` already implement the Mtek rules
/// (`spec/language.md` section 6.3), and so does its `f32` `%` (truncated remainder).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum BinaryOp {
    /// `+`
    Add,
    /// `-`
    Subtract,
    /// `*`: component-wise, scalar-vector or matrix-vector multiplication.
    Multiply,
    /// `/`
    Divide,
    /// `%`
    Remainder,
    /// `<`
    Less,
    /// `<=`
    LessEqual,
    /// `>`
    Greater,
    /// `>=`
    GreaterEqual,
    /// `==`
    Equal,
    /// `!=`
    NotEqual,
    /// `&&`
    LogicalAnd,
    /// `||`
    LogicalOr,
}

impl BinaryOp {
    /// The operator of the Mtek spelling `op` (`+`, `<=`, `&&`, ...).
    pub fn from_mtek(op: &str) -> Option<BinaryOp> {
        Some(match op {
            "+" => BinaryOp::Add,
            "-" => BinaryOp::Subtract,
            "*" => BinaryOp::Multiply,
            "/" => BinaryOp::Divide,
            "%" => BinaryOp::Remainder,
            "<" => BinaryOp::Less,
            "<=" => BinaryOp::LessEqual,
            ">" => BinaryOp::Greater,
            ">=" => BinaryOp::GreaterEqual,
            "==" => BinaryOp::Equal,
            "!=" => BinaryOp::NotEqual,
            "&&" => BinaryOp::LogicalAnd,
            "||" => BinaryOp::LogicalOr,
            _ => return None,
        })
    }

    /// The WGSL spelling.
    pub fn text(self) -> &'static str {
        match self {
            BinaryOp::Add => "+",
            BinaryOp::Subtract => "-",
            BinaryOp::Multiply => "*",
            BinaryOp::Divide => "/",
            BinaryOp::Remainder => "%",
            BinaryOp::Less => "<",
            BinaryOp::LessEqual => "<=",
            BinaryOp::Greater => ">",
            BinaryOp::GreaterEqual => ">=",
            BinaryOp::Equal => "==",
            BinaryOp::NotEqual => "!=",
            BinaryOp::LogicalAnd => "&&",
            BinaryOp::LogicalOr => "||",
        }
    }
}

/// A unary operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum UnaryOp {
    /// `-x` (`f32`, `i32`, vectors; the `i32` minimum negates to itself, as in Mtek).
    Negate,
    /// `!x` (`bool`).
    Not,
}

impl UnaryOp {
    /// The WGSL spelling.
    pub fn text(self) -> &'static str {
        match self {
            UnaryOp::Negate => "-",
            UnaryOp::Not => "!",
        }
    }
}

/// A WGSL built-in function. The Mtek intrinsics of `spec/stdlib.md` section 6 that
/// WGSL implements with the same meaning map one to one; the others (quaternions,
/// `color.srgb`, the `mat4` constructors) are generated helper functions
/// ([`crate::lowering::shader`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Intrinsic {
    Abs,
    Acos,
    Asin,
    Atan,
    Atan2,
    Ceil,
    Clamp,
    Cos,
    Cross,
    Degrees,
    Distance,
    Dot,
    Exp,
    Exp2,
    Floor,
    Fract,
    InverseSqrt,
    Length,
    Log,
    Log2,
    Max,
    Min,
    Mix,
    Normalize,
    Pow,
    Radians,
    Reflect,
    Round,
    Saturate,
    /// `select(f, t, cond)`.
    Select,
    Sign,
    Sin,
    Smoothstep,
    Sqrt,
    Step,
    Tan,
    Transpose,
    Trunc,
}

impl Intrinsic {
    /// Every intrinsic, for tests and lookups.
    pub const ALL: [Intrinsic; 38] = [
        Intrinsic::Abs,
        Intrinsic::Acos,
        Intrinsic::Asin,
        Intrinsic::Atan,
        Intrinsic::Atan2,
        Intrinsic::Ceil,
        Intrinsic::Clamp,
        Intrinsic::Cos,
        Intrinsic::Cross,
        Intrinsic::Degrees,
        Intrinsic::Distance,
        Intrinsic::Dot,
        Intrinsic::Exp,
        Intrinsic::Exp2,
        Intrinsic::Floor,
        Intrinsic::Fract,
        Intrinsic::InverseSqrt,
        Intrinsic::Length,
        Intrinsic::Log,
        Intrinsic::Log2,
        Intrinsic::Max,
        Intrinsic::Min,
        Intrinsic::Mix,
        Intrinsic::Normalize,
        Intrinsic::Pow,
        Intrinsic::Radians,
        Intrinsic::Reflect,
        Intrinsic::Round,
        Intrinsic::Saturate,
        Intrinsic::Select,
        Intrinsic::Sign,
        Intrinsic::Sin,
        Intrinsic::Smoothstep,
        Intrinsic::Sqrt,
        Intrinsic::Step,
        Intrinsic::Tan,
        Intrinsic::Transpose,
        Intrinsic::Trunc,
    ];

    /// The WGSL function name.
    pub fn wgsl_name(self) -> &'static str {
        match self {
            Intrinsic::Abs => "abs",
            Intrinsic::Acos => "acos",
            Intrinsic::Asin => "asin",
            Intrinsic::Atan => "atan",
            Intrinsic::Atan2 => "atan2",
            Intrinsic::Ceil => "ceil",
            Intrinsic::Clamp => "clamp",
            Intrinsic::Cos => "cos",
            Intrinsic::Cross => "cross",
            Intrinsic::Degrees => "degrees",
            Intrinsic::Distance => "distance",
            Intrinsic::Dot => "dot",
            Intrinsic::Exp => "exp",
            Intrinsic::Exp2 => "exp2",
            Intrinsic::Floor => "floor",
            Intrinsic::Fract => "fract",
            Intrinsic::InverseSqrt => "inverseSqrt",
            Intrinsic::Length => "length",
            Intrinsic::Log => "log",
            Intrinsic::Log2 => "log2",
            Intrinsic::Max => "max",
            Intrinsic::Min => "min",
            Intrinsic::Mix => "mix",
            Intrinsic::Normalize => "normalize",
            Intrinsic::Pow => "pow",
            Intrinsic::Radians => "radians",
            Intrinsic::Reflect => "reflect",
            Intrinsic::Round => "round",
            Intrinsic::Saturate => "saturate",
            Intrinsic::Select => "select",
            Intrinsic::Sign => "sign",
            Intrinsic::Sin => "sin",
            Intrinsic::Smoothstep => "smoothstep",
            Intrinsic::Sqrt => "sqrt",
            Intrinsic::Step => "step",
            Intrinsic::Tan => "tan",
            Intrinsic::Transpose => "transpose",
            Intrinsic::Trunc => "trunc",
        }
    }

    /// The intrinsic implementing the Mtek built-in function `name` (`inverse_sqrt`),
    /// if WGSL has one with the same meaning.
    pub fn from_mtek(name: &str) -> Option<Intrinsic> {
        Some(match name {
            "abs" => Intrinsic::Abs,
            "acos" => Intrinsic::Acos,
            "asin" => Intrinsic::Asin,
            "atan" => Intrinsic::Atan,
            "atan2" => Intrinsic::Atan2,
            "ceil" => Intrinsic::Ceil,
            "clamp" => Intrinsic::Clamp,
            "cos" => Intrinsic::Cos,
            "cross" => Intrinsic::Cross,
            "degrees" => Intrinsic::Degrees,
            "distance" => Intrinsic::Distance,
            "dot" => Intrinsic::Dot,
            "exp" => Intrinsic::Exp,
            "exp2" => Intrinsic::Exp2,
            "floor" => Intrinsic::Floor,
            "fract" => Intrinsic::Fract,
            "inverse_sqrt" => Intrinsic::InverseSqrt,
            "length" => Intrinsic::Length,
            "log" => Intrinsic::Log,
            "log2" => Intrinsic::Log2,
            "max" => Intrinsic::Max,
            "min" => Intrinsic::Min,
            "mix" => Intrinsic::Mix,
            "normalize" => Intrinsic::Normalize,
            "pow" => Intrinsic::Pow,
            "radians" => Intrinsic::Radians,
            "reflect" => Intrinsic::Reflect,
            "round" => Intrinsic::Round,
            "saturate" => Intrinsic::Saturate,
            "sign" => Intrinsic::Sign,
            "sin" => Intrinsic::Sin,
            "smoothstep" => Intrinsic::Smoothstep,
            "sqrt" => Intrinsic::Sqrt,
            "step" => Intrinsic::Step,
            "tan" => Intrinsic::Tan,
            "transpose" => Intrinsic::Transpose,
            "trunc" => Intrinsic::Trunc,
            _ => return None,
        })
    }
}

/// A typed expression.
#[derive(Debug, Clone, PartialEq)]
pub struct Expr {
    pub kind: ExprKind,
    pub ty: ShaderType,
    pub span: Span,
}

/// The kinds of [`Expr`].
#[derive(Debug, Clone, PartialEq)]
pub enum ExprKind {
    Literal(Literal),
    /// A `let` local or a function parameter.
    Local(Name),
    /// A module-scope variable.
    Global(Name),
    /// `base.member`; `member` is the member name as printed.
    Field {
        base: Box<Expr>,
        member: String,
    },
    /// `base.xyz`.
    Swizzle {
        base: Box<Expr>,
        components: Vec<Component>,
    },
    /// `T(args)` where `T` is the expression's type.
    Construct {
        args: Vec<Expr>,
    },
    /// `left op right`.
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    /// `op operand`.
    Unary {
        op: UnaryOp,
        operand: Box<Expr>,
    },
    /// `base[index]`: an array element or a matrix column. The lowering clamps every
    /// index that is not a constant (`spec/language.md` section 5.6).
    Index {
        base: Box<Expr>,
        index: Box<Expr>,
    },
    /// `bitcast<T>(arg)` where `T` is the expression's type (`i32` <-> `u32`).
    Bitcast {
        arg: Box<Expr>,
    },
    /// `select(0u, 1u, value)`: a `bool` stored as `u32` (`spec/gpu-layout.md` section 3).
    Bool32Encode {
        value: Box<Expr>,
    },
    /// `(value != 0u)`: a stored `u32` read as `bool`.
    Bool32Decode {
        value: Box<Expr>,
    },
    /// A built-in function call.
    Intrinsic {
        function: Intrinsic,
        args: Vec<Expr>,
    },
    /// A call of a function of the module.
    Call {
        function: Name,
        args: Vec<Expr>,
    },
}

impl Expr {
    /// A literal.
    pub fn literal(literal: Literal, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Literal(literal),
            ty: literal.ty(),
            span,
        }
    }

    /// An `f32` literal.
    pub fn f32(value: FiniteF32, span: Span) -> Expr {
        Expr::literal(Literal::F32(value), span)
    }

    /// A local or parameter of type `ty`.
    pub fn local(name: Name, ty: ShaderType, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Local(name),
            ty,
            span,
        }
    }

    /// A read of the module-scope variable `global`.
    pub fn global(global: &GlobalDecl, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Global(global.name.clone()),
            ty: global.ty().clone(),
            span,
        }
    }

    /// `self.member` of type `ty`.
    pub fn field(self, member: impl Into<String>, ty: ShaderType, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Field {
                base: Box::new(self),
                member: member.into(),
            },
            ty,
            span,
        }
    }

    /// `self.<components>`. The type follows from the base type; a swizzle of a
    /// non-vector keeps the base type (Naga rejects the module, which is then `E6100`).
    pub fn swizzle(self, components: &[Component], span: Span) -> Expr {
        let ty = self
            .ty
            .swizzled(components.len())
            .unwrap_or_else(|| self.ty.clone());
        Expr {
            kind: ExprKind::Swizzle {
                base: Box::new(self),
                components: components.to_vec(),
            },
            ty,
            span,
        }
    }

    /// `ty(args)`.
    pub fn construct(ty: ShaderType, args: Vec<Expr>, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Construct { args },
            ty,
            span,
        }
    }

    /// `left op right` of type `ty`.
    pub fn binary(op: BinaryOp, left: Expr, right: Expr, ty: ShaderType, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            },
            ty,
            span,
        }
    }

    /// `normalize(self)`, of the argument's type.
    pub fn normalize(self, span: Span) -> Expr {
        let ty = self.ty.clone();
        Expr {
            kind: ExprKind::Intrinsic {
                function: Intrinsic::Normalize,
                args: vec![self],
            },
            ty,
            span,
        }
    }

    /// A call of `function` returning `ty`.
    pub fn call(function: Name, args: Vec<Expr>, ty: ShaderType, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Call { function, args },
            ty,
            span,
        }
    }

    /// The built-in `function(args)` of type `ty`.
    pub fn intrinsic(function: Intrinsic, args: Vec<Expr>, ty: ShaderType, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Intrinsic { function, args },
            ty,
            span,
        }
    }

    /// `op self`, of the operand's type.
    pub fn unary(self, op: UnaryOp, span: Span) -> Expr {
        let ty = self.ty.clone();
        Expr {
            kind: ExprKind::Unary {
                op,
                operand: Box::new(self),
            },
            ty,
            span,
        }
    }

    /// `self[index]` of type `ty`.
    pub fn index(self, index: Expr, ty: ShaderType, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Index {
                base: Box::new(self),
                index: Box::new(index),
            },
            ty,
            span,
        }
    }

    /// `bitcast<ty>(self)`.
    pub fn bitcast(self, ty: ShaderType, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Bitcast {
                arg: Box::new(self),
            },
            ty,
            span,
        }
    }

    /// `select(0u, 1u, self)`: the stored form of a `bool`.
    pub fn bool32_encode(self, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Bool32Encode {
                value: Box::new(self),
            },
            ty: ShaderType::U32,
            span,
        }
    }

    /// `(self != 0u)`: a stored `bool` read as a value.
    pub fn bool32_decode(self, span: Span) -> Expr {
        Expr {
            kind: ExprKind::Bool32Decode {
                value: Box::new(self),
            },
            ty: ShaderType::BOOL,
            span,
        }
    }
}

/// A complete shader module: what the printer prints, in this order (structs, globals,
/// functions).
#[derive(Debug, Clone, PartialEq)]
pub struct ShaderModule {
    /// The material the module was generated for (`std/materials.mtek::Unlit`). It is the
    /// symbol of every span-map entry outside a function.
    pub symbol: String,
    /// The material declaration: the span of generated code and the fallback of the
    /// span map.
    pub span: Span,
    /// Struct declarations, each type declared before its first use.
    pub structs: Vec<StructDecl>,
    pub globals: Vec<GlobalDecl>,
    /// Functions, each declared before its first call (helpers, the fragment body, then
    /// the entry points).
    pub functions: Vec<Function>,
}

impl ShaderModule {
    /// An empty module for `symbol`, declared at `span`.
    pub fn new(symbol: impl Into<String>, span: Span) -> ShaderModule {
        ShaderModule {
            symbol: symbol.into(),
            span,
            structs: Vec::new(),
            globals: Vec::new(),
            functions: Vec::new(),
        }
    }

    /// Appends the struct declarations a block needs (see [`struct_decls_from_layout`]),
    /// skipping structs the module already declares (two blocks may share `MtekLight` or
    /// a padded-element wrapper).
    pub fn declare_block(&mut self, record: &LayoutRecord, span: Span) {
        for decl in struct_decls_from_layout(record, span) {
            if !self.structs.iter().any(|s| s.name == decl.name) {
                self.structs.push(decl);
            }
        }
    }
}

/// The struct declarations of a block in dependency order (inner types first, each once):
/// nested structs (`S_<Name>`, built-in `MtekLight`), padded element wrappers
/// (`MtekPad16_<elem>`) and finally the block struct (`record.wgsl_struct`), with the
/// `@align`/`@size` attributes of `spec/gpu-layout.md` section 4.4.
///
/// Nothing here computes an offset: `@size` is the difference of two offsets of the record
/// and `@align(16)` is placed on every struct- and array-typed member. The result prints
/// to exactly [`crate::emit_wgsl::emit_block_structs`] (a test proves it per fixture).
pub fn struct_decls_from_layout(record: &LayoutRecord, span: Span) -> Vec<StructDecl> {
    let mut collector = StructCollector {
        seen: BTreeSet::new(),
        ordered: Vec::new(),
        span,
    };
    collector.declare_struct(&record.wgsl_struct, &record.root);
    collector.ordered
}

struct StructCollector {
    seen: BTreeSet<String>,
    ordered: Vec<StructDecl>,
    span: Span,
}

impl StructCollector {
    fn declare_dependencies(&mut self, node: &LayoutNode) {
        match node {
            LayoutNode::Struct { name, .. } => self.declare_struct(&wgsl_struct_name(name), node),
            LayoutNode::Array {
                stride,
                padded,
                element,
                ..
            } => {
                self.declare_dependencies(element);
                if *padded {
                    self.declare_wrapper(element, *stride);
                }
            }
            LayoutNode::Scalar { .. } | LayoutNode::Vector { .. } | LayoutNode::Matrix { .. } => {}
        }
    }

    fn declare_wrapper(&mut self, element: &LayoutNode, stride: u32) {
        let name = padded_element_name(element);
        if !self.seen.insert(name.clone()) {
            return;
        }
        self.ordered.push(StructDecl {
            name,
            members: vec![StructMember {
                name: "value".to_owned(),
                ty: ShaderType::from_layout_node(element),
                align: None,
                size: Some(stride),
                binding: None,
                span: self.span,
            }],
            span: self.span,
        });
    }

    fn declare_struct(&mut self, name: &str, node: &LayoutNode) {
        let LayoutNode::Struct {
            name: mtek_name,
            members,
            ..
        } = node
        else {
            return;
        };
        if !self.seen.insert(name.to_owned()) {
            return;
        }
        for member in members {
            self.declare_dependencies(&member.node);
        }
        let members = members
            .iter()
            .enumerate()
            .map(|(index, member)| self.member(mtek_name, member, members.get(index + 1)))
            .collect();
        self.ordered.push(StructDecl {
            name: name.to_owned(),
            members,
            span: self.span,
        });
    }

    /// A block member with the attributes of section 4.4; `next` drives `@size`.
    fn member(
        &self,
        struct_name: &str,
        member: &LayoutMember,
        next: Option<&LayoutMember>,
    ) -> StructMember {
        let node = &member.node;
        let align = matches!(node, LayoutNode::Struct { .. } | LayoutNode::Array { .. })
            .then_some(UNIFORM_ALIGN);
        let size = next.and_then(|next| {
            let gap = next.node.offset().saturating_sub(node.offset());
            (gap > node.size()).then_some(gap)
        });
        StructMember {
            name: member_wgsl_name(struct_name, &member.name),
            ty: ShaderType::from_layout_node(node),
            align,
            size,
            binding: None,
            span: self.span,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{LayoutType, builtin_blocks, compute};
    use crate::source::FileId;

    fn span() -> Span {
        Span::new(FileId(0), 3, 9)
    }

    #[test]
    fn layout_nodes_map_to_the_wgsl_types_of_section_3() {
        let ty = LayoutType::new_struct(
            "T",
            vec![
                ("b".to_owned(), LayoutType::Bool),
                ("i".to_owned(), LayoutType::I32),
                ("c".to_owned(), LayoutType::Color),
                ("q".to_owned(), LayoutType::Quat),
                ("m".to_owned(), LayoutType::Mat4),
                ("v".to_owned(), LayoutType::Vec2),
                ("a".to_owned(), LayoutType::new_array(LayoutType::F32, 2)),
                ("s".to_owned(), LayoutType::new_array(LayoutType::Vec4, 2)),
            ],
        );
        let record = compute(&ty, "fixture:t", "MtekFixture_t").expect("valid layout");
        let LayoutNode::Struct { members, .. } = &record.root else {
            panic!("struct root");
        };
        let types: Vec<ShaderType> = members
            .iter()
            .map(|m| ShaderType::from_layout_node(&m.node))
            .collect();
        assert_eq!(
            types,
            vec![
                ShaderType::U32,
                ShaderType::Scalar(Scalar::I32),
                ShaderType::VEC4,
                ShaderType::VEC4,
                ShaderType::Mat4,
                ShaderType::VEC2,
                ShaderType::Array {
                    element: Box::new(ShaderType::named("MtekPad16_f32")),
                    length: 2
                },
                ShaderType::Array {
                    element: Box::new(ShaderType::VEC4),
                    length: 2
                },
            ]
        );
    }

    #[test]
    fn struct_declarations_come_inner_first_with_layout_attributes() {
        let frame = builtin_blocks()
            .into_iter()
            .find(|b| b.id == "builtin:frame")
            .expect("frame block");
        let record = compute(&frame.ty, frame.id, frame.wgsl_struct).expect("valid layout");
        let decls = struct_decls_from_layout(&record, span());
        let names: Vec<&str> = decls.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, ["MtekLight", "MtekFrame"]);
        let lights = decls[1].members.last().expect("lights member");
        assert_eq!(lights.name, "lights");
        assert_eq!(lights.align, Some(16));
        assert_eq!(lights.size, None);
        assert!(
            decls
                .iter()
                .flat_map(|d| d.members.iter().map(|m| m.span).chain([d.span]))
                .all(|s| s == span())
        );
    }

    #[test]
    fn declare_block_skips_structs_already_declared() {
        let mut module = ShaderModule::new("src/main.mtek::M", span());
        let frame = builtin_blocks()
            .into_iter()
            .find(|b| b.id == "builtin:frame")
            .expect("frame block");
        let record = compute(&frame.ty, frame.id, frame.wgsl_struct).expect("valid layout");
        module.declare_block(&record, span());
        module.declare_block(&record, span());
        assert_eq!(module.structs.len(), 2);
    }

    #[test]
    fn swizzles_and_constructors_are_typed() {
        let v = Expr::local(Name::generated("v"), ShaderType::VEC4, span());
        let xyz = v
            .clone()
            .swizzle(&[Component::X, Component::Y, Component::Z], span());
        assert_eq!(xyz.ty, ShaderType::VEC3);
        assert_eq!(
            v.clone().swizzle(&[Component::W], span()).ty,
            ShaderType::F32
        );
        assert_eq!(xyz.normalize(span()).ty, ShaderType::VEC3);
        let scalar = Expr::f32(FiniteF32::ONE, span());
        assert_eq!(
            scalar.clone().swizzle(&[Component::X], span()).ty,
            ShaderType::F32
        );
        assert_eq!(
            Expr::construct(ShaderType::VEC4, vec![scalar], span()).ty,
            ShaderType::VEC4
        );
    }

    #[test]
    fn non_finite_floats_have_no_literal() {
        assert!(FiniteF32::new(f32::NAN).is_none());
        assert!(FiniteF32::new(f32::INFINITY).is_none());
        assert_eq!(FiniteF32::new(0.5).map(FiniteF32::get), Some(0.5));
    }

    #[test]
    fn user_name_kinds_have_their_tags() {
        assert_eq!(UserNameKind::Function.tag(), "fn");
        assert_eq!(UserNameKind::Local.tag(), "l");
        assert_eq!(UserNameKind::Param.tag(), "p");
    }
}
