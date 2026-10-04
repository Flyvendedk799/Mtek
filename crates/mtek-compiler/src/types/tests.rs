//! Unit tests of the type checker and the constant evaluator, on whole
//! modules (lexed, parsed and resolved as the compiler does).

use super::*;
use crate::diagnostics::{Code, Diagnostic, Severity};
use crate::resolve::{Construct, DefKind, construct_implemented, resolve_module};
use crate::source::FileId;
use crate::syntax::{lex_str, parse_module};

struct Checked {
    typeck: Typeck,
    resolution: Resolution,
    diagnostics: Vec<Diagnostic>,
}

fn checked(text: &str) -> Checked {
    let mut lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    assert!(sink.is_empty(), "syntax errors in {text:?}");
    let resolution = resolve_module(&parsed.module, &mut sink);
    let typeck = check_module(&parsed.module, text, &resolution, &mut sink);
    Checked {
        typeck,
        resolution,
        diagnostics: sink.finish().diagnostics,
    }
}

impl Checked {
    fn codes(&self) -> Vec<&'static str> {
        self.diagnostics.iter().map(|d| d.code.short()).collect()
    }

    fn info(&self, name: &str) -> &ConstInfo {
        let def = self
            .resolution
            .defs()
            .iter()
            .find(|d| d.kind == DefKind::Const && d.name == name)
            .unwrap_or_else(|| panic!("no constant {name}"));
        self.typeck
            .const_info(def.id)
            .unwrap_or_else(|| panic!("constant {name} was not evaluated"))
    }

    fn value(&self, name: &str) -> Option<ConstValue> {
        self.info(name).value.clone()
    }

    fn ty(&self, name: &str) -> String {
        self.typeck.display(self.info(name).ty)
    }

    fn only(&self, code: &str) -> &Diagnostic {
        let found: Vec<&Diagnostic> = self
            .diagnostics
            .iter()
            .filter(|d| d.code.short() == code)
            .collect();
        match found.as_slice() {
            [one] => one,
            _ => panic!("expected one {code}: {:#?}", self.diagnostics),
        }
    }
}

/// A module of the given constants (one per line) and a minimal scene.
fn consts(lines: &str) -> Checked {
    checked(&format!("{lines}\nscene Demo {{ camera Main {{}} }}\n"))
}

fn clean(lines: &str) -> Checked {
    let c = consts(lines);
    assert!(c.diagnostics.is_empty(), "{lines}: {:#?}", c.diagnostics);
    c
}

#[test]
fn integer_literals_adopt_the_type_their_context_requires() {
    let c = clean(
        "const A = 1;\nconst B: f32 = 1;\nconst C: u32 = 16 * 2;\nconst D = 7 / 2;\nconst E: f32 = 1 / 4;\nconst F = -2147483648;\nconst G: f32 = -3;",
    );
    assert_eq!(
        (c.ty("A"), c.value("A")),
        ("i32".into(), Some(ConstValue::I32(1)))
    );
    assert_eq!(
        (c.ty("B"), c.value("B")),
        ("f32".into(), Some(ConstValue::F32(1.0)))
    );
    assert_eq!(c.value("C"), Some(ConstValue::U32(32)));
    // Integer division truncates.
    assert_eq!(c.value("D"), Some(ConstValue::I32(3)));
    // With an f32 context the literals are f32: 1.0 / 4.0.
    assert_eq!(c.value("E"), Some(ConstValue::F32(0.25)));
    assert_eq!(c.value("F"), Some(ConstValue::I32(i32::MIN)));
    assert_eq!(c.value("G"), Some(ConstValue::F32(-3.0)));
}

#[test]
fn float_literals_round_once_from_their_text() {
    // 1 + 2^-24 is the midpoint between 1.0 and the next f32; this literal is
    // slightly above it, so it rounds up. Rounding through f64 first would
    // land exactly on the midpoint and round to even (1.0).
    let c =
        clean("const A = 1.000000059604644775390625000001;\nconst B = 2.5e-3;\nconst C = 1.0e-50;");
    let Some(ConstValue::F32(a)) = c.value("A") else {
        panic!()
    };
    assert_eq!(a.to_bits(), 0x3f80_0001);
    assert_ne!(
        ("1.000000059604644775390625000001"
            .parse::<f64>()
            .unwrap_or(0.0) as f32)
            .to_bits(),
        a.to_bits()
    );
    assert_eq!(c.value("B"), Some(ConstValue::F32(2.5e-3)));
    // Finite after rounding (to zero): representable.
    assert_eq!(c.value("C"), Some(ConstValue::F32(0.0)));
}

#[test]
fn unrepresentable_literals_are_e3041() {
    for (source, message) in [
        (
            "const A: u32 = 4294967296;",
            "The integer literal 4294967296 is not representable as u32.",
        ),
        (
            "const A = 2147483648;",
            "The integer literal 2147483648 is not representable as i32.",
        ),
        (
            "const A: i32 = 3.5;",
            "The float literal 3.5 is not representable as i32: a float literal always has type f32.",
        ),
        (
            "const A = 1.0e39;",
            "The float literal 1.0e39 is not representable as f32: it rounds to infinity.",
        ),
        (
            "const A: u32 = -1;",
            "The integer literal -1 is not representable as u32.",
        ),
        (
            "const A = -2147483649;",
            "The integer literal -2147483649 is not representable as i32.",
        ),
        (
            "const A = 99999999999999999999999;",
            "The integer literal 99999999999999999999999 is not representable as i32.",
        ),
    ] {
        let c = consts(source);
        assert_eq!(c.codes(), ["E3041"], "{source}");
        assert_eq!(c.only("E3041").message, message);
        // No cascade: the constant keeps its type, has no value.
        assert_eq!(c.value("A"), None, "{source}");
    }
    // A long integer literal is fine as an f32.
    let c = clean("const A: f32 = 99999999999999999999999;");
    assert_eq!(c.value("A"), Some(ConstValue::F32(1.0e23)));
}

#[test]
fn literal_errors_set_expected_and_actual() {
    let c = consts("const A: i32 = 3.5;");
    let d = c.only("E3041");
    assert_eq!(d.expected.as_deref(), Some("i32"));
    assert_eq!(d.actual.as_deref(), Some("f32"));
}

#[test]
fn negating_unsigned_values_is_e3011() {
    let c = consts("const A: u32 = -(5);");
    assert_eq!(c.codes(), ["E3011"]);
    let c = consts("const N: u32 = 5;\nconst M = -N;");
    assert_eq!(c.codes(), ["E3011"]);
    assert_eq!(
        c.only("E3011").message,
        "A value of type u32 cannot be negated."
    );
}

