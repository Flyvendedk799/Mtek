//! Unit tests of the program-wide effect and reachability rules
//! (`effects.rs`, decision 0038), including the rules no program of this
//! build can reach: every CPU-only built-in function is planned for M3 or
//! later (`E4012`), every GPU-only one for M4 (`E4013`), `spawn` and
//! `destroy` for M5 (`E5080`). Those are checked on registries where a
//! built-in function is implemented already, or has another domain.

use super::effects::{FnRef, ProgramUnit, Roots, check_program};
use super::*;
use crate::diagnostics::{Code, Diagnostic};
use crate::project::ModuleId;
use crate::resolve::resolve_module;
use crate::source::FileId;
use crate::stdlib::{Domain, Milestone, Registry, registry};
use crate::syntax::{lex_str, parse_module};

struct Run {
    diagnostics: Vec<Diagnostic>,
    effects: ProgramEffects,
    typeck: Typeck,
}

impl Run {
    fn codes(&self) -> Vec<&'static str> {
        self.diagnostics.iter().map(|d| d.code.short()).collect()
    }

    fn only(&self, code: Code) -> &Diagnostic {
        let found: Vec<&Diagnostic> = self.diagnostics.iter().filter(|d| d.code == code).collect();
        assert_eq!(found.len(), 1, "{:#?}", self.diagnostics);
        found[0]
    }

    fn function(&self, name: &str) -> FnRef {
        let def = self
            .typeck
            .functions()
            .find(|(_, info)| info.name == name)
            .map(|(def, _)| def)
            .unwrap_or_else(|| panic!("no function {name}"));
        FnRef {
            module: ModuleId::from_index(0),
            def,
        }
    }
}

/// The related spans of `d` as `(text, message)`.
fn related(text: &str, d: &Diagnostic) -> Vec<(String, String)> {
    d.related
        .iter()
        .map(|label| {
            (
                text[label.span.range()].to_owned(),
                label.message.clone().unwrap_or_default(),
            )
        })
        .collect()
}

/// Check `text` (one module) with the checker reading `registry` and run
/// the program-wide pass with the functions `gpu_roots` as GPU roots. The
/// resolver keeps the v0.1 registry, so its `E9010` for built-in functions
/// the test registry implements is dropped.
fn run_with(text: &str, registry: &'static Registry, gpu_roots: &[&str]) -> Run {
    let mut lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    assert!(sink.is_empty(), "syntax errors in {text:?}");
    let resolution = resolve_module(&parsed.module, &mut sink);
    let mut checker =
        check::Checker::with_registry(&parsed.module, text, &resolution, &mut sink, registry);
    checker.module(&parsed.module);
    let typeck = checker.finish();
    let id = ModuleId::from_index(0);
    let roots = Roots {
        gpu_functions: gpu_roots
            .iter()
            .filter_map(|name| {
                typeck
                    .functions()
                    .find(|(_, info)| info.name == *name)
                    .map(|(def, _)| FnRef { module: id, def })
            })
            .collect(),
        ..Roots::default()
    };
    let units = [ProgramUnit {
        id,
        resolution: &resolution,
        types: &typeck,
    }];
    let effects = check_program(&units, &roots, &mut sink);
    let diagnostics = sink
        .finish()
        .diagnostics
        .into_iter()
        .filter(|d| d.code != Code::E9010)
        .collect();
    Run {
        diagnostics,
        effects,
        typeck,
    }
}

fn run(text: &str, gpu_roots: &[&str]) -> Run {
    run_with(text, registry(), gpu_roots)
}

/// A v0.1 registry with the global intrinsic `name` changed by `edit`.
/// Leaked: it lives as long as the test binary.
fn registry_with(
    name: &str,
    edit: impl FnOnce(&mut crate::stdlib::IntrinsicDef),
) -> &'static Registry {
    let mut changed = Registry::v0_1();
    let def = changed
        .intrinsics
        .iter_mut()
        .find(|f| f.name == name)
        .unwrap_or_else(|| panic!("no intrinsic {name}"));
    edit(def);
    Box::leak(Box::new(changed))
}

