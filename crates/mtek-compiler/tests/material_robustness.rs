//! Robustness of material checking (`spec/testing.md` section 3.3,
//! `spec/compiler-architecture.md` section 3, decision 0039). Random
//! programs of materials — params of every kind of type with good and bad
//! defaults, stage functions with every signature, bodies that read params,
//! the stage input, constants, functions, `frame` and entities, instances
//! with unknown, duplicate, missing and mistyped params, in constants and in
//! entities — go through `mtek_compiler::analyze` on a thread with the
//! compilation stack: nothing panics, every diagnostic has a catalogue code
//! and severity and lies in its file, checking twice gives the same report,
//! and a program without errors lowers to the typed IR with a parameter
//! block for every material with params, every material of it lowers to WGSL
//! that Naga accepts and the program builds (decision 0041). A stage at the
//! root of a chain of
//! 50 000 functions is checked on a 1 MiB stack, and a material with 10 000
//! params and an instance of it stay linear; a stage with an expression close
//! to the parser's height limit and blocks nested 100 deep builds.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::thread;

use mtek_compiler::diagnostics::{Code, Report};
use mtek_compiler::emit_wgsl::emit_shader;
use mtek_compiler::ir::lower_to_ir;
use mtek_compiler::lowering::shader::lower_material;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{Analysis, BuildMode, CompileOptions, analyze, build};

/// The stack of the compilation thread (`spec/compiler-architecture.md` 3).
const STACK: usize = 16 * 1024 * 1024;

/// SplitMix64, for deterministic programs.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, bound: usize) -> usize {
        usize::try_from(self.next() % u64::try_from(bound.max(1)).unwrap()).unwrap()
    }

    fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
        items[self.below(items.len())]
    }
}

/// Param types with a default of the type, and a few that are not
/// GPU-representable or have a default of another type or a non-constant
/// one.
const PARAMS: &[&str] = &[
    "f32 = 1.0",
    "f32",
    "f32 = vec3(1.0)",
    "f32 = half(1.0)",
    "u32 = 3",
    "i32 = -2",
    "bool = true",
    "vec2 = vec2(0.5)",
    "vec3",
    "vec4 = vec4(1.0, 0.0, 0.0, 0.5)",
    "color = #6b5cff",
    "color = #6b5cff80",
    "color = TINT",
    "quat = quat.identity()",
    "mat4 = mat4.identity()",
    "W = W { a: 1.0; d: vec2(0.0) }",
    "array<f32, 2> = [1.0, 2.0]",
    "string = \"x\"",
    "mesh = Box {}",
    "SurfaceInput",
    "texture",
];

/// Expressions a stage body may compute with.
const ATOMS: &[&str] = &[
    "p0",
    "p1",
    "p2",
    "p0.rgb",
    "input.uv",
    "input.world_normal",
    "input.nope",
    "input",
    "TINT",
    "SHAPE",
    "half(0.5)",
    "noise()",
    "frame.time",
    "Cube.position",
    "self",
    "missing",
    "1.0",
    "vec3(1.0)",
    "#ffffff",
    "#ffffff80",
    "color.linear(vec3(1.0), 0.5)",
];

const STAGES: &[&str] = &[
    "fragment(input: SurfaceInput) -> color",
    "fragment(input: SurfaceInput) -> color",
    "fragment(input: SurfaceInput) -> color",
    "fragment(input: SurfaceInput)",
    "fragment(input: vec3) -> color",
    "fragment() -> color",
    "fragmnt(input: SurfaceInput) -> color",
    "fragment(input: SurfaceInput, extra: f32) -> vec4",
];

fn material(rng: &mut Rng, index: usize, out: &mut String) {
    out.push_str(&format!("material M{index} {{\n"));
    for param in 0..rng.below(4) {
        out.push_str(&format!("    param p{param}: {};\n", rng.pick(PARAMS)));
    }
    for _ in 0..rng.below(3).max(usize::from(rng.below(5) > 0)) {
        out.push_str(&format!("    {} {{\n", rng.pick(STAGES)));
        for local in 0..rng.below(3) {
            out.push_str(&format!("        let l{local} = {};\n", rng.pick(ATOMS)));
        }
        if rng.below(4) > 0 {
            // An assignment to a param (E3061) or another local.
            let target = if rng.below(4) == 0 { "p0 =" } else { "let z =" };
            out.push_str(&format!("        {target} {};\n", rng.pick(ATOMS)));
        }
        if rng.below(6) > 0 {
            out.push_str(&format!(
                "        return color.linear(vec3({}), 1.0);\n",
                rng.pick(ATOMS)
            ));
        } else {
            out.push_str(&format!("        return {};\n", rng.pick(ATOMS)));
        }
        out.push_str("    }\n");
    }
    out.push_str("}\n");
}

