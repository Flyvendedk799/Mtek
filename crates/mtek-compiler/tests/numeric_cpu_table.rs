//! The CPU numeric conformance table `tests/semantics/numeric/cpu.json` (`spec/testing.md`
//! section 5; row format and numeric definitions: decision 0037), checked by an **independent
//! oracle** written in Rust.
//!
//! The runtime math library `rt` (`packages/runtime-web/src/math/`, JavaScript, `Math.fround`
//! after every operation) is asserted against the same table by
//! `packages/runtime-web/src/math/conformance.test.ts`. Here every expected value is recomputed
//! with native binary32 arithmetic, Rust's `as` conversions, wrapping integer operations with the
//! WGSL division rules, the pure-Rust `libm` for transcendental functions (binary64, rounded once,
//! as decision 0037 defines the CPU result), and the compiler's own constant-folding functions
//! for the quaternion and matrix products (`mtek_compiler::types::value`), so the two languages
//! must agree bit for bit and the run-time operation order is the folded one (decision 0026).
//! Functions whose folding uses binary32 `libm` (`quat.axis_angle`, `quat.euler`, `color.srgb`)
//! are additionally compared with the compiler within one or two ulps.
//!
//! The file is canonical: this test fails when it differs from what the oracle writes. To add rows,
//! add them with any `expect` (for example `null`) and run
//! `MTEK_BLESS=1 cargo test -p mtek-compiler --test numeric_cpu_table`, then review the diff.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::f64::consts::PI;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::stdlib::srgb_channel_to_linear_f32;
use mtek_compiler::types::ConstValue;
use mtek_compiler::types::value::{
    color_srgb, mat4_mul, mat4_mul_vec4, quat_axis_angle, quat_euler, quat_mul, quat_rotate,
};
use serde_json::{Map, Value, json};

const FORMAT: &str = "mtek-numeric-cpu/1";

fn table_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/semantics/numeric/cpu.json")
}

/// A typed value of the table.
#[derive(Clone, Debug, PartialEq)]
enum Val {
    Bool(bool),
    I32(i32),
    U32(u32),
    F32(f32),
    /// `vec2`, `vec3`, `vec4`, `quat` or `color` (the kind is the JSON key).
    Floats(&'static str, Vec<f32>),
    Mat4([f32; 16]),
}

const FLOAT_KINDS: [&str; 5] = ["vec2", "vec3", "vec4", "quat", "color"];

fn parse_f32(value: &Value, context: &str) -> f32 {
    match value {
        Value::String(s) => match s.as_str() {
            "NaN" => f32::NAN,
            "Infinity" => f32::INFINITY,
            "-Infinity" => f32::NEG_INFINITY,
            "-0" => -0.0,
            other => panic!("{context}: unknown f32 string {other:?}"),
        },
        Value::Number(n) => {
            let v = n.as_f64().unwrap();
            let f = v as f32;
            assert!(
                f64::from(f) == v,
                "{context}: {v} is not exactly a binary32 value"
            );
            assert!(
                !(f == 0.0 && v.is_sign_negative()),
                "{context}: write -0 as \"-0\""
            );
            f
        }
        other => panic!("{context}: expected an f32, got {other}"),
    }
}

fn parse_val(value: &Value, context: &str) -> Val {
    let object = value
        .as_object()
        .unwrap_or_else(|| panic!("{context}: expected a typed value, got {value}"));
    assert_eq!(object.len(), 1, "{context}: a typed value has one key");
    let (key, inner) = object.iter().next().unwrap();
    match key.as_str() {
        "bool" => Val::Bool(inner.as_bool().unwrap()),
        "i32" => Val::I32(i32::try_from(inner.as_i64().unwrap()).unwrap()),
        "u32" => Val::U32(u32::try_from(inner.as_i64().unwrap()).unwrap()),
        "f32" => Val::F32(parse_f32(inner, context)),
        "mat4" => {
            let items = inner.as_array().unwrap();
            assert_eq!(items.len(), 16, "{context}: mat4 has 16 elements");
            let mut m = [0.0_f32; 16];
            for (slot, item) in m.iter_mut().zip(items) {
                *slot = parse_f32(item, context);
            }
            Val::Mat4(m)
        }
        kind => {
            let kind = FLOAT_KINDS
                .into_iter()
                .find(|k| *k == kind)
                .unwrap_or_else(|| panic!("{context}: unknown type {kind}"));
            let items: Vec<f32> = inner
                .as_array()
                .unwrap()
                .iter()
                .map(|v| parse_f32(v, context))
                .collect();
            let expected = match kind {
                "vec2" => 2,
                "vec3" => 3,
                _ => 4,
            };
            assert_eq!(items.len(), expected, "{context}: {kind} length");
            Val::Floats(kind, items)
        }
    }
}

fn f32_json(v: f32) -> Value {
    if v.is_nan() {
        json!("NaN")
    } else if v == f32::INFINITY {
        json!("Infinity")
    } else if v == f32::NEG_INFINITY {
        json!("-Infinity")
    } else if v == 0.0 && v.is_sign_negative() {
        json!("-0")
    } else {
        json!(f64::from(v))
    }
}

fn val_json(v: &Val) -> Value {
    match v {
        Val::Bool(b) => json!({ "bool": b }),
        Val::I32(n) => json!({ "i32": n }),
        Val::U32(n) => json!({ "u32": n }),
        Val::F32(f) => json!({ "f32": f32_json(*f) }),
        Val::Floats(kind, items) => {
            let mut map = Map::new();
            map.insert(
                (*kind).to_owned(),
                Value::Array(items.iter().map(|f| f32_json(*f)).collect()),
            );
            Value::Object(map)
        }
        Val::Mat4(m) => json!({ "mat4": m.iter().map(|f| f32_json(*f)).collect::<Vec<_>>() }),
    }
}

/// Every `f32` inside a value.
fn floats_of(v: &Val) -> Vec<f32> {
    match v {
        Val::F32(f) => vec![*f],
        Val::Floats(_, items) => items.clone(),
        Val::Mat4(m) => m.to_vec(),
        _ => Vec::new(),
    }
}

// ------------------------------------------------------------------------------------------
// The oracle: the CPU semantics of decision 0037, written independently of the JavaScript.

fn min_f(a: f32, b: f32) -> f32 {
    if b < a || a.is_nan() { b } else { a }
}

fn max_f(a: f32, b: f32) -> f32 {
    if b > a || a.is_nan() { b } else { a }
}

fn clamp_f(x: f32, lo: f32, hi: f32) -> f32 {
    min_f(max_f(x, lo), hi)
}

fn sign_f(x: f32) -> f32 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else if x == 0.0 {
        0.0
    } else {
        x
    }
}