#[test]
fn vector_arithmetic_and_scaling() {
    let c = clean(
        "const A = vec3(1.0, 2.0, 3.0) * 2;\nconst B = 2 * vec2(1.0, 0.5);\nconst C = vec4(1.0) / 4.0;\nconst D = vec3(1, 2, 3) - vec3(0.5);\nconst E = -vec2(1.0, -2.0);",
    );
    assert_eq!(c.value("A"), Some(ConstValue::Vec3([2.0, 4.0, 6.0])));
    assert_eq!(c.value("B"), Some(ConstValue::Vec2([2.0, 1.0])));
    assert_eq!(c.value("C"), Some(ConstValue::Vec4([0.25; 4])));
    assert_eq!(c.value("D"), Some(ConstValue::Vec3([0.5, 1.5, 2.5])));
    assert_eq!(c.value("E"), Some(ConstValue::Vec2([-1.0, 2.0])));
    assert_eq!(c.ty("A"), "vec3");
}

#[test]
fn operators_without_a_row_are_e3014() {
    let c = consts("const A = vec3(1.0) + vec2(1.0);");
    assert_eq!(
        c.only("E3014").message,
        "The operator `+` is not defined for vec3 and vec2."
    );
    let c = consts("const H: f32 = 1.0;\nconst N = 2;\nconst X = H + N;");
    assert_eq!(
        c.only("E3014").message,
        "The operator `+` is not defined for f32 and i32."
    );
    let c = consts("const X = 2.0 / vec3(1.0);");
    assert_eq!(c.codes(), ["E3014"]);
    let c = consts("const X = vec3(1.0) + 1.0;");
    assert_eq!(c.codes(), ["E3014"]);
    let c = consts("const X = quat.identity() + quat.identity();");
    assert_eq!(c.codes(), ["E3014"]);
    // Next to an i32 a float literal must become an i32, which it cannot.
    let c = consts("const N = 2;\nconst X = N * 1.5;");
    assert_eq!(c.codes(), ["E3041"]);
}

#[test]
fn remainders_fold_with_the_specified_semantics() {
    let c = clean(
        "const A = 7 % 3;\nconst B = -7 % 3;\nconst C: u32 = 7 % 4;\nconst D = 7.5 % 2.0;\nconst E = -7.5 % 2;\nconst F: f32 = 9 % 4;\nconst G = 2147483647 % -1;",
    );
    assert_eq!(c.value("A"), Some(ConstValue::I32(1)));
    // The remainder has the sign of the dividend.
    assert_eq!(c.value("B"), Some(ConstValue::I32(-1)));
    assert_eq!(c.value("C"), Some(ConstValue::U32(3)));
    assert_eq!(c.value("D"), Some(ConstValue::F32(1.5)));
    assert_eq!(c.value("E"), Some(ConstValue::F32(-1.5)));
    assert_eq!(c.value("F"), Some(ConstValue::F32(1.0)));
    assert_eq!(c.value("G"), Some(ConstValue::I32(0)));
    for (source, message) in [
        (
            "const A = 7 % 0;",
            "Division by zero in a constant expression: 7 % 0.",
        ),
        (
            "const A: u32 = 7 % 0;",
            "Division by zero in a constant expression: 7 % 0.",
        ),
        (
            "const A = -2147483648 % -1;",
            "Integer overflow in a constant expression: -2147483648 % -1 does not fit in i32.",
        ),
        (
            "const A = 1.0 % 0.0;",
            "A constant expression has no finite f32 value: 1.0 % 0.0 is not finite.",
        ),
    ] {
        let c = consts(source);
        assert_eq!(c.codes(), ["E3040"], "{source}");
        assert_eq!(c.only("E3040").message, message, "{source}");
    }
    let c = consts("const A = vec3(1.0) % vec3(2.0);");
    let d = c.only("E3014");
    assert_eq!(
        d.message,
        "The operator `%` is not defined for vec3 and vec3."
    );
    assert_eq!(
        d.notes,
        ["`%` is defined for f32, i32 and u32 operands of one type"]
    );
}

#[test]
fn comparisons_equality_and_logic_give_bool() {
    let c = clean(
        "const N: u32 = 3;\nconst A = 1 < 2;\nconst B = 2.5 >= 2;\nconst C = N <= 3;\nconst D = 1.0 > 2.0;\nconst E = N == 3;\nconst F = true != false;\nconst G = -0.0 == 0.0;\nconst H = !(A && D) || false;\nconst I = !true;",
    );
    for (name, value) in [
        ("A", true),
        ("B", true),
        ("C", true),
        ("D", false),
        ("E", true),
        ("F", true),
        ("G", true),
        ("H", true),
        ("I", false),
    ] {
        assert_eq!(
            (c.ty(name), c.value(name)),
            ("bool".into(), Some(ConstValue::Bool(value))),
            "{name}"
        );
    }
    for (source, code, message) in [
        (
            "const A = vec2(1.0) == vec2(1.0);",
            "E3012",
            "The operator `==` is not defined for vectors (vec2 and vec2) in v0.1.",
        ),
        (
            "const A = vec3(1.0) < vec3(2.0);",
            "E3014",
            "The operator `<` is not defined for vec3 and vec3.",
        ),
        (
            "const A = true < false;",
            "E3014",
            "The operator `<` is not defined for bool and bool.",
        ),
        (
            "const N: u32 = 1;\nconst A = N == 1.5;",
            "E3041",
            "The float literal 1.5 is not representable as u32: a float literal always has type f32.",
        ),
        (
            "const H = 1.0;\nconst N = 1;\nconst A = H == N;",
            "E3014",
            "The operator `==` is not defined for f32 and i32.",
        ),
        (
            "const A = 1 && true;",
            "E3014",
            "The operator `&&` is not defined for i32 and bool.",
        ),
        (
            "const A = !1.0;",
            "E3014",
            "The operator `!` is not defined for f32.",
        ),
        (
            "const A = #ffffff == #ffffff;",
            "E3014",
            "The operator `==` is not defined for color and color.",
        ),
    ] {
        let c = consts(source);
        assert_eq!(c.codes(), [code], "{source}");
        assert_eq!(c.only(code).message, message, "{source}");
    }
    // Both operands are folded: an overflow behind `false &&` is reported.
    let c = consts("const A = false && 2147483647 + 1 > 0;");
    assert_eq!(c.codes(), ["E3040"]);
}

