//! The generated WGSL helper library (`spec/compiler-architecture.md` section 7.3): Mtek
//! operations WGSL has no built-in for, as shader IR functions. Only the helpers a
//! module uses are emitted, dependencies first (the order of [`Helper`]).
//!
//! Each follows the operation order of the CPU (decisions 0026 item 6 and 0037 item 7),
//! so CPU and GPU compute the same sequence of binary32 operations wherever WGSL lets
//! them (a GPU may still contract `a * b + c` and its transcendental functions have
//! their own accuracy, `spec/language.md` section 6.4):
//!
//! - `mtek_quat_mul(a, b)`: the Hamilton product, `x = aw*bx + ax*bw + ay*bz - az*by`,
//!   ... summed left to right;
//! - `mtek_quat_rotate(q, v)`: `t = 2 * cross(q.xyz, v)`, `v + q.w * t + cross(q.xyz, t)`;
//! - `mtek_quat_axis_angle(axis, angle)`: the identity for a zero axis, else the axis
//!   divided by its largest component magnitude, then by its length, times `sin(angle *
//!   0.5)`, with `w = cos(angle * 0.5)`;
//! - `mtek_quat_euler(x, y, z)`: `(axis_angle(+Y, y) * axis_angle(+X, x)) *
//!   axis_angle(+Z, z)`;
//! - `mtek_mat4_translation(v)`, `mtek_mat4_scale(v)`, `mtek_mat4_rotation(q)` (the
//!   products `xx = x*x`, ..., `wz = w*z` and the columns of decision 0037 item 7);
//! - `mtek_color_srgb(rgb, a)` with `mtek_srgb_channel(c)`: `c / 12.92` for `c <=
//!   0.04045`, else `pow((c + 0.055) / 1.055, 2.4)` (decision 0024 item 6), alpha
//!   unchanged.
//!
//! - `mtek_mix_*(a, b, t)` = `a * (1.0 - t) + b * t`: WGSL bounds `mix` by this expression, but
//!   the backends evaluate `x + t * (y - x)`, whose `y - x` overflows near the largest
//!   floats (decision 0047);
//! - `mtek_normalize_*(v)` = `v / sqrt(v.x*v.x + v.y*v.y + ...)` summed left to right, the
//!   zero vector when that length is 0 (the CPU rule), not the built-in's `v * inverseSqrt(...)`;
//!
//! WGSL's own `/` and `%` already implement the Mtek integer rules, its conversions
//! saturate like the CPU's (decision 0047), its `round` rounds half to even and it has `saturate`, so none of those needs a
//! helper. Helper code carries the material declaration's span.

use crate::lowering::shader_ir::{
    BinaryOp, Component, Expr, FiniteF32, Function, FunctionParam, FunctionResult, Intrinsic, Name,
    ShaderType, Statement,
};
use crate::source::Span;

/// A generated helper function. The declaration order is the emission order: every
/// helper comes after the helpers it calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum Helper {
    SrgbChannel,
    ColorSrgb,
    QuatMul,
    QuatRotate,
    QuatAxisAngle,
    QuatEuler,
    Mat4Translation,
    Mat4Scale,
    Mat4Rotation,
    /// `mix` over `dim` components (1 = `f32`); `scalar_t`: the weight is an `f32` for a vector.
    Mix {
        dim: u8,
        scalar_t: bool,
    },
    /// `normalize` of a vector of `dim` (2 to 4) components.
    Normalize {
        dim: u8,
    },
}

/// The type of `dim` `f32` components: 1 is `f32`, 2 to 4 a vector.
fn float_type(dim: u8) -> ShaderType {
    match dim {
        2 => ShaderType::VEC2,
        3 => ShaderType::VEC3,
        4 => ShaderType::VEC4,
        _ => ShaderType::F32,
    }
}

/// The `dim` of a type of `float_type`, if it is one.
pub(super) fn float_dim(ty: &ShaderType) -> Option<u8> {
    [1, 2, 3, 4].into_iter().find(|dim| &float_type(*dim) == ty)
}

fn dim_name(dim: u8) -> String {
    if dim == 1 {
        "f32".to_owned()
    } else {
        format!("vec{dim}")
    }
}