fn smoothstep_f(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp_f((x - e0) / (e1 - e0), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// A binary64 `libm` function of a binary32 argument, rounded once.
fn via_f64(f: fn(f64) -> f64, x: f32) -> f32 {
    f(f64::from(x)) as f32
}

fn unary_f32(name: &str, x: f32) -> Option<f32> {
    Some(match name {
        "abs" | "length" => x.abs(),
        "saturate" => clamp_f(x, 0.0, 1.0),
        "sqrt" => x.sqrt(),
        "inverse_sqrt" => (1.0 / f64::from(x).sqrt()) as f32,
        "exp" => via_f64(libm::exp, x),
        "exp2" => via_f64(libm::exp2, x),
        "log" => via_f64(libm::log, x),
        "log2" => via_f64(libm::log2, x),
        "sin" => via_f64(libm::sin, x),
        "cos" => via_f64(libm::cos, x),
        "tan" => via_f64(libm::tan, x),
        "asin" => via_f64(libm::asin, x),
        "acos" => via_f64(libm::acos, x),
        "atan" => via_f64(libm::atan, x),
        "floor" => x.floor(),
        "ceil" => x.ceil(),
        "trunc" => x.trunc(),
        "fract" => x - x.floor(),
        "sign" => sign_f(x),
        "round" => x.round_ties_even(),
        "radians" => x * ((PI / 180.0) as f32),
        "degrees" => x * ((180.0 / PI) as f32),
        "neg" => -x,
        _ => return None,
    })
}

fn binary_f32(name: &str, a: f32, b: f32) -> Option<f32> {
    Some(match name {
        "+" => a + b,
        "-" => a - b,
        "*" => a * b,
        "/" => a / b,
        "%" => a % b,
        "min" => min_f(a, b),
        "max" => max_f(a, b),
        "pow" => libm::pow(f64::from(a), f64::from(b)) as f32,
        "atan2" => libm::atan2(f64::from(a), f64::from(b)) as f32,
        "step" => {
            if b >= a {
                1.0
            } else {
                0.0
            }
        }
        "distance" => (a - b).abs(),
        _ => return None,
    })
}

fn ternary_f32(name: &str, a: f32, b: f32, c: f32) -> Option<f32> {
    Some(match name {
        "clamp" => clamp_f(a, b, c),
        "mix" => a * (1.0 - c) + b * c,
        "smoothstep" => smoothstep_f(a, b, c),
        _ => return None,
    })
}

fn compare<T: PartialOrd>(op: &str, a: T, b: T) -> Option<bool> {
    Some(match op {
        "<" => a < b,
        "<=" => a <= b,
        ">" => a > b,
        ">=" => a >= b,
        "==" => a == b,
        "!=" => a != b,
        _ => return None,
    })
}

fn int_i32(op: &str, a: i32, b: i32) -> Option<i32> {
    Some(match op {
        "+" => a.wrapping_add(b),
        "-" => a.wrapping_sub(b),
        "*" => a.wrapping_mul(b),
        "/" if b == 0 => a,
        "/" if a == i32::MIN && b == -1 => i32::MIN,
        "/" => a / b,
        "%" if b == 0 || (a == i32::MIN && b == -1) => 0,
        "%" => a % b,
        "min" => a.min(b),
        "max" => a.max(b),
        _ => return None,
    })
}

fn int_u32(op: &str, a: u32, b: u32) -> Option<u32> {
    Some(match op {
        "+" => a.wrapping_add(b),
        "-" => a.wrapping_sub(b),
        "*" => a.wrapping_mul(b),
        "/" if b == 0 => a,
        "/" => a / b,
        "%" if b == 0 => 0,
        "%" => a % b,
        "min" => a.min(b),
        "max" => a.max(b),
        _ => return None,
    })
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut sum = a[0] * b[0];
    for (x, y) in a.iter().zip(b).skip(1) {
        sum += x * y;
    }
    sum
}

fn length(v: &[f32]) -> f32 {
    dot(v, v).sqrt()
}

fn vec_kind(n: usize) -> &'static str {
    match n {
        2 => "vec2",
        3 => "vec3",
        _ => "vec4",
    }
}

fn quat4(v: &[f32]) -> [f32; 4] {
    [v[0], v[1], v[2], v[3]]
}

fn columns(m: &[f32; 16]) -> [[f32; 4]; 4] {
    let mut out = [[0.0; 4]; 4];
    for (c, column) in out.iter_mut().enumerate() {
        column.copy_from_slice(&m[c * 4..c * 4 + 4]);
    }
    out
}

/// `quat.axis_angle` as `rt` evaluates it: the folding order of decision 0026, with `sin`/`cos`
/// in binary64 rounded once.
fn axis_angle_rt(axis: &[f32], angle: f32) -> [f32; 4] {
    let largest = axis.iter().fold(0.0_f32, |m, c| m.max(c.abs()));
    if largest == 0.0 {
        return [0.0, 0.0, 0.0, 1.0];
    }
    let s: Vec<f32> = axis.iter().map(|c| c / largest).collect();
    let len = (s[0] * s[0] + s[1] * s[1] + s[2] * s[2]).sqrt();
    let half = angle * 0.5;
    let (sin, cos) = (via_f64(libm::sin, half), via_f64(libm::cos, half));
    [s[0] / len * sin, s[1] / len * sin, s[2] / len * sin, cos]
}

/// One channel of `color.srgb` as `rt` evaluates it: the folding formula of decision 0024 item 6
/// with the power in binary64, rounded once.
fn srgb_rt(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        libm::pow(f64::from((c + 0.055) / 1.055), f64::from(2.4_f32)) as f32
    }
}