#[test]
fn colours_have_no_arithmetic() {
    let c = consts("const A = #ffffff * 0.5;");
    assert_eq!(c.codes(), ["E3010"]);
    let c = consts("const A = -#ffffff;");
    assert_eq!(c.codes(), ["E3010"]);
    // Through `.rgb` it works.
    let c = clean("const A = #ffffff.rgb * 0.5;");
    assert_eq!(c.value("A"), Some(ConstValue::Vec3([0.5; 3])));
}

#[test]
fn quaternions_multiply_and_rotate() {
    let c = clean(
        "const Q = quat.axis_angle(vec3(0, 0, 1), 1.5707964);\nconst V = Q * vec3(1.0, 0.0, 0.0);\nconst P = Q * Q;",
    );
    let Some(ConstValue::Vec3(v)) = c.value("V") else {
        panic!()
    };
    assert!(
        (v[0]).abs() < 1.0e-6 && (v[1] - 1.0).abs() < 1.0e-6,
        "{v:?}"
    );
    assert_eq!(c.ty("P"), "quat");
}

#[test]
fn integer_folding_errors_are_e3040() {
    for (source, message) in [
        (
            "const A = 2147483647 + 1;",
            "Integer overflow in a constant expression: 2147483647 + 1 does not fit in i32.",
        ),
        (
            "const A = 7 / 0;",
            "Division by zero in a constant expression: 7 / 0.",
        ),
        (
            "const A: u32 = 0 - 1;",
            "Integer overflow in a constant expression: 0 - 1 does not fit in u32.",
        ),
        (
            "const A = -2147483648 / -1;",
            "Integer overflow in a constant expression: -2147483648 / -1 does not fit in i32.",
        ),
        (
            "const A = 3.0e38 * 10.0;",
            "A constant expression has no finite f32 value: 3e38 * 10.0 is not finite.",
        ),
    ] {
        let c = consts(source);
        assert_eq!(c.codes(), ["E3040"], "{source}");
        assert_eq!(c.only("E3040").message, message, "{source}");
        assert_eq!(c.value("A"), None);
    }
}

#[test]
fn folding_happens_outside_constants_too() {
    let c =
        checked("scene Demo {\n    camera Main { position: vec3(0.0, 2147483647 + 1, 0.0); }\n}\n");
    // The literal adopts f32 from the vector constructor: no overflow.
    assert!(c.diagnostics.is_empty(), "{:#?}", c.diagnostics);
    let c = checked(
        "scene Demo {\n    camera Main {}\n    entity A { mesh: Sphere { segments: 4294967295 + 1 }; }\n}\n",
    );
    assert_eq!(c.codes(), ["E3040"]);
}

#[test]
fn vector_constructors() {
    let c = clean(
        "const A = vec3(2.0);\nconst B = vec3(vec2(1.0, 2.0), 3);\nconst C = vec4(vec2(1.0, 2.0), 3.0, 4.0);\nconst D = vec4(vec3(1.0), 0);\nconst E = vec2(0, 1);",
    );
    assert_eq!(c.value("A"), Some(ConstValue::Vec3([2.0; 3])));
    assert_eq!(c.value("B"), Some(ConstValue::Vec3([1.0, 2.0, 3.0])));
    assert_eq!(c.value("C"), Some(ConstValue::Vec4([1.0, 2.0, 3.0, 4.0])));
    assert_eq!(c.value("D"), Some(ConstValue::Vec4([1.0, 1.0, 1.0, 0.0])));
    assert_eq!(c.value("E"), Some(ConstValue::Vec2([0.0, 1.0])));

    let c = consts("const A = vec2(1.0, 2.0, 3.0);");
    assert_eq!(
        c.only("E3002").message,
        "The constructor `vec2` takes 1 or 2 arguments, but 3 were given."
    );
    let c = consts("const A = vec3();");
    assert_eq!(
        c.only("E3002").message,
        "The constructor `vec3` takes 1, 2 or 3 arguments, but 0 were given."
    );
    let c = consts("const A = vec3(1.0, 2.0);");
    let d = c.only("E3001");
    assert_eq!(
        d.message,
        "Argument 1 of `vec3(xy: vec2, z: f32)` expects vec2, but received f32."
    );
    assert_eq!(
        (d.expected.as_deref(), d.actual.as_deref()),
        (Some("vec2"), Some("f32"))
    );
    let c = consts("const A = vec3(true, 1.0, 2.0);");
    assert_eq!(c.codes(), ["E3001"]);
}

#[test]
fn namespace_functions_check_their_arguments() {
    let c = clean(
        "const I = quat.identity();\nconst A = quat.axis_angle(vec3(0, 2, 0), 1);\nconst L = color.linear(vec3(1, 0.5, 0), 1);",
    );
    assert_eq!(c.value("I"), Some(ConstValue::Quat([0.0, 0.0, 0.0, 1.0])));
    assert_eq!(
        c.value("A"),
        Some(ConstValue::Quat([
            0.0,
            libm::sinf(0.5),
            0.0,
            libm::cosf(0.5)
        ]))
    );
    assert_eq!(c.value("L"), Some(ConstValue::Color([1.0, 0.5, 0.0, 1.0])));

    let c = consts("const A = quat.identity(1.0);");
    assert_eq!(
        c.only("E3002").message,
        "`quat.identity` takes 0 arguments, but 1 was given."
    );
    let c = consts("const A = quat.axis_angle(1.0, 2.0);");
    assert_eq!(
        c.only("E3001").message,
        "Argument 1 of `quat.axis_angle(axis: vec3, angle: f32)` expects vec3, but received f32."
    );
    let c = consts("const A = color.srgb(vec3(0.5), 1.0, 2.0);");
    assert_eq!(c.codes(), ["E3002"]);
}