impl Helper {
    /// Every helper, in emission order.
    #[cfg(test)]
    pub fn all() -> Vec<Helper> {
        let mut all = vec![
            Helper::SrgbChannel,
            Helper::ColorSrgb,
            Helper::QuatMul,
            Helper::QuatRotate,
            Helper::QuatAxisAngle,
            Helper::QuatEuler,
            Helper::Mat4Translation,
            Helper::Mat4Scale,
            Helper::Mat4Rotation,
        ];
        for dim in 1..=4 {
            all.push(Helper::Mix {
                dim,
                scalar_t: false,
            });
            if dim > 1 {
                all.push(Helper::Mix {
                    dim,
                    scalar_t: true,
                });
            }
        }
        all.extend((2..=4).map(|dim| Helper::Normalize { dim }));
        all
    }

    /// The generated name (printed with the reserved `mtek_` prefix).
    pub fn name(self) -> Name {
        Name::generated(match self {
            Helper::SrgbChannel => "srgb_channel".to_owned(),
            Helper::ColorSrgb => "color_srgb".to_owned(),
            Helper::QuatMul => "quat_mul".to_owned(),
            Helper::QuatRotate => "quat_rotate".to_owned(),
            Helper::QuatAxisAngle => "quat_axis_angle".to_owned(),
            Helper::QuatEuler => "quat_euler".to_owned(),
            Helper::Mat4Translation => "mat4_translation".to_owned(),
            Helper::Mat4Scale => "mat4_scale".to_owned(),
            Helper::Mat4Rotation => "mat4_rotation".to_owned(),
            Helper::Mix {
                dim,
                scalar_t: false,
            } => format!("mix_{}", dim_name(dim)),
            Helper::Mix {
                dim,
                scalar_t: true,
            } => format!("mix_{}_f32", dim_name(dim)),
            Helper::Normalize { dim } => format!("normalize_{}", dim_name(dim)),
        })
    }

    /// The helpers this one calls.
    pub fn dependencies(self) -> &'static [Helper] {
        match self {
            Helper::ColorSrgb => &[Helper::SrgbChannel],
            Helper::QuatEuler => &[Helper::QuatMul, Helper::QuatAxisAngle],
            _ => &[],
        }
    }

    /// The result type.
    pub fn result(self) -> ShaderType {
        match self {
            Helper::SrgbChannel => ShaderType::F32,
            Helper::Mix { dim, .. } | Helper::Normalize { dim } => float_type(dim),
            Helper::QuatRotate => ShaderType::VEC3,
            Helper::Mat4Translation | Helper::Mat4Scale | Helper::Mat4Rotation => ShaderType::Mat4,
            Helper::ColorSrgb | Helper::QuatMul | Helper::QuatAxisAngle | Helper::QuatEuler => {
                ShaderType::VEC4
            }
        }
    }

    /// A call of the helper.
    pub fn call(self, args: Vec<Expr>, span: Span) -> Expr {
        Expr::call(self.name(), args, self.result(), span)
    }

    /// The helper's function; `span` and `symbol` are the material's.
    pub fn function(self, span: Span, symbol: &str) -> Function {
        let b = Builder { span };
        let (params, body): (Vec<(&str, ShaderType)>, Vec<Statement>) = match self {
            Helper::SrgbChannel => (vec![("c", ShaderType::F32)], b.srgb_channel()),
            Helper::ColorSrgb => (
                vec![("rgb", ShaderType::VEC3), ("a", ShaderType::F32)],
                b.color_srgb(),
            ),
            Helper::QuatMul => (
                vec![("a", ShaderType::VEC4), ("b", ShaderType::VEC4)],
                b.quat_mul(),
            ),
            Helper::QuatRotate => (
                vec![("q", ShaderType::VEC4), ("v", ShaderType::VEC3)],
                b.quat_rotate(),
            ),
            Helper::QuatAxisAngle => (
                vec![("axis", ShaderType::VEC3), ("angle", ShaderType::F32)],
                b.quat_axis_angle(),
            ),
            Helper::QuatEuler => (
                vec![
                    ("x", ShaderType::F32),
                    ("y", ShaderType::F32),
                    ("z", ShaderType::F32),
                ],
                b.quat_euler(),
            ),
            Helper::Mat4Translation => (vec![("v", ShaderType::VEC3)], b.mat4_translation()),
            Helper::Mat4Scale => (vec![("v", ShaderType::VEC3)], b.mat4_scale()),
            Helper::Mat4Rotation => (vec![("q", ShaderType::VEC4)], b.mat4_rotation()),
            Helper::Mix { dim, scalar_t } => (
                vec![
                    ("a", float_type(dim)),
                    ("b", float_type(dim)),
                    (
                        "t",
                        if scalar_t {
                            ShaderType::F32
                        } else {
                            float_type(dim)
                        },
                    ),
                ],
                b.mix(
                    dim,
                    if scalar_t {
                        ShaderType::F32
                    } else {
                        float_type(dim)
                    },
                ),
            ),
            Helper::Normalize { dim } => (vec![("v", float_type(dim))], b.normalize(dim)),
        };
        Function {
            name: self.name(),
            stage: None,
            params: params
                .into_iter()
                .map(|(name, ty)| FunctionParam {
                    name: Name::generated(name),
                    ty,
                    binding: None,
                    span,
                })
                .collect(),
            result: Some(FunctionResult {
                ty: self.result(),
                binding: None,
            }),
            body,
            symbol: symbol.to_owned(),
            span,
        }
    }
}

