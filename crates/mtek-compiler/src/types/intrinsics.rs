//! Compile-time semantics of the const-eligible global intrinsics
//! (`spec/stdlib.md` section 6, `spec/language.md` section 10, decision
//! 0035 item 3).
//!
//! The registry decides which functions exist, their signatures and whether
//! they are const-eligible; the checker has already chosen the overload, so
//! the arguments here have the parameter types. Each function is written as
//! a fixed sequence of binary32 operations (Rust `f32` arithmetic, correctly
//! rounded; `f32::sqrt`, correctly rounded) and pure-Rust `libm` binary32
//! functions for everything transcendental, so a folded value has the same
//! bits on every host. A result that is not finite is an error (`E3040`,
//! decision 0026 item 5).

use super::value::{ConstValue, EvalError, EvalResult, cross};

/// Every global intrinsic [`intrinsic_function`] evaluates.
pub const EVALUATED: &[&str] = &[
    "abs",
    "min",
    "max",
    "clamp",
    "saturate",
    "mix",
    "step",
    "smoothstep",
    "sqrt",
    "inverse_sqrt",
    "pow",
    "exp",
    "exp2",
    "log",
    "log2",
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "atan2",
    "floor",
    "ceil",
    "trunc",
    "fract",
    "sign",
    "round",
    "radians",
    "degrees",
    "length",
    "distance",
    "dot",
    "cross",
    "normalize",
    "reflect",
    "transpose",
];

/// Whether [`intrinsic_function`] evaluates `name`.
#[must_use]
pub fn has_intrinsic_evaluator(name: &str) -> bool {
    EVALUATED.contains(&name)
}

/// The `f32` components of a value of the class `T` (`f32`, `vec2`, `vec3`,
/// `vec4`).
fn components(value: &ConstValue) -> Option<Vec<f32>> {
    match value {
        ConstValue::F32(v) => Some(vec![*v]),
        ConstValue::Vec2(_) | ConstValue::Vec3(_) | ConstValue::Vec4(_) => {
            value.components().map(<[f32]>::to_vec)
        }
        _ => None,
    }
}

/// A value of the same class member as `shape` with these components.
fn like(shape: &ConstValue, values: &[f32]) -> EvalResult {
    match (shape, values) {
        (ConstValue::F32(_), [v]) => Ok(ConstValue::F32(*v)),
        (ConstValue::Vec2(_) | ConstValue::Vec3(_) | ConstValue::Vec4(_), _) => {
            ConstValue::vector(values).ok_or(EvalError::Mismatch)
        }
        _ => Err(EvalError::Mismatch),
    }
}

/// `f` applied component-wise to the arguments, which are all `T` of one
/// member, except that an `f32` argument stands for every component (the
/// scalar weight of `mix(a, b, t: f32)`).
fn component_wise(args: &[ConstValue], f: impl Fn(&[f32]) -> f32) -> EvalResult {
    let shape = args
        .iter()
        .find(|a| !matches!(a, ConstValue::F32(_)))
        .or_else(|| args.first())
        .ok_or(EvalError::Mismatch)?;
    let lists: Option<Vec<Vec<f32>>> = args.iter().map(components).collect();
    let lists = lists.ok_or(EvalError::Mismatch)?;
    let width = lists.iter().map(Vec::len).max().unwrap_or(0);
    let mut out = Vec::with_capacity(width);
    let mut operands = Vec::with_capacity(lists.len());
    for index in 0..width {
        operands.clear();
        for list in &lists {
            let value = match list.as_slice() {
                [single] => *single,
                many => *many.get(index).ok_or(EvalError::Mismatch)?,
            };
            operands.push(value);
        }
        out.push(f(&operands));
    }
    like(shape, &out)
}

fn arg(values: &[f32], index: usize) -> f32 {
    values.get(index).copied().unwrap_or(f32::NAN)
}

/// `a < b ? a : b`, written so that the result never depends on how a
/// platform treats `-0.0` against `0.0` (the first operand wins a tie).
fn min32(a: f32, b: f32) -> f32 {
    if b < a { b } else { a }
}

fn max32(a: f32, b: f32) -> f32 {
    if b > a { b } else { a }
}

/// `x0*y0 + x1*y1 + …`, summed left to right.
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut pairs = a.iter().zip(b);
    let Some((x, y)) = pairs.next() else {
        return 0.0;
    };
    let mut sum = x * y;
    for (x, y) in pairs {
        sum += x * y;
    }
    sum
}