#[test]
fn colours_fold_bit_exactly() {
    let c =
        clean("const A = #6b5cff;\nconst B = color.srgb(vec3(0.5), 0.25);\nconst C = #10141880;");
    let expected = |c8: u8| {
        let c = f64::from(c8) / 255.0;
        let linear = if c <= 0.04045 {
            c / 12.92
        } else {
            libm::pow((c + 0.055) / 1.055, 2.4)
        };
        linear as f32
    };
    let Some(ConstValue::Color(a)) = c.value("A") else {
        panic!()
    };
    let bits: Vec<u32> = a.iter().map(|v| v.to_bits()).collect();
    let want: Vec<u32> = [expected(0x6b), expected(0x5c), expected(0xff), 1.0]
        .iter()
        .map(|v| v.to_bits())
        .collect();
    assert_eq!(bits, want);
    let srgb = libm::powf((0.5_f32 + 0.055) / 1.055, 2.4);
    assert_eq!(
        c.value("B"),
        Some(ConstValue::Color([srgb, srgb, srgb, 0.25]))
    );
    let Some(ConstValue::Color(translucent)) = c.value("C") else {
        panic!()
    };
    assert_eq!(translucent[3], (128.0_f64 / 255.0) as f32);
}

#[test]
fn components_and_swizzles() {
    let c = clean(
        "const V = vec4(1, 2, 3, 4);\nconst A = V.wzyx;\nconst B = V.x;\nconst C = V.xxy;\nconst D = #ff0000.rgb;\nconst E = #ff000080.a;\nconst F = quat.identity().w;",
    );
    assert_eq!(c.value("A"), Some(ConstValue::Vec4([4.0, 3.0, 2.0, 1.0])));
    assert_eq!(
        (c.ty("B"), c.value("B")),
        ("f32".into(), Some(ConstValue::F32(1.0)))
    );
    assert_eq!(c.value("C"), Some(ConstValue::Vec3([1.0, 1.0, 2.0])));
    assert_eq!(c.value("D"), Some(ConstValue::Vec3([1.0, 0.0, 0.0])));
    assert_eq!(
        c.value("E"),
        Some(ConstValue::F32((128.0_f64 / 255.0) as f32))
    );
    assert_eq!(c.value("F"), Some(ConstValue::F32(1.0)));

    for (source, message) in [
        (
            "const A = vec2(1.0).z;",
            "The type vec2 has no component 'z'.",
        ),
        (
            "const A = vec2(1.0).xz;",
            "The type vec2 has no component 'xz'.",
        ),
        (
            "const A = vec4(1.0).xyzwx;",
            "'.xyzwx' is not a valid swizzle: a swizzle has 2 to 4 components.",
        ),
        (
            "const A = vec3(1.0).r;",
            "The type vec3 has no component 'r'.",
        ),
        (
            "const A = quat.identity().xy;",
            "The type quat has no component 'xy'.",
        ),
        (
            "const A = #ffffff.x;",
            "The type color has no component 'x'.",
        ),
        (
            "const A = #ffffff.rgba;",
            "The type color has no component 'rgba'.",
        ),
        ("const A = (1.0).x;", "The type f32 has no component 'x'."),
    ] {
        let c = consts(source);
        assert_eq!(c.codes(), ["E3013"], "{source}");
        assert_eq!(c.only("E3013").message, message);
    }
}

#[test]
fn conversions() {
    let c = clean(
        "const A = f32(10);\nconst B = i32(2.9);\nconst C = u32(-1);\nconst N: u32 = 4294967295;\nconst D = i32(N);\nconst E = u32(-2.5);",
    );
    assert_eq!(c.value("A"), Some(ConstValue::F32(10.0)));
    assert_eq!(c.value("B"), Some(ConstValue::I32(2)));
    assert_eq!(c.value("C"), Some(ConstValue::U32(u32::MAX)));
    assert_eq!(c.value("D"), Some(ConstValue::I32(-1)));
    assert_eq!(c.value("E"), Some(ConstValue::U32(0)));

    let c = consts("const A = f32(1.0);");
    assert_eq!(c.codes(), ["W3050"]);
    let d = c.only("W3050");
    assert_eq!(d.severity, Severity::Warning);
    assert_eq!(
        d.message,
        "The conversion `f32(…)` is redundant: its argument already has type f32."
    );
    assert_eq!(c.value("A"), Some(ConstValue::F32(1.0)));

    let c = consts("const A = f32(true);");
    assert_eq!(
        c.only("E3001").message,
        "The conversion `f32(…)` expects an i32, u32 or f32 value, but received bool."
    );
    let c = consts("const A = i32(1, 2);");
    assert_eq!(
        c.only("E3002").message,
        "The conversion `i32(…)` takes 1 argument, but 2 were given."
    );
    let c = consts("const A = bool(1);");
    assert_eq!(c.only("E3001").message, "The type 'bool' cannot be called.");
    let c = consts("const A = quat(1.0);");
    let d = c.only("E3001");
    assert_eq!(d.message, "The type 'quat' cannot be called.");
    assert_eq!(
        d.notes,
        ["help: use one of its constructors: quat.identity(), quat.axis_angle(…), quat.euler(…)"]
    );
}

#[test]
fn constant_cycles_are_e2020_with_the_full_path() {
    let c = consts("const A = B + 1;\nconst B = C;\nconst C = A;");
    let d = c.only("E2020");
    assert_eq!(
        d.message,
        "The constant 'A' is defined in terms of itself: A → B → C → A."
    );
    let related: Vec<&str> = d
        .related
        .iter()
        .map(|l| l.message.as_deref().unwrap_or(""))
        .collect();
    assert_eq!(
        related,
        [
            "'A' uses 'B' here",
            "'B' uses 'C' here",
            "'C' uses 'A' here"
        ]
    );
    assert_eq!(c.codes(), ["E2020"]);
    for name in ["A", "B", "C"] {
        assert_eq!(c.ty(name), "{error}");
        assert_eq!(c.value(name), None);
    }
    // Annotated constants form cycles just the same, and a self-reference is
    // the shortest cycle.
    let c = consts("const A: f32 = A * 2.0;");
    assert_eq!(
        c.only("E2020").message,
        "The constant 'A' is defined in terms of itself: A → A."
    );
    // A constant that uses a cyclic one is not reported again.
    let c = consts("const A = B;\nconst B = A;\nconst C = A + 1;");
    assert_eq!(c.codes(), ["E2020"]);
}

#[test]
fn constants_that_are_not_constant_expressions_are_e3090() {
    let c = checked(
        "scene Demo {\n    camera Main {}\n    const X = Cube.position;\n    const E = Cube;\n    entity Cube { mesh: Box {}; }\n}\n",
    );
    let messages: Vec<&str> = c.diagnostics.iter().map(|d| d.message.as_str()).collect();
    assert_eq!(
        messages,
        [
            "The value of the constant 'X' is not a constant expression: it reads the field 'position' of the entity 'Cube'.",
            "The value of the constant 'E' is not a constant expression: it refers to the entity 'Cube'.",
        ]
    );
    // Reading the field has the field's type.
    assert_eq!(c.ty("X"), "vec3");
    // A call of a user function (decision 0038: never constant in v0.1).
    let c = consts("fn f() -> f32 { return 1.0; }\nconst X = f();");
    assert_eq!(c.codes(), ["E3090"]);
}