/// Builds helper bodies; every node gets `span`.
struct Builder {
    span: Span,
}

impl Builder {
    fn f(&self, value: f32) -> Expr {
        Expr::f32(FiniteF32::new(value).unwrap_or(FiniteF32::ZERO), self.span)
    }

    fn local(&self, name: &str, ty: ShaderType) -> Expr {
        Expr::local(Name::generated(name), ty, self.span)
    }

    fn scalar(&self, name: &str) -> Expr {
        self.local(name, ShaderType::F32)
    }

    fn component(&self, base: Expr, component: Component) -> Expr {
        base.swizzle(&[component], self.span)
    }

    fn xyz(&self, base: Expr) -> Expr {
        base.swizzle(&[Component::X, Component::Y, Component::Z], self.span)
    }

    fn bin(&self, op: BinaryOp, left: Expr, right: Expr) -> Expr {
        let ty = if matches!(
            op,
            BinaryOp::Less
                | BinaryOp::LessEqual
                | BinaryOp::Greater
                | BinaryOp::GreaterEqual
                | BinaryOp::Equal
                | BinaryOp::NotEqual
        ) {
            ShaderType::BOOL
        } else if left.ty == ShaderType::F32 {
            right.ty.clone()
        } else {
            left.ty.clone()
        };
        Expr::binary(op, left, right, ty, self.span)
    }

    fn add(&self, left: Expr, right: Expr) -> Expr {
        self.bin(BinaryOp::Add, left, right)
    }

    fn sub(&self, left: Expr, right: Expr) -> Expr {
        self.bin(BinaryOp::Subtract, left, right)
    }

    fn mul(&self, left: Expr, right: Expr) -> Expr {
        self.bin(BinaryOp::Multiply, left, right)
    }

    fn div(&self, left: Expr, right: Expr) -> Expr {
        self.bin(BinaryOp::Divide, left, right)
    }

    fn call(&self, function: Intrinsic, args: Vec<Expr>, ty: ShaderType) -> Expr {
        Expr::intrinsic(function, args, ty, self.span)
    }

    fn vec4(&self, args: Vec<Expr>) -> Expr {
        Expr::construct(ShaderType::VEC4, args, self.span)
    }

    fn vec3(&self, args: Vec<Expr>) -> Expr {
        Expr::construct(ShaderType::VEC3, args, self.span)
    }

    fn vec4_of(&self, values: [f32; 4]) -> Expr {
        self.vec4(values.iter().map(|v| self.f(*v)).collect())
    }

    fn let_(&self, name: &str, value: Expr) -> Statement {
        Statement::Let {
            name: Name::generated(name),
            value,
            span: self.span,
        }
    }

    fn ret(&self, value: Expr) -> Statement {
        Statement::Return {
            value: Some(value),
            span: self.span,
        }
    }

