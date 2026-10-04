//! Robustness of function and statement checking and of the program-wide
//! effect pass (`spec/testing.md` section 3.3, `spec/compiler-architecture.md`
//! section 3, decision 0038). Random programs of functions — every statement
//! form, assignments to every kind of place, calls with wrong arities,
//! recursion, `cpu fn` calls, CPU-only types, GPU roots — go through
//! `mtek_compiler::analyze_with` on a thread with the compilation stack:
//! nothing panics, every diagnostic has a catalogue code and severity and
//! lies in its file, checking twice gives the same report, and a program
//! without errors always lowers to the typed IR and builds, its CPU
//! functions emitted (decision 0040). Long call chains and
//! cycles are checked on a 1 MiB stack, and statements nested to the
//! parser's limit on the compilation stack.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::thread;

use mtek_compiler::diagnostics::{Code, Report};
use mtek_compiler::ir::lower_to_ir;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{Analysis, AnalyzeOptions, BuildMode, CompileOptions, analyze_with, build};

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

const FUNCTIONS: usize = 5;

const TYPES: &[&str] = &[
    "f32",
    "i32",
    "u32",
    "bool",
    "vec3",
    "P",
    "array<f32, 3>",
    "string",
    "mesh",
    "quat",
];

/// Expressions over the names a body may have in scope (some of them only
/// sometimes: unknown names are part of the test).
const ATOMS: &[&str] = &[
    "0",
    "1",
    "2.5",
    "2147483647 + 1",
    "true",
    "K",
    "x",
    "y",
    "v",
    "p",
    "p.a",
    "p.v",
    "arr",
    "arr[1]",
    "arr[7]",
    "v.y",
    "v.zyx",
    "i",
    "a0",
    "\"text\"",
    "vec3(1.0)",
    "P { a: 1.0; v: vec3(0.0) }",
    "[1.0, 2.0, 3.0]",
    "sin(1.0)",
    "missing",
];

const PLACES: &[&str] = &[
    "x", "y", "v", "v.y", "v.xy", "p.a", "arr[0]", "K", "a0", "i", "q.x", "f0", "(x)",
];

const ASSIGN_OPS: &[&str] = &["=", "+=", "-=", "*=", "/="];

const BINARY: &[&str] = &["+", "-", "*", "/", "<", "==", "&&", "||"];

fn expr(rng: &mut Rng, depth: usize, out: &mut String) {
    if depth == 0 {
        out.push_str(rng.pick(ATOMS));
        return;
    }
    match rng.below(5) {
        0 => {
            out.push('(');
            expr(rng, depth - 1, out);
            out.push(' ');
            out.push_str(rng.pick(BINARY));
            out.push(' ');
            expr(rng, depth - 1, out);
            out.push(')');
        }
        1 => {
            // A call of a user function, with any number of arguments.
            out.push_str(&format!("f{}(", rng.below(FUNCTIONS)));
            for index in 0..rng.below(4) {
                if index > 0 {
                    out.push_str(", ");
                }
                expr(rng, depth - 1, out);
            }
            out.push(')');
        }
        2 => {
            out.push('-');
            expr(rng, depth - 1, out);
        }
        _ => out.push_str(rng.pick(ATOMS)),
    }
}