#[test]
fn unknown_fields_of_named_entities_are_e5001() {
    let c = checked(
        "scene Demo {\n    camera Main {}\n    const X = Main.speed;\n    entity Cube {}\n}\n",
    );
    let d = c.only("E5001");
    assert_eq!(d.message, "The camera 'Main' has no field 'speed'.");
    assert_eq!(c.codes(), ["E5001"]);
}

#[test]
fn names_that_are_not_values_are_e3001() {
    for (source, message) in [
        ("const A = vec3;", "'vec3' is a type, not a value."),
        ("const A = Box;", "'Box' is a schema, not a value."),
        ("const A = Demo;", "'Demo' is a scene, not a value."),
        (
            "const A = quat.identity;",
            "`quat.identity` is a function, not a value.",
        ),
        (
            "const H = 1.0;\nconst A = H(2.0);",
            "Only functions and constructors can be called, but this expression has type f32.",
        ),
    ] {
        let c = checked(&format!("{source}\nscene Demo {{ camera Main {{}} }}\n"));
        let d = c.only("E3001");
        assert_eq!(d.message, message, "{source}");
    }
    let c = checked(
        "scene Demo {
    camera Main {}
    const A = Main;
}
",
    );
    assert_eq!(c.only("E3001").message, "'Main' is a camera, not a value.");
}

#[test]
fn declared_types_are_checked() {
    let c = consts("const A: f32 = vec3(1.0);");
    let d = c.only("E3001");
    assert_eq!(
        d.message,
        "The constant 'A' is declared as f32, but its value has type vec3."
    );
    assert_eq!(
        (d.expected.as_deref(), d.actual.as_deref()),
        (Some("f32"), Some("vec3"))
    );
    assert_eq!(c.ty("A"), "f32");
    assert_eq!(c.value("A"), None);
    // Unknown types were reported by the resolver; not again.
    let c = consts("const A: vec5 = 1.0;");
    assert_eq!(c.codes(), ["E3003"]);
    let c = consts("const A: vec3<f32, 3> = vec3(1.0);");
    assert_eq!(
        c.only("E3003").message,
        "The type 'vec3' takes no type arguments; only `array<T, N>` does."
    );
}

#[test]
fn descriptor_literals_have_their_schema_type() {
    let c = clean(
        "const B = Box { size: vec3(2, 1, 1) };\nconst S = Sphere { radius: 1; segments: 16 };\nconst M: mesh = Plane {};",
    );
    assert_eq!(c.ty("B"), "Box");
    assert_eq!(
        c.value("B"),
        Some(ConstValue::Struct {
            name: "Box".into(),
            fields: vec![("size".into(), ConstValue::Vec3([2.0, 1.0, 1.0]))],
        })
    );
    // The field types flow into the literals: `radius` is f32, `segments` u32.
    assert_eq!(
        c.value("S"),
        Some(ConstValue::Struct {
            name: "Sphere".into(),
            fields: vec![
                ("radius".into(), ConstValue::F32(1.0)),
                ("segments".into(), ConstValue::U32(16)),
            ],
        })
    );
    assert_eq!(c.ty("M"), "mesh");
    let c = consts("const M: mesh = Unlit {};");
    assert_eq!(
        c.only("E3001").message,
        "The constant 'M' is declared as mesh, but its value has type Unlit."
    );
    // A field value that cannot adopt the field's type: the literal is
    // reported by the type checker, once; a non-literal value of another
    // type by the schema checks.
    let c = consts("const S = Sphere { segments: 2.5 };");
    assert_eq!(c.codes(), ["E3041"]);
    let c = consts("const S = Sphere { segments: vec3(1.0) };");
    assert_eq!(
        c.only("E3102").message,
        "Field 'segments' of Sphere expects u32, but received vec3."
    );
}

#[test]
fn field_values_are_typed_and_folded() {
    let text = "scene Demo {\n    clear_color: #101418;\n    camera Main { position: vec3(0, 1, 5); }\n    entity Cube { scale: vec3(2.0) * 0.5; }\n}\n";
    let c = checked(text);
    assert!(c.diagnostics.is_empty(), "{:#?}", c.diagnostics);
    let mut values: Vec<ConstValue> = (0..200)
        .filter_map(|i| c.typeck.value(crate::syntax::ast::NodeId(i)).cloned())
        .collect();
    values.dedup();
    assert!(values.contains(&ConstValue::Vec3([0.0, 1.0, 5.0])));
    assert!(values.contains(&ConstValue::Vec3([1.0, 1.0, 1.0])));
    assert!(values.iter().any(|v| matches!(v, ConstValue::Color(_))));
}