    fn srgb_channel(&self) -> Vec<Statement> {
        let c = || self.scalar("c");
        vec![
            Statement::If {
                branches: vec![(
                    self.bin(BinaryOp::LessEqual, c(), self.f(0.04045)),
                    vec![self.ret(self.div(c(), self.f(12.92)))],
                )],
                otherwise: None,
                span: self.span,
            },
            self.ret(self.call(
                Intrinsic::Pow,
                vec![
                    self.div(self.add(c(), self.f(0.055)), self.f(1.055)),
                    self.f(2.4),
                ],
                ShaderType::F32,
            )),
        ]
    }

    fn color_srgb(&self) -> Vec<Statement> {
        let rgb = || self.local("rgb", ShaderType::VEC3);
        let channel =
            |c: Component| Helper::SrgbChannel.call(vec![self.component(rgb(), c)], self.span);
        vec![self.ret(self.vec4(vec![
            channel(Component::X),
            channel(Component::Y),
            channel(Component::Z),
            self.scalar("a"),
        ]))]
    }

    fn quat_mul(&self) -> Vec<Statement> {
        let a = |c| self.component(self.local("a", ShaderType::VEC4), c);
        let b = |c| self.component(self.local("b", ShaderType::VEC4), c);
        let p = |x, y| self.mul(a(x), b(y));
        use Component::{W, X, Y, Z};
        vec![self.ret(self.vec4(vec![
            self.sub(self.add(self.add(p(W, X), p(X, W)), p(Y, Z)), p(Z, Y)),
            self.add(self.add(self.sub(p(W, Y), p(X, Z)), p(Y, W)), p(Z, X)),
            self.add(self.sub(self.add(p(W, Z), p(X, Y)), p(Y, X)), p(Z, W)),
            self.sub(self.sub(self.sub(p(W, W), p(X, X)), p(Y, Y)), p(Z, Z)),
        ]))]
    }

    fn quat_rotate(&self) -> Vec<Statement> {
        let q = || self.local("q", ShaderType::VEC4);
        let v = || self.local("v", ShaderType::VEC3);
        let t = || self.local("t", ShaderType::VEC3);
        vec![
            self.let_(
                "t",
                self.mul(
                    self.f(2.0),
                    self.call(Intrinsic::Cross, vec![self.xyz(q()), v()], ShaderType::VEC3),
                ),
            ),
            self.ret(self.add(
                self.add(v(), self.mul(self.component(q(), Component::W), t())),
                self.call(Intrinsic::Cross, vec![self.xyz(q()), t()], ShaderType::VEC3),
            )),
        ]
    }

    fn quat_axis_angle(&self) -> Vec<Statement> {
        let axis = || self.local("axis", ShaderType::VEC3);
        let magnitude = |c| {
            self.call(
                Intrinsic::Abs,
                vec![self.component(axis(), c)],
                ShaderType::F32,
            )
        };
        let largest = || self.scalar("largest");
        let scaled = || self.local("scaled", ShaderType::VEC3);
        let square = |c| self.mul(self.component(scaled(), c), self.component(scaled(), c));
        let half = || self.scalar("half");
        vec![
            self.let_(
                "largest",
                self.call(
                    Intrinsic::Max,
                    vec![
                        self.call(
                            Intrinsic::Max,
                            vec![magnitude(Component::X), magnitude(Component::Y)],
                            ShaderType::F32,
                        ),
                        magnitude(Component::Z),
                    ],
                    ShaderType::F32,
                ),
            ),
            Statement::If {
                branches: vec![(
                    self.bin(BinaryOp::Equal, largest(), self.f(0.0)),
                    vec![self.ret(self.vec4_of([0.0, 0.0, 0.0, 1.0]))],
                )],
                otherwise: None,
                span: self.span,
            },
            self.let_("scaled", self.div(axis(), largest())),
            self.let_(
                "unit",
                self.div(
                    scaled(),
                    self.call(
                        Intrinsic::Sqrt,
                        vec![self.add(
                            self.add(square(Component::X), square(Component::Y)),
                            square(Component::Z),
                        )],
                        ShaderType::F32,
                    ),
                ),
            ),
            self.let_("half", self.mul(self.scalar("angle"), self.f(0.5))),
            self.ret(self.vec4(vec![
                self.mul(
                    self.local("unit", ShaderType::VEC3),
                    self.call(Intrinsic::Sin, vec![half()], ShaderType::F32),
                ),
                self.call(Intrinsic::Cos, vec![half()], ShaderType::F32),
            ])),
        ]
    }