fn stmt(rng: &mut Rng, depth: usize, out: &mut String, indent: usize) {
    let pad = "    ".repeat(indent);
    out.push_str(&pad);
    let choice = if depth == 0 {
        rng.below(6)
    } else {
        rng.below(10)
    };
    match choice {
        0 => {
            out.push_str(rng.pick(&["let ", "var "]));
            out.push_str(rng.pick(&["x", "y", "v", "p", "arr", "q", "a0"]));
            if rng.below(2) == 0 {
                out.push_str(": ");
                out.push_str(rng.pick(TYPES));
            }
            out.push_str(" = ");
            expr(rng, 2, out);
            out.push_str(";\n");
        }
        1 | 2 => {
            out.push_str(rng.pick(PLACES));
            out.push(' ');
            out.push_str(rng.pick(ASSIGN_OPS));
            out.push(' ');
            expr(rng, 2, out);
            out.push_str(";\n");
        }
        3 => {
            out.push_str("return");
            if rng.below(3) > 0 {
                out.push(' ');
                expr(rng, 2, out);
            }
            out.push_str(";\n");
        }
        4 => {
            out.push_str(&format!("f{}(", rng.below(FUNCTIONS)));
            expr(rng, 1, out);
            out.push_str(");\n");
        }
        5 => {
            out.push_str(rng.pick(&["break;\n", "continue;\n", "const C: f32 = 1.0;\n"]));
        }
        6 | 7 => {
            out.push_str("if ");
            expr(rng, 1, out);
            out.push_str(" {\n");
            block(rng, depth - 1, out, indent + 1);
            out.push_str(&pad);
            if rng.below(2) == 0 {
                out.push_str("} else {\n");
                block(rng, depth - 1, out, indent + 1);
                out.push_str(&pad);
            }
            out.push_str("}\n");
        }
        8 => {
            out.push_str("for i in ");
            if rng.below(2) == 0 {
                out.push_str(rng.pick(&["0..4", "0..K", "0..x", "0.0..2.0", "0..u32(3)"]));
            } else {
                out.push_str(rng.pick(&["arr", "v", "[1, 2]"]));
            }
            out.push_str(" {\n");
            block(rng, depth - 1, out, indent + 1);
            out.push_str(&pad);
            out.push_str("}\n");
        }
        _ => {
            out.push_str("{\n");
            block(rng, depth - 1, out, indent + 1);
            out.push_str(&pad);
            out.push_str("}\n");
        }
    }
}

fn block(rng: &mut Rng, depth: usize, out: &mut String, indent: usize) {
    for _ in 0..=rng.below(4) {
        stmt(rng, depth, out, indent);
    }
}

fn program(rng: &mut Rng) -> String {
    let mut text = String::from("struct P { a: f32; v: vec3; }\nconst K: i32 = 3;\n");
    for index in 0..FUNCTIONS {
        if rng.below(3) == 0 {
            text.push_str("cpu ");
        }
        text.push_str(&format!("fn f{index}("));
        for param in 0..rng.below(3) {
            if param > 0 {
                text.push_str(", ");
            }
            text.push_str(&format!(
                "{}: {}",
                ["x", "p", "arr"][param],
                rng.pick(TYPES)
            ));
        }
        text.push(')');
        if rng.below(3) > 0 {
            text.push_str(" -> ");
            text.push_str(rng.pick(TYPES));
        }
        text.push_str(" {\n");
        block(rng, 3, &mut text, 1);
        text.push_str("}\n");
    }
    text.push_str("scene Demo {\n    camera Main {}\n}\n");
    text
}

