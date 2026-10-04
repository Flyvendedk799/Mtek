//! Constant values and the exact operations on them
//! (`spec/language.md` sections 5.4, 6.2 to 6.7, decisions 0009, 0024, 0026).
//!
//! Every `f32` operation is one Rust `f32` operation, so each result is the
//! correctly rounded binary32 value (IEEE 754), identical on every host;
//! `sqrt` is Rust's `f32::sqrt` (also correctly rounded). Transcendental
//! functions and the sRGB conversions use the pure-Rust `libm` crate, never
//! `std`, whose transcendental functions depend on the platform.
//!
//! Integer operations are checked: overflow and division by zero are errors
//! during constant evaluation (`E3040`), as in WGSL const-evaluation. An
//! `f32` operation whose result is infinite or NaN is an error as well
//! (decision 0026): a folded constant must be a finite binary32 value.

use std::fmt;

use crate::stdlib::{ColorValue, srgb_channel_to_linear_f32};

/// A value computed at compile time.
#[derive(Clone, Debug, PartialEq)]
pub enum ConstValue {
    Bool(bool),
    I32(i32),
    U32(u32),
    F32(f32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
    /// `(x, y, z, w)`.
    Quat([f32; 4]),
    /// Linear RGBA, straight alpha.
    Color([f32; 4]),
    /// Four columns of four rows (column-major, `spec/language.md` 5.3).
    Mat4([[f32; 4]; 4]),
    /// A descriptor or struct value: the schema or struct name and the
    /// fields as written, in source order. Defaults of omitted schema fields
    /// are filled in by the schema checks, not here.
    Struct {
        name: String,
        fields: Vec<(String, ConstValue)>,
    },
    Array(Vec<ConstValue>),
}

impl ConstValue {
    /// The `f32` components of a vector, quaternion or colour value.
    #[must_use]
    pub fn components(&self) -> Option<&[f32]> {
        match self {
            ConstValue::Vec2(v) => Some(v),
            ConstValue::Vec3(v) => Some(v),
            ConstValue::Vec4(v) | ConstValue::Quat(v) | ConstValue::Color(v) => Some(v),
            _ => None,
        }
    }

    /// The `f32` value of a scalar.
    #[must_use]
    pub fn as_f32(&self) -> Option<f32> {
        match self {
            ConstValue::F32(v) => Some(*v),
            _ => None,
        }
    }

    /// The `f32` vector with these components (2, 3 or 4 of them).
    #[must_use]
    pub fn vector(components: &[f32]) -> Option<ConstValue> {
        match *components {
            [x, y] => Some(ConstValue::Vec2([x, y])),
            [x, y, z] => Some(ConstValue::Vec3([x, y, z])),
            [x, y, z, w] => Some(ConstValue::Vec4([x, y, z, w])),
            _ => None,
        }
    }
}

impl fmt::Display for ConstValue {
    /// A short rendering for diagnostics (`7`, `1.5`, `vec3(1.0, 2.0, 3.0)`).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fn list(f: &mut fmt::Formatter<'_>, name: &str, values: &[f32]) -> fmt::Result {
            write!(f, "{name}(")?;
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    write!(f, ", ")?;
                }
                write!(f, "{value:?}")?;
            }
            write!(f, ")")
        }
        match self {
            ConstValue::Bool(v) => write!(f, "{v}"),
            ConstValue::I32(v) => write!(f, "{v}"),
            ConstValue::U32(v) => write!(f, "{v}"),
            ConstValue::F32(v) => write!(f, "{v:?}"),
            ConstValue::Vec2(v) => list(f, "vec2", v),
            ConstValue::Vec3(v) => list(f, "vec3", v),
            ConstValue::Vec4(v) => list(f, "vec4", v),
            ConstValue::Quat(v) => list(f, "quat", v),
            ConstValue::Color(v) => list(f, "color", v),
            ConstValue::Mat4(_) => write!(f, "mat4(…)"),
            ConstValue::Struct { name, .. } => write!(f, "{name} {{ … }}"),
            ConstValue::Array(items) => write!(f, "[… {} elements]", items.len()),
        }
    }
}

/// Why an operation has no constant result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EvalError {
    /// An integer result outside its type; the text says which operation.
    Overflow(String),
    /// Integer division by zero; the text shows the operation.
    DivisionByZero(String),
    /// An `f32` result that is infinite or NaN.
    NotFinite(String),
    /// Operands the operation does not take. Type checking rules these out;
    /// should one occur, the expression is simply not folded.
    Mismatch,
}

/// The result of one operation.
pub type EvalResult = Result<ConstValue, EvalError>;

/// The four arithmetic operators.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum ArithOp {
    Add,
    Sub,
    Mul,
    Div,
}