    fn quat_euler(&self) -> Vec<Statement> {
        let axis = |x: f32, y: f32, z: f32, angle: &str| {
            Helper::QuatAxisAngle.call(
                vec![
                    self.vec3(vec![self.f(x), self.f(y), self.f(z)]),
                    self.scalar(angle),
                ],
                self.span,
            )
        };
        vec![self.ret(Helper::QuatMul.call(
            vec![
                Helper::QuatMul.call(
                    vec![axis(0.0, 1.0, 0.0, "y"), axis(1.0, 0.0, 0.0, "x")],
                    self.span,
                ),
                axis(0.0, 0.0, 1.0, "z"),
            ],
            self.span,
        ))]
    }

    /// `a * (1.0 - t) + b * t`; `t_ty` is the weight's type.
    fn mix(&self, dim: u8, t_ty: ShaderType) -> Vec<Statement> {
        let a = || self.local("a", float_type(dim));
        let b = || self.local("b", float_type(dim));
        let t = || self.local("t", t_ty.clone());
        vec![self.ret(self.add(
            self.mul(a(), self.sub(self.f(1.0), t())),
            self.mul(b(), t()),
        ))]
    }

    /// `v / sqrt(v.x*v.x + v.y*v.y + ...)` (squares summed left to right), the zero vector for length 0.
    fn normalize(&self, dim: u8) -> Vec<Statement> {
        use Component::{W, X, Y, Z};
        let ty = float_type(dim);
        let v = || self.local("v", float_type(dim));
        let square = |c| self.mul(self.component(v(), c), self.component(v(), c));
        let components = [X, Y, Z, W];
        let mut sum = self.add(square(X), square(Y));
        for c in &components[2..usize::from(dim)] {
            sum = self.add(sum, square(*c));
        }
        let length = || self.scalar("length");
        let zero = Expr::construct(ty.clone(), vec![self.f(0.0)], self.span);
        vec![
            self.let_(
                "length",
                self.call(Intrinsic::Sqrt, vec![sum], ShaderType::F32),
            ),
            self.ret(self.call(
                Intrinsic::Select,
                vec![
                    self.div(v(), length()),
                    zero,
                    self.bin(BinaryOp::Equal, length(), self.f(0.0)),
                ],
                ty,
            )),
        ]
    }

    fn mat4(&self, columns: Vec<Expr>) -> Expr {
        Expr::construct(ShaderType::Mat4, columns, self.span)
    }

    fn mat4_translation(&self) -> Vec<Statement> {
        vec![self.ret(self.mat4(vec![
            self.vec4_of([1.0, 0.0, 0.0, 0.0]),
            self.vec4_of([0.0, 1.0, 0.0, 0.0]),
            self.vec4_of([0.0, 0.0, 1.0, 0.0]),
            self.vec4(vec![self.local("v", ShaderType::VEC3), self.f(1.0)]),
        ]))]
    }

    fn mat4_scale(&self) -> Vec<Statement> {
        let v = |c| self.component(self.local("v", ShaderType::VEC3), c);
        let zero = || self.f(0.0);
        vec![self.ret(self.mat4(vec![
            self.vec4(vec![v(Component::X), zero(), zero(), zero()]),
            self.vec4(vec![zero(), v(Component::Y), zero(), zero()]),
            self.vec4(vec![zero(), zero(), v(Component::Z), zero()]),
            self.vec4_of([0.0, 0.0, 0.0, 1.0]),
        ]))]
    }