#[test]
fn intrinsics_resolve_their_overload_from_the_registry_and_fold() {
    let c = clean(
        "const A = sin(1.0);\nconst B = max(1, 2);\nconst C: u32 = max(1, 2);\nconst D = abs(-3);\nconst E = mix(vec3(0.0), vec3(2.0), 0.25);\nconst F = length(vec2(3, 4));\nconst G = dot(vec3(1.0), vec3(1.0, 2.0, 3.0));\nconst H = clamp(1.5, 0, 1);\nconst I: f32 = min(1, 2);\nconst J = cross(vec3(1, 0, 0), vec3(0, 1, 0));\nconst K = round(2.5);\nconst L = transpose(mat4.translation(vec3(1, 2, 3)));",
    );
    assert_eq!(c.value("A"), Some(ConstValue::F32(libm::sin(1.0) as f32)));
    assert_eq!(
        (c.ty("B"), c.value("B")),
        ("i32".into(), Some(ConstValue::I32(2)))
    );
    // All-literal arguments take the expected scalar type.
    assert_eq!(
        (c.ty("C"), c.value("C")),
        ("u32".into(), Some(ConstValue::U32(2)))
    );
    assert_eq!(c.value("D"), Some(ConstValue::I32(3)));
    assert_eq!(c.value("E"), Some(ConstValue::Vec3([0.5; 3])));
    assert_eq!(
        (c.ty("F"), c.value("F")),
        ("f32".into(), Some(ConstValue::F32(5.0)))
    );
    assert_eq!(c.value("G"), Some(ConstValue::F32(6.0)));
    assert_eq!(c.value("H"), Some(ConstValue::F32(1.0)));
    assert_eq!(c.value("I"), Some(ConstValue::F32(1.0)));
    assert_eq!(c.value("J"), Some(ConstValue::Vec3([0.0, 0.0, 1.0])));
    assert_eq!(c.value("K"), Some(ConstValue::F32(2.0)));
    let Some(ConstValue::Mat4(l)) = c.value("L") else {
        panic!()
    };
    assert_eq!(l[0], [1.0, 0.0, 0.0, 1.0]);

    for (source, code, message) in [
        (
            "const A = sin(true);",
            "E3001",
            "No signature of `sin` accepts (bool).",
        ),
        (
            "const A = max(vec3(1.0), 2.0);",
            "E3001",
            "No signature of `max` accepts (vec3, f32).",
        ),
        (
            "const A = dot(1.0, 2.0);",
            "E3001",
            "No signature of `dot` accepts (f32, f32).",
        ),
        (
            "const A = cross(vec2(1.0), vec3(1.0));",
            "E3001",
            "Argument 1 of `cross(a: vec3, b: vec3)` expects vec3, but received vec2.",
        ),
        (
            "const A = clamp(1.0, 2.0);",
            "E3002",
            "`clamp` takes 3 arguments, but 2 were given.",
        ),
        (
            "const A = sin();",
            "E3002",
            "`sin` takes 1 argument, but 0 were given.",
        ),
        (
            "const A = sqrt(-1.0);",
            "E3040",
            "A constant expression has no finite f32 value: sqrt(-1.0) is not finite.",
        ),
        (
            "const A = log(0.0);",
            "E3040",
            "A constant expression has no finite f32 value: log(0.0) is not finite.",
        ),
    ] {
        let c = consts(source);
        assert_eq!(c.codes(), [code], "{source}");
        assert_eq!(c.only(code).message, message, "{source}");
    }
}

#[test]
fn mat4_constructors_fold_column_major() {
    let c = clean(
        "const I = mat4.identity();\nconst T = mat4.translation(vec3(1, 2, 3));\nconst S = mat4.scale(vec3(2.0));\nconst R = mat4.rotation(quat.identity());\nconst C = mat4.columns(vec4(1.0), vec4(2.0), vec4(3.0), vec4(4.0));\nconst P = T * vec4(0, 0, 0, 1);\nconst M = T * S;",
    );
    assert_eq!(c.ty("I"), "mat4");
    assert_eq!(c.value("I"), c.value("R"));
    let Some(ConstValue::Mat4(t)) = c.value("T") else {
        panic!()
    };
    assert_eq!(t[3], [1.0, 2.0, 3.0, 1.0]);
    let Some(ConstValue::Mat4(columns)) = c.value("C") else {
        panic!()
    };
    assert_eq!(columns[2], [3.0; 4]);
    assert_eq!(c.value("P"), Some(ConstValue::Vec4([1.0, 2.0, 3.0, 1.0])));
    let Some(ConstValue::Mat4(m)) = c.value("M") else {
        panic!()
    };
    assert_eq!(m[0], [2.0, 0.0, 0.0, 0.0]);
    assert_eq!(m[3], [1.0, 2.0, 3.0, 1.0]);
    // A rotation matrix rotates like its quaternion.
    let c = clean(
        "const Q = quat.axis_angle(vec3(0, 0, 1), 1.5707964);\nconst V = mat4.rotation(Q) * vec4(1, 0, 0, 0);",
    );
    let Some(ConstValue::Vec4(v)) = c.value("V") else {
        panic!()
    };
    assert!(v[0].abs() < 1.0e-6 && (v[1] - 1.0).abs() < 1.0e-6, "{v:?}");
    let c = consts("const A = mat4.translation(vec4(1.0));");
    assert_eq!(
        c.only("E3001").message,
        "Argument 1 of `mat4.translation(v: vec3)` expects vec3, but received vec4."
    );
}

#[test]
fn strings_are_values_without_operators() {
    let c = clean("const TITLE = \"Show\\troom\";\nconst SAME: string = TITLE;");
    assert_eq!(c.ty("SAME"), "string");
    assert_eq!(c.value("SAME"), Some(ConstValue::Str("Show\troom".into())));
    let c = consts("const A = \"a\" + \"b\";");
    assert_eq!(
        c.only("E3014").message,
        "The operator `+` is not defined for string and string."
    );
    let c = consts("const A = \"a\" == \"a\";");
    assert_eq!(c.codes(), ["E3014"]);
}