/// `mat4.rotation(q)` in the order of decision 0037.
fn rotation(q: &[f32]) -> [f32; 16] {
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let (xx, yy, zz) = (x * x, y * y, z * z);
    let (xy, xz, yz) = (x * y, x * z, y * z);
    let (wx, wy, wz) = (w * x, w * y, w * z);
    [
        1.0 - 2.0 * (yy + zz),
        2.0 * (xy + wz),
        2.0 * (xz - wy),
        0.0,
        2.0 * (xy - wz),
        1.0 - 2.0 * (xx + zz),
        2.0 * (yz + wx),
        0.0,
        2.0 * (xz + wy),
        2.0 * (yz - wx),
        1.0 - 2.0 * (xx + yy),
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ]
}

/// The specified CPU result of `callee(args)`.
fn evaluate(callee: &str, args: &[Val]) -> Val {
    use Val as V;
    let map = |kind: &'static str, v: &[f32], f: &dyn Fn(f32) -> Option<f32>| -> Option<Val> {
        v.iter()
            .map(|c| f(*c))
            .collect::<Option<Vec<_>>>()
            .map(|out| V::Floats(kind, out))
    };
    let result = match (callee, args) {
        // Comparisons.
        (op, [V::F32(a), V::F32(b)]) if compare(op, 0, 0).is_some() => {
            compare(op, a, b).map(V::Bool)
        }
        (op, [V::I32(a), V::I32(b)]) if compare(op, 0, 0).is_some() => {
            compare(op, a, b).map(V::Bool)
        }
        (op, [V::U32(a), V::U32(b)]) if compare(op, 0, 0).is_some() => {
            compare(op, a, b).map(V::Bool)
        }
        // Conversions.
        ("i32", [V::F32(x)]) => Some(V::I32(if *x >= 2_147_483_520.0 {
            2_147_483_520
        } else {
            *x as i32
        })),
        ("u32", [V::F32(x)]) => Some(V::U32(if *x >= 4_294_967_040.0 {
            4_294_967_040
        } else {
            *x as u32
        })),
        ("f32", [V::I32(x)]) => Some(V::F32(*x as f32)),
        ("f32", [V::U32(x)]) => Some(V::F32(*x as f32)),
        ("i32", [V::U32(x)]) => Some(V::I32(*x as i32)),
        ("u32", [V::I32(x)]) => Some(V::U32(*x as u32)),
        // Integers.
        ("neg", [V::I32(x)]) => Some(V::I32(x.wrapping_neg())),
        ("abs", [V::I32(x)]) => Some(V::I32(x.wrapping_abs())),
        ("abs", [V::U32(x)]) => Some(V::U32(*x)),
        ("clamp", [V::I32(x), V::I32(lo), V::I32(hi)]) => Some(V::I32((*x).max(*lo).min(*hi))),
        ("clamp", [V::U32(x), V::U32(lo), V::U32(hi)]) => Some(V::U32((*x).max(*lo).min(*hi))),
        (op, [V::I32(a), V::I32(b)]) => int_i32(op, *a, *b).map(V::I32),
        (op, [V::U32(a), V::U32(b)]) => int_u32(op, *a, *b).map(V::U32),
        // Vector constructors.
        ("vec2" | "vec3" | "vec4", parts) => {
            let n = usize::from(callee.as_bytes()[3] - b'0');
            let mut out = Vec::new();
            for part in parts {
                out.extend(floats_of(part));
            }
            if out.len() == 1 {
                out = vec![out[0]; n];
            }
            (out.len() == n).then(|| V::Floats(vec_kind(n), out))
        }
        // Geometric functions and vector operators.
        ("dot", [V::Floats(_, a), V::Floats(_, b)]) => Some(V::F32(dot(a, b))),
        ("length", [V::Floats(_, v)]) => Some(V::F32(length(v))),
        ("distance", [V::Floats(_, a), V::Floats(_, b)]) => {
            let d: Vec<f32> = a.iter().zip(b).map(|(x, y)| x - y).collect();
            Some(V::F32(length(&d)))
        }
        ("normalize", [V::Floats(kind, v)]) => {
            let len = length(v);
            Some(V::Floats(
                kind,
                v.iter()
                    .map(|c| if len == 0.0 { 0.0 } else { c / len })
                    .collect(),
            ))
        }
        ("reflect", [V::Floats(kind, i), V::Floats(_, n)]) => {
            let t = 2.0 * dot(n, i);
            Some(V::Floats(
                kind,
                i.iter().zip(n).map(|(ic, nc)| ic - t * nc).collect(),
            ))
        }
        ("cross", [V::Floats("vec3", a), V::Floats("vec3", b)]) => Some(V::Floats(
            "vec3",
            vec![
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ],
        )),
        // Quaternions and matrices: the compiler's folding functions.
        ("*", [V::Floats("quat", a), V::Floats("quat", b)]) => {
            Some(V::Floats("quat", quat_mul(quat4(a), quat4(b)).to_vec()))
        }
        ("*", [V::Floats("quat", q), V::Floats("vec3", v)]) => Some(V::Floats(
            "vec3",
            quat_rotate(quat4(q), [v[0], v[1], v[2]]).to_vec(),
        )),
        ("*", [V::Mat4(a), V::Mat4(b)]) => {
            let product = mat4_mul(&columns(a), &columns(b));
            let mut out = [0.0; 16];
            out.copy_from_slice(product.as_flattened());
            Some(V::Mat4(out))
        }
        ("*", [V::Mat4(m), V::Floats("vec4", v)]) => Some(V::Floats(
            "vec4",
            mat4_mul_vec4(&columns(m), &quat4(v)).to_vec(),
        )),
        ("transpose", [V::Mat4(m)]) => {
            let mut out = [0.0; 16];
            for r in 0..4 {
                for c in 0..4 {
                    out[r * 4 + c] = m[c * 4 + r];
                }
            }
            Some(V::Mat4(out))
        }
        ("quat.identity", []) => Some(V::Floats("quat", vec![0.0, 0.0, 0.0, 1.0])),
        ("quat.axis_angle", [V::Floats("vec3", axis), V::F32(angle)]) => {
            Some(V::Floats("quat", axis_angle_rt(axis, *angle).to_vec()))
        }
        ("quat.euler", [V::F32(x), V::F32(y), V::F32(z)]) => {
            let qy = axis_angle_rt(&[0.0, 1.0, 0.0], *y);
            let qx = axis_angle_rt(&[1.0, 0.0, 0.0], *x);
            let qz = axis_angle_rt(&[0.0, 0.0, 1.0], *z);
            Some(V::Floats("quat", quat_mul(quat_mul(qy, qx), qz).to_vec()))
        }
        ("mat4.identity", []) => Some(V::Mat4(rotation(&[0.0, 0.0, 0.0, 1.0]))),
        ("mat4.translation", [V::Floats("vec3", v)]) => {
            let mut m = rotation(&[0.0, 0.0, 0.0, 1.0]);
            m[12..15].copy_from_slice(v);
            Some(V::Mat4(m))
        }
        ("mat4.scale", [V::Floats("vec3", v)]) => {
            let mut m = [0.0; 16];
            (m[0], m[5], m[10], m[15]) = (v[0], v[1], v[2], 1.0);
            Some(V::Mat4(m))
        }
        ("mat4.rotation", [V::Floats("quat", q)]) => Some(V::Mat4(rotation(q))),
        ("mat4.columns", cols) if cols.len() == 4 => {
            let mut m = [0.0; 16];
            for (c, col) in cols.iter().enumerate() {
                m[c * 4..c * 4 + 4].copy_from_slice(&floats_of(col));
            }
            Some(V::Mat4(m))
        }
        ("color.linear", [V::Floats("vec3", rgb), V::F32(a)]) => {
            Some(V::Floats("color", vec![rgb[0], rgb[1], rgb[2], *a]))
        }
        ("color.srgb", [V::Floats("vec3", rgb), V::F32(a)]) => Some(V::Floats(
            "color",
            vec![srgb_rt(rgb[0]), srgb_rt(rgb[1]), srgb_rt(rgb[2]), *a],
        )),
        // f32 scalars.
        (name, [V::F32(x)]) => unary_f32(name, *x).map(V::F32),
        (name, [V::F32(a), V::F32(b)]) => binary_f32(name, *a, *b).map(V::F32),
        (name, [V::F32(a), V::F32(b), V::F32(c)]) => ternary_f32(name, *a, *b, *c).map(V::F32),
        // Component-wise intrinsics and operators on vectors.
        ("mix", [V::Floats(kind, a), V::Floats(_, b), V::F32(t)]) => Some(V::Floats(
            kind,
            a.iter()
                .zip(b)
                .map(|(x, y)| ternary_f32("mix", *x, *y, *t).unwrap())
                .collect(),
        )),
        (op @ ("*" | "/"), [V::Floats(kind, v), V::F32(s)]) => {
            map(kind, v, &|c| binary_f32(op, c, *s))
        }
        ("*", [V::F32(s), V::Floats(kind, v)]) => map(kind, v, &|c| binary_f32("*", *s, c)),
        (name, [V::Floats(kind, v)]) => map(kind, v, &|c| unary_f32(name, c)),
        (name, [V::Floats(kind, a), V::Floats(_, b)]) => a
            .iter()
            .zip(b)
            .map(|(x, y)| binary_f32(name, *x, *y))
            .collect::<Option<Vec<_>>>()
            .map(|out| V::Floats(kind, out)),
        (name, [V::Floats(kind, a), V::Floats(_, b), V::Floats(_, c)]) => a
            .iter()
            .zip(b)
            .zip(c)
            .map(|((x, y), z)| ternary_f32(name, *x, *y, *z))
            .collect::<Option<Vec<_>>>()
            .map(|out| V::Floats(kind, out)),
        _ => None,
    };
    result.unwrap_or_else(|| panic!("the oracle has no rule for {callee} {args:?}"))
}