#[test]
fn levels_and_reachability_are_recorded_for_every_function() {
    let r = run(
        "fn leaf(x: f32) -> f32 { return x * 2.0; }
fn shade(x: f32) -> f32 { return leaf(x); }
fn unused(x: f32) -> f32 { return x; }
cpu fn tick(x: f32) -> f32 { return leaf(x) + log_it(x); }
cpu fn log_it(x: f32) -> f32 { return x; }
",
        &["shade"],
    );
    // `log_it` needs no CPU effect (W4003); `tick` calls a `cpu fn`.
    assert_eq!(r.codes(), ["W4003"], "{:#?}", r.diagnostics);
    let effect = |name: &str| r.effects.get(r.function(name)).unwrap();
    assert_eq!(effect("leaf").level, EffectLevel::Pure);
    assert_eq!(effect("tick").level, EffectLevel::Cpu);
    assert!(effect("leaf").gpu_reachable && effect("leaf").cpu_reachable);
    assert!(effect("shade").gpu_reachable && !effect("shade").cpu_reachable);
    assert!(!effect("unused").gpu_reachable && !effect("unused").cpu_reachable);
    assert!(!effect("tick").gpu_reachable && effect("tick").cpu_reachable);
    assert!(effect("log_it").cpu_reachable);
}

#[test]
fn cpu_only_builtins_in_gpu_code_are_e4012_and_elsewhere_e4002() {
    let changed = registry_with("random", |f| f.since = Milestone::M1);
    let text = "fn noise(p: f32) -> f32 { return p * random(); }
fn shade(p: f32) -> f32 { return noise(p); }
";
    // Not GPU code: a pure function calling a CPU-only built-in is `E4002`,
    // and so is its caller, with the chain.
    let r = run_with(text, changed, &[]);
    assert_eq!(r.codes(), ["E4002", "E4002"], "{:#?}", r.diagnostics);
    assert_eq!(
        r.diagnostics[0].message,
        "The pure function 'noise' calls `random`, which is CPU-only."
    );
    assert_eq!(
        r.diagnostics[1].message,
        "The pure function 'shade' calls 'noise', which needs the CPU: shade → noise → `random`."
    );
    assert_eq!(
        related(text, &r.diagnostics[1]),
        [(
            "random()".to_owned(),
            "'noise' calls `random` here".to_owned()
        )]
    );
    // GPU code: the call itself is `E4012` (not also `E4002`), with the
    // chain from the root.
    let r = run_with(text, changed, &["shade"]);
    assert_eq!(r.codes(), ["E4012", "E4002"], "{:#?}", r.diagnostics);
    let d = r.only(Code::E4012);
    assert_eq!(
        d.message,
        "`random` is a CPU-only built-in function, but the function 'noise' runs on the GPU."
    );
    assert_eq!(
        related(text, d),
        [
            (
                "shade".to_owned(),
                "'shade' runs on the GPU (called from a stage function)".to_owned()
            ),
            (
                "noise(p)".to_owned(),
                "'shade' calls 'noise' here".to_owned()
            ),
        ]
    );
}

#[test]
fn a_cpu_fn_that_calls_a_cpu_only_builtin_is_not_w4003() {
    let changed = registry_with("random", |f| f.since = Milestone::M1);
    let r = run_with("cpu fn roll() -> f32 { return random(); }\n", changed, &[]);
    assert!(r.diagnostics.is_empty(), "{:#?}", r.diagnostics);
}

#[test]
fn gpu_only_builtins_reached_from_cpu_code_are_e4013() {
    let changed = registry_with("sin", |f| {
        f.domain = Domain::Gpu;
        f.const_eligible = false;
    });
    let text = "fn wave(x: f32) -> f32 { return sin(x); }
cpu fn tick(x: f32) -> f32 { return wave(x); }
cpu fn direct(x: f32) -> f32 { return sin(x); }
fn unused(x: f32) -> f32 { return sin(x); }
";
    let r = run_with(text, changed, &[]);
    let found: Vec<(&str, &str)> = r
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::E4013)
        .map(|d| {
            (
                &text[d.primary.as_ref().unwrap().span.range()],
                d.message.as_str(),
            )
        })
        .collect();
    assert_eq!(
        found,
        [
            (
                "sin(x)",
                "`sin` is a GPU-only built-in function, but the function 'wave' is called from CPU code."
            ),
            (
                "sin(x)",
                "`sin` is a GPU-only built-in function, but the function 'direct' runs on the CPU."
            ),
        ]
    );
    let first = r
        .diagnostics
        .iter()
        .find(|d| d.code == Code::E4013)
        .unwrap();
    assert_eq!(
        related(text, first),
        [
            (
                "tick".to_owned(),
                "'tick' is a `cpu fn`, which runs on the CPU".to_owned()
            ),
            ("wave(x)".to_owned(), "'tick' calls 'wave' here".to_owned()),
        ]
    );
    // The `cpu fn`s use no CPU effect either (a GPU-only call is not one).
    assert_eq!(
        r.codes().iter().filter(|c| **c == "W4003").count(),
        2,
        "{:#?}",
        r.diagnostics
    );
}