#[test]
fn arrays_literals_lengths_and_indexing() {
    let c = clean(
        "const N: u32 = 3;\nconst A = [1, 2, 3];\nconst B = [1, 2.5];\nconst C: array<f32, N> = [1, 2, 3];\nconst D = [vec2(1.0), vec2(0, 1)];\nconst E = A[2];\nconst F = D[1].y;\nconst G = [[1, 2], [3, 4]][1][0];\nconst M = mat4.translation(vec3(1, 2, 3))[3];\nconst H: array<u32, 2> = [7, 8];\nconst I = H[N - 2];",
    );
    assert_eq!(c.ty("A"), "array<i32, 3>");
    assert_eq!(
        c.value("A"),
        Some(ConstValue::Array(vec![
            ConstValue::I32(1),
            ConstValue::I32(2),
            ConstValue::I32(3)
        ]))
    );
    assert_eq!(c.ty("B"), "array<f32, 2>");
    assert_eq!(c.ty("C"), "array<f32, 3>");
    assert_eq!(c.ty("D"), "array<vec2, 2>");
    assert_eq!(c.value("E"), Some(ConstValue::I32(3)));
    assert_eq!(c.value("F"), Some(ConstValue::F32(1.0)));
    assert_eq!(c.value("G"), Some(ConstValue::I32(3)));
    assert_eq!(c.value("M"), Some(ConstValue::Vec4([1.0, 2.0, 3.0, 1.0])));
    assert_eq!(c.value("I"), Some(ConstValue::U32(8)));

    for (source, code, message) in [
        (
            "const A = [1.0, 2.0][2];",
            "E3030",
            "The index 2 is out of range for array<f32, 2>: valid indices are 0 to 1.",
        ),
        (
            "const A = [1.0, 2.0][-1];",
            "E3030",
            "The index -1 is out of range for array<f32, 2>: valid indices are 0 to 1.",
        ),
        (
            "const A = mat4.identity()[4];",
            "E3030",
            "The index 4 is out of range for mat4: valid indices are 0 to 3.",
        ),
        (
            "const A: array<f32, 0> = [1.0];",
            "E3031",
            "Invalid array length: the length is 0.",
        ),
        (
            "const A: array<f32, 65537> = [1.0];",
            "E3031",
            "Invalid array length: the length is 65537.",
        ),
        (
            "const L = -2;\nconst A: array<f32, L> = [1.0];",
            "E3031",
            "Invalid array length: the constant 'L' is -2.",
        ),
        (
            "const L = 2.0;\nconst A: array<f32, L> = [1.0, 2.0];",
            "E3031",
            "Invalid array length: the constant 'L' has the value 2.0, which is not an integer.",
        ),
        (
            "const A: array = [1.0];",
            "E3003",
            "The type 'array' needs an element type and a length: `array<T, N>`.",
        ),
        (
            "const A = [1.0, vec2(1.0)];",
            "E3001",
            "Element 1 of the array literal has type f32, but the elements of this array have type vec2.",
        ),
        (
            "const A: array<vec3, 2> = [vec3(1.0), 2.0];",
            "E3001",
            "Element 2 of the array literal must be vec3, but it has type f32.",
        ),
        (
            "const A: array<f32, 3> = [1.0, 2.0];",
            "E3001",
            "The constant 'A' is declared as array<f32, 3>, but its value has type array<f32, 2>.",
        ),
        (
            "const A = [1.0][0.0];",
            "E3001",
            "An index must be an i32 or u32, but this one has type f32.",
        ),
        (
            "const A = vec3(1.0)[0];",
            "E3001",
            "Only arrays and mat4 can be indexed, but this expression has type vec3.",
        ),
    ] {
        let c = consts(source);
        assert_eq!(c.codes(), [code], "{source}");
        assert_eq!(c.only(code).message, message, "{source}");
    }
    // A constant used as a length is evaluated first, whatever the order.
    let c = clean("const A: array<f32, N> = [1.0, 2.0];\nconst N = 2;");
    assert_eq!(c.ty("A"), "array<f32, 2>");
    let c = consts("const A: array<f32, A> = [1.0];");
    assert_eq!(c.codes(), ["E2020"]);
}

#[test]
fn structs_declare_types_literals_fold_in_declaration_order() {
    let c = clean(
        "const P = Pair { b: vec3(1, 2, 3); a: 0.5 };\nstruct Pair { a: f32; b: vec3; }\nconst B = P.b.y;\nconst W: Wrap = Wrap { pairs: [P, Pair { a: 1; b: vec3(0.0) }]; n: N };\nstruct Wrap { pairs: array<Pair, N>; n: u32; }\nconst N: u32 = 2;\nconst A = W.pairs[1].a;",
    );
    assert_eq!(c.ty("P"), "Pair");
    assert_eq!(
        c.value("P"),
        Some(ConstValue::Struct {
            name: "Pair".into(),
            fields: vec![
                ("a".into(), ConstValue::F32(0.5)),
                ("b".into(), ConstValue::Vec3([1.0, 2.0, 3.0])),
            ],
        })
    );
    assert_eq!(c.value("B"), Some(ConstValue::F32(2.0)));
    assert_eq!(c.ty("W"), "Wrap");
    assert_eq!(c.value("A"), Some(ConstValue::F32(1.0)));

    for (source, code, message) in [
        (
            "struct Node { value: f32; next: Node; }",
            "E3020",
            "The struct 'Node' contains itself: Node → Node.",
        ),
        (
            "struct A { b: array<B, 2>; }\nstruct B { a: A; }",
            "E3020",
            "The struct 'A' contains itself: A → B → A.",
        ),
        (
            "struct Pair { a: f32; b: f32; }\nconst P = Pair { a: 1.0 };",
            "E3021",
            "The struct literal Pair is missing the field 'b'.",
        ),
        (
            "struct Trio { a: f32; b: f32; c: f32; }\nconst P = Trio { a: 1.0 };",
            "E3021",
            "The struct literal Trio is missing the fields 'b' and 'c'.",
        ),
        (
            "struct Pair { a: f32; b: f32; }\nconst P = Pair { a: 1.0; b: 2.0; a: 3.0 };",
            "E3022",
            "The field 'a' of struct Pair is given twice.",
        ),
        (
            "struct Pair { a: f32; a: vec3; }",
            "E3022",
            "The struct 'Pair' declares the field 'a' twice.",
        ),
        (
            "struct Pair { a: f32; b: f32; }\nconst P = Pair { a: 1.0; b: 2.0; c: 3.0 };",
            "E3023",
            "The struct Pair has no field 'c'.",
        ),
        (
            "struct Pair { a: f32; b: f32; }\nconst P = Pair { a: 1.0; b: 2.0 };\nconst C = P.c;",
            "E3023",
            "The struct Pair has no field 'c'.",
        ),
        (
            "struct Pair { a: f32; b: f32; }\nconst P = Pair { a: vec3(1.0); b: 2.0 };",
            "E3001",
            "Field 'a' of struct Pair expects f32, but received vec3.",
        ),
        (
            "struct Pair { a: f32; b: f32; }\nconst P: Pair<f32, 2> = Pair { a: 1.0; b: 2.0 };",
            "E3003",
            "The type 'Pair' takes no type arguments; only `array<T, N>` does.",
        ),
        (
            "struct Pair { a: f32; b: f32; }\nconst P = Pair;",
            "E3001",
            "'Pair' is a struct, not a value.",
        ),
        (
            "struct Sized { v: array<f32, L>; }\nconst L: Sized = Sized { v: [1.0] };",
            "E2020",
            "The constant 'L' is defined in terms of itself: L → Sized → L.",
        ),
    ] {
        let c = consts(source);
        assert_eq!(c.codes(), [code], "{source}");
        assert_eq!(c.only(code).message, message, "{source}");
    }
    // A did-you-mean for an unknown field.
    let c = consts("struct Pair { alpha: f32; }\nconst P = Pair { alpah: 1.0 };");
    assert_eq!(c.codes(), ["E3023"]);
    assert!(
        c.only("E3023")
            .notes
            .contains(&"help: did you mean 'alpha'?".to_owned()),
        "{:?}",
        c.only("E3023").notes
    );
}

#[test]
fn gated_constructs_are_not_typed_or_reported_again() {
    for source in ["const F = frame.time;", "const K = Key.A;"] {
        let c = consts(source);
        assert_eq!(c.codes(), ["E9010"], "{source}");
    }
}

