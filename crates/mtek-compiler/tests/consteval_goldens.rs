//! Golden bit patterns of constant evaluation (`spec/language.md` sections
//! 5.4, 6.3 to 6.7; task M1-10).
//!
//! Each case is a constant declared in a one-scene project and checked with
//! `mtek_compiler::analyze`; its folded value must have exactly the expected
//! bits. The expected values are computed **independently** here: colour
//! literals from `c / 255` in `f64` through the sRGB EOTF with `libm::pow`,
//! rounded once with `as f32`; `color.srgb` with the binary32 formula of
//! decision 0024 item 6; quaternions from `libm::sinf`/`libm::cosf`; the rest
//! as literal hexadecimal bit patterns or Rust binary32 arithmetic. The bits
//! do not depend on the host: the compiler uses only correctly rounded binary32
//! operations and the pure-Rust `libm`.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::analyze;
use mtek_compiler::diagnostics::Severity;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::DefKind;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::types::ConstValue;

/// The folded value of the constant `X` declared as `const X<decl>;`, e.g.
/// `decl = " = 1.0 / 3.0"` or `decl = ": u32 = 16 * 2"`.
fn fold(decl: &str) -> ConstValue {
    let source = format!("const X{decl};\n\nscene Demo {{\n    camera Main {{}}\n}}\n");
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"golden\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), source.as_str());
    let result = analyze(&ProjectRoot::at_base(), &fs);
    let errors: Vec<_> = result
        .report
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "const X{decl}: {errors:#?}");
    let resolution = result.resolution.unwrap();
    let types = result.types.unwrap();
    let def = resolution
        .defs()
        .iter()
        .find(|d| d.kind == DefKind::Const && d.name == "X")
        .unwrap();
    types
        .const_info(def.id)
        .and_then(|info| info.value.clone())
        .unwrap_or_else(|| panic!("const X{decl} was not folded"))
}

fn bits(values: &[f32]) -> Vec<u32> {
    values.iter().map(|v| v.to_bits()).collect()
}

/// The components of a vector, quaternion or colour value, or a scalar.
fn floats(value: &ConstValue) -> Vec<f32> {
    match value {
        ConstValue::F32(v) => vec![*v],
        other => other
            .components()
            .unwrap_or_else(|| panic!("{other:?} has no f32 components"))
            .to_vec(),
    }
}

/// The sRGB EOTF of an 8-bit channel, in `f64`, rounded once to `f32`.
fn eotf(c8: u8) -> f32 {
    let c = f64::from(c8) / 255.0;
    let linear = if c <= 0.04045 {
        c / 12.92
    } else {
        libm::pow((c + 0.055) / 1.055, 2.4)
    };
    linear as f32
}

/// The binary32 transfer function of `color.srgb` (decision 0024 item 6).
fn srgb32(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        libm::powf((c + 0.055) / 1.055, 2.4)
    }
}

#[test]
fn colour_literals_match_the_f64_eotf_rounded_once() {
    for (literal, rgba) in [
        ("#6b5cff", [0x6b, 0x5c, 0xff, 0xff]),
        ("#000000", [0x00, 0x00, 0x00, 0xff]),
        ("#ffffff", [0xff, 0xff, 0xff, 0xff]),
        // Below the knee of the transfer function (linear segment).
        ("#0a0a0a", [0x0a, 0x0a, 0x0a, 0xff]),
        ("#808080", [0x80, 0x80, 0x80, 0xff]),
        ("#101418", [0x10, 0x14, 0x18, 0xff]),
        ("#FFCC00", [0xff, 0xcc, 0x00, 0xff]),
        ("#10141880", [0x10, 0x14, 0x18, 0x80]),
    ] {
        let value = fold(&format!(" = {literal}"));
        let ConstValue::Color(linear) = value else {
            panic!("{literal}: {value:?}")
        };
        let [r, g, b, a] = rgba;
        let expected = [eotf(r), eotf(g), eotf(b), (f64::from(a) / 255.0) as f32];
        assert_eq!(bits(&linear), bits(&expected), "{literal}");
    }
}