// ------------------------------------------------------------------------------------------

struct Case {
    id: String,
    callee: String,
    args: Vec<Val>,
    expect: Val,
    portable: bool,
    note: Option<String>,
}

fn read_table() -> (Value, Vec<Case>) {
    let text = fs::read_to_string(table_path()).unwrap();
    let doc: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(doc["format"], FORMAT, "format tag");
    let mut ids = BTreeSet::new();
    let cases = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            let id = case["id"].as_str().unwrap().to_owned();
            assert!(ids.insert(id.clone()), "duplicate case id {id}");
            let callee = case["fn"].as_str().unwrap().to_owned();
            let args: Vec<Val> = case["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| parse_val(a, &id))
                .collect();
            let expect = evaluate(&callee, &args);
            // Non-finite inputs or results are never portable (spec/testing.md 5).
            let finite = args
                .iter()
                .chain([&expect])
                .flat_map(floats_of)
                .all(f32::is_finite);
            let portable = case["portable"].as_bool().unwrap() && finite;
            let note = case.get("note").and_then(Value::as_str).map(str::to_owned);
            Case {
                id,
                callee,
                args,
                expect,
                portable,
                note,
            }
        })
        .collect();
    (doc, cases)
}

/// The canonical text: two-space indentation, one compact case per line, final line break.
fn render(comment: &Value, cases: &[Case]) -> String {
    let mut out = String::from("{\n  \"$comment\": [\n");
    let lines = comment.as_array().unwrap();
    for (i, line) in lines.iter().enumerate() {
        out.push_str("    ");
        out.push_str(&serde_json::to_string(line).unwrap());
        out.push_str(if i + 1 < lines.len() { ",\n" } else { "\n" });
    }
    out.push_str("  ],\n");
    out.push_str(&format!("  \"format\": \"{FORMAT}\",\n  \"cases\": [\n"));
    for (i, case) in cases.iter().enumerate() {
        let mut map = Map::new();
        map.insert("id".into(), json!(case.id));
        map.insert("fn".into(), json!(case.callee));
        map.insert(
            "args".into(),
            Value::Array(case.args.iter().map(val_json).collect()),
        );
        map.insert("expect".into(), val_json(&case.expect));
        map.insert("portable".into(), json!(case.portable));
        if let Some(note) = &case.note {
            map.insert("note".into(), json!(note));
        }
        out.push_str("    ");
        out.push_str(&serde_json::to_string(&Value::Object(map)).unwrap());
        out.push_str(if i + 1 < cases.len() { ",\n" } else { "\n" });
    }
    out.push_str("  ]\n}\n");
    out
}