fn instance(rng: &mut Rng, materials: usize) -> String {
    let mut text = format!("M{} {{ ", rng.below(materials + 1));
    for _ in 0..rng.below(4) {
        let name = rng.pick(&["p0", "p1", "p2", "p9"]);
        let value = rng.pick(&[
            "1.0",
            "2",
            "vec3(1.0)",
            "#ff0000",
            "#ff000080",
            "half(1.0)",
            "Cube.position",
            "TINT",
            "true",
        ]);
        text.push_str(&format!("{name}: {value}; "));
    }
    text.push('}');
    text
}

fn program(rng: &mut Rng) -> String {
    let mut text = String::from(
        "struct W { a: f32; d: vec2; }\nconst TINT = #ff8800;\nconst SHAPE = Box { size: vec3(1.0) };\nfn half(x: f32) -> f32 { return x * 0.5; }\ncpu fn noise() -> f32 { return 0.5; }\n",
    );
    let materials = 1 + rng.below(3);
    for index in 0..materials {
        material(rng, index, &mut text);
    }
    text.push_str(&format!("const INSTANCE = {};\n", instance(rng, materials)));
    text.push_str("scene Demo {\n    camera Main {}\n    entity Cube {\n        mesh: Box { size: vec3(1.0) };\n");
    let material = if rng.below(3) == 0 {
        "INSTANCE".to_owned()
    } else {
        instance(rng, materials)
    };
    text.push_str(&format!("        material: {material};\n    }}\n}}\n"));
    text
}

/// A program that is valid by construction: random params with defaults,
/// a stage reading random inputs, an instance supplying random params.
fn valid_program(rng: &mut Rng) -> String {
    const VALID: &[(&str, &str, &str)] = &[
        ("f32 = 1.0", "2.0", "a{i}"),
        ("color = #6b5cff", "#00ff00", "a{i}.r"),
        ("vec3 = vec3(0.5)", "vec3(1.0)", "a{i}.y"),
        ("u32 = 3", "7", "f32(a{i})"),
        (
            "W = W { d: vec2(1.0); a: 0.5 }",
            "W { a: 2.0; d: vec2(0.0) }",
            "a{i}.a",
        ),
        ("array<f32, 2> = [1.0, 2.0]", "[3.0, 4.0]", "a{i}[1]"),
        ("bool = false", "true", "1.0"),
        (
            "array<vec3, 2> = [vec3(1.0), vec3(2.0)]",
            "[vec3(0.5), vec3(0.25)]",
            "a{i}[1].x",
        ),
        (
            "mat4 = mat4.identity()",
            "mat4.scale(vec3(2.0))",
            "a{i}[2].z",
        ),
        (
            "quat = quat.identity()",
            "quat.axis_angle(vec3(0.0, 1.0, 0.0), 0.5)",
            "(a{i} * input.world_normal).x",
        ),
    ];
    const INPUTS: &[&str] = &[
        "input.uv.x",
        "input.world_normal.y",
        "input.world_position.z",
        "input.local_position.x",
        "half(1.0)",
    ];
    let mut text = String::from(
        "struct W { a: f32; d: vec2; }\nfn half(x: f32) -> f32 { return x * 0.5; }\nmaterial M {\n",
    );
    let mut terms = Vec::new();
    let mut fields = Vec::new();
    for i in 0..rng.below(5) {
        let (param, value, read) = VALID[rng.below(VALID.len())];
        text.push_str(&format!("    param a{i}: {param};\n"));
        terms.push(read.replace("{i}", &i.to_string()));
        if rng.below(2) == 0 {
            fields.push(format!("a{i}: {value}"));
        }
    }
    terms.push(rng.pick(INPUTS).to_owned());
    text.push_str("    fragment(input: SurfaceInput) -> color {\n");
    text.push_str(&format!("        let v = {};\n", terms.join(" + ")));
    text.push_str("        return color.linear(vec3(v), 1.0);\n    }\n}\n");
    text.push_str(&format!(
        "scene Demo {{\n    camera Main {{}}\n    entity Cube {{\n        mesh: Box {{}};\n        material: M {{ {} }};\n    }}\n}}\n",
        fields.join("; ")
    ));
    text
}

