//! Robustness of type checking and constant evaluation (`spec/testing.md`
//! section 3.3, `spec/compiler-architecture.md` section 3: the compiler never
//! panics). Random programs built from the M1 expression forms — extreme
//! literals, every operator, constructors, conversions, namespace calls,
//! swizzles, descriptors, constant references that may form cycles, names
//! that do not resolve — and maximally nested expressions go through
//! `mtek_compiler::check` on a thread with the compilation stack. Nothing
//! panics, every diagnostic has a catalogue code and severity and lies in its
//! file, and checking twice gives the same report.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::thread;

use mtek_compiler::diagnostics::{Code, Report};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::DefKind;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::types::ConstValue;
use mtek_compiler::{CheckResult, check};

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

const ATOMS: &[&str] = &[
    "0",
    "1",
    "7",
    "2147483647",
    "2147483648",
    "4294967295",
    "4294967296",
    "99999999999999999999999",
    "0.5",
    "0.1",
    "1.0e38",
    "3.4028235e38",
    "1.0e39",
    "1.0e-45",
    "true",
    "false",
    "#6b5cff",
    "#00000000",
    "A",
    "B",
    "C",
    "UP",
    "missing",
    "Cube",
    "Main",
    "Demo",
    "vec3",
    "quat",
    "Box",
    "sin",
    "frame.time",
    "Cube.position",
    "Main.position",
    "Cube.nothing",
];

const BINARY: &[&str] = &["+", "-", "*", "/", "%", "<", "==", "&&"];

const SWIZZLES: &[&str] = &["x", "w", "xy", "xyz", "zyx", "rgb", "r", "a", "xyzwx", "q"];

fn expr(rng: &mut Rng, depth: usize, out: &mut String) {
    if depth == 0 {
        out.push_str(rng.pick(ATOMS));
        return;
    }
    let d = depth - 1;
    let args = |rng: &mut Rng, out: &mut String, count: usize| {
        for i in 0..count {
            if i > 0 {
                out.push_str(", ");
            }
            expr(rng, d, out);
        }
    };
    match rng.below(16) {
        0 => {
            out.push('(');
            expr(rng, d, out);
            out.push(')');
        }
        1 => {
            out.push('-');
            expr(rng, d, out);
        }
        2 | 3 => {
            expr(rng, d, out);
            out.push(' ');
            out.push_str(rng.pick(BINARY));
            out.push(' ');
            expr(rng, d, out);
        }
        4 => {
            let name = rng.pick(&["vec2", "vec3", "vec4"]);
            out.push_str(name);
            out.push('(');
            let count = rng.below(5);
            args(rng, out, count);
            out.push(')');
        }
        5 => {
            out.push_str(rng.pick(&["f32", "i32", "u32", "bool", "quat", "color"]));
            out.push('(');
            let count = 1 + rng.below(2);
            args(rng, out, count);
            out.push(')');
        }
        6 => out.push_str("quat.identity()"),
        7 => {
            out.push_str("quat.axis_angle(");
            let count = 1 + rng.below(3);
            args(rng, out, count);
            out.push(')');
        }
        8 => {
            out.push_str("quat.euler(");
            args(rng, out, 3);
            out.push(')');
        }
        9 => {
            out.push_str(rng.pick(&["color.linear(", "color.srgb("]));
            args(rng, out, 2);
            out.push(')');
        }
        10 | 11 => {
            out.push('(');
            expr(rng, d, out);
            out.push_str(").");
            out.push_str(rng.pick(SWIZZLES));
        }
        12 => {
            out.push_str("Sphere { radius: ");
            expr(rng, d, out);
            out.push_str("; segments: ");
            expr(rng, d, out);
            out.push_str(" }");
        }
        13 => {
            out.push_str("Box { size: ");
            expr(rng, d, out);
            out.push_str(" }");
        }
        _ => out.push_str(rng.pick(ATOMS)),
    }
}

/// An expression of depth `low` to `low + span - 1`.
fn sub(rng: &mut Rng, low: usize, span: usize, out: &mut String) {
    let depth = low + rng.below(span);
    expr(rng, depth, out);
}

fn program(rng: &mut Rng) -> String {
    let mut text = String::new();
    for name in ["A", "B", "C", "UP"] {
        text.push_str("const ");
        text.push_str(name);
        if rng.below(3) == 0 {
            text.push_str(": ");
            text.push_str(
                rng.pick(&["f32", "i32", "u32", "vec3", "quat", "color", "mesh", "vec5"]),
            );
        }
        text.push_str(" = ");
        sub(rng, 1, 4, &mut text);
        text.push_str(";\n");
    }
    text.push_str("scene Demo {\n    clear_color: ");
    sub(rng, 0, 3, &mut text);
    text.push_str(";\n    camera Main { position: ");
    sub(rng, 0, 4, &mut text);
    text.push_str("; rotation: ");
    sub(rng, 0, 3, &mut text);
    text.push_str("; }\n    entity Cube {\n        const LOCAL = ");
    sub(rng, 0, 3, &mut text);
    text.push_str(";\n        position: ");
    sub(rng, 0, 4, &mut text);
    text.push_str(";\n        mesh: ");
    sub(rng, 1, 2, &mut text);
    text.push_str(";\n    }\n}\n");
    text
}