#[test]
fn handler_only_builtins_outside_handlers_are_e5080() {
    let changed = registry_with("random", |f| {
        f.since = Milestone::M1;
        f.handlers_only = true;
    });
    let text = "cpu fn make() -> f32 { return random(); }
fn pure_make() -> f32 { return random(); }
fn caller() -> f32 { return pure_make(); }
";
    let r = run_with(text, changed, &[]);
    // One diagnostic per call: `E5080` (not also `E4002`); the caller of a
    // function that needs the CPU is `E4002`; `make` is not `W4003`.
    assert_eq!(
        r.codes(),
        ["E5080", "E5080", "E4002"],
        "{:#?}",
        r.diagnostics
    );
    assert_eq!(
        r.diagnostics[0].message,
        "`random` may be called only in lifecycle functions and event handlers, not in the function 'make'."
    );
}

#[test]
fn each_cycle_is_reported_once_at_its_first_function() {
    let text = "fn a() { b(); }
fn b() { a(); }
fn c() { a(); d(); }
fn d() { d(); }
fn e() { c(); }
";
    let r = run(text, &[]);
    assert_eq!(r.codes(), ["E4001", "E4001"], "{:#?}", r.diagnostics);
    assert_eq!(
        r.diagnostics[0].message,
        "The function 'a' calls itself: a → b → a."
    );
    assert_eq!(
        r.diagnostics[1].message,
        "The function 'd' calls itself: d → d."
    );
    assert_eq!(
        related(text, &r.diagnostics[0]),
        [
            ("b()".to_owned(), "'a' calls 'b' here".to_owned()),
            ("a()".to_owned(), "'b' calls 'a' here".to_owned()),
        ]
    );
}

#[test]
fn gpu_roots_reach_only_pure_functions() {
    // A call of a `cpu fn` from GPU code is `E4002`; the `cpu fn` is not
    // GPU code (its string local is no `E4011`).
    let text = "cpu fn tell(x: f32) -> f32 { let s = \"x\"; return x; }
fn shade(x: f32) -> f32 { return tell(x); }
";
    let r = run(text, &["shade"]);
    assert_eq!(r.codes(), ["W4003", "E4002"], "{:#?}", r.diagnostics);
    assert!(!r.effects.get(r.function("tell")).unwrap().gpu_reachable);
}

#[test]
fn chains_are_cut_after_the_step_limit() {
    // 300 `fn`s, each calling the next, the last a `cpu fn`: the first
    // one's chain lists MAX_CHAIN_STEPS steps and says how many follow.
    let count = 300;
    let mut text = String::new();
    for i in 0..count {
        text.push_str(&format!("fn f{i}() {{ f{}(); }}\n", i + 1));
    }
    text.push_str(&format!("cpu fn f{count}() {{ }}\n"));
    let r = run(&text, &[]);
    let first = r
        .diagnostics
        .iter()
        .find(|d| d.code == Code::E4002)
        .unwrap();
    assert!(
        first
            .message
            .starts_with("The pure function 'f0' calls 'f1'")
    );
    assert!(
        first.message.contains("… (269 more) …"),
        "{}",
        first.message
    );
    assert_eq!(first.related.len(), effects::MAX_CHAIN_STEPS);
    assert!(
        first
            .notes
            .iter()
            .any(|n| n == "the chain continues through 44 more steps not listed"),
        "{:?}",
        first.notes
    );
    // One `E4002` per call, but only the diagnostics a file keeps are
    // built; the rest (and the `W4003` of the `cpu fn`, which sorts last)
    // count as suppressed, in one `W9003`.
    let codes = r.codes();
    assert_eq!(codes.iter().filter(|c| **c == "E4002").count(), 199);
    assert_eq!(codes.last(), Some(&"W9003"), "{codes:?}");
}