impl ArithOp {
    /// The operator as written.
    #[must_use]
    pub fn symbol(self) -> &'static str {
        match self {
            ArithOp::Add => "+",
            ArithOp::Sub => "-",
            ArithOp::Mul => "*",
            ArithOp::Div => "/",
        }
    }

    fn apply(self, a: f32, b: f32) -> f32 {
        match self {
            ArithOp::Add => a + b,
            ArithOp::Sub => a - b,
            ArithOp::Mul => a * b,
            ArithOp::Div => a / b,
        }
    }
}

/// The target of a numeric conversion (`spec/language.md` 6.5).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Scalar {
    I32,
    U32,
    F32,
}

/// Every component must be finite.
fn finite(values: &[f32], what: impl FnOnce() -> String) -> Result<(), EvalError> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(EvalError::NotFinite(what()))
    }
}

fn map<const N: usize>(v: [f32; N], f: impl Fn(f32) -> f32) -> [f32; N] {
    v.map(f)
}

fn zip<const N: usize>(a: [f32; N], b: [f32; N], f: impl Fn(f32, f32) -> f32) -> [f32; N] {
    let mut out = a;
    for (slot, (x, y)) in out.iter_mut().zip(a.iter().zip(b.iter())) {
        *slot = f(*x, *y);
    }
    out
}

/// `-v` (`spec/language.md` 6.2): `f32`, `i32` and vectors.
pub fn negate(value: &ConstValue) -> EvalResult {
    Ok(match value {
        ConstValue::F32(v) => ConstValue::F32(-v),
        ConstValue::I32(v) => ConstValue::I32(
            v.checked_neg()
                .ok_or_else(|| EvalError::Overflow(format!("-({v}) does not fit in i32")))?,
        ),
        ConstValue::Vec2(v) => ConstValue::Vec2(map(*v, |c| -c)),
        ConstValue::Vec3(v) => ConstValue::Vec3(map(*v, |c| -c)),
        ConstValue::Vec4(v) => ConstValue::Vec4(map(*v, |c| -c)),
        _ => return Err(EvalError::Mismatch),
    })
}

fn int_i32(op: ArithOp, a: i32, b: i32) -> EvalResult {
    let symbol = op.symbol();
    let result = match op {
        ArithOp::Add => a.checked_add(b),
        ArithOp::Sub => a.checked_sub(b),
        ArithOp::Mul => a.checked_mul(b),
        ArithOp::Div => {
            if b == 0 {
                return Err(EvalError::DivisionByZero(format!("{a} / 0")));
            }
            a.checked_div(b)
        }
    };
    result
        .map(ConstValue::I32)
        .ok_or_else(|| EvalError::Overflow(format!("{a} {symbol} {b} does not fit in i32")))
}

fn int_u32(op: ArithOp, a: u32, b: u32) -> EvalResult {
    let symbol = op.symbol();
    let result = match op {
        ArithOp::Add => a.checked_add(b),
        ArithOp::Sub => a.checked_sub(b),
        ArithOp::Mul => a.checked_mul(b),
        ArithOp::Div => {
            if b == 0 {
                return Err(EvalError::DivisionByZero(format!("{a} / 0")));
            }
            a.checked_div(b)
        }
    };
    result
        .map(ConstValue::U32)
        .ok_or_else(|| EvalError::Overflow(format!("{a} {symbol} {b} does not fit in u32")))
}

fn vector_op<const N: usize>(
    op: ArithOp,
    a: [f32; N],
    b: [f32; N],
    make: fn([f32; N]) -> ConstValue,
    name: &str,
) -> EvalResult {
    let out = zip(a, b, |x, y| op.apply(x, y));
    finite(&out, || {
        format!("a component of {name} {} {name} is not finite", op.symbol())
    })?;
    Ok(make(out))
}

fn vector_scalar<const N: usize>(
    op: ArithOp,
    v: [f32; N],
    s: f32,
    scalar_first: bool,
    make: fn([f32; N]) -> ConstValue,
    name: &str,
) -> EvalResult {
    let out = if scalar_first {
        map(v, |c| op.apply(s, c))
    } else {
        map(v, |c| op.apply(c, s))
    };
    finite(&out, || {
        if scalar_first {
            format!("a component of f32 {} {name} is not finite", op.symbol())
        } else {
            format!("a component of {name} {} f32 is not finite", op.symbol())
        }
    })?;
    Ok(make(out))
}