/// `sqrt(dot(v, v))`.
fn length(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

/// The vector components of a `V` argument (`vec2`, `vec3`, `vec4`).
fn vector(value: &ConstValue) -> Option<&[f32]> {
    match value {
        ConstValue::Vec2(_) | ConstValue::Vec3(_) | ConstValue::Vec4(_) => value.components(),
        _ => None,
    }
}

/// Every `f32` of a value, for the finiteness check.
fn all_finite(value: &ConstValue) -> bool {
    match value {
        ConstValue::F32(v) => v.is_finite(),
        ConstValue::Mat4(m) => m.as_flattened().iter().all(|v| v.is_finite()),
        other => other
            .components()
            .is_none_or(|values| values.iter().all(|v| v.is_finite())),
    }
}

/// Evaluates the global intrinsic `name` on `args` (`None` if this build has
/// no evaluator for it; a unit test keeps that from happening for any
/// const-eligible intrinsic the build implements).
#[must_use]
pub fn intrinsic_function(name: &str, args: &[ConstValue]) -> Option<EvalResult> {
    use ConstValue as V;
    let unary = |f: fn(f32) -> f32| component_wise(args, |v| f(arg(v, 0)));
    let binary = |f: fn(f32, f32) -> f32| component_wise(args, |v| f(arg(v, 0), arg(v, 1)));
    let result = match (name, args) {
        ("abs", [V::I32(x)]) => Ok(V::I32(x.wrapping_abs())),
        ("abs", [V::U32(x)]) => Ok(V::U32(*x)),
        ("abs", [_]) => unary(f32::abs),
        ("min", [V::I32(a), V::I32(b)]) => Ok(V::I32(*a.min(b))),
        ("min", [V::U32(a), V::U32(b)]) => Ok(V::U32(*a.min(b))),
        ("min", [_, _]) => binary(min32),
        ("max", [V::I32(a), V::I32(b)]) => Ok(V::I32(*a.max(b))),
        ("max", [V::U32(a), V::U32(b)]) => Ok(V::U32(*a.max(b))),
        ("max", [_, _]) => binary(max32),
        // `min(max(x, lo), hi)`.
        ("clamp", [V::I32(x), V::I32(lo), V::I32(hi)]) => Ok(V::I32(*x.max(lo).min(hi))),
        ("clamp", [V::U32(x), V::U32(lo), V::U32(hi)]) => Ok(V::U32(*x.max(lo).min(hi))),
        ("clamp", [_, _, _]) => {
            component_wise(args, |v| min32(max32(arg(v, 0), arg(v, 1)), arg(v, 2)))
        }
        ("saturate", [_]) => unary(|x| min32(max32(x, 0.0), 1.0)),
        // `a * (1 - t) + b * t`.
        ("mix", [_, _, _]) => component_wise(args, |v| {
            let (a, b, t) = (arg(v, 0), arg(v, 1), arg(v, 2));
            a * (1.0 - t) + b * t
        }),
        // WGSL order: `step(edge, x)` is 1 where `x >= edge`.
        ("step", [_, _]) => binary(|edge, x| if x >= edge { 1.0 } else { 0.0 }),
        // `t = clamp((x - e0) / (e1 - e0), 0, 1)`, then `t * t * (3 - 2 * t)`.
        ("smoothstep", [_, _, _]) => component_wise(args, |v| {
            let (e0, e1, x) = (arg(v, 0), arg(v, 1), arg(v, 2));
            let t = min32(max32((x - e0) / (e1 - e0), 0.0), 1.0);
            t * t * (3.0 - 2.0 * t)
        }),
        ("sqrt", [_]) => unary(f32::sqrt),
        ("inverse_sqrt", [_]) => unary(|x| 1.0 / x.sqrt()),
        ("pow", [_, _]) => binary(libm::powf),
        ("exp", [_]) => unary(libm::expf),
        ("exp2", [_]) => unary(libm::exp2f),
        ("log", [_]) => unary(libm::logf),
        ("log2", [_]) => unary(libm::log2f),
        ("sin", [_]) => unary(libm::sinf),
        ("cos", [_]) => unary(libm::cosf),
        ("tan", [_]) => unary(libm::tanf),
        ("asin", [_]) => unary(libm::asinf),
        ("acos", [_]) => unary(libm::acosf),
        ("atan", [_]) => unary(libm::atanf),
        ("atan2", [_, _]) => binary(libm::atan2f),
        ("floor", [_]) => unary(libm::floorf),
        ("ceil", [_]) => unary(libm::ceilf),
        ("trunc", [_]) => unary(libm::truncf),
        // Halves to even: `rint` in the default rounding mode.
        ("round", [_]) => unary(libm::rintf),
        ("fract", [_]) => unary(|x| x - libm::floorf(x)),
        ("sign", [_]) => unary(|x| {
            if x > 0.0 {
                1.0
            } else if x < 0.0 {
                -1.0
            } else {
                0.0
            }
        }),
        // One multiplication by the binary32 value of π/180 (and 180/π).
        ("radians", [_]) => unary(|x| x * (std::f32::consts::PI / 180.0)),
        ("degrees", [_]) => unary(|x| x * (180.0 / std::f32::consts::PI)),
        ("length", [x]) => components(x)
            .map(|v| V::F32(length(&v)))
            .ok_or(EvalError::Mismatch),
        // `length(a - b)`.
        ("distance", [a, b]) => match (components(a), components(b)) {
            (Some(a), Some(b)) if a.len() == b.len() => {
                let difference: Vec<f32> = a.iter().zip(&b).map(|(x, y)| x - y).collect();
                Ok(V::F32(length(&difference)))
            }
            _ => Err(EvalError::Mismatch),
        },
        ("dot", [a, b]) => match (vector(a), vector(b)) {
            (Some(a), Some(b)) if a.len() == b.len() => Ok(V::F32(dot(a, b))),
            _ => Err(EvalError::Mismatch),
        },
        ("cross", [V::Vec3(a), V::Vec3(b)]) => Ok(V::Vec3(cross(*a, *b))),
        // `v / length(v)`; the zero vector stays the zero vector (the CPU
        // semantics of `spec/stdlib.md` 6).
        ("normalize", [v]) => match vector(v) {
            Some(values) => {
                let len = length(values);
                if len == 0.0 {
                    like(v, values)
                } else {
                    let scaled: Vec<f32> = values.iter().map(|c| c / len).collect();
                    like(v, &scaled)
                }
            }
            None => Err(EvalError::Mismatch),
        },
        // `i - 2 * dot(n, i) * n`: `s = 2 * dot(n, i)`, then `i_k - s * n_k`.
        ("reflect", [i, n]) => match (vector(i), vector(n)) {
            (Some(iv), Some(nv)) if iv.len() == nv.len() => {
                let s = 2.0 * dot(nv, iv);
                let out: Vec<f32> = iv.iter().zip(nv).map(|(a, b)| a - s * b).collect();
                like(i, &out)
            }
            _ => Err(EvalError::Mismatch),
        },
        ("transpose", [V::Mat4(m)]) => {
            let mut out = [[0.0_f32; 4]; 4];
            for (column, out_column) in out.iter_mut().enumerate() {
                for (row, slot) in out_column.iter_mut().enumerate() {
                    *slot = m[row][column];
                }
            }
            Ok(V::Mat4(out))
        }
        _ if has_intrinsic_evaluator(name) => Err(EvalError::Mismatch),
        _ => return None,
    };
    Some(result.and_then(|value| {
        if all_finite(&value) {
            Ok(value)
        } else {
            let shown: Vec<String> = args.iter().map(ToString::to_string).collect();
            Err(EvalError::NotFinite(format!(
                "{name}({}) is not finite",
                shown.join(", ")
            )))
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve::IMPLEMENTED_MILESTONE;
    use crate::stdlib::registry;
    use ConstValue as V;

    fn eval(name: &str, args: &[ConstValue]) -> EvalResult {
        intrinsic_function(name, args).unwrap_or_else(|| panic!("no evaluator for {name}"))
    }

    #[test]
    fn every_implemented_const_eligible_intrinsic_has_an_evaluator() {
        for intrinsic in &registry().intrinsics {
            let implemented = intrinsic.since.is_reached_by(IMPLEMENTED_MILESTONE);
            if intrinsic.const_eligible && implemented {
                assert!(
                    has_intrinsic_evaluator(intrinsic.name),
                    "{}",
                    intrinsic.name
                );
            }
        }
        for name in EVALUATED {
            let intrinsic = registry().intrinsic(name);
            assert!(intrinsic.is_some_and(|i| i.const_eligible), "{name}");
        }
        assert!(intrinsic_function("random", &[]).is_none());
        assert_eq!(
            intrinsic_function("sin", &[]),
            Some(Err(EvalError::Mismatch))
        );
    }

    #[test]
    fn integer_overloads() {
        assert_eq!(eval("abs", &[V::I32(i32::MIN)]), Ok(V::I32(i32::MIN)));
        assert_eq!(eval("abs", &[V::I32(-4)]), Ok(V::I32(4)));
        assert_eq!(eval("max", &[V::U32(3), V::U32(9)]), Ok(V::U32(9)));
        assert_eq!(
            eval("clamp", &[V::I32(-5), V::I32(0), V::I32(3)]),
            Ok(V::I32(0))
        );
    }

    #[test]
    fn component_wise_and_scalar_weights() {
        assert_eq!(
            eval(
                "mix",
                &[V::Vec2([0.0, 2.0]), V::Vec2([4.0, 6.0]), V::F32(0.5)]
            ),
            Ok(V::Vec2([2.0, 4.0]))
        );
        assert_eq!(
            eval(
                "mix",
                &[
                    V::Vec2([0.0, 2.0]),
                    V::Vec2([4.0, 6.0]),
                    V::Vec2([0.0, 1.0])
                ]
            ),
            Ok(V::Vec2([0.0, 6.0]))
        );
        assert_eq!(
            eval("step", &[V::Vec2([0.5, 0.5]), V::Vec2([0.4, 0.5])]),
            Ok(V::Vec2([0.0, 1.0]))
        );
        assert_eq!(
            eval("max", &[V::Vec3([1.0, -2.0, 3.0]), V::Vec3([0.0; 3])]),
            Ok(V::Vec3([1.0, 0.0, 3.0]))
        );
    }

    #[test]
    fn rounding_and_signs_follow_wgsl() {
        assert_eq!(eval("round", &[V::F32(2.5)]), Ok(V::F32(2.0)));
        assert_eq!(eval("round", &[V::F32(3.5)]), Ok(V::F32(4.0)));
        assert_eq!(eval("round", &[V::F32(-0.5)]), Ok(V::F32(-0.0)));
        assert_eq!(eval("fract", &[V::F32(-1.25)]), Ok(V::F32(0.75)));
        assert_eq!(eval("sign", &[V::F32(-0.0)]), Ok(V::F32(0.0)));
        assert_eq!(eval("sign", &[V::F32(-3.0)]), Ok(V::F32(-1.0)));
        assert_eq!(eval("trunc", &[V::F32(-2.7)]), Ok(V::F32(-2.0)));
    }

    #[test]
    fn geometry() {
        assert_eq!(eval("length", &[V::Vec2([3.0, 4.0])]), Ok(V::F32(5.0)));
        assert_eq!(eval("length", &[V::F32(-2.0)]), Ok(V::F32(2.0)));
        assert_eq!(
            eval(
                "distance",
                &[V::Vec3([1.0, 1.0, 1.0]), V::Vec3([1.0, 4.0, 5.0])]
            ),
            Ok(V::F32(5.0))
        );
        assert_eq!(
            eval("dot", &[V::Vec3([1.0, 2.0, 3.0]), V::Vec3([4.0, 5.0, 6.0])]),
            Ok(V::F32(32.0))
        );
        assert_eq!(
            eval(
                "cross",
                &[V::Vec3([1.0, 0.0, 0.0]), V::Vec3([0.0, 1.0, 0.0])]
            ),
            Ok(V::Vec3([0.0, 0.0, 1.0]))
        );
        assert_eq!(
            eval("normalize", &[V::Vec2([0.0, -3.0])]),
            Ok(V::Vec2([0.0, -1.0]))
        );
        assert_eq!(
            eval("normalize", &[V::Vec3([0.0; 3])]),
            Ok(V::Vec3([0.0; 3]))
        );
        assert_eq!(
            eval("reflect", &[V::Vec2([1.0, -1.0]), V::Vec2([0.0, 1.0])]),
            Ok(V::Vec2([1.0, 1.0]))
        );
    }

    #[test]
    fn non_finite_results_are_errors() {
        for (name, args) in [
            ("sqrt", vec![V::F32(-1.0)]),
            ("log", vec![V::F32(0.0)]),
            ("exp", vec![V::F32(100.0)]),
            ("inverse_sqrt", vec![V::F32(0.0)]),
            ("asin", vec![V::Vec2([0.5, 2.0])]),
            ("smoothstep", vec![V::F32(1.0), V::F32(1.0), V::F32(1.0)]),
        ] {
            assert!(
                matches!(eval(name, &args), Err(EvalError::NotFinite(_))),
                "{name}"
            );
        }
        assert_eq!(
            eval("sqrt", &[V::F32(-1.0)]),
            Err(EvalError::NotFinite("sqrt(-1.0) is not finite".to_owned()))
        );
    }

    #[test]
    fn transcendental_functions_are_libm() {
        assert_eq!(eval("sin", &[V::F32(1.0)]), Ok(V::F32(libm::sinf(1.0))));
        assert_eq!(
            eval("pow", &[V::Vec2([2.0, 3.0]), V::Vec2([0.5, 2.0])]),
            Ok(V::Vec2([libm::powf(2.0, 0.5), libm::powf(3.0, 2.0)]))
        );
        assert_eq!(
            eval("atan2", &[V::F32(1.0), V::F32(-1.0)]),
            Ok(V::F32(libm::atan2f(1.0, -1.0)))
        );
    }

    #[test]
    fn transpose_swaps_rows_and_columns() {
        let m = [
            [1.0, 2.0, 3.0, 4.0],
            [5.0, 6.0, 7.0, 8.0],
            [9.0, 10.0, 11.0, 12.0],
            [13.0, 14.0, 15.0, 16.0],
        ];
        let Ok(V::Mat4(t)) = eval("transpose", &[V::Mat4(m)]) else {
            panic!()
        };
        assert_eq!(t[0], [1.0, 5.0, 9.0, 13.0]);
        assert_eq!(t[3], [4.0, 8.0, 12.0, 16.0]);
    }
}