fn project(text: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"fuzz\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), text);
    fs
}

fn check_text(text: &str) -> Analysis {
    analyze(&ProjectRoot::at_base(), &project(text))
}

/// The invariants of one report over `text`; `Err` describes a violation.
fn invariants(text: &str, report: &Report) -> Result<(), String> {
    for d in &report.diagnostics {
        if !Code::ALL.contains(&d.code) || d.code == Code::E9999 {
            return Err(format!("{:?} is not a catalogue code", d.code));
        }
        if d.severity != d.code.severity() {
            return Err(format!("{} reported as {:?}", d.code, d.severity));
        }
        for label in d.primary.iter().chain(&d.related) {
            if text.get(label.span.range()).is_none() {
                return Err(format!(
                    "{} at {:?} is outside the text",
                    d.code, label.span
                ));
            }
        }
    }
    Ok(())
}

/// Run `body` on a thread with a stack of `bytes`; a panic fails the test
/// with `label`.
fn on_stack(bytes: usize, label: String, body: impl FnOnce() + Send + 'static) {
    let outcome = thread::Builder::new()
        .stack_size(bytes)
        .spawn(body)
        .unwrap()
        .join();
    assert!(outcome.is_ok(), "panicked on {label}");
}

#[test]
fn random_material_programs_never_break_checking_or_lowering() {
    let mut rng = Rng(0x4d32_2d30_3400);
    let cases: Vec<String> = (0..600)
        .map(|case| {
            if case % 5 == 0 {
                valid_program(&mut rng)
            } else {
                program(&mut rng)
            }
        })
        .collect();
    on_stack(STACK, "random material programs".to_owned(), move || {
        let mut codes = BTreeSet::new();
        let mut lowered = 0;
        let mut built_count = 0;
        for text in &cases {
            let first = check_text(text);
            if let Err(problem) = invariants(text, &first.report) {
                panic!("{problem} in\n{text}");
            }
            let second = check_text(text);
            assert_eq!(
                first.report.diagnostics, second.report.diagnostics,
                "{text}"
            );
            if !first.has_errors() {
                let program = lower_to_ir(&first).unwrap_or_else(|e| panic!("{e:?} for\n{text}"));
                for material in program.materials() {
                    assert_eq!(
                        material.layout.is_some(),
                        !material.params.is_empty(),
                        "{text}"
                    );
                    // Shader lowering (M2-05): every material, used or not, lowers to
                    // WGSL that Naga accepts.
                    let shader = lower_material(&program, material)
                        .unwrap_or_else(|d| panic!("{d:#?} for\n{text}"));
                    emit_shader(&shader).unwrap_or_else(|d| panic!("{d:#?} for\n{text}"));
                }
                let built = build(
                    &ProjectRoot::at_base(),
                    &project(text),
                    &CompileOptions::with_stub_runtime(BuildMode::Release),
                );
                assert!(!built.has_errors(), "{:#?} for\n{text}", built.report);
                built_count += usize::from(!built.has_errors());
                lowered += 1;
            }
            codes.extend(first.report.diagnostics.iter().map(|d| d.code.short()));
        }
        // The generator reaches the diagnostics of this task, and some
        // programs are valid.
        for code in [
            "E4020", "E4021", "E4030", "E4031", "E4040", "E5100", "W5101", "E5001", "E5002",
            "E5003", "E3102", "E3061", "E3023", "E9010",
        ] {
            assert!(codes.contains(code), "{code} never reported: {codes:?}");
        }
        assert!(lowered > 0, "no program lowered");
        assert_eq!(built_count, lowered, "every program that lowers builds");
    });
}

