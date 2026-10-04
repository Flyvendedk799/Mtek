//! The constant folder against the CPU numeric conformance table
//! `tests/semantics/numeric/cpu.json` (decision 0037; task M2-01, decision
//! 0035 item 3).
//!
//! Decision 0037 item 7 requires that folded values and the run-time library
//! `rt` agree bit for bit wherever no transcendental function is involved. The
//! table holds the specified CPU result of each row, and its independent Rust
//! oracle computes transcendental functions in binary64 `libm` rounded once,
//! which is also how the folder evaluates them, so every row the folder can
//! express must fold to exactly the expected bits. Each row becomes a project
//! whose arguments are typed constants (`const A0: vec3 = vec3(…);`) and whose
//! constant `X` is the row's expression (`X = A0 * A1`, `X = mix(A0, A1, A2)`).
//!
//! Rows the folder cannot or must not express are skipped, each for a stated
//! reason: non-finite or signed-zero operands and results (folding rejects
//! non-finite values, and `-0` has no literal), `quat` operands (no
//! constructor from components), the binary32-`libm` namespace functions of
//! decisions 0024 and 0026 (`quat.axis_angle`, `quat.euler`, `color.srgb`,
//! compared within ulps by the oracle), and integer rows that wrap or divide
//! by zero at run time, which are `E3040` when folded (`spec/language.md`
//! 6.3; asserted here).

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fmt::Write as _;
use std::path::Path;

use mtek_compiler::analyze;
use mtek_compiler::diagnostics::{Code, Severity};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::DefKind;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::types::ConstValue;
use serde_json::Value;

/// Namespace functions folded with binary32 `libm` (decisions 0024, 0026).
const WITHIN_ULPS: &[&str] = &["quat.axis_angle", "quat.euler", "color.srgb"];

/// A finite `f32` of the table as a Mtek expression, or `None` for `"-0"`,
/// NaN and the infinities.
fn f32_source(value: &Value) -> Option<String> {
    let number = value.as_f64()?;
    let v = number as f32;
    if !v.is_finite() || (v == 0.0 && v.is_sign_negative()) || f64::from(v) != number {
        return None;
    }
    // The shortest decimal that reads back as `v`, in Mtek's float syntax
    // (digits on both sides of the point).
    let text = format!("{:e}", v.abs());
    let (mantissa, exponent) = text.split_once('e')?;
    let mantissa = if mantissa.contains('.') {
        mantissa.to_owned()
    } else {
        format!("{mantissa}.0")
    };
    let sign = if v < 0.0 { "-" } else { "" };
    Some(format!("{sign}{mantissa}e{exponent}"))
}

/// A typed value of the table as `(type, Mtek expression)`.
fn value_source(value: &Value) -> Option<(&'static str, String)> {
    let object = value.as_object()?;
    let (tag, inner) = object.iter().next()?;
    let list = |name: &str, n: usize| -> Option<String> {
        let items = inner.as_array()?;
        if items.len() != n {
            return None;
        }
        let parts: Option<Vec<String>> = items.iter().map(f32_source).collect();
        Some(format!("{name}({})", parts?.join(", ")))
    };
    Some(match tag.as_str() {
        "f32" => ("f32", f32_source(inner)?),
        "i32" => ("i32", inner.as_i64()?.to_string()),
        "u32" => ("u32", inner.as_u64()?.to_string()),
        "bool" => ("bool", inner.as_bool()?.to_string()),
        "vec2" => ("vec2", list("vec2", 2)?),
        "vec3" => ("vec3", list("vec3", 3)?),
        "vec4" => ("vec4", list("vec4", 4)?),
        "color" => {
            let items = inner.as_array()?;
            let parts: Option<Vec<String>> = items.iter().map(f32_source).collect();
            let parts = parts?;
            if parts.len() != 4 {
                return None;
            }
            (
                "color",
                format!(
                    "color.linear(vec3({}, {}, {}), {})",
                    parts[0], parts[1], parts[2], parts[3]
                ),
            )
        }
        "mat4" => {
            let items = inner.as_array()?;
            let parts: Option<Vec<String>> = items.iter().map(f32_source).collect();
            let parts = parts?;
            if parts.len() != 16 {
                return None;
            }
            let columns: Vec<String> = parts
                .chunks(4)
                .map(|c| format!("vec4({})", c.join(", ")))
                .collect();
            ("mat4", format!("mat4.columns({})", columns.join(", ")))
        }
        _ => return None,
    })
}