#[test]
fn every_row_matches_the_independent_oracle() {
    let (doc, cases) = read_table();
    let rendered = render(&doc["$comment"], &cases);
    let path = table_path();
    if std::env::var_os("MTEK_BLESS").is_some_and(|v| v == "1") {
        fs::write(&path, &rendered).unwrap();
        return;
    }
    let committed = fs::read_to_string(&path).unwrap();
    if committed != rendered {
        let differing: Vec<&str> = committed
            .lines()
            .zip(rendered.lines())
            .filter(|(a, b)| a != b)
            .map(|(a, _)| a)
            .take(10)
            .collect();
        panic!(
            "tests/semantics/numeric/cpu.json differs from the oracle (expected values, portable \
             flags or layout). First differing lines:\n{}\nIf the change is intended, run \
             MTEK_BLESS=1 cargo test -p mtek-compiler --test numeric_cpu_table and review the diff.",
            differing.join("\n")
        );
    }
}

#[test]
fn the_table_covers_every_operation_family() {
    let (_, cases) = read_table();
    let callees: BTreeSet<&str> = cases.iter().map(|c| c.callee.as_str()).collect();
    const REQUIRED: &str = "+ - * / % neg < <= > >= == != i32 u32 f32 vec2 vec3 vec4 \
        abs min max clamp saturate mix step smoothstep sqrt inverse_sqrt pow exp exp2 log log2 \
        sin cos tan asin acos atan atan2 floor ceil round trunc fract sign length distance dot \
        cross normalize reflect radians degrees transpose quat.identity quat.axis_angle \
        quat.euler mat4.identity mat4.translation mat4.rotation mat4.scale mat4.columns \
        color.linear color.srgb";
    for required in REQUIRED.split_whitespace() {
        assert!(callees.contains(required), "no case for {required}");
    }
    // The cases the specification names explicitly (spec/testing.md 5).
    let has = |pred: &dyn Fn(&Case) -> bool| cases.iter().any(pred);
    assert!(has(
        &|c| c.callee == "/" && c.args == [Val::I32(i32::MIN), Val::I32(-1)]
    ));
    assert!(has(
        &|c| c.callee == "/" && c.args.get(1) == Some(&Val::I32(0))
    ));
    assert!(has(
        &|c| c.callee == "%" && c.args.get(1) == Some(&Val::U32(0))
    ));
    assert!(has(&|c| c.callee == "round" && c.args == [Val::F32(2.5)]));
    assert!(has(
        &|c| c.callee == "i32" && floats_of(&c.args[0]).iter().any(|f| f.is_nan())
    ));
    assert!(has(
        &|c| c.callee == "/" && c.args.get(1) == Some(&Val::F32(0.0))
    ));
    assert!(has(
        &|c| c.callee == "+" && c.args == [Val::I32(i32::MAX), Val::I32(1)]
    ));
}