/// A program that is valid by construction (warnings aside): functions of
/// `x: f32` that call only functions declared before them.
fn valid_program(rng: &mut Rng) -> String {
    let mut text = String::new();
    let mut fresh = 0;
    for index in 0..FUNCTIONS {
        if rng.below(4) == 0 {
            text.push_str("cpu ");
        }
        text.push_str(&format!("fn f{index}(x: f32) -> f32 {{\n"));
        for _ in 0..rng.below(6) {
            fresh += 1;
            let line = match rng.below(6) {
                0 => format!("    let a{fresh} = x * 2.0 + 1.0;\n"),
                1 => format!("    var t{fresh} = 0.0;\n    t{fresh} += x;\n"),
                2 => format!(
                    "    for j{fresh} in 0..4 {{\n        if j{fresh} == 2 {{ break; }}\n    }}\n"
                ),
                3 => "    if x > 1.0 {\n        return x;\n    }\n".to_owned(),
                4 if index > 0 => format!("    let c{fresh} = f{}(x);\n", rng.below(index)),
                _ => format!("    var v{fresh} = vec3(x);\n    v{fresh}.y = 2.0;\n"),
            };
            text.push_str(&line);
        }
        text.push_str("    return x;\n}\n");
    }
    text.push_str("scene Demo {\n    camera Main {}\n}\n");
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

fn check_text(text: &str, roots: &[String]) -> Analysis {
    let options = AnalyzeOptions {
        gpu_root_functions: roots.to_vec(),
    };
    analyze_with(&ProjectRoot::at_base(), &project(text), &options)
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
fn random_function_programs_never_break_checking_or_lowering() {
    let mut rng = Rng(0x4d32_2d30_3200);
    let cases: Vec<(String, Vec<String>)> = (0..700)
        .map(|case| {
            let text = if case % 5 == 0 {
                valid_program(&mut rng)
            } else {
                program(&mut rng)
            };
            let roots = (0..FUNCTIONS)
                .filter(|_| rng.below(3) == 0)
                .map(|i| format!("src/main.mtek::f{i}"))
                .collect();
            (text, roots)
        })
        .collect();
    on_stack(STACK, "random function programs".to_owned(), move || {
        let mut codes = BTreeSet::new();
        let mut lowered = 0;
        let mut emitted = 0;
        for (text, roots) in &cases {
            let first = check_text(text, roots);
            if let Err(problem) = invariants(text, &first.report) {
                panic!("{problem} in\n{text}");
            }
            let second = check_text(text, roots);
            assert_eq!(
                first.report.diagnostics, second.report.diagnostics,
                "{text}"
            );
            if !first.has_errors() {
                if let Err(error) = lower_to_ir(&first) {
                    panic!("{error:?} for\n{text}");
                }
                lowered += 1;
                // GPU roots only add errors, so the program also builds without them, and
                // its CPU functions are emitted without a defect (decision 0040).
                let built = build(
                    &ProjectRoot::at_base(),
                    &project(text),
                    &CompileOptions::with_stub_runtime(BuildMode::Release),
                );
                assert!(!built.has_errors(), "{:#?} for\n{text}", built.report);
                let app = std::str::from_utf8(&built.files["app.js"]).unwrap();
                emitted += app.matches("\nfunction f_").count();
            }
            codes.extend(first.report.diagnostics.iter().map(|d| d.code.short()));
        }
        // The generator reaches the diagnostics of this task, and some
        // programs are valid.
        for code in [
            "E3001", "E3002", "E3060", "E3061", "E3070", "E3080", "W3081", "W2010", "E4001",
            "E4002", "W4003", "E4010", "E4011", "E3040", "E3030",
        ] {
            assert!(codes.contains(code), "{code} never reported: {codes:?}");
        }
        assert!(lowered > 0, "no program lowered");
        assert!(emitted > 0, "no function emitted");
    });
}

#[test]
fn long_call_chains_and_wide_cycles_need_no_deep_stack() {
    // 50 000 functions, each calling the next: checked, with effects and
    // reachability, on a 1 MiB stack (every traversal is a worklist).
    let count = 50_000;
    let scene = "scene Demo {\n    camera Main {}\n}\n";
    let mut chain = String::new();
    for i in 0..count {
        chain.push_str(&format!(
            "fn g{i}() -> i32 {{ return g{}() + 1; }}\n",
            i + 1
        ));
    }
    let pure_end = format!("{chain}fn g{count}() -> i32 {{ return 0; }}\n{scene}");
    let cpu_end = format!("{chain}cpu fn g{count}() -> i32 {{ return 0; }}\n{scene}");
    let cycle = format!("{chain}fn g{count}() -> i32 {{ return g0(); }}\n{scene}");
    on_stack(1024 * 1024, "call chains".to_owned(), move || {
        let roots = vec!["src/main.mtek::g0".to_owned()];
        let result = check_text(&pure_end, &roots);
        assert!(result.report.diagnostics.is_empty(), "{:#?}", result.report);
        let program = lower_to_ir(&result).unwrap();
        assert_eq!(program.modules[0].items.len(), count + 2);

        // Every function needs the CPU: one E4002 per call, but only those
        // a file keeps are built (each with at most 256 related spans).
        let result = check_text(&cpu_end, &[]);
        let errors = result.report.summary.errors;
        assert!(errors >= 199, "{errors}");
        assert!(result.report.summary.suppressed > 0);
        assert!(
            result
                .report
                .diagnostics
                .iter()
                .all(|d| d.related.len() <= 257),
            "a chain was not cut"
        );

        // Closing the chain is one E4001 with every call of the cycle.
        let result = check_text(&cycle, &[]);
        let codes: Vec<&str> = result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.short())
            .collect();
        assert_eq!(codes, ["E4001"]);
        assert_eq!(result.report.diagnostics[0].related.len(), count + 1);
    });
}

#[test]
fn statements_nested_to_the_parser_limit_are_checked() {
    // The parser bounds the height of the tree (256, decision 0022);
    // statements nested just below it are checked and lowered on the
    // compilation stack.
    let depth = 60;
    let mut blocks = String::from("fn blocks() -> i32 {\n");
    for _ in 0..depth {
        blocks.push_str("{\n");
    }
    blocks.push_str("return 1;\n");
    for _ in 0..depth {
        blocks.push_str("}\n");
    }
    blocks.push_str("}\n");
    let mut ifs = String::from("fn ifs(x: i32) -> i32 {\n");
    for i in 0..depth {
        ifs.push_str(&format!("if x > {i} {{\n"));
    }
    ifs.push_str("return x;\n");
    for _ in 0..depth {
        ifs.push_str("}\n");
    }
    ifs.push_str("return 0;\n}\n");
    let mut loops = String::from("fn loops() -> i32 {\nvar t = 0;\n");
    for i in 0..depth {
        loops.push_str(&format!("for n{i} in 0..2 {{\n"));
    }
    loops.push_str("t += 1;\n");
    for _ in 0..depth {
        loops.push_str("}\n");
    }
    loops.push_str("return t;\n}\n");
    // An `else if` chain is a loop in the checker and the lowering; the
    // parser nests it, so a chain within its limit is valid.
    let else_if = |count: usize| {
        let mut chain = String::from("fn chain(x: i32) -> i32 {\nif x == 0 { return 0; }\n");
        for i in 1..count {
            chain.push_str(&format!("else if x == {i} {{ return {i}; }}\n"));
        }
        chain.push_str("else { return -1; }\n}\n");
        chain
    };
    let scene = "scene Demo {\n    camera Main {}\n}\n";
    let text = format!("{blocks}{ifs}{loops}{}{scene}", else_if(60));
    let too_long = format!("{}{scene}", else_if(2_000));
    on_stack(STACK, "nested statements".to_owned(), move || {
        let result = check_text(&text, &["src/main.mtek::loops".to_owned()]);
        assert!(result.report.diagnostics.is_empty(), "{:#?}", result.report);
        lower_to_ir(&result).unwrap();
        // Beyond the parser's limit: `E1050` (and whatever its recovery
        // leaves), never a panic or a deep recursion.
        let result = check_text(&too_long, &[]);
        assert!(invariants(&too_long, &result.report).is_ok());
        assert_eq!(
            result.report.diagnostics.first().map(|d| d.code.short()),
            Some("E1050")
        );
    });
}

#[test]
fn deeply_nested_cpu_functions_are_emitted() {
    // Statements and expressions nested close to the parser's limit, reached from a `cpu fn`,
    // are emitted and printed on the compilation stack (decision 0040); an `else if` chain is a
    // loop in the emitter and the printer.
    let depth = 20;
    let mut text = String::from("fn nested(x: i32) -> i32 {\nvar t = 0;\n");
    for i in 0..depth {
        text.push_str(&format!("if x > {i} {{\nfor n{i} in 0..2 {{\n{{\n"));
    }
    text.push_str("t += 1;\n");
    for _ in 0..depth {
        text.push_str("}\n}\n}\n");
    }
    text.push_str("return t;\n}\n");
    let mut sum = String::from("x");
    for _ in 0..100 {
        sum = format!("({sum} + 1.0)");
    }
    text.push_str(&format!("fn deep(x: f32) -> f32 {{\nreturn {sum};\n}}\n"));
    text.push_str("fn chain(x: i32) -> i32 {\nif x == 0 { return 0; }\n");
    for i in 1..100 {
        text.push_str(&format!("else if x == {i} {{ return {i}; }}\n"));
    }
    text.push_str("else { return -1; }\n}\n");
    text.push_str(
        "cpu fn root() -> f32 {\nreturn f32(nested(3) + chain(7)) + deep(0.5);\n}\n\
         scene Demo {\n    camera Main {}\n}\n",
    );
    on_stack(STACK, "nested CPU functions".to_owned(), move || {
        let built = build(
            &ProjectRoot::at_base(),
            &project(&text),
            &CompileOptions::with_stub_runtime(BuildMode::Release),
        );
        assert!(!built.has_errors(), "{:#?}", built.report);
        let app = std::str::from_utf8(&built.files["app.js"]).unwrap();
        assert_eq!(app.matches("\nfunction f_").count(), 4);
        assert_eq!(app.matches("} else if (").count(), 99);
        // 100 additions in `deep`; in `root` the conversion and the addition.
        assert_eq!(app.matches("fr(").count(), 100 + 2);
    });
}