#[test]
fn every_construct_the_checker_does_not_type_is_gated_in_this_build() {
    // The checker skips these (`Ty::Error`, no descent): they must be gated,
    // so the resolver reports them. When a milestone implements one, this
    // test fails until the checker types it.
    for construct in [
        Construct::Prefab,
        Construct::State,
        Construct::PrefabInstance,
        Construct::LifecycleFn,
        Construct::Handler,
        Construct::Bind,
        Construct::SelfValue,
    ] {
        assert!(!construct_implemented(construct), "{construct:?}");
    }
}

#[test]
fn diagnostics_have_the_catalogue_severity() {
    let c = consts("const A = f32(1.0);\nconst B = vec2(1.0).z;");
    for d in &c.diagnostics {
        assert_eq!(d.severity, d.code.severity());
        assert!(matches!(d.code, Code::W3050 | Code::E3013));
    }
}

// ----- functions and statements (decision 0038) ---------------------------

/// The type of the local, parameter or loop variable `name`.
fn local_ty(c: &Checked, name: &str) -> String {
    let def = c
        .resolution
        .defs()
        .iter()
        .find(|d| {
            d.name == name
                && matches!(
                    d.kind,
                    DefKind::Local { .. } | DefKind::FnParam | DefKind::LoopVar
                )
        })
        .unwrap_or_else(|| panic!("no local {name}"));
    c.typeck.display(c.typeck.local_ty(def.id).expect("typed"))
}

#[test]
fn a_function_using_every_statement_checks_cleanly() {
    let c = clean(
        "struct Pair { a: f32; b: vec3; }
const N: u32 = 3;
fn helper(x: f32) -> f32 { return x * 0.5; }
fn every(p: Pair, xs: array<f32, 3>, flag: bool) -> vec3 {
    let k = 2;
    let half = helper(p.a);
    var v = p.b;
    var count: u32 = 0;
    const LOCAL: f32 = 4.0 * 2.0;
    v.y = half + LOCAL;
    v *= 2.0;
    v += vec3(1.0);
    for i in 0..N {
        count += i;
        if i == 2 { break; } else if i == 7 { continue; }
    }
    for x in xs {
        v.x -= x;
    }
    { let inner = k * 2; v.z /= f32(inner); }
    if flag && count > 1 {
        return v;
    } else {
        return -v;
    }
}
cpu fn noisy() { helper(1.0); }",
    );
    assert_eq!(local_ty(&c, "k"), "i32");
    assert_eq!(local_ty(&c, "half"), "f32");
    assert_eq!(local_ty(&c, "v"), "vec3");
    assert_eq!(local_ty(&c, "count"), "u32");
    assert_eq!(local_ty(&c, "i"), "u32");
    assert_eq!(local_ty(&c, "x"), "f32");
    assert_eq!(local_ty(&c, "p"), "Pair");
    assert_eq!(c.value("LOCAL"), Some(ConstValue::F32(8.0)));
    let every = c
        .typeck
        .functions()
        .find(|(_, f)| f.name == "every")
        .map(|(_, f)| f)
        .unwrap();
    assert_eq!(every.sig.params.len(), 3);
    assert_eq!(c.typeck.display(every.sig.ret), "vec3");
    assert_eq!(every.facts.calls.len(), 1, "{:?}", every.facts);
    assert!(every.facts.unbounded_loops.is_empty());
}

#[test]
fn statements_after_a_leaving_statement_are_w3081_once_per_block() {
    let c = consts(
        "fn f(x: f32) -> f32 {
    for i in 0..3 { break; let a = 1; let b = 2; }
    if x > 0.0 { return 1.0; } else { return 2.0; }
    let dead = 3.0;
    return dead;
}",
    );
    assert_eq!(c.codes(), ["W3081", "W3081"], "{:#?}", c.diagnostics);
    assert_eq!(
        c.diagnostics[0].message,
        "Unreachable code: it follows a `break`, which always leaves the block."
    );
    assert_eq!(
        c.diagnostics[1].message,
        "Unreachable code: it follows an `if` whose every branch leaves the block, which always leaves the block."
    );
}

#[test]
fn a_var_never_assigned_is_w2010_and_one_assigned_through_a_component_is_not() {
    let c = consts("fn f() -> f32 { var a = 1.0; var v = vec3(0.0); v.x = 2.0; return a + v.x; }");
    assert_eq!(c.codes(), ["W2010"], "{:#?}", c.diagnostics);
    assert_eq!(
        c.diagnostics[0].message,
        "The variable 'a' is never reassigned; declare it with `let`."
    );
}

#[test]
fn component_assignment_needs_a_vector_var() {
    for (source, message) in [
        (
            "fn f(q: quat) -> quat { var r = q; r.x = 1.0; return r; }",
            "Cannot assign to a component of a quat value: only single components of vectors are assignable.",
        ),
        (
            "fn f(v: vec3) -> vec3 { let w = v; w.x = 1.0; return w; }",
            "Cannot assign to the local 'w': it is declared with `let`.",
        ),
        (
            "fn f() { helper() = 1.0; }\nfn helper() -> f32 { return 1.0; }",
            "This expression is not an assignable place.",
        ),
    ] {
        let c = consts(source);
        assert_eq!(c.only("E3061").message, message, "{source}");
    }
}

#[test]
fn literals_in_bodies_adopt_the_type_their_context_needs() {
    // A range of literals is i32; a literal bound next to u32 is u32; a
    // compound assignment's literal adopts the place's type.
    let c = clean(
        "fn f(n: u32) -> u32 { var t: u32 = 0; for i in 0..n { t += 1; } for j in 0..4 { t *= 2; } return t; }",
    );
    assert_eq!(local_ty(&c, "i"), "u32");
    assert_eq!(local_ty(&c, "j"), "i32");
}

#[test]
fn calls_type_against_imported_and_local_signatures_in_any_order() {
    // A call before the declaration it calls.
    let c = clean("fn a() -> f32 { return b(2.0); }\nfn b(x: f32) -> f32 { return x; }");
    let calls: Vec<_> = c
        .typeck
        .functions()
        .flat_map(|(_, f)| f.facts.calls.clone())
        .collect();
    assert_eq!(calls.len(), 1);
    // Unknown parameter types are errors once (the resolver's), and the
    // function is still checked.
    let c = consts("fn f(x: Nope) -> f32 { return 1.0; }");
    assert_eq!(c.codes(), ["E3003"]);
}