/// The number of binary32 values between `a` and `b` (0 when equal, both NaN, or `0 == -0`).
fn ulps(a: f32, b: f32) -> u32 {
    if (a.is_nan() && b.is_nan()) || a == b {
        return 0;
    }
    fn ordered(x: f32) -> i64 {
        let bits = i64::from(x.to_bits());
        if bits & 0x8000_0000 != 0 {
            0x8000_0000 - bits
        } else {
            bits
        }
    }
    u32::try_from((ordered(a) - ordered(b)).unsigned_abs()).unwrap_or(u32::MAX)
}

#[test]
fn rows_with_binary32_libm_folding_agree_with_the_compiler() {
    let (_, cases) = read_table();
    let mut checked = 0;
    for case in cases.iter().filter(|c| c.portable) {
        let folded: Option<(Vec<f32>, u32)> = match (case.callee.as_str(), case.args.as_slice()) {
            ("quat.axis_angle", [Val::Floats(_, axis), Val::F32(angle)]) => {
                match quat_axis_angle([axis[0], axis[1], axis[2]], *angle) {
                    Ok(ConstValue::Quat(q)) => Some((q.to_vec(), 1)),
                    other => panic!("{}: {other:?}", case.id),
                }
            }
            ("quat.euler", [Val::F32(x), Val::F32(y), Val::F32(z)]) => {
                match quat_euler(*x, *y, *z) {
                    Ok(ConstValue::Quat(q)) => Some((q.to_vec(), 2)),
                    other => panic!("{}: {other:?}", case.id),
                }
            }
            ("color.srgb", [Val::Floats(_, rgb), Val::F32(a)]) => {
                match color_srgb([rgb[0], rgb[1], rgb[2]], *a) {
                    Ok(ConstValue::Color(c)) => Some((c.to_vec(), 1)),
                    other => panic!("{}: {other:?}", case.id),
                }
            }
            _ => None,
        };
        if let Some((folded, bound)) = folded {
            for (cpu, fold) in floats_of(&case.expect).iter().zip(&folded) {
                assert!(
                    ulps(*cpu, *fold) <= bound,
                    "{}: CPU {cpu:e} vs folded {fold:e}",
                    case.id
                );
            }
            checked += 1;
        }
    }
    assert!(checked >= 15, "only {checked} rows compared with folding");
    // The channel function itself is the one the constant folder uses.
    assert_eq!(srgb_channel_to_linear_f32(0.5), {
        let Ok(ConstValue::Color(c)) = color_srgb([0.5, 0.5, 0.5], 1.0) else {
            panic!()
        };
        c[0]
    });
}