/// `l op r` for the rows of `spec/language.md` 6.2 that `op` has.
pub fn arithmetic(op: ArithOp, l: &ConstValue, r: &ConstValue) -> EvalResult {
    use ConstValue as V;
    let mul = op == ArithOp::Mul;
    let scales = matches!(op, ArithOp::Mul | ArithOp::Div);
    match (l, r) {
        (V::F32(a), V::F32(b)) => {
            let out = op.apply(*a, *b);
            finite(&[out], || {
                format!("{a:?} {} {b:?} is not finite", op.symbol())
            })?;
            Ok(V::F32(out))
        }
        (V::I32(a), V::I32(b)) => int_i32(op, *a, *b),
        (V::U32(a), V::U32(b)) => int_u32(op, *a, *b),
        (V::Vec2(a), V::Vec2(b)) => vector_op(op, *a, *b, V::Vec2, "vec2"),
        (V::Vec3(a), V::Vec3(b)) => vector_op(op, *a, *b, V::Vec3, "vec3"),
        (V::Vec4(a), V::Vec4(b)) => vector_op(op, *a, *b, V::Vec4, "vec4"),
        (V::Vec2(v), V::F32(s)) if scales => vector_scalar(op, *v, *s, false, V::Vec2, "vec2"),
        (V::Vec3(v), V::F32(s)) if scales => vector_scalar(op, *v, *s, false, V::Vec3, "vec3"),
        (V::Vec4(v), V::F32(s)) if scales => vector_scalar(op, *v, *s, false, V::Vec4, "vec4"),
        (V::F32(s), V::Vec2(v)) if mul => vector_scalar(op, *v, *s, true, V::Vec2, "vec2"),
        (V::F32(s), V::Vec3(v)) if mul => vector_scalar(op, *v, *s, true, V::Vec3, "vec3"),
        (V::F32(s), V::Vec4(v)) if mul => vector_scalar(op, *v, *s, true, V::Vec4, "vec4"),
        (V::Mat4(a), V::Mat4(b)) if mul => {
            let out = mat4_mul(a, b);
            finite(out.as_flattened(), || {
                "a component of mat4 * mat4 is not finite".to_owned()
            })?;
            Ok(V::Mat4(out))
        }
        (V::Mat4(m), V::Vec4(v)) if mul => {
            let out = mat4_mul_vec4(m, v);
            finite(&out, || {
                "a component of mat4 * vec4 is not finite".to_owned()
            })?;
            Ok(V::Vec4(out))
        }
        (V::Quat(a), V::Quat(b)) if mul => {
            let out = quat_mul(*a, *b);
            finite(&out, || {
                "a component of quat * quat is not finite".to_owned()
            })?;
            Ok(V::Quat(out))
        }
        (V::Quat(q), V::Vec3(v)) if mul => {
            let out = quat_rotate(*q, *v);
            finite(&out, || {
                "a component of quat * vec3 is not finite".to_owned()
            })?;
            Ok(V::Vec3(out))
        }
        _ => Err(EvalError::Mismatch),
    }
}

/// `a * b` for column-major matrices: column `j` row `i` is
/// `a[0][i]*b[j][0] + a[1][i]*b[j][1] + a[2][i]*b[j][2] + a[3][i]*b[j][3]`,
/// summed left to right.
#[must_use]
pub fn mat4_mul(a: &[[f32; 4]; 4], b: &[[f32; 4]; 4]) -> [[f32; 4]; 4] {
    let mut out = [[0.0_f32; 4]; 4];
    for (column, b_column) in out.iter_mut().zip(b.iter()) {
        *column = mat4_mul_vec4(a, b_column);
    }
    out
}

/// `m * v`: row `i` is `m[0][i]*v[0] + m[1][i]*v[1] + m[2][i]*v[2] + m[3][i]*v[3]`,
/// summed left to right.
#[must_use]
pub fn mat4_mul_vec4(m: &[[f32; 4]; 4], v: &[f32; 4]) -> [f32; 4] {
    let mut out = [0.0_f32; 4];
    for (row, slot) in out.iter_mut().enumerate() {
        let mut sum = m[0][row] * v[0];
        for (column, component) in m.iter().zip(v.iter()).skip(1) {
            sum += column[row] * component;
        }
        *slot = sum;
    }
    out
}