/// The bits of an expected value of the table (finite numbers only).
fn expected_value(value: &Value) -> Option<ConstValue> {
    let object = value.as_object()?;
    let (tag, inner) = object.iter().next()?;
    let floats = |n: usize| -> Option<Vec<f32>> {
        let items = inner.as_array()?;
        let values: Option<Vec<f32>> = items
            .iter()
            .map(|v| {
                let number = v.as_f64()?;
                let f = number as f32;
                (f.is_finite() && f64::from(f) == number).then_some(f)
            })
            .collect();
        values.filter(|v| v.len() == n)
    };
    Some(match tag.as_str() {
        "f32" => {
            let number = inner.as_f64()?;
            let f = number as f32;
            if !f.is_finite() || f64::from(f) != number {
                return None;
            }
            ConstValue::F32(f)
        }
        "i32" => ConstValue::I32(i32::try_from(inner.as_i64()?).ok()?),
        "u32" => ConstValue::U32(u32::try_from(inner.as_u64()?).ok()?),
        "bool" => ConstValue::Bool(inner.as_bool()?),
        "vec2" => ConstValue::Vec2(floats(2)?.try_into().ok()?),
        "vec3" => ConstValue::Vec3(floats(3)?.try_into().ok()?),
        "vec4" => ConstValue::Vec4(floats(4)?.try_into().ok()?),
        "quat" => ConstValue::Quat(floats(4)?.try_into().ok()?),
        "color" => ConstValue::Color(floats(4)?.try_into().ok()?),
        "mat4" => {
            let v = floats(16)?;
            let mut m = [[0.0_f32; 4]; 4];
            for (index, value) in v.into_iter().enumerate() {
                m[index / 4][index % 4] = value;
            }
            ConstValue::Mat4(m)
        }
        _ => return None,
    })
}

/// Every `f32` of a value as bits, and the value's shape, for an exact
/// comparison (`-0.0 != 0.0`).
fn bits(value: &ConstValue) -> (String, Vec<u32>) {
    match value {
        ConstValue::F32(v) => ("f32".into(), vec![v.to_bits()]),
        ConstValue::Mat4(m) => (
            "mat4".into(),
            m.as_flattened().iter().map(|v| v.to_bits()).collect(),
        ),
        ConstValue::I32(v) => (format!("i32 {v}"), Vec::new()),
        ConstValue::U32(v) => (format!("u32 {v}"), Vec::new()),
        ConstValue::Bool(v) => (format!("bool {v}"), Vec::new()),
        other => (
            format!("{:?}", std::mem::discriminant(other)),
            other
                .components()
                .unwrap_or(&[])
                .iter()
                .map(|v| v.to_bits())
                .collect(),
        ),
    }
}

/// The Mtek expression of row `function` over the arguments `A0 … An-1`.
fn expression(function: &str, arity: usize) -> String {
    let args: Vec<String> = (0..arity).map(|i| format!("A{i}")).collect();
    match (function, args.as_slice()) {
        ("neg", [a]) => format!("-{a}"),
        ("+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=", [a, b]) => {
            format!("{a} {function} {b}")
        }
        _ => format!("{function}({})", args.join(", ")),
    }
}

#[test]
fn folded_values_equal_the_cpu_table_bit_for_bit() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/semantics/numeric/cpu.json");
    let table: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = table["cases"].as_array().unwrap();
    let (mut compared, mut skipped, mut wrapping) = (0, 0, 0);
    let mut mismatches = String::new();
    for case in cases {
        let id = case["id"].as_str().unwrap();
        let function = case["fn"].as_str().unwrap();
        let args = case["args"].as_array().unwrap();
        let sources: Option<Vec<(&str, String)>> = args.iter().map(value_source).collect();
        let (Some(sources), Some(expected)) = (sources, expected_value(&case["expect"])) else {
            skipped += 1;
            continue;
        };
        if WITHIN_ULPS.contains(&function) {
            skipped += 1;
            continue;
        }
        let mut text = String::new();
        for (index, (ty, source)) in sources.iter().enumerate() {
            let _ = writeln!(text, "const A{index}: {ty} = {source};");
        }
        let _ = writeln!(
            text,
            "const X = {};\n\nscene Demo {{\n    camera Main {{}}\n}}",
            expression(function, sources.len())
        );
        let mut fs = MemFs::new();
        fs.insert(
            ProjectPath::new("mtek.toml").unwrap(),
            "[project]\nname = \"table\"\nlanguage = \"0.1\"\n",
        )
        .insert(ProjectPath::new("src/main.mtek").unwrap(), text.as_str());
        let result = analyze(&ProjectRoot::at_base(), &fs);
        let errors: Vec<_> = result
            .report
            .diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Error)
            .collect();
        if !errors.is_empty() {
            let integer = sources.iter().all(|(ty, _)| matches!(*ty, "i32" | "u32"));
            assert!(
                integer && errors.iter().all(|d| d.code == Code::E3040),
                "{id}: {text}\n{errors:#?}"
            );
            wrapping += 1;
            continue;
        }
        let resolution = result.resolution.unwrap();
        let types = result.types.unwrap();
        let def = resolution
            .defs()
            .iter()
            .find(|d| d.kind == DefKind::Const && d.name == "X")
            .unwrap();
        let folded = types
            .const_info(def.id)
            .and_then(|info| info.value.clone())
            .unwrap_or_else(|| panic!("{id}: not folded:\n{text}"));
        if bits(&folded) != bits(&expected) {
            let _ = writeln!(
                mismatches,
                "{id}: folded {folded:?}, the table expects {expected:?}"
            );
        }
        compared += 1;
    }
    assert!(mismatches.is_empty(), "{mismatches}");
    println!(
        "{compared} rows folded bit for bit, {wrapping} integer rows are E3040, {skipped} skipped"
    );
    assert!(compared >= 400, "only {compared} rows compared");
}