    fn mat4_rotation(&self) -> Vec<Statement> {
        use Component::{W, X, Y, Z};
        let q = |c| self.component(self.local("q", ShaderType::VEC4), c);
        let products: [(&str, Component, Component); 9] = [
            ("xx", X, X),
            ("yy", Y, Y),
            ("zz", Z, Z),
            ("xy", X, Y),
            ("xz", X, Z),
            ("yz", Y, Z),
            ("wx", W, X),
            ("wy", W, Y),
            ("wz", W, Z),
        ];
        let mut body: Vec<Statement> = products
            .iter()
            .map(|(name, a, b)| self.let_(name, self.mul(q(*a), q(*b))))
            .collect();
        let p = |name: &str| self.scalar(name);
        let two = |e: Expr| self.mul(self.f(2.0), e);
        let one_minus = |e: Expr| self.sub(self.f(1.0), two(e));
        body.push(self.ret(self.mat4(vec![
            self.vec4(vec![
                one_minus(self.add(p("yy"), p("zz"))),
                two(self.add(p("xy"), p("wz"))),
                two(self.sub(p("xz"), p("wy"))),
                self.f(0.0),
            ]),
            self.vec4(vec![
                two(self.sub(p("xy"), p("wz"))),
                one_minus(self.add(p("xx"), p("zz"))),
                two(self.add(p("yz"), p("wx"))),
                self.f(0.0),
            ]),
            self.vec4(vec![
                two(self.add(p("xz"), p("wy"))),
                two(self.sub(p("yz"), p("wx"))),
                one_minus(self.add(p("xx"), p("yy"))),
                self.f(0.0),
            ]),
            self.vec4_of([0.0, 0.0, 0.0, 1.0]),
        ])));
        body
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::emit_wgsl::{print_module, validate_wgsl};
    use crate::lowering::shader_ir::ShaderModule;
    use crate::source::FileId;

    #[test]
    fn every_helper_validates_and_comes_after_its_dependencies() {
        let span = Span::new(FileId(0), 0, 1);
        let mut module = ShaderModule::new("src/main.mtek::M", span);
        for helper in Helper::all() {
            for dependency in helper.dependencies() {
                assert!(dependency < &helper, "{helper:?} after {dependency:?}");
            }
            let function = helper.function(span, "src/main.mtek::M");
            assert_eq!(
                function.result.as_ref().map(|r| &r.ty),
                Some(&helper.result())
            );
            module.functions.push(function);
        }
        let printed = print_module(&module);
        validate_wgsl(&printed.text).unwrap_or_else(|e| panic!("{e}\n{}", printed.text));
        assert!(
            printed.text.contains(
                "fn mtek_quat_rotate(mtek_q: vec4<f32>, mtek_v: vec3<f32>) -> vec3<f32> {\n    \
             let mtek_t = 2.0 * cross(mtek_q.xyz, mtek_v);\n    \
             return (mtek_v + (mtek_q.w * mtek_t)) + cross(mtek_q.xyz, mtek_t);\n}\n"
            ),
            "{}",
            printed.text
        );
        // The CPU's operation order (decision 0047): mix, and normalize with the zero-length rule.
        for expected in [
            "fn mtek_mix_f32(mtek_a: f32, mtek_b: f32, mtek_t: f32) -> f32 {\n    \
             return (mtek_a * (1.0 - mtek_t)) + (mtek_b * mtek_t);\n}\n",
            "fn mtek_mix_vec3_f32(mtek_a: vec3<f32>, mtek_b: vec3<f32>, mtek_t: f32) -> vec3<f32> {",
            "fn mtek_mix_vec2(mtek_a: vec2<f32>, mtek_b: vec2<f32>, mtek_t: vec2<f32>) -> vec2<f32> {",
            "fn mtek_normalize_vec2(mtek_v: vec2<f32>) -> vec2<f32> {\n    \
             let mtek_length = sqrt((mtek_v.x * mtek_v.x) + (mtek_v.y * mtek_v.y));\n    \
             return select(mtek_v / mtek_length, vec2<f32>(0.0), mtek_length == 0.0);\n}\n",
            "let mtek_length = sqrt((((mtek_v.x * mtek_v.x) + (mtek_v.y * mtek_v.y)) + (mtek_v.z * mtek_v.z)) + (mtek_v.w * mtek_v.w));",
        ] {
            assert!(
                printed.text.contains(expected),
                "{expected}\n{}",
                printed.text
            );
        }
    }
}