#[test]
fn the_brand_colour_has_these_bits() {
    // `#6b5cff` (the blueprint's example colour), spelled out.
    let ConstValue::Color(linear) = fold(" = #6b5cff") else {
        panic!()
    };
    let expected = [eotf(0x6b), eotf(0x5c), eotf(0xff), 1.0];
    assert_eq!(bits(&linear), bits(&expected));
    // Pinned, so that a change of `libm` or of the conversion shows up on
    // every host (0.147027… and 0.107023… in linear light).
    assert_eq!(
        bits(&linear),
        [0x3e16_8e51, 0x3ddb_2eee, 0x3f80_0000, 0x3f80_0000]
    );
    println!(
        "#6b5cff -> r {:#010x} g {:#010x} b {:#010x} a {:#010x}",
        linear[0].to_bits(),
        linear[1].to_bits(),
        linear[2].to_bits(),
        linear[3].to_bits()
    );
}

#[test]
fn colour_functions_fold_in_binary32() {
    let value = fold(" = color.srgb(vec3(0.5, 0.04045, 1.0), 0.25)");
    assert_eq!(
        bits(&floats(&value)),
        bits(&[srgb32(0.5), srgb32(0.04045), srgb32(1.0), 0.25])
    );
    let value = fold(" = color.linear(vec3(0.25, 0.5, 1), 1)");
    assert_eq!(bits(&floats(&value)), bits(&[0.25, 0.5, 1.0, 1.0]));
    // Components of a literal colour are its linear channels.
    let value = fold(" = #6b5cff.rgb");
    assert_eq!(
        bits(&floats(&value)),
        bits(&[eotf(0x6b), eotf(0x5c), eotf(0xff)])
    );
}

#[test]
fn scalar_arithmetic_has_these_bits() {
    for (decl, expected) in [
        (" = 1.0 / 3.0", 0x3eaa_aaab_u32),
        (" = 0.1", 0x3dcc_cccd),
        (" = 0.1 + 0.2", 0x3e99_999a),
        (" = 2.0 / 3.0", 0x3f2a_aaab),
        (" = 16777216.0 + 1.0", 0x4b80_0000),
        (" = -0.2", 0xbe4c_cccd),
        (" = 2.5e-3", 0x3b23_d70a),
        // One rounding from the decimal text (an f64 detour would give 1.0).
        (" = 1.000000059604644775390625000001", 0x3f80_0001),
        // An integer literal in an f32 context, rounded to nearest even.
        (": f32 = 16777217", 0x4b80_0000),
        (": f32 = 1 / 3", 0x3eaa_aaab),
        (" = f32(16777217)", 0x4b80_0000),
        (" = f32(-2147483648)", 0xcf00_0000),
    ] {
        let value = fold(decl);
        assert_eq!(bits(&floats(&value)), [expected], "const X{decl}");
    }
    // The same results as Rust binary32 arithmetic.
    assert_eq!(
        floats(&fold(" = 0.7 * 3.0 - 1.1 / 7.0")),
        [0.7_f32 * 3.0_f32 - 1.1_f32 / 7.0_f32]
    );
}

#[test]
fn remainders_and_boolean_operators() {
    // `%` on f32 is the exact remainder `x - y * trunc(x / y)` (C `fmod`,
    // decision 0035), computed here independently in binary64.
    let rem = |x: f32, y: f32| (f64::from(x) % f64::from(y)) as f32;
    for (decl, x, y) in [
        (" = 7.5 % 2.0", 7.5_f32, 2.0_f32),
        (" = 5.3 % 1.1", 5.3, 1.1),
        (" = -5.3 % 1.1", -5.3, 1.1),
        (" = 0.7 % -0.2", 0.7, -0.2),
        (" = 1.0e30 % 3.0", 1.0e30, 3.0),
    ] {
        assert_eq!(bits(&floats(&fold(decl))), [rem(x, y).to_bits()], "{decl}");
    }
    // Pinned: 5.3 % 1.1 in binary32.
    assert_eq!(bits(&floats(&fold(" = 5.3 % 1.1"))), [0x3f66_6668]);
    for (decl, expected) in [
        (" = 7 % 3", ConstValue::I32(1)),
        (" = -7 % 3", ConstValue::I32(-1)),
        (" = 7 % -3", ConstValue::I32(1)),
        (" = 2147483647 % -1", ConstValue::I32(0)),
        (": u32 = 4294967295 % 10", ConstValue::U32(5)),
        (" = 1 < 2", ConstValue::Bool(true)),
        (" = 2.0 <= 1.5", ConstValue::Bool(false)),
        (" = -0.0 == 0.0", ConstValue::Bool(true)),
        (" = 16777217 == 16777216", ConstValue::Bool(false)),
        (": bool = !(true && false) || false", ConstValue::Bool(true)),
    ] {
        assert_eq!(fold(decl), expected, "const X{decl}");
    }
}