/// The Hamilton product `a * b` of quaternions `(x, y, z, w)`; `a * b`
/// rotates by `b` first, then by `a`.
#[must_use]
pub fn quat_mul(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    let [ax, ay, az, aw] = a;
    let [bx, by, bz, bw] = b;
    [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// `q * v`: `v` rotated by the unit quaternion `q`, computed as
/// `t = 2 * cross(q.xyz, v)`, `v + q.w * t + cross(q.xyz, t)` (decision
/// 0026).
#[must_use]
pub fn quat_rotate(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let u = [q[0], q[1], q[2]];
    let w = q[3];
    let t = map(cross(u, v), |c| 2.0 * c);
    let c = cross(u, t);
    [
        v[0] + w * t[0] + c[0],
        v[1] + w * t[1] + c[1],
        v[2] + w * t[2] + c[2],
    ]
}

/// A registry default as a constant value. An empty descriptor (`Unlit {}`)
/// becomes a [`ConstValue::Struct`] without fields (the schema checks fill in
/// its defaults); the built-in textures and samplers have no constant value
/// in this build (their fields are M4): `None`.
#[must_use]
pub fn from_registry(value: &crate::stdlib::ConstValue) -> Option<ConstValue> {
    use crate::stdlib::ConstValue as R;
    Some(match value {
        R::Bool(v) => ConstValue::Bool(*v),
        R::I32(v) => ConstValue::I32(*v),
        R::U32(v) => ConstValue::U32(*v),
        R::F32(v) => ConstValue::F32(*v),
        R::Vec2(v) => ConstValue::Vec2(*v),
        R::Vec3(v) => ConstValue::Vec3(*v),
        R::Vec4(v) => ConstValue::Vec4(*v),
        R::Color(c) => ConstValue::Color(c.linear),
        R::QuatIdentity => quat_identity(),
        R::EmptyDescriptor(name) => ConstValue::Struct {
            name: (*name).to_owned(),
            fields: Vec::new(),
        },
        R::Texture(_) | R::Sampler(_) => return None,
    })
}

/// `quat.identity()`.
#[must_use]
pub fn quat_identity() -> ConstValue {
    ConstValue::Quat([0.0, 0.0, 0.0, 1.0])
}

/// `quat.axis_angle(axis, angle)` (`spec/language.md` 6.7): the axis is
/// normalised; an axis whose components are all zero gives the identity.
///
/// Normalisation first divides by the largest component magnitude, so that
/// neither squaring underflows for tiny axes nor overflows for huge ones, then
/// by the length of the scaled axis (decision 0026). With the half angle
/// `h = angle * 0.5`: `(n * libm::sinf(h), libm::cosf(h))`.
pub fn quat_axis_angle(axis: [f32; 3], angle: f32) -> EvalResult {
    let largest = axis.iter().fold(0.0_f32, |m, c| m.max(c.abs()));
    if largest == 0.0 {
        return Ok(quat_identity());
    }
    let scaled = map(axis, |c| c / largest);
    let length = (scaled[0] * scaled[0] + scaled[1] * scaled[1] + scaled[2] * scaled[2]).sqrt();
    let n = map(scaled, |c| c / length);
    let half = angle * 0.5;
    let (s, c) = (libm::sinf(half), libm::cosf(half));
    let out = [n[0] * s, n[1] * s, n[2] * s, c];
    finite(&out, || {
        "quat.axis_angle(axis, angle) is not finite".to_owned()
    })?;
    Ok(ConstValue::Quat(out))
}

/// `quat.euler(x, y, z)` = `axis_angle(+Y, y) * axis_angle(+X, x) *
/// axis_angle(+Z, z)` (`spec/language.md` 6.7): a vector is rotated about Z
/// first, then X, then Y, all fixed world axes.
pub fn quat_euler(x: f32, y: f32, z: f32) -> EvalResult {
    let about = |axis: [f32; 3], angle: f32| match quat_axis_angle(axis, angle)? {
        ConstValue::Quat(q) => Ok(q),
        _ => Err(EvalError::Mismatch),
    };
    let qy = about([0.0, 1.0, 0.0], y)?;
    let qx = about([1.0, 0.0, 0.0], x)?;
    let qz = about([0.0, 0.0, 1.0], z)?;
    let out = quat_mul(quat_mul(qy, qx), qz);
    finite(&out, || "quat.euler(x, y, z) is not finite".to_owned())?;
    Ok(ConstValue::Quat(out))
}

/// The colour literal `#RRGGBBAA` (`spec/language.md` 5.4): each RGB channel
/// through the exact sRGB EOTF in `f64`, rounded once to `f32`; alpha
/// `AA / 255`.
#[must_use]
pub fn color_literal(rgba: [u8; 4]) -> ConstValue {
    let [r, g, b, a] = rgba;
    ConstValue::Color(ColorValue::from_srgb8(r, g, b, a).linear)
}

/// `color.linear(rgb, a)`: the components as given.
#[must_use]
pub fn color_linear(rgb: [f32; 3], a: f32) -> ConstValue {
    ConstValue::Color([rgb[0], rgb[1], rgb[2], a])
}

/// `color.srgb(rgb, a)`: each channel through the binary32 transfer function
/// of decision 0024 item 6 (`libm::powf`); alpha unchanged.
pub fn color_srgb(rgb: [f32; 3], a: f32) -> EvalResult {
    let [r, g, b] = map(rgb, srgb_channel_to_linear_f32);
    let out = [r, g, b, a];
    finite(&out, || "color.srgb(rgb, a) is not finite".to_owned())?;
    Ok(ConstValue::Color(out))
}

/// A numeric conversion `T(x)` (`spec/language.md` 6.5): `i32`/`u32` to
/// `f32` rounds to nearest, ties to even; `f32` to an integer clamps to the
/// target range, then truncates toward zero (NaN cannot occur: constants are
/// finite); between `i32` and `u32` the bits are reinterpreted. Rust's `as`
/// implements exactly these rules.
pub fn convert(value: &ConstValue, target: Scalar) -> EvalResult {
    use ConstValue as V;
    Ok(match (value, target) {
        (V::I32(v), Scalar::I32) => V::I32(*v),
        (V::I32(v), Scalar::U32) => V::U32(*v as u32),
        (V::I32(v), Scalar::F32) => V::F32(*v as f32),
        (V::U32(v), Scalar::I32) => V::I32(*v as i32),
        (V::U32(v), Scalar::U32) => V::U32(*v),
        (V::U32(v), Scalar::F32) => V::F32(*v as f32),
        (V::F32(v), Scalar::I32) => V::I32(*v as i32),
        (V::F32(v), Scalar::U32) => V::U32(*v as u32),
        (V::F32(v), Scalar::F32) => V::F32(*v),
        _ => return Err(EvalError::Mismatch),
    })
}

/// A vector constructor `vecN(..)` (`spec/language.md` 6.7): a single `f32`
/// is splat; otherwise the `f32` and vector arguments are concatenated and
/// must give exactly `dim` components.
pub fn construct_vector(dim: usize, args: &[ConstValue]) -> EvalResult {
    if let [ConstValue::F32(s)] = args {
        return ConstValue::vector(&vec![*s; dim]).ok_or(EvalError::Mismatch);
    }
    let mut components = Vec::with_capacity(dim);
    for arg in args {
        match arg {
            ConstValue::F32(v) => components.push(*v),
            ConstValue::Vec2(_) | ConstValue::Vec3(_) | ConstValue::Vec4(_) => {
                components.extend_from_slice(arg.components().unwrap_or(&[]));
            }
            _ => return Err(EvalError::Mismatch),
        }
    }
    if components.len() != dim {
        return Err(EvalError::Mismatch);
    }
    ConstValue::vector(&components).ok_or(EvalError::Mismatch)
}

/// The components `indices` of a vector, quaternion or colour: one index
/// gives an `f32`, several a vector (a swizzle).
pub fn select_components(value: &ConstValue, indices: &[usize]) -> EvalResult {
    let components = value.components().ok_or(EvalError::Mismatch)?;
    let picked: Option<Vec<f32>> = indices
        .iter()
        .map(|&i| components.get(i).copied())
        .collect();
    let picked = picked.ok_or(EvalError::Mismatch)?;
    match picked.as_slice() {
        [single] => Ok(ConstValue::F32(*single)),
        many => ConstValue::vector(many).ok_or(EvalError::Mismatch),
    }
}

/// Whether [`namespace_function`] evaluates `namespace.member`.
#[must_use]
pub fn has_namespace_evaluator(namespace: &str, member: &str) -> bool {
    matches!(
        (namespace, member),
        ("quat", "identity" | "axis_angle" | "euler") | ("color", "linear" | "srgb")
    )
}

/// Evaluates the const-eligible namespace function `namespace.member` (the
/// registry decides which functions exist and are const-eligible; this is
/// their compile-time semantics). `None` if this build has no evaluator for
/// it; a unit test keeps that from happening for any function the build
/// implements.
#[must_use]
pub fn namespace_function(
    namespace: &str,
    member: &str,
    args: &[ConstValue],
) -> Option<EvalResult> {
    use ConstValue as V;
    let result = match (namespace, member, args) {
        ("quat", "identity", []) => Ok(quat_identity()),
        ("quat", "axis_angle", [V::Vec3(axis), V::F32(angle)]) => quat_axis_angle(*axis, *angle),
        ("quat", "euler", [V::F32(x), V::F32(y), V::F32(z)]) => quat_euler(*x, *y, *z),
        ("color", "linear", [V::Vec3(rgb), V::F32(a)]) => Ok(color_linear(*rgb, *a)),
        ("color", "srgb", [V::Vec3(rgb), V::F32(a)]) => color_srgb(*rgb, *a),
        _ if has_namespace_evaluator(namespace, member) => Err(EvalError::Mismatch),
        _ => return None,
    };
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve::IMPLEMENTED_MILESTONE;
    use crate::stdlib::{NamespaceMember, registry};

    fn quat(value: EvalResult) -> [f32; 4] {
        match value {
            Ok(ConstValue::Quat(q)) => q,
            other => panic!("not a quaternion: {other:?}"),
        }
    }

    fn close(a: &[f32], b: &[f32], tolerance: f32) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tolerance)
    }

    #[test]
    fn f32_arithmetic_is_binary32() {
        let third = arithmetic(ArithOp::Div, &ConstValue::F32(1.0), &ConstValue::F32(3.0));
        assert_eq!(third, Ok(ConstValue::F32(1.0_f32 / 3.0_f32)));
        let Ok(ConstValue::F32(v)) = third else {
            panic!()
        };
        assert_eq!(v.to_bits(), 0x3eaa_aaab);
        // 0.1 + 0.2 in binary32 is 0.3 (unlike binary64).
        let sum = arithmetic(ArithOp::Add, &ConstValue::F32(0.1), &ConstValue::F32(0.2));
        assert_eq!(sum, Ok(ConstValue::F32(0.3)));
    }

    #[test]
    fn non_finite_f32_results_are_errors() {
        let big = ConstValue::F32(3.0e38);
        assert!(matches!(
            arithmetic(ArithOp::Mul, &big, &ConstValue::F32(10.0)),
            Err(EvalError::NotFinite(_))
        ));
        assert!(matches!(
            arithmetic(ArithOp::Div, &ConstValue::F32(1.0), &ConstValue::F32(0.0)),
            Err(EvalError::NotFinite(_))
        ));
        assert!(matches!(
            arithmetic(
                ArithOp::Div,
                &ConstValue::Vec2([1.0, 1.0]),
                &ConstValue::F32(0.0)
            ),
            Err(EvalError::NotFinite(_))
        ));
    }

    #[test]
    fn integer_arithmetic_is_checked() {
        let max = ConstValue::I32(i32::MAX);
        let one = ConstValue::I32(1);
        assert_eq!(
            arithmetic(ArithOp::Add, &max, &one),
            Err(EvalError::Overflow(
                "2147483647 + 1 does not fit in i32".to_owned()
            ))
        );
        assert_eq!(
            arithmetic(
                ArithOp::Div,
                &ConstValue::I32(i32::MIN),
                &ConstValue::I32(-1)
            ),
            Err(EvalError::Overflow(
                "-2147483648 / -1 does not fit in i32".to_owned()
            ))
        );
        assert_eq!(
            arithmetic(ArithOp::Div, &ConstValue::I32(7), &ConstValue::I32(0)),
            Err(EvalError::DivisionByZero("7 / 0".to_owned()))
        );
        assert_eq!(
            arithmetic(ArithOp::Div, &ConstValue::I32(-7), &ConstValue::I32(2)),
            Ok(ConstValue::I32(-3))
        );
        assert_eq!(
            arithmetic(ArithOp::Sub, &ConstValue::U32(0), &ConstValue::U32(1)),
            Err(EvalError::Overflow("0 - 1 does not fit in u32".to_owned()))
        );
        assert_eq!(
            arithmetic(ArithOp::Div, &ConstValue::U32(1), &ConstValue::U32(0)),
            Err(EvalError::DivisionByZero("1 / 0".to_owned()))
        );
        assert_eq!(
            negate(&ConstValue::I32(i32::MIN)),
            Err(EvalError::Overflow(
                "-(-2147483648) does not fit in i32".to_owned()
            ))
        );
        assert_eq!(negate(&ConstValue::U32(1)), Err(EvalError::Mismatch));
    }

    #[test]
    fn vectors_are_component_wise_and_scale_by_scalars() {
        let a = ConstValue::Vec3([1.0, 2.0, 3.0]);
        let b = ConstValue::Vec3([0.5, 0.25, 0.125]);
        assert_eq!(
            arithmetic(ArithOp::Mul, &a, &b),
            Ok(ConstValue::Vec3([0.5, 0.5, 0.375]))
        );
        assert_eq!(
            arithmetic(ArithOp::Div, &a, &ConstValue::F32(2.0)),
            Ok(ConstValue::Vec3([0.5, 1.0, 1.5]))
        );
        assert_eq!(
            arithmetic(ArithOp::Mul, &ConstValue::F32(2.0), &a),
            Ok(ConstValue::Vec3([2.0, 4.0, 6.0]))
        );
        // Rows that §6.2 does not have.
        assert_eq!(
            arithmetic(ArithOp::Div, &ConstValue::F32(2.0), &a),
            Err(EvalError::Mismatch)
        );
        assert_eq!(
            arithmetic(ArithOp::Add, &a, &ConstValue::F32(2.0)),
            Err(EvalError::Mismatch)
        );
        assert_eq!(
            arithmetic(ArithOp::Add, &a, &ConstValue::Vec2([1.0, 1.0])),
            Err(EvalError::Mismatch)
        );
        assert_eq!(negate(&a), Ok(ConstValue::Vec3([-1.0, -2.0, -3.0])));
    }

    #[test]
    fn matrices_compose_column_major() {
        let identity = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        let translation = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [5.0, 6.0, 7.0, 1.0],
        ];
        assert_eq!(mat4_mul(&identity, &translation), translation);
        assert_eq!(
            mat4_mul_vec4(&translation, &[1.0, 2.0, 3.0, 1.0]),
            [6.0, 8.0, 10.0, 1.0]
        );
        assert_eq!(
            arithmetic(
                ArithOp::Mul,
                &ConstValue::Mat4(translation),
                &ConstValue::Vec4([0.0, 0.0, 0.0, 1.0])
            ),
            Ok(ConstValue::Vec4([5.0, 6.0, 7.0, 1.0]))
        );
    }

    #[test]
    fn axis_angle_normalises_and_uses_libm() {
        let q = quat(quat_axis_angle([0.0, 2.0, 0.0], 1.0));
        assert_eq!(q, [0.0, libm::sinf(0.5), 0.0, libm::cosf(0.5)]);
        // A zero axis is the identity.
        assert_eq!(quat_axis_angle([0.0, 0.0, 0.0], 1.0), Ok(quat_identity()));
        // Tiny and huge axes normalise without underflow or overflow.
        let tiny = quat(quat_axis_angle([1.0e-30, 0.0, 0.0], 1.0));
        assert_eq!(tiny, [libm::sinf(0.5), 0.0, 0.0, libm::cosf(0.5)]);
        let huge = quat(quat_axis_angle([0.0, 0.0, -3.0e38], 1.0));
        assert_eq!(huge, [0.0, 0.0, -libm::sinf(0.5), libm::cosf(0.5)]);
        // Unit length within rounding.
        let q = quat(quat_axis_angle([1.0, 2.0, 3.0], 0.7));
        let norm = q.iter().map(|c| c * c).sum::<f32>();
        assert!((norm - 1.0).abs() < 4.0 * f32::EPSILON, "{norm}");
        assert!(matches!(
            quat_axis_angle([1.0, 0.0, 0.0], f32::INFINITY),
            Err(EvalError::NotFinite(_))
        ));
    }

    #[test]
    fn hamilton_product_composes_rotations() {
        let a = quat(quat_axis_angle([0.0, 0.0, 1.0], 0.4));
        let b = quat(quat_axis_angle([1.0, 1.0, 0.0], 1.1));
        let v = [0.3, -0.7, 2.0];
        let ab_v = quat_rotate(quat_mul(a, b), v);
        let a_b_v = quat_rotate(a, quat_rotate(b, v));
        assert!(close(&ab_v, &a_b_v, 1.0e-6), "{ab_v:?} {a_b_v:?}");
        // The identity is neutral, exactly.
        let one = [0.0, 0.0, 0.0, 1.0];
        assert_eq!(quat_mul(one, b), b);
        assert_eq!(quat_mul(b, one), b);
        assert_eq!(quat_rotate(one, v), v);
    }

    #[test]
    fn rotating_x_by_a_quarter_turn_about_z_gives_y() {
        let q = quat(quat_axis_angle(
            [0.0, 0.0, 1.0],
            std::f32::consts::FRAC_PI_2,
        ));
        let rotated = quat_rotate(q, [1.0, 0.0, 0.0]);
        assert!(close(&rotated, &[0.0, 1.0, 0.0], 1.0e-6), "{rotated:?}");
    }

    #[test]
    fn euler_rotates_about_z_then_x_then_y() {
        let (x, y, z) = (0.3, -1.2, 0.8);
        let q = quat(quat_euler(x, y, z));
        let qx = quat(quat_axis_angle([1.0, 0.0, 0.0], x));
        let qy = quat(quat_axis_angle([0.0, 1.0, 0.0], y));
        let qz = quat(quat_axis_angle([0.0, 0.0, 1.0], z));
        // Bit-exact: the definition, evaluated in the same order.
        assert_eq!(q, quat_mul(quat_mul(qy, qx), qz));
        let v = [1.0, 2.0, 3.0];
        let stepwise = quat_rotate(qy, quat_rotate(qx, quat_rotate(qz, v)));
        assert!(close(&quat_rotate(q, v), &stepwise, 1.0e-5));
        // A single angle is that single rotation.
        assert_eq!(quat(quat_euler(0.0, 0.5, 0.0)), qy_of(0.5));
    }

    fn qy_of(angle: f32) -> [f32; 4] {
        quat(quat_axis_angle([0.0, 1.0, 0.0], angle))
    }

    #[test]
    fn colour_literals_use_the_exact_eotf_rounded_once() {
        // Independent computation: c / 255 in f64, the EOTF in f64 with
        // libm::pow, one rounding to f32.
        fn expected(c: u8) -> u32 {
            let c = f64::from(c) / 255.0;
            let linear = if c <= 0.04045 {
                c / 12.92
            } else {
                libm::pow((c + 0.055) / 1.055, 2.4)
            };
            (linear as f32).to_bits()
        }
        let Some(value) = color_literal([0x6b, 0x5c, 0xff, 0x80])
            .components()
            .map(<[f32]>::to_vec)
        else {
            panic!()
        };
        let bits: Vec<u32> = value.iter().map(|v| v.to_bits()).collect();
        assert_eq!(
            bits,
            [
                expected(0x6b),
                expected(0x5c),
                expected(0xff),
                ((128.0_f64 / 255.0) as f32).to_bits()
            ]
        );
    }

    #[test]
    fn color_srgb_uses_the_binary32_formula() {
        let c = 0.5_f32;
        let expected = libm::powf((c + 0.055) / 1.055, 2.4);
        assert_eq!(
            color_srgb([c, 0.04, 1.0], 0.25),
            Ok(ConstValue::Color([expected, 0.04 / 12.92, 1.0, 0.25]))
        );
        assert_eq!(
            color_linear([0.1, 0.2, 0.3], 0.4),
            ConstValue::Color([0.1, 0.2, 0.3, 0.4])
        );
    }

    #[test]
    fn conversions_follow_section_6_5() {
        use ConstValue as V;
        assert_eq!(
            convert(&V::I32(16_777_217), Scalar::F32),
            Ok(V::F32(16_777_216.0))
        );
        assert_eq!(
            convert(&V::U32(u32::MAX), Scalar::F32),
            Ok(V::F32(4_294_967_296.0))
        );
        assert_eq!(convert(&V::F32(-2.9), Scalar::I32), Ok(V::I32(-2)));
        assert_eq!(convert(&V::F32(3.0e9), Scalar::I32), Ok(V::I32(i32::MAX)));
        assert_eq!(convert(&V::F32(-3.0e9), Scalar::I32), Ok(V::I32(i32::MIN)));
        assert_eq!(convert(&V::F32(-1.5), Scalar::U32), Ok(V::U32(0)));
        assert_eq!(convert(&V::F32(5.0e9), Scalar::U32), Ok(V::U32(u32::MAX)));
        assert_eq!(convert(&V::I32(-1), Scalar::U32), Ok(V::U32(u32::MAX)));
        assert_eq!(
            convert(&V::U32(0x8000_0000), Scalar::I32),
            Ok(V::I32(i32::MIN))
        );
        assert_eq!(
            convert(&V::Bool(true), Scalar::I32),
            Err(EvalError::Mismatch)
        );
    }

    #[test]
    fn vector_constructors_splat_and_compose() {
        use ConstValue as V;
        assert_eq!(construct_vector(3, &[V::F32(2.0)]), Ok(V::Vec3([2.0; 3])));
        assert_eq!(
            construct_vector(4, &[V::Vec2([1.0, 2.0]), V::F32(3.0), V::F32(4.0)]),
            Ok(V::Vec4([1.0, 2.0, 3.0, 4.0]))
        );
        assert_eq!(
            construct_vector(4, &[V::Vec3([1.0, 2.0, 3.0]), V::F32(4.0)]),
            Ok(V::Vec4([1.0, 2.0, 3.0, 4.0]))
        );
        assert_eq!(
            construct_vector(3, &[V::F32(1.0), V::F32(2.0)]),
            Err(EvalError::Mismatch)
        );
        assert_eq!(
            select_components(&V::Vec4([1.0, 2.0, 3.0, 4.0]), &[3, 0, 0]),
            Ok(V::Vec3([4.0, 1.0, 1.0]))
        );
        assert_eq!(
            select_components(&V::Color([0.1, 0.2, 0.3, 0.4]), &[3]),
            Ok(V::F32(0.4))
        );
        assert_eq!(
            select_components(&V::Vec2([1.0, 2.0]), &[2]),
            Err(EvalError::Mismatch)
        );
    }

    #[test]
    fn every_implemented_const_eligible_namespace_function_has_an_evaluator() {
        let registry = registry();
        for namespace in &registry.namespaces {
            if !namespace.since.is_reached_by(IMPLEMENTED_MILESTONE) {
                continue;
            }
            for member in &namespace.members {
                if let NamespaceMember::Function(function) = member
                    && function.const_eligible
                    && function.since.is_reached_by(IMPLEMENTED_MILESTONE)
                {
                    assert!(
                        has_namespace_evaluator(namespace.name, function.name),
                        "{}.{} has no evaluator",
                        namespace.name,
                        function.name
                    );
                }
            }
        }
        assert!(namespace_function("mat4", "identity", &[]).is_none());
        assert_eq!(
            namespace_function("quat", "euler", &[]),
            Some(Err(EvalError::Mismatch))
        );
    }

    #[test]
    fn values_render_for_diagnostics() {
        assert_eq!(ConstValue::I32(-3).to_string(), "-3");
        assert_eq!(ConstValue::F32(1.5).to_string(), "1.5");
        assert_eq!(ConstValue::Vec2([1.0, 0.5]).to_string(), "vec2(1.0, 0.5)");
    }
}