fn check_text(text: &str) -> CheckResult {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"fuzz\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), text);
    check(&ProjectRoot::at_base(), &fs)
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

/// Run `body` on a thread with the compilation stack; a panic fails the test
/// with the program that caused it.
fn on_compiler_stack(label: String, body: impl FnOnce() + Send + 'static) {
    on_stack(STACK, label, body);
}

/// Run `body` on a thread with a stack of `bytes`.
fn on_stack(bytes: usize, label: String, body: impl FnOnce() + Send + 'static) {
    let outcome = thread::Builder::new()
        .stack_size(bytes)
        .spawn(body)
        .unwrap()
        .join();
    assert!(outcome.is_ok(), "panicked on {label}");
}

#[test]
fn random_constant_programs_never_break_type_checking() {
    let mut rng = Rng(0x4d31_2d31_3020);
    let programs: Vec<String> = (0..1500).map(|_| program(&mut rng)).collect();
    on_compiler_stack("random programs".to_owned(), move || {
        let mut codes = std::collections::BTreeSet::new();
        for text in &programs {
            let first = check_text(text);
            if let Err(problem) = invariants(text, &first.report) {
                panic!("{problem} in\n{text}");
            }
            let second = check_text(text);
            assert_eq!(
                first.report.diagnostics, second.report.diagnostics,
                "{text}"
            );
            codes.extend(first.report.diagnostics.iter().map(|d| d.code.short()));
        }
        // The generator reaches the diagnostics of this task.
        for code in [
            "E3001", "E3002", "E3013", "E3014", "E3040", "E3041", "E2020", "E3090",
        ] {
            assert!(codes.contains(code), "{code} never reported: {codes:?}");
        }
    });
}

#[test]
fn deeply_nested_constant_expressions_are_checked() {
    // The parser bounds the height of an expression tree (256, decision
    // 0022); expressions just below the bound are typed and folded.
    // Heights: one level per parenthesis and per `+`, two per `-(` and per
    // `(..).wzyx`, three per `vec3((..).y)`.
    let depth = 250;
    let parens = format!("{}1.5{}", "(".repeat(depth), ")".repeat(depth));
    let negations = format!("{}1{}", "-(".repeat(depth / 2), ")".repeat(depth / 2));
    let chain = std::iter::repeat_n("1.0", depth)
        .collect::<Vec<_>>()
        .join(" + ");
    let vectors = (0..depth / 3).fold("vec3(1.0)".to_owned(), |inner, _| {
        format!("vec3(({inner}).y)")
    });
    let swizzles = (0..depth / 2).fold("vec4(1, 2, 3, 4)".to_owned(), |inner, _| {
        format!("({inner}).wzyx")
    });
    let mut source = String::new();
    for (name, value) in [
        ("P", &parens),
        ("N", &negations),
        ("S", &chain),
        ("V", &vectors),
        ("W", &swizzles),
    ] {
        source.push_str(&format!("const {name} = {value};\n"));
    }
    source.push_str("scene Demo {\n    camera Main {}\n}\n");
    on_compiler_stack("deep nesting".to_owned(), move || {
        let result = check_text(&source);
        assert!(result.report.diagnostics.is_empty(), "{:#?}", result.report);
        let types = result.types.unwrap();
        let resolution = result.resolution.unwrap();
        let values: Vec<_> = resolution
            .defs()
            .iter()
            .filter(|d| d.kind == DefKind::Const)
            .map(|d| types.const_info(d.id).and_then(|i| i.value.clone()))
            .collect();
        assert_eq!(values.len(), 5);
        assert!(values.iter().all(Option::is_some), "{values:?}");
    });
}

#[test]
fn long_constant_chains_and_wide_cycles_are_checked() {
    // A chain of 50 000 constants, each using the next, is evaluated
    // dependencies first without recursion from constant to constant: it
    // fits a 1 MiB stack. Closing it into a cycle is one E2020 with every
    // step.
    let count: i32 = 50_000;
    let mut chain = String::new();
    for i in 0..count {
        if i + 1 < count {
            chain.push_str(&format!("const K{i} = K{} + 1;\n", i + 1));
        } else {
            chain.push_str(&format!("const K{i} = 0;\n"));
        }
    }
    let cycle = chain.replace(
        &format!("const K{} = 0;", count - 1),
        &format!("const K{} = K0;", count - 1),
    );
    let scene = "scene Demo {\n    camera Main {}\n}\n";
    let (chain, cycle) = (format!("{chain}{scene}"), format!("{cycle}{scene}"));
    on_stack(1024 * 1024, "constant chains".to_owned(), move || {
        let result = check_text(&chain);
        assert!(result.report.diagnostics.is_empty(), "{:#?}", result.report);
        let resolution = result.resolution.unwrap();
        let first = resolution.defs().iter().find(|d| d.name == "K0").unwrap();
        let value = result
            .types
            .unwrap()
            .const_info(first.id)
            .unwrap()
            .value
            .clone();
        assert_eq!(value, Some(ConstValue::I32(count - 1)));
        let result = check_text(&cycle);
        let codes: Vec<&str> = result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.short())
            .collect();
        assert_eq!(codes, ["E2020"]);
        assert_eq!(result.report.diagnostics[0].related.len(), count as usize);
    });
}