#[test]
fn a_stage_at_the_root_of_a_long_call_chain_needs_no_deep_stack() {
    // 50 000 functions, each calling the next, reached from a fragment
    // stage: GPU reachability through all of them on a 1 MiB stack, and the
    // unbounded loop at the end of the chain is found (E4010).
    let count = 50_000;
    let mut text = String::new();
    for i in 0..count {
        text.push_str(&format!(
            "fn g{i}(n: i32) -> i32 {{ return g{}(n) + 1; }}\n",
            i + 1
        ));
    }
    text.push_str(&format!(
        "fn g{count}(n: i32) -> i32 {{\n    var t = 0;\n    for i in 0..n {{ t += 1; }}\n    return t;\n}}\n"
    ));
    text.push_str(
        "material Deep {\n    param n: i32 = 3;\n    fragment(input: SurfaceInput) -> color {\n        return color.linear(vec3(f32(g0(n))), 1.0);\n    }\n}\nscene Demo {\n    camera Main {}\n}\n",
    );
    on_stack(
        1024 * 1024,
        "a stage over a call chain".to_owned(),
        move || {
            let result = check_text(&text);
            let codes: Vec<&str> = result
                .report
                .diagnostics
                .iter()
                .map(|d| d.code.short())
                .collect();
            assert_eq!(codes, ["E4010"]);
            // The chain from the stage to the loop is cut in the related spans.
            assert!(result.report.diagnostics[0].related.len() <= 258);
        },
    );
}

#[test]
fn ten_thousand_params_are_one_e4032_and_an_instance_of_them_checks() {
    let count = 10_000;
    let mut text = String::from("material Wide {\n");
    let mut fields = String::new();
    for i in 0..count {
        text.push_str(&format!("    param p{i}: f32 = 0.0;\n"));
        fields.push_str(&format!("p{i}: 1.0; "));
    }
    text.push_str("    fragment(input: SurfaceInput) -> color {\n        return color.linear(vec3(p0), 1.0);\n    }\n}\n");
    text.push_str(&format!(
        "scene Demo {{\n    camera Main {{}}\n    entity E {{\n        mesh: Box {{}};\n        material: Wide {{ {fields}}};\n    }}\n}}\n"
    ));
    on_stack(STACK, "ten thousand params".to_owned(), move || {
        let result = check_text(&text);
        let codes: Vec<&str> = result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.short())
            .collect();
        assert_eq!(codes, ["E4032"]);
    });
}

#[test]
fn deep_expressions_and_nested_blocks_in_a_stage_build_on_the_compilation_stack() {
    // An expression close to the parser's height limit of 256 that does not fold, and
    // blocks nested 100 deep: shader lowering and printing recurse along the tree only
    // as deep as the parser lets it grow.
    let depth = 80;
    let mut expr = String::from("input.uv.x");
    for _ in 0..depth {
        expr = format!("(input.uv.y * {expr} + 0.5)");
    }
    let mut blocks = String::new();
    for _ in 0..100 {
        blocks.push_str("if input.uv.x > 0.5 {\n");
    }
    blocks.push_str("v = v * 0.5;\n");
    for _ in 0..100 {
        blocks.push_str("}\n");
    }
    let text = format!(
        "material M {{\n    fragment(input: SurfaceInput) -> color {{\n        var v = {expr};\n{blocks}        return color.linear(vec3(v), 1.0);\n    }}\n}}\n\
         scene Demo {{\n    camera Main {{}}\n    entity Cube {{\n        mesh: Box {{}};\n        material: M {{}};\n    }}\n}}\n"
    );
    on_stack(STACK, "a deep stage".to_owned(), move || {
        let built = build(
            &ProjectRoot::at_base(),
            &project(&text),
            &CompileOptions::with_stub_runtime(BuildMode::Release),
        );
        assert!(!built.has_errors(), "{:#?}", built.report);
        let wgsl = built
            .files
            .iter()
            .find(|(path, _)| path.ends_with(".wgsl"))
            .map(|(_, bytes)| String::from_utf8_lossy(bytes).into_owned())
            .unwrap();
        assert_eq!(wgsl.matches("if u_p_input.uv.x > 0.5 {").count(), 100);
    });
}