#[test]
fn integer_constants() {
    for (decl, expected) in [
        (" = -2147483648", ConstValue::I32(i32::MIN)),
        (" = 2147483647", ConstValue::I32(i32::MAX)),
        (": u32 = 4294967295", ConstValue::U32(u32::MAX)),
        (": u32 = 16 * 2", ConstValue::U32(32)),
        (" = -7 / 2", ConstValue::I32(-3)),
        (" = i32(-2.9)", ConstValue::I32(-2)),
        (" = i32(3.0e9)", ConstValue::I32(2_147_483_520)),
        (" = u32(-1)", ConstValue::U32(u32::MAX)),
        (" = u32(-0.5)", ConstValue::U32(0)),
    ] {
        assert_eq!(fold(decl), expected, "const X{decl}");
    }
}

#[test]
fn vectors_fold_component_wise() {
    let value = fold(" = vec3(1, 2, 3).zyx * 0.5");
    assert_eq!(bits(&floats(&value)), bits(&[1.5, 1.0, 0.5]));
    let value = fold(" = vec4(vec2(0.1, 0.2), 0.3, 1) / 3.0");
    assert_eq!(
        bits(&floats(&value)),
        bits(&[0.1_f32 / 3.0, 0.2_f32 / 3.0, 0.3_f32 / 3.0, 1.0_f32 / 3.0])
    );
    let value = fold(" = 2 * vec2(0.1) - vec2(0.05, 0.3)");
    assert_eq!(
        bits(&floats(&value)),
        bits(&[2.0_f32 * 0.1 - 0.05, 2.0_f32 * 0.1 - 0.3])
    );
}

#[test]
fn quaternion_constructors() {
    // axis_angle with a non-unit axis: normalised, then (n sin(a/2), cos(a/2)).
    let value = fold(" = quat.axis_angle(vec3(0, 3, 0), 1.0)");
    assert_eq!(
        bits(&floats(&value)),
        bits(&[0.0, libm::sinf(0.5), 0.0, libm::cosf(0.5)])
    );
    // A zero axis is the identity.
    let value = fold(" = quat.axis_angle(vec3(0.0), 2.0)");
    assert_eq!(bits(&floats(&value)), bits(&[0.0, 0.0, 0.0, 1.0]));
    assert_eq!(
        fold(" = quat.identity()"),
        ConstValue::Quat([0.0, 0.0, 0.0, 1.0])
    );
    // euler with a single angle is that single rotation, bit for bit.
    for (decl, axis) in [
        (" = quat.euler(0.0, 1.25, 0.0)", 1),
        (" = quat.euler(1.25, 0.0, 0.0)", 0),
        (" = quat.euler(0.0, 0.0, 1.25)", 2),
    ] {
        let mut expected = [0.0, 0.0, 0.0, libm::cosf(0.625)];
        expected[axis] = libm::sinf(0.625);
        let got = floats(&fold(decl));
        // Signs of zero may differ through the products with zeros.
        assert!(
            got.iter().zip(&expected).all(|(a, b)| a == b),
            "{decl}: {got:?} {expected:?}"
        );
    }
}

/// The Hamilton product and the rotation of a vector, written out here for
/// the checks below.
fn mul(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    let [ax, ay, az, aw] = a;
    let [bx, by, bz, bw] = b;
    [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

fn rotate(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    // q v q* computed in f64, independently of the compiler's formula.
    let q64 = q.map(f64::from);
    let p = [f64::from(v[0]), f64::from(v[1]), f64::from(v[2]), 0.0];
    let m = |a: [f64; 4], b: [f64; 4]| {
        let [ax, ay, az, aw] = a;
        let [bx, by, bz, bw] = b;
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ]
    };
    let conj = [-q64[0], -q64[1], -q64[2], q64[3]];
    let r = m(m(q64, p), conj);
    [r[0] as f32, r[1] as f32, r[2] as f32]
}

fn quat_of(decl: &str) -> [f32; 4] {
    match fold(decl) {
        ConstValue::Quat(q) => q,
        other => panic!("{decl}: {other:?}"),
    }
}

#[test]
fn euler_is_y_times_x_times_z() {
    let q = quat_of(" = quat.euler(0.3, -1.2, 0.8)");
    let qx = quat_of(" = quat.axis_angle(vec3(1, 0, 0), 0.3)");
    let qy = quat_of(" = quat.axis_angle(vec3(0, 1, 0), -1.2)");
    let qz = quat_of(" = quat.axis_angle(vec3(0, 0, 1), 0.8)");
    // Bit-exact: the definition, in the specified order.
    assert_eq!(bits(&q), bits(&mul(mul(qy, qx), qz)));
    // A unit quaternion within rounding.
    let norm: f32 = q.iter().map(|c| c * c).sum();
    assert!((norm - 1.0).abs() <= 4.0 * f32::EPSILON, "{norm}");
}

#[test]
fn quaternions_rotate_vectors() {
    // A quarter turn about +Z takes +X to +Y.
    let ConstValue::Vec3(v) = fold(" = quat.axis_angle(vec3(0, 0, 1), 1.5707964) * vec3(1, 0, 0)")
    else {
        panic!()
    };
    assert!(
        (v[0]).abs() < 1.0e-6 && (v[1] - 1.0).abs() < 1.0e-6 && v[2] == 0.0,
        "{v:?}"
    );
    // Euler rotates about Z, then X, then Y (fixed world axes): the folded
    // rotation agrees with q v q* evaluated independently in f64.
    let q = quat_of(" = quat.euler(0.3, -1.2, 0.8)");
    let ConstValue::Vec3(folded) = fold(" = quat.euler(0.3, -1.2, 0.8) * vec3(1, 2, 3)") else {
        panic!()
    };
    let reference = rotate(q, [1.0, 2.0, 3.0]);
    for (a, b) in folded.iter().zip(&reference) {
        assert!((a - b).abs() <= 1.0e-5, "{folded:?} {reference:?}");
    }
    // Composition: (a * b) * v == a * (b * v) within rounding.
    let ConstValue::Vec3(composed) = fold(
        " = (quat.axis_angle(vec3(0, 1, 0), 0.4) * quat.axis_angle(vec3(1, 0, 0), 0.9)) * vec3(0.5, -1, 2)",
    ) else {
        panic!()
    };
    let ConstValue::Vec3(stepwise) = fold(
        " = quat.axis_angle(vec3(0, 1, 0), 0.4) * (quat.axis_angle(vec3(1, 0, 0), 0.9) * vec3(0.5, -1, 2))",
    ) else {
        panic!()
    };
    for (a, b) in composed.iter().zip(&stepwise) {
        assert!((a - b).abs() <= 1.0e-5, "{composed:?} {stepwise:?}");
    }
}

#[test]
fn descriptors_fold_to_struct_values() {
    assert_eq!(
        fold(" = Sphere { radius: 0.5; segments: 16 * 2 }"),
        ConstValue::Struct {
            name: "Sphere".to_owned(),
            fields: vec![
                ("radius".to_owned(), ConstValue::F32(0.5)),
                ("segments".to_owned(), ConstValue::U32(32)),
            ],
        }
    );
}

#[test]
fn intrinsics_fold_with_libm_in_binary32() {
    // Each expected value is the documented formula (decision 0035 item 3)
    // evaluated here with Rust binary32 operations and binary64 `libm`
    // rounded once (the run-time library's rounding, decision 0037 item 5).
    for (decl, expected) in [
        (" = sin(1.0)", (libm::sin(1.0) as f32)),
        (" = cos(0.5)", (libm::cos(0.5) as f32)),
        (" = tan(0.5)", (libm::tan(0.5) as f32)),
        (" = asin(0.5)", (libm::asin(0.5) as f32)),
        (" = acos(0.5)", (libm::acos(0.5) as f32)),
        (" = atan(2.0)", (libm::atan(2.0) as f32)),
        (" = atan2(1.0, -1.0)", (libm::atan2(1.0, -1.0) as f32)),
        (" = pow(2.0, 0.5)", (libm::pow(2.0, 0.5) as f32)),
        (" = exp(1.0)", (libm::exp(1.0) as f32)),
        (" = exp2(0.5)", (libm::exp2(0.5) as f32)),
        (" = log(2.0)", (libm::log(2.0) as f32)),
        (" = log2(10.0)", (libm::log2(10.0) as f32)),
        (" = sqrt(2.0)", 2.0_f32.sqrt()),
        (" = inverse_sqrt(2.0)", (1.0 / 2.0_f64.sqrt()) as f32),
        (
            " = radians(90.0)",
            90.0 * ((std::f64::consts::PI / 180.0) as f32),
        ),
        (" = degrees(1.0)", (180.0 / std::f64::consts::PI) as f32),
        (" = fract(-1.1)", -1.1_f32 - (-2.0)),
        (" = round(2.5)", 2.0),
        (" = round(-3.5)", -4.0),
        (" = mix(0.1, 0.7, 0.3)", 0.1 * (1.0 - 0.3) + 0.7 * 0.3),
        (" = smoothstep(0.0, 2.0, 0.5)", {
            let t = 0.5_f32 / 2.0;
            t * t * (3.0 - 2.0 * t)
        }),
        (" = length(vec3(1.0, 2.0, 2.0))", 3.0),
        (
            " = length(vec2(0.1, 0.2))",
            (0.1_f32 * 0.1 + 0.2 * 0.2).sqrt(),
        ),
        (" = distance(vec2(0.5), vec2(0.1, 0.9))", {
            let (dx, dy) = (0.5_f32 - 0.1, 0.5_f32 - 0.9);
            (dx * dx + dy * dy).sqrt()
        }),
        (" = dot(vec3(0.1, 0.2, 0.3), vec3(0.4, 0.5, 0.6))", {
            0.1_f32 * 0.4 + 0.2 * 0.5 + 0.3 * 0.6
        }),
    ] {
        assert_eq!(
            bits(&floats(&fold(decl))),
            [expected.to_bits()],
            "const X{decl}"
        );
    }
    // Pinned on every host: sin(1) and pow(2, 0.5) in binary32.
    assert_eq!(bits(&floats(&fold(" = sin(1.0)"))), [0x3f57_6aa4]);
    assert_eq!(bits(&floats(&fold(" = pow(2.0, 0.5)"))), [0x3fb5_04f3]);
    // Component-wise and integer overloads.
    let v = fold(" = normalize(vec3(1.0, 2.0, 2.0))");
    assert_eq!(bits(&floats(&v)), bits(&[1.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0]));
    let v = fold(" = sin(vec2(0.25, 0.75))");
    assert_eq!(
        bits(&floats(&v)),
        bits(&[libm::sin(0.25) as f32, libm::sin(0.75) as f32])
    );
    assert_eq!(fold(" = abs(-2147483648)"), ConstValue::I32(i32::MIN));
    assert_eq!(fold(": u32 = clamp(9, 2, 5)"), ConstValue::U32(5));
}

#[test]
fn mat4_constructors_fold_column_major() {
    let ConstValue::Mat4(r) = fold(" = mat4.rotation(quat.axis_angle(vec3(0, 1, 0), 0.5))") else {
        panic!()
    };
    // The rotation matrix of q = (0, s, 0, c), from the documented formula.
    let (s, c) = (libm::sinf(0.25), libm::cosf(0.25));
    let (yy, wy) = (s * s, c * s);
    let expected = [
        [
            1.0 - 2.0 * (yy + 0.0),
            2.0 * (0.0 + 0.0),
            2.0 * (0.0 - wy),
            0.0,
        ],
        [
            2.0 * (0.0 - 0.0),
            1.0 - 2.0 * (0.0 + 0.0),
            2.0 * (0.0 + 0.0),
            0.0,
        ],
        [
            2.0 * (0.0 + wy),
            2.0 * (0.0 - 0.0),
            1.0 - 2.0 * (0.0 + yy),
            0.0,
        ],
        [0.0, 0.0, 0.0, 1.0],
    ];
    for (column, want) in r.iter().zip(&expected) {
        assert_eq!(bits(column), bits(want));
    }
    assert_eq!(
        fold(" = mat4.translation(vec3(1, 2, 3)) * vec4(1, 1, 1, 1)"),
        ConstValue::Vec4([2.0, 3.0, 4.0, 1.0])
    );
}
