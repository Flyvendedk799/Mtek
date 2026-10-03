//! Unit tests of the module parser: the AST shapes of every construct through
//! the dump, diagnostics with their spans, candidate edits, the structural
//! invariants of every tree, recovery without cascades, the nesting limit on
//! small stacks, and robustness on junk and on mutated programs.

use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::FileId;
use crate::syntax::ast::Module;
use crate::syntax::{
    CandidateEdit, MAX_NESTING_DEPTH, NodeInfo, dump_module, lex_str, parse_module, walk_module,
};

const FILE: FileId = FileId(0);

/// The result of parsing `src`, lexical diagnostics included.
struct Run {
    src: String,
    module: Module,
    diagnostics: Vec<Diagnostic>,
    edits: Vec<CandidateEdit>,
}

impl Run {
    fn codes(&self) -> Vec<Code> {
        self.diagnostics.iter().map(|d| d.code).collect()
    }

    /// `(code, text of the primary span)` of each diagnostic.
    fn found(&self) -> Vec<(Code, &str)> {
        self.diagnostics
            .iter()
            .map(|d| {
                let span = d.primary.as_ref().map(|l| l.span).unwrap();
                (d.code, self.src.get(span.range()).unwrap())
            })
            .collect()
    }

    fn dump(&self) -> String {
        one_line(&dump_module(&self.module))
    }
}

fn parse(src: &str) -> Run {
    let mut lexed = lex_str(FILE, src);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(src, &lexed.tokens, &lexed.trivia, &mut sink);
    Run {
        src: src.to_owned(),
        module: parsed.module,
        diagnostics: sink.finish().diagnostics,
        edits: parsed.candidate_edits,
    }
}

/// Join the lines of a dump: line breaks sit between children, so a space
/// gives the flat form.
fn one_line(dump: &str) -> String {
    dump.split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn nodes(module: &Module) -> Vec<(NodeInfo, Option<NodeInfo>)> {
    let mut all = Vec::new();
    walk_module(module, &mut |info, parent| all.push((info, parent)));
    all
}

/// The structural invariants of every tree: spans lie inside the text and
/// inside their parent's span, children have smaller ids than their parent,
/// ids are unique and below `node_count`, and in a tree without errors they
/// are exactly `0..node_count`.
fn check_tree(run: &Run) {
    let all = nodes(&run.module);
    let mut ids = Vec::new();
    for (info, parent) in &all {
        ids.push(info.id.0);
        assert!(
            info.span.start <= info.span.end && info.span.end as usize <= run.src.len(),
            "{:?}: {info:?} is outside the text",
            run.src
        );
        if let Some(parent) = parent {
            assert!(parent.id > info.id, "children are numbered first: {info:?}");
            assert!(
                parent.span.contains_span(info.span),
                "{:?}: {info:?} is outside its parent {parent:?}",
                run.src
            );
        }
    }
    ids.sort_unstable();
    assert!(ids.windows(2).all(|pair| pair[0] < pair[1]), "unique ids");
    assert!(
        ids.iter().all(|&id| id < run.module.node_count),
        "ids are below node_count"
    );
    if run.diagnostics.is_empty() {
        assert_eq!(
            ids,
            (0..run.module.node_count).collect::<Vec<_>>(),
            "{:?}: ids are dense",
            run.src
        );
    }
}

/// The dump of `src`, which must parse without diagnostics and with a sound
/// tree.
fn flat(src: &str) -> String {
    let run = parse(src);
    assert!(run.diagnostics.is_empty(), "{src}: {:?}", run.diagnostics);
    check_tree(&run);
    run.dump()
}

/// The dump of `src` and the `(code, text)` of its diagnostics.
fn flawed(src: &str) -> (String, Vec<(Code, String)>) {
    let run = parse(src);
    check_tree(&run);
    let found = run
        .found()
        .into_iter()
        .map(|(code, text)| (code, text.to_owned()))
        .collect();
    (run.dump(), found)
}

/// The diagnostics of `src` as `(code, text of the primary span)`.
fn diags(src: &str) -> Vec<(Code, String)> {
    flawed(src).1
}

fn d(code: Code, text: &str) -> (Code, String) {
    (code, text.to_owned())
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

#[test]
fn an_empty_file_is_an_empty_module() {
    assert_eq!(flat(""), "(module)");
    assert_eq!(flat("  // only a comment\n"), "(module)");
}

#[test]
fn imports_with_and_without_a_trailing_comma() {
    assert_eq!(
        flat("import { A } from \"./a.mtek\";"),
        "(module (import \"./a.mtek\" A))"
    );
    assert_eq!(
        flat("import { A, B, } from \"../b.mtek\";"),
        "(module (import \"../b.mtek\" A B))"
    );
}

#[test]
fn from_is_an_ordinary_name_everywhere_else() {
    assert_eq!(
        flat("fn from(from: f32) -> f32 { return from; }"),
        "(module (fn from (params (param from (type f32))) (ret (type f32)) (block (return (name from)))))"
    );
    assert_eq!(
        flat("import { from } from \"./a.mtek\";"),
        "(module (import \"./a.mtek\" from))"
    );
}

#[test]
fn constants_with_and_without_a_type() {
    assert_eq!(
        flat("const A = 1;\nconst B: f32 = 2.0;"),
        "(module (const A (lit int 1)) (const B (type f32) (lit float 2.0)))"
    );
}

#[test]
fn functions_and_cpu_functions() {
    assert_eq!(flat("fn f() {}"), "(module (fn f (params) (block)))");
    assert_eq!(
        flat("fn f(a: f32, b: vec3,) -> vec3 { return b; }"),
        "(module (fn f (params (param a (type f32)) (param b (type vec3))) (ret (type vec3)) (block (return (name b)))))"
    );
    assert_eq!(
        flat("cpu fn log_it(msg: string) { print(msg); }"),
        "(module (cpu-fn log_it (params (param msg (type string))) (block (expr (call (name print) (name msg))))))"
    );
}

#[test]
fn structs() {
    assert_eq!(
        flat("struct P { x: f32; y: vec3; zs: array<f32, 4>; }"),
        "(module (struct P (field x (type f32)) (field y (type vec3)) (field zs (type array (type f32) (len 4)))))"
    );
}

#[test]
fn export_marks_the_item_not_the_declaration() {
    let src = "export const A = 1;\nexport fn f() {}\nexport struct S { a: f32; }\nexport scene Main {}\nexport prefab P {}\nexport material M {}";
    let run = parse(src);
    assert!(run.diagnostics.is_empty(), "{:?}", run.diagnostics);
    check_tree(&run);
    assert!(run.module.items.iter().all(|item| item.export));
    assert_eq!(run.module.items[0].span.start, 0, "starts at `export`");
    assert_eq!(
        run.dump(),
        "(module (export (const A (lit int 1))) (export (fn f (params) (block))) (export (struct S (field a (type f32)))) (export (scene Main)) (export (prefab P)) (export (material M)))"
    );
}

#[test]
fn materials_have_params_and_stage_functions() {
    assert_eq!(
        flat(
            "material Pulse {\n    param tint: color = #6b5cff;\n    param strength: f32;\n    fragment(input: SurfaceInput) -> color { return tint; }\n}"
        ),
        "(module (material Pulse (param tint (type color) (lit color #6b5cff)) (param strength (type f32)) (stage fragment (params (param input (type SurfaceInput))) (ret (type color)) (block (return (name tint))))))"
    );
}

#[test]
fn the_names_of_params_may_be_prelude_type_names() {
    // `spec/materials.md` 9: `param color: color = #ffffff;`.
    assert_eq!(
        flat(
            "export material Unlit { param color: color = #ffffff; fragment(surface: SurfaceInput) -> color { return color; } }"
        ),
        "(module (export (material Unlit (param color (type color) (lit color #ffffff)) (stage fragment (params (param surface (type SurfaceInput))) (ret (type color)) (block (return (name color)))))))"
    );
}

// ---------------------------------------------------------------------------
// Scenes, entities, prefabs
// ---------------------------------------------------------------------------

#[test]
fn every_scene_member_kind() {
    let src = "scene Demo {
    clear_color: #101418;
    const LIMIT = 3;
    state speed: f32 = 0.7;
    camera Main { position: vec3(0.0, 0.0, 5.0); }
    entity Cube { position: vec3(0.0); }
    update(dt: f32) { speed += dt; }
    fixed_update(step: f32) {}
    on key_down(Key.Space) { speed = -speed; }
}";
    assert_eq!(
        flat(src),
        "(module (scene Demo (init clear_color (lit color #101418)) (const LIMIT (lit int 3)) (state speed (type f32) (lit float 0.7)) (object camera Main (init position (call (name vec3) (lit float 0.0) (lit float 0.0) (lit float 5.0)))) (entity Cube (init position (call (name vec3) (lit float 0.0)))) (lifecycle update (params (param dt (type f32))) (block (assign += (name speed) (name dt)))) (lifecycle fixed_update (params (param step (type f32))) (block)) (on key_down (filter (field (name Key) Space)) (block (assign = (name speed) (unary - (name speed)))))))"
    );
}

#[test]
fn entity_members_include_nested_entities_state_and_handlers() {
    let scene = "scene S { entity Cube {
        position: vec3(0.0, 0.5, 0.0);
        state hits: i32 = 0;
        const K = 2;
        entity Badge { position: vec3(0.0, 0.6, 0.0); }
        update(dt: f32) { hits += 1; }
        on collision_enter(other: entity_ref) { hits += K; }
    } }";
    assert_eq!(
        flat(scene),
        "(module (scene S (entity Cube (init position (call (name vec3) (lit float 0.0) (lit float 0.5) (lit float 0.0))) (state hits (type i32) (lit int 0)) (const K (lit int 2)) (entity Badge (init position (call (name vec3) (lit float 0.0) (lit float 0.6) (lit float 0.0)))) (lifecycle update (params (param dt (type f32))) (block (assign += (name hits) (lit int 1)))) (on collision_enter (param other (type entity_ref)) (block (assign += (name hits) (name K)))))))"
    );
}

#[test]
fn a_prefab_has_params_and_an_instance_names_its_prefab() {
    let src = "prefab Crate {
    param origin: vec3 = vec3(0.0, 2.0, 0.0);
    param tint: color;
    position: origin;
    state bounces: i32 = 0;
    on collision_enter(other: entity_ref) { self.bounces += 1; }
}
scene S { entity First: Crate { origin: vec3(0.0, 3.0, 0.0); } }";
    assert_eq!(
        flat(src),
        "(module (prefab Crate (param origin (type vec3) (call (name vec3) (lit float 0.0) (lit float 2.0) (lit float 0.0))) (param tint (type color)) (init position (name origin)) (state bounces (type i32) (lit int 0)) (on collision_enter (param other (type entity_ref)) (block (assign += (field (self) bounces) (lit int 1))))) (scene S (entity First (prefab Crate) (init origin (call (name vec3) (lit float 0.0) (lit float 3.0) (lit float 0.0))))))"
    );
}

#[test]
fn fields_take_bind_and_descriptors() {
    let src = "scene S { entity E {
    material: Pulse { tint: bind(tint); phase: bind(frame.time) };
    mesh: Box { size: vec3(1.0) };
    scale: bind(f(a, b));
} }";
    assert_eq!(
        flat(src),
        "(module (scene S (entity E (init material (desc Pulse (field tint (bind (name tint))) (field phase (bind (field (name frame) time))))) (init mesh (desc Box (field size (call (name vec3) (lit float 1.0))))) (init scale (bind (call (name f) (name a) (name b)))))))"
    );
}

#[test]
fn material_is_a_field_name_although_it_is_a_keyword() {
    // `spec/scenes.md` 4.1: the entity field `material`; and reading it:
    // `Cube.material.phase = 0.5;` (`spec/materials.md` 4). Decision 0023.
    let src = "scene S { entity Cube { material: Unlit { color: #ffffff }; }
    on key_down(Key.A) { Cube.material.phase = 0.5; } }";
    assert_eq!(
        flat(src),
        "(module (scene S (entity Cube (init material (desc Unlit (field color (lit color #ffffff))))) (on key_down (filter (field (name Key) A)) (block (assign = (field (field (name Cube) material) phase) (lit float 0.5))))))"
    );
    // A scene object field and a descriptor field too.
    assert_eq!(
        flat("scene S { camera C { material: 1; } x: A { material: 2 }; }"),
        "(module (scene S (object camera C (init material (lit int 1))) (init x (desc A (field material (lit int 2))))))"
    );
}

#[test]
fn material_still_starts_a_material_declaration() {
    assert_eq!(flat("material M {}"), "(module (material M))");
}

#[test]
fn members_are_told_apart_by_two_tokens_of_lookahead() {
    // `Ident :` field, `Ident (` lifecycle function, `Ident Ident {` object.
    assert_eq!(
        flat("scene S { a: 1; b(dt: f32) {} c d { e: 2; } }"),
        "(module (scene S (init a (lit int 1)) (lifecycle b (params (param dt (type f32))) (block)) (object c d (init e (lit int 2)))))"
    );
    // Any word is a lifecycle function name here; the checker rejects it.
    assert_eq!(
        flat("scene S { start() {} }"),
        "(module (scene S (lifecycle start (params) (block))))"
    );
}

#[test]
fn handler_arguments_are_parameters_or_filters() {
    // `Ident :` is the parameter form; everything else is an expression.
    assert_eq!(
        flat(
            "scene S { on a() {} on b(Key.W) {} on c(x: vec2) {} on d(Key.A, p: T,) {} on e(f(1), 2) {} }"
        ),
        "(module (scene S (on a (block)) (on b (filter (field (name Key) W)) (block)) (on c (param x (type vec2)) (block)) (on d (filter (field (name Key) A)) (param p (type T)) (block)) (on e (filter (call (name f) (lit int 1))) (filter (lit int 2)) (block))))"
    );
}

#[test]
fn a_descriptor_may_be_a_handler_filter() {
    assert_eq!(
        flat("scene S { on a(Box { x: 1 }) {} }"),
        "(module (scene S (on a (filter (desc Box (field x (lit int 1)))) (block))))"
    );
}

#[test]
fn an_empty_body_and_empty_scene_object() {
    assert_eq!(
        flat("scene S { camera C {} entity E {} }"),
        "(module (scene S (object camera C) (entity E)))"
    );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[test]
fn types_with_nested_arguments_and_names_as_lengths() {
    assert_eq!(
        flat("const A: array<array<f32, 2>, 3> = x;"),
        "(module (const A (type array (type array (type f32) (len 2)) (len 3)) (name x)))"
    );
    assert_eq!(
        flat("const A: array<vec3, COUNT> = x;"),
        "(module (const A (type array (type vec3) (len COUNT)) (name x)))"
    );
    assert_eq!(
        flat("const A: array<f32, 18446744073709551616> = x;"),
        "(module (const A (type array (type f32) (len overflow)) (name x)))"
    );
}

#[test]
fn a_closing_angle_glued_to_the_next_token_is_split() {
    // `>=` lexes as one token: `array<f32, 2>= x` is the type, `=`, `x`.
    assert_eq!(
        flat("fn f() { let a: array<f32, 2>= x; }"),
        "(module (fn f (params) (block (let a (type array (type f32) (len 2)) (name x)))))"
    );
    // `>>` closes two types at once when the inner one is the last argument.
    let run = parse("const A: array<array<f32, 2>> = x;");
    assert_eq!(run.found(), [(Code::E1001, ">")]);
    assert_eq!(
        run.diagnostics[0].message,
        "Expected `,` and an array length after the element type, found `>`."
    );
    check_tree(&run);
}

#[test]
fn a_type_node_ends_where_the_angle_ends() {
    let run = parse("const A: array<f32, 2>= x;");
    assert!(run.diagnostics.is_empty());
    let ty = nodes(&run.module)
        .into_iter()
        .find(|(info, _)| info.kind == "type" && run.src[info.span.range()].starts_with("array"))
        .unwrap()
        .0;
    assert_eq!(&run.src[ty.span.range()], "array<f32, 2>");
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

#[test]
fn every_statement_kind() {
    let src = "fn f() {
    let a = 1;
    var b: f32 = 2.0;
    const C = 3;
    b = a;
    b += 1.0; b -= 1.0; b *= 2.0; b /= 2.0;
    g(a);
    return;
}";
    assert_eq!(
        flat(src),
        "(module (fn f (params) (block (let a (lit int 1)) (var b (type f32) (lit float 2.0)) (const C (lit int 3)) (assign = (name b) (name a)) (assign += (name b) (lit float 1.0)) (assign -= (name b) (lit float 1.0)) (assign *= (name b) (lit float 2.0)) (assign /= (name b) (lit float 2.0)) (expr (call (name g) (name a))) (return))))"
    );
}

#[test]
fn if_else_if_else_and_nested_blocks() {
    assert_eq!(
        flat("fn f() { if a { x(); } else if b { y(); } else { z(); } { w(); } }"),
        "(module (fn f (params) (block (if (name a) (block (expr (call (name x)))) (if (name b) (block (expr (call (name y)))) (block (expr (call (name z)))))) (block (expr (call (name w)))))))"
    );
}

#[test]
fn for_loops_over_ranges_and_arrays() {
    assert_eq!(
        flat(
            "fn f() { for i in 0..n { break; } for x in xs { continue; } for j in a + 1..b * 2 {} }"
        ),
        "(module (fn f (params) (block (for i (range (lit int 0) (name n)) (block (break))) (for x (each (name xs)) (block (continue))) (for j (range (binary + (name a) (lit int 1)) (binary * (name b) (lit int 2))) (block)))))"
    );
}

#[test]
fn break_is_valid_in_nested_blocks_of_a_loop() {
    assert_eq!(
        flat("fn f() { for i in 0..3 { if i == 1 { break; } { continue; } } }"),
        "(module (fn f (params) (block (for i (range (lit int 0) (lit int 3)) (block (if (binary == (name i) (lit int 1)) (block (break))) (block (continue)))))))"
    );
}

#[test]
fn return_with_a_value_and_before_a_closing_brace() {
    assert_eq!(
        flat("fn f() -> f32 { return 1.0; }"),
        "(module (fn f (params) (ret (type f32)) (block (return (lit float 1.0)))))"
    );
    let (dump, diagnostics) = flawed("fn f() { return }");
    assert_eq!(dump, "(module (fn f (params) (block (return))))");
    assert_eq!(diagnostics, [d(Code::E1003, "")]);
}

#[test]
fn a_descriptor_in_parentheses_is_fine_in_a_condition() {
    assert_eq!(
        flat("fn f() { if (Box { size: 1.0 }) == b { } for i in (Box { a: 1 }) { } }"),
        "(module (fn f (params) (block (if (binary == (paren (desc Box (field size (lit float 1.0)))) (name b)) (block)) (for i (each (paren (desc Box (field a (lit int 1))))) (block)))))"
    );
}

#[test]
fn a_descriptor_may_start_an_expression_statement_or_value() {
    assert_eq!(
        flat("fn f() { let b = Box { size: 1.0 }; g(Box { a: 1 }); }"),
        "(module (fn f (params) (block (let b (desc Box (field size (lit float 1.0)))) (expr (call (name g) (desc Box (field a (lit int 1))))))))"
    );
}

// ---------------------------------------------------------------------------
// Diagnostics: one test per code, with the primary span
// ---------------------------------------------------------------------------

#[test]
fn e1001_lists_what_was_expected() {
    let run = parse("fn f() { let = 1; }");
    assert_eq!(run.found(), [(Code::E1001, "=")]);
    assert_eq!(
        run.diagnostics[0].message,
        "Expected a name after `let`, found `=`."
    );
    let run = parse("scene S { 42 }");
    assert_eq!(run.codes(), [Code::E1001]);
    assert!(
        run.diagnostics[0]
            .message
            .starts_with("Expected a member: a field `name: value;`, `const`, `state`"),
        "{}",
        run.diagnostics[0].message
    );
    assert!(run.diagnostics[0].expected.is_some() && run.diagnostics[0].actual.is_some());
    let run = parse("import { A } \"./a.mtek\";");
    assert_eq!(
        run.diagnostics[0].message,
        "Expected `from` after the list of imported names, found string literal `\"./a.mtek\"`."
    );
}

#[test]
fn e1002_names_the_opener_in_a_related_span() {
    let run = parse("fn f() {\n    let x = g(1;\n}");
    assert_eq!(run.found(), [(Code::E1002, ";")]);
    let related = &run.diagnostics[0].related;
    assert_eq!(related.len(), 1);
    assert_eq!(&run.src[related[0].span.range()], "(");
    assert_eq!(related[0].message.as_deref(), Some("opened here"));

    let run = parse("scene S {\n    entity E {\n        a: 1;\n");
    assert_eq!(run.codes(), [Code::E1002]);
    assert_eq!(
        &run.src[run.diagnostics[0].related[0].span.range()],
        "{",
        "the innermost unclosed brace"
    );
    assert_eq!(run.diagnostics[0].related[0].span.start, 23);
}

#[test]
fn e1002_for_a_missing_paren_after_parameters() {
    let (dump, found) = flawed("fn f(a: f32 -> f32 { return a; }\nfn g() {}");
    assert_eq!(found, [d(Code::E1002, "->")]);
    // The rest of the file is read normally.
    assert_eq!(
        dump,
        "(module (fn f (params (param a (type f32))) (ret (type f32)) (block (return (name a)))) (fn g (params) (block)))"
    );
    let (_, found) = flawed("fn f(a: f32 {}\nfn g() {}");
    assert_eq!(found, [d(Code::E1002, "{")]);
}

#[test]
fn e1003_is_a_missing_semicolon_with_an_edit() {
    let src = "fn f() {\n    let x = 1\n    let y = 2;\n}";
    let run = parse(src);
    assert_eq!(run.found(), [(Code::E1003, "")]);
    let at = run.diagnostics[0].primary.as_ref().unwrap().span;
    assert_eq!(
        (at.start, at.end),
        (
            src.find('1').unwrap() as u32 + 1,
            src.find('1').unwrap() as u32 + 1
        ),
        "an empty span right after the last token of the statement"
    );
    assert_eq!(run.edits.len(), 1);
    assert_eq!(run.edits[0].code, Code::E1003);
    assert_eq!(run.edits[0].at, at);
    assert_eq!(run.edits[0].edit.edits.len(), 1);
    assert_eq!(run.edits[0].edit.edits[0].span, at);
    assert_eq!(run.edits[0].edit.edits[0].replacement, ";");
    // Applying the edit makes the file clean.
    let fixed = format!(
        "{};{}",
        &src[..at.start as usize],
        &src[at.start as usize..]
    );
    assert!(parse(&fixed).diagnostics.is_empty());
}

#[test]
fn e1003_in_every_place_a_semicolon_ends_something() {
    for (src, what) in [
        ("const A = 1\nfn f() {}", "constant declaration"),
        ("import { A } from \"./a.mtek\"\nfn f() {}", "import"),
        ("struct S { a: f32 }", "field"),
        ("scene S { state a: f32 = 1.0 }", "declaration"),
        ("scene S { a: 1 }", "field"),
        ("prefab P { param a: f32 }", "declaration"),
        ("scene S { camera C { a: 1 } }", "field"),
        ("fn f() { x = 1 }", "assignment"),
        ("fn f() { g() }", "statement"),
        ("fn f() { for i in a { break } }", "statement"),
        ("fn f() { return 1 }", "`return` statement"),
        ("fn f() { let a = 1 }", "statement"),
    ] {
        let run = parse(src);
        assert_eq!(run.codes(), [Code::E1003], "{src}");
        assert!(
            run.diagnostics[0].message.contains(what),
            "{src}: {}",
            run.diagnostics[0].message
        );
        assert_eq!(run.edits.len(), 1, "{src}");
    }
}

#[test]
fn a_semicolon_is_not_forgotten_when_something_else_follows_on_the_line() {
    // E1001, and the statement is skipped to its `;`.
    let (dump, found) = flawed("fn f() { let x = 1 2; let y = 3; }");
    assert_eq!(found, [d(Code::E1001, "2")]);
    assert_eq!(
        dump,
        "(module (fn f (params) (block (let x (lit int 1)) (let y (lit int 3)))))"
    );
}

#[test]
fn e1004_is_the_end_of_the_file_where_something_was_expected() {
    for src in [
        "const A =",
        "fn f(",
        "fn f() -> ",
        "scene",
        "import",
        "export",
        "const A: array<",
    ] {
        let run = parse(src);
        assert!(
            run.codes().contains(&Code::E1004) || run.codes().contains(&Code::E1002),
            "{src}: {:?}",
            run.codes()
        );
        assert!(run.diagnostics.len() <= 2, "{src}: {:?}", run.diagnostics);
    }
    let run = parse("const A =");
    assert_eq!(
        run.diagnostics[0].message,
        "Unexpected end of file; expected an expression."
    );
    assert_eq!(run.codes(), [Code::E1004]);
    let run = parse("scene");
    assert_eq!(run.codes(), [Code::E1004]);
    assert_eq!(
        run.diagnostics[0].message,
        "Unexpected end of file; expected a scene name after `scene`."
    );
}

#[test]
fn e1011_asks_for_parentheses_with_an_edit() {
    let src = "fn f() { if Box { size: 1.0 } { } }";
    let run = parse(src);
    assert_eq!(run.found(), [(Code::E1011, "Box { size: 1.0 }")]);
    assert_eq!(run.edits.len(), 1);
    let edits = &run.edits[0].edit.edits;
    assert_eq!(
        edits
            .iter()
            .map(|e| (e.span.start, e.span.end, e.replacement.as_str()))
            .collect::<Vec<_>>(),
        [(12, 12, "("), (29, 29, ")")]
    );
    // The same for the iterable of `for`.
    let run = parse("fn f() { for i in Box { a: 1 } { } }");
    assert_eq!(run.codes(), [Code::E1011]);
}

#[test]
fn e1020_only_calls_may_be_statements() {
    let (_, found) = flawed("fn f() { 1 + 2; x; (g(1)); f(1); a.b(2); }");
    assert_eq!(
        found,
        [
            d(Code::E1020, "1 + 2"),
            d(Code::E1020, "x"),
            d(Code::E1020, "(g(1))")
        ]
    );
}

#[test]
fn e1020_is_not_added_to_a_statement_that_is_already_broken() {
    // The missing `;` is the problem, not the unused value.
    assert_eq!(diags("fn f() { x\n y(); }"), [d(Code::E1003, "")]);
    // An erroneous expression has been reported already.
    assert_eq!(diags("fn f() { ); }").len(), 1);
}

#[test]
fn e1030_break_and_continue_need_a_loop() {
    let (_, found) = flawed("fn f() { break; continue; }");
    assert_eq!(found, [d(Code::E1030, "break"), d(Code::E1030, "continue")]);
    // In a loop, also through blocks and ifs, they are fine; after it not.
    assert_eq!(
        diags("fn f() { for i in 0..2 { if a { break; } } break; }"),
        [d(Code::E1030, "break")]
    );
}

#[test]
fn e1030_a_function_body_inside_a_loop_is_not_in_the_loop() {
    // Handlers and lifecycle functions are bodies of their own.
    let src =
        "scene S { update(dt: f32) { break; for i in 0..2 { break; } } on a() { continue; } }";
    assert_eq!(
        diags(src),
        [d(Code::E1030, "break"), d(Code::E1030, "continue")]
    );
}

#[test]
fn e1040_a_member_that_does_not_belong() {
    let (dump, found) = flawed("scene S { fn helper() {} state a: f32 = 1.0; }");
    assert_eq!(found, [d(Code::E1040, "fn")]);
    assert_eq!(
        dump,
        "(module (scene S (error) (state a (type f32) (lit float 1.0))))"
    );
    assert_eq!(
        diags("scene S { entity E { param p: f32; } }"),
        [d(Code::E1040, "param")]
    );
    assert_eq!(
        diags("scene S { param p: f32; }"),
        [d(Code::E1040, "param")]
    );
    // A prefab may have params, and entities inside (E5040 is the checker's).
    assert!(diags("prefab P { param p: f32; entity E {} }").is_empty());
    assert_eq!(
        diags("entity E { entity F { camera C {} } }"),
        [d(Code::E1040, "entity"), d(Code::E1040, "camera")]
    );
    assert_eq!(
        diags("scene S { entity E { camera C { a: 1; } } }"),
        [d(Code::E1040, "camera")]
    );
    // Statements are not members.
    assert_eq!(
        diags("scene S { let x = 1; if a { } }"),
        [d(Code::E1040, "let"), d(Code::E1040, "if")]
    );
    // Items are not members: `struct` in a scene, `scene` in a scene.
    assert_eq!(
        diags(
            "scene S { struct T { a: f32; } scene U {} import { A } from \"./a.mtek\"; export fn g() {} }"
        ),
        [
            d(Code::E1040, "struct"),
            d(Code::E1040, "scene"),
            d(Code::E1040, "import"),
            d(Code::E1040, "export")
        ]
    );
    // Members of scenes at the top level, and declarations in blocks.
    assert_eq!(
        diags("entity E {}\nstate s: f32 = 1.0;\nparam p: f32;\non a() {}"),
        [
            d(Code::E1040, "entity"),
            d(Code::E1040, "state"),
            d(Code::E1040, "param"),
            d(Code::E1040, "on")
        ]
    );
    assert_eq!(
        diags(
            "fn f() { fn g() {} state s: f32 = 1.0; entity E {} on a() {} struct S { a: f32; } }"
        ),
        [
            d(Code::E1040, "fn"),
            d(Code::E1040, "state"),
            d(Code::E1040, "entity"),
            d(Code::E1040, "on"),
            d(Code::E1040, "struct")
        ]
    );
}

#[test]
fn e1040_in_a_material() {
    assert_eq!(
        diags("material M { state a: f32 = 1.0; foo: 1; on a() {} entity E {} }"),
        [
            d(Code::E1040, "state"),
            d(Code::E1040, "foo"),
            d(Code::E1040, "on"),
            d(Code::E1040, "entity")
        ]
    );
}

#[test]
fn e1040_still_reports_what_is_wrong_inside_the_dropped_member() {
    assert_eq!(
        diags("scene S { fn helper( { } }"),
        [d(Code::E1040, "fn"), d(Code::E1002, "{")]
    );
}

#[test]
fn e4901_is_the_only_diagnostic_for_vertex_and_compute() {
    let src = "material M {
    param a: f32 = 1.0;
    vertex(input: VertexInput) -> VertexOutput { return input; }
    compute() { }
    fragment(input: SurfaceInput) -> color { return #fff000; }
}";
    let run = parse(src);
    assert_eq!(
        run.found(),
        [(Code::E4901, "vertex"), (Code::E4901, "compute")]
    );
    check_tree(&run);
    // The stage that is fine is kept, the unsupported ones are `Error`s.
    assert_eq!(
        run.dump(),
        "(module (material M (param a (type f32) (lit float 1.0)) (error) (error) (stage fragment (params (param input (type SurfaceInput))) (ret (type color)) (block (return (lit color #fff000))))))"
    );
    // Elsewhere the words are reserved names.
    assert_eq!(diags("fn vertex() {}"), [d(Code::E0013, "vertex")]);
}

#[test]
fn e4901_does_not_hide_mistakes_inside_the_stage() {
    assert_eq!(
        diags("material M { vertex(i: V) { let = 1; } }"),
        [d(Code::E4901, "vertex"), d(Code::E1001, "=")]
    );
}

#[test]
fn e0013_reserved_words_as_names() {
    assert_eq!(diags("fn while() {}"), [d(Code::E0013, "while")]);
    assert_eq!(
        diags("scene S { type: 1; entity async {} }"),
        [d(Code::E0013, "type"), d(Code::E0013, "async")]
    );
    assert_eq!(
        diags("fn f(match: f32) { let enum = 1; }"),
        [d(Code::E0013, "match"), d(Code::E0013, "enum")]
    );
    assert_eq!(
        diags("struct impl { loop: f32; }"),
        [d(Code::E0013, "impl"), d(Code::E0013, "loop")]
    );
}

#[test]
fn e1050_a_nesting_deeper_than_the_limit_is_reported_once() {
    let deep = |n: usize| format!("fn f() {{ {}{} }}", "{ ".repeat(n), "} ".repeat(n));
    assert!(
        parse(&deep(MAX_NESTING_DEPTH as usize))
            .diagnostics
            .is_empty()
    );
    let run = parse(&deep(MAX_NESTING_DEPTH as usize + 1));
    assert_eq!(run.codes(), [Code::E1050]);
    check_tree(&run);
}

#[test]
fn w0007_a_doc_comment_that_documents_nothing() {
    let src = "/// documents f\nfn f() {}\n\n/// documents nothing\n";
    let run = parse(src);
    assert_eq!(run.codes(), [Code::W0007]);
    assert_eq!(
        &run.src[run.diagnostics[0].primary.as_ref().unwrap().span.range()],
        "/// documents nothing"
    );
    // Blank lines between the comment and the declaration are fine.
    assert!(parse("/// doc\n\n\nfn f() {}").diagnostics.is_empty());
    // Every kind of declaration and member can be documented.
    let documented = "/// a\nexport const A = 1;
/// b
struct S {
    /// c
    x: f32;
}
/// d
material M {
    /// e
    param p: f32;
    /// f
    fragment(i: SurfaceInput) -> color { return #fff000; }
}
/// g
prefab P {
    /// h
    param q: f32;
}
/// i
scene Sc {
    /// j
    state s: f32 = 1.0;
    /// k
    camera C {
        /// l
        position: vec3(0.0);
    }
    /// m
    entity E {}
    /// n
    update(dt: f32) {}
    /// o
    on a() {}
    /// p
    const K = 1;
    /// q
    field: 1;
}";
    assert!(parse(documented).diagnostics.is_empty());
}

#[test]
fn w0007_doc_comments_before_things_that_cannot_be_documented() {
    assert_eq!(
        diags("/// about the import\nimport { A } from \"./a.mtek\";"),
        [d(Code::W0007, "/// about the import")]
    );
    assert_eq!(
        diags("fn f() {\n    /// about a statement\n    let x = 1;\n    /// at the end\n}"),
        [
            d(Code::W0007, "/// about a statement"),
            d(Code::W0007, "/// at the end")
        ]
    );
    assert_eq!(
        diags("scene S {\n    a: 1;\n    /// last\n}"),
        [d(Code::W0007, "/// last")]
    );
}

#[test]
fn w0007_an_ordinary_comment_between_breaks_the_attachment() {
    // `spec/language.md` 1.5: other comments are not allowed in between.
    assert_eq!(
        diags("/// doc\n// ordinary\nfn f() {}"),
        [d(Code::W0007, "/// doc")]
    );
    assert_eq!(
        diags("/// doc\n/* block */\nfn f() {}"),
        [d(Code::W0007, "/// doc")]
    );
    // Several doc comments in a row all document the declaration.
    assert!(diags("/// one\n/// two\nfn f() {}").is_empty());
    // An ordinary comment before the doc comments is fine.
    assert!(diags("// note\n/// doc\nfn f() {}").is_empty());
    // `////` is an ordinary comment, not a doc comment.
    assert!(diags("//// banner\n").is_empty());
}

#[test]
fn w0007_is_not_hidden_by_recovery() {
    // The warning has a meaning of its own; it is reported next to an error.
    let (_, found) = flawed("/// doc\n42\nfn f() {}");
    assert_eq!(found, [d(Code::E1001, "42")]);
}

// ---------------------------------------------------------------------------
// Recovery without cascades
// ---------------------------------------------------------------------------

#[test]
fn recovery_one_mistake_one_diagnostic() {
    for src in [
        // Missing `;` before the next statement.
        "fn f() { let a = 1\n let b = 2; }",
        // A bad type.
        "fn f() { let a: = 1; let b = 2; }",
        // A stray token between members.
        "scene S { a: 1; ) b: 2; }",
        // A member without its colon.
        "scene S { speed 0.7; other: 1; }",
        // `=` for `:`.
        "scene S { speed = 0.7; other: 1; }",
        // A missing initialiser.
        "fn f() { let a; let b = 2; }",
        // A broken parameter list.
        "fn f(a f32, b: f32) {} fn g() {}",
        // A missing block.
        "fn f() -> f32 return 1.0; fn g() {}",
        // A missing condition block.
        "fn f() { if a return; g(); }",
        // `else` without a block.
        "fn f() { if a { } else g(); h(); }",
    ] {
        let run = parse(src);
        assert_eq!(run.diagnostics.len(), 1, "{src}: {:?}", run.found());
        check_tree(&run);
    }
}

#[test]
fn recovery_keeps_the_rest_of_the_file() {
    let (dump, found) = flawed("fn a() { let = 1; }\nfn b() { return; }\nfn c() { ] }\nfn d() {}");
    assert_eq!(found, [d(Code::E1001, "="), d(Code::E1001, "]")]);
    assert!(dump.contains("(fn b (params) (block (return)))"), "{dump}");
    assert!(dump.contains("(fn d (params) (block))"), "{dump}");
}

#[test]
fn recovery_at_item_level_skips_to_the_next_item_keyword() {
    let (dump, found) = flawed("foo bar { baz; }\nconst A = 1;\n42 )\nfn f() {}");
    assert_eq!(found, [d(Code::E1001, "foo"), d(Code::E1001, "42")]);
    assert_eq!(
        dump,
        "(module (error) (const A (lit int 1)) (error) (fn f (params) (block)))"
    );
}

#[test]
fn recovery_in_a_body_stops_at_the_next_member() {
    let (dump, found) = flawed("scene S { ) ) a: 1; update(dt: f32) {} 7 7 7 on k() {} }");
    assert_eq!(found, [d(Code::E1001, ")"), d(Code::E1001, "7")]);
    assert_eq!(
        dump,
        "(module (scene S (error) (init a (lit int 1)) (lifecycle update (params (param dt (type f32))) (block)) (error) (on k (block))))"
    );
}

#[test]
fn recovery_does_not_swallow_the_closing_brace() {
    // The `}` after the broken field closes the entity, and `b` is the
    // scene's.
    let (dump, found) = flawed("scene S { entity E { a: } b: 2; }");
    assert_eq!(found, [d(Code::E1001, "}")]);
    assert_eq!(
        dump,
        "(module (scene S (entity E (init a (error))) (init b (lit int 2))))"
    );
}

#[test]
fn three_independent_mistakes_are_three_diagnostics() {
    let src = "fn a() { let x = ; }
scene S {
    speed 0.7;
    entity E { position: vec3(0.0) }
    on key_down(Key.A) { for i in 0..3 { g(i) } }
}
struct T { a: f32; }";
    let run = parse(src);
    check_tree(&run);
    assert_eq!(
        run.codes(),
        [Code::E1001, Code::E1001, Code::E1003, Code::E1003],
        "{:?}",
        run.found()
    );
}

#[test]
fn a_loop_header_that_cannot_be_read_still_has_its_body_checked() {
    // One error for the header, one for the `break` outside any loop would be
    // wrong: the body is the body of the loop.
    let (_, found) = flawed("fn f() { for in xs { break; } }");
    assert_eq!(found, [d(Code::E1001, "in")]);
    let (_, found) = flawed("fn f() { for i xs { break; } break; }");
    assert_eq!(found, [d(Code::E1001, "xs"), d(Code::E1030, "break")]);
}

#[test]
fn a_handler_with_a_broken_header_has_its_body_parsed() {
    let (_, found) = flawed("scene S { on { let a = 1; let = 1; } }");
    assert_eq!(found, [d(Code::E1001, "{"), d(Code::E1001, "=")]);
}

#[test]
fn an_assignment_for_a_comparison_in_a_condition_is_one_error() {
    let (dump, found) = flawed("fn f() { if x = 1 { y(); } }");
    assert_eq!(found, [d(Code::E1001, "=")]);
    assert_eq!(
        dump,
        "(module (fn f (params) (block (if (name x) (block (expr (call (name y))))))))"
    );
}

#[test]
fn an_item_keyword_at_the_start_of_a_line_is_a_missing_brace() {
    // The classic mistake: the `}` of a body is forgotten and the next item
    // starts. One diagnostic, naming the unclosed brace, and the item is read.
    let (dump, found) = flawed(
        "fn first() {
    let x = 1;

fn second() { return; }
",
    );
    assert_eq!(found, [d(Code::E1002, "fn")]);
    assert_eq!(
        dump,
        "(module (fn first (params) (block (let x (lit int 1)))) (fn second (params) (block (return))))"
    );
    for src in [
        "scene S {
    a: 1;
    entity E {
        b: 2;
    }

material M {}
",
        "struct P {
    a: f32;

struct Q { b: f32; }
",
        "prefab P {
    param a: f32;

export fn f() {}
",
        "material M {
    param a: f32;

cpu fn f() {}
",
        "fn f() {
    if a {
        b();

scene S {}
",
        "scene S { camera C {
    a: 1;

import { A } from \"./a.mtek\";
",
    ] {
        let run = parse(src);
        assert_eq!(run.codes(), [Code::E1002], "{src}: {:?}", run.found());
        check_tree(&run);
        // The item after the missing brace is an item of the file.
        assert!(run.module.items.len() >= 2, "{src}: {}", run.dump());
    }
}

#[test]
fn an_indented_declaration_in_a_body_is_not_a_missing_brace() {
    // It is a declaration in the wrong place (`spec/scenes.md` 2).
    assert_eq!(
        diags(
            "scene S {
    fn helper() {}
}
"
        ),
        [d(Code::E1040, "fn")]
    );
    assert_eq!(
        diags(
            "fn f() {
    fn g() {}
}
"
        ),
        [d(Code::E1040, "fn")]
    );
    // A field named `material` at the start of a line is a field.
    assert!(
        diags(
            "scene S {
  entity E {
material: Unlit {};
  }
}
"
        )
        .is_empty()
    );
}

#[test]
fn a_malformed_literal_that_swallowed_the_semicolon_is_not_a_missing_semicolon() {
    // The unterminated string takes the `;`; the lexer reported the string,
    // and the parser does not report the semicolon on top of it.
    let (_, found) = flawed(
        "const A = \"unterminated;
fn f() {}
",
    );
    assert_eq!(found, [d(Code::E0024, "\"unterminated;")]);
    let (_, found) = flawed(
        "fn f() {
    let x = 1.
    let y = 2;
}
",
    );
    assert_eq!(found, [d(Code::E0022, "1.")]);
}

#[test]
fn e1050_advises_on_the_construct_that_ran_out_of_levels() {
    let help = |src: &str| {
        let run = parse(src);
        assert_eq!(run.codes(), [Code::E1050], "{src:.40}");
        run.diagnostics[0].notes.join(" ")
    };
    assert_eq!(
        help(&format!("const A = {};", nest("(", ")", "1", 300))),
        "help: split the expression into several `let` statements"
    );
    assert_eq!(
        help(&format!(
            "fn f() {{ {} }}",
            nest("{ ", "} ", "return;", 300)
        )),
        "help: move the inner code into a function of its own"
    );
    // The condition of an `if` is the first thing that runs out of levels in
    // nested ifs, but the blocks are the problem.
    assert_eq!(
        help(&format!(
            "fn f() {{ {} }}",
            nest("if a { ", "} ", "return;", 300)
        )),
        "help: move the inner code into a function of its own"
    );
    assert_eq!(
        help(&format!(
            "scene S {{ {} }}",
            nest("entity E { ", "} ", "", 300)
        )),
        "help: flatten the entity tree: declare the inner entities beside the outer ones"
    );
}

// ---------------------------------------------------------------------------
// Messages worth checking
// ---------------------------------------------------------------------------

#[test]
fn messages_name_the_construct() {
    let message = |src: &str| parse(src).diagnostics[0].message.clone();
    assert_eq!(
        message("fn f() { break; }"),
        "`break` can only be used inside a `for` loop."
    );
    assert_eq!(
        message("scene S { param p: f32; }"),
        "`param` declarations cannot appear in a scene."
    );
    assert_eq!(
        message("fn f() { x; }"),
        "The value of this expression is not used; only calls can be used as statements."
    );
    assert_eq!(message("struct S {}"), "A struct needs at least one field.");
    assert_eq!(
        message("import {} from \"./a.mtek\";"),
        "An import needs at least one name."
    );
    assert_eq!(
        message("export import { A } from \"./a.mtek\";"),
        "An `import` cannot be exported; only `const`, `fn`, `struct`, `material`, `prefab` and `scene` items can."
    );
}

// ---------------------------------------------------------------------------
// The nesting limit
// ---------------------------------------------------------------------------

/// Run `f` on a thread with a 1 MiB stack, the smallest main-thread stack
/// the compiler might run on (Windows), in whatever build the tests use.
fn on_one_mebibyte<R: Send + 'static>(f: impl FnOnce() -> R + Send + 'static) -> R {
    std::thread::Builder::new()
        .stack_size(1 << 20)
        .spawn(f)
        .unwrap()
        .join()
        .unwrap()
}

/// The thread the CLI compiles on (`spec/compiler-architecture.md` section 3).
fn on_compile_thread<R: Send + 'static>(f: impl FnOnce() -> R + Send + 'static) -> R {
    std::thread::Builder::new()
        .stack_size(16 << 20)
        .spawn(f)
        .unwrap()
        .join()
        .unwrap()
}

/// `n` levels of `open ... close` around `core`.
fn nest(open: &str, close: &str, core: &str, n: usize) -> String {
    format!("{}{core}{}", open.repeat(n), close.repeat(n))
}

/// The statement and member shapes that nest, each `n` levels deep inside
/// the one level of the function body, scene or prefab they stand in.
fn shapes(n: usize) -> Vec<(&'static str, String)> {
    // The last `then` block is a level of its own: one fewer else-if.
    let else_ifs = format!("if a {{ }}{}", " else if a { }".repeat(n - 1));
    vec![
        (
            "blocks",
            format!("fn f() {{ {} }}", nest("{ ", "} ", "return;", n)),
        ),
        (
            "ifs",
            format!("fn f() {{ {} }}", nest("if a { ", "} ", "return;", n)),
        ),
        ("else if chain", format!("fn f() {{ {else_ifs} }}")),
        (
            "for loops",
            format!(
                "fn f() {{ {} }}",
                nest("for i in 0..2 { ", "} ", "break;", n)
            ),
        ),
        (
            "entities",
            format!("scene S {{ {} }}", nest("entity E { ", "} ", "", n)),
        ),
        (
            "prefab entities",
            format!("prefab P {{ {} }}", nest("entity E { ", "} ", "", n)),
        ),
        (
            "types",
            format!("const A: {} = x;", nest("array<", ", 2>", "f32", n),),
        ),
    ]
}

#[test]
fn nesting_to_the_limit_parses_on_a_one_mebibyte_stack() {
    // Each shape nests as deep as it can: 256 levels inside the one level of
    // the body around it. The tree is dumped and walked on the same stack.
    let n = MAX_NESTING_DEPTH as usize;
    for (what, src) in shapes(n) {
        let outcome = on_one_mebibyte({
            let src = src.clone();
            move || {
                let run = parse(&src);
                let dump = dump_module(&run.module);
                let walked = nodes(&run.module).len();
                (run.codes(), dump.len(), walked)
            }
        });
        assert!(outcome.0.is_empty(), "{what}: {:?}", outcome.0);
        assert!(outcome.1 > 0 && outcome.2 > 0, "{what}");
    }
}

#[test]
fn nesting_beyond_the_limit_is_one_e1050() {
    for (what, src) in shapes(MAX_NESTING_DEPTH as usize + 40) {
        let outcome = on_one_mebibyte(move || parse(&src).codes());
        assert_eq!(outcome, [Code::E1050], "{what}");
    }
}

#[test]
fn the_limit_is_exactly_two_hundred_and_fifty_seven_active_levels() {
    // The body of the function is the first level, so 256 blocks inside it
    // are the last that fit.
    let blocks = |n: usize| format!("fn f() {{ {} }}", nest("{ ", "} ", "return;", n));
    assert!(parse(&blocks(256)).diagnostics.is_empty());
    assert_eq!(parse(&blocks(257)).codes(), [Code::E1050]);
    let entities = |n: usize| format!("scene S {{ {} }}", nest("entity E { ", "} ", "", n));
    assert!(parse(&entities(256)).diagnostics.is_empty());
    assert_eq!(parse(&entities(257)).codes(), [Code::E1050]);
}

#[test]
fn ten_thousand_nested_blocks_and_entities_are_e1050_without_crashing() {
    for src in [
        format!("fn f() {{ {} }}", nest("{ ", "} ", "x();", 10_000)),
        format!(
            "scene S {{ {} }}",
            nest("entity E { ", "} ", "a: 1;", 10_000)
        ),
        format!("fn f() {{ {} }}", nest("if a { ", "} ", "x();", 10_000)),
        format!(
            "fn f() {{ {} }}",
            nest("for i in a { ", "} ", "x();", 10_000)
        ),
        format!("const A: {} = x;", nest("array<", ", 2>", "f32", 10_000)),
    ] {
        let (codes, nodes) = on_compile_thread(move || {
            let run = parse(&src);
            (run.codes(), nodes(&run.module).len())
        });
        assert_eq!(codes, [Code::E1050]);
        assert!(nodes > 256);
    }
}

#[test]
fn a_hundred_thousand_else_ifs_are_e1050_and_drop_without_overflowing() {
    let src = format!(
        "fn f() {{ if a {{ }}{} }}",
        " else if a { }".repeat(100_000)
    );
    let (codes, kept) = on_compile_thread(move || {
        let run = parse(&src);
        (run.codes(), run.module.node_count)
    });
    assert_eq!(codes, [Code::E1050], "reported once, not once per branch");
    assert!(kept > 256);
    // And on the small stack too: the recursion is bounded, not just the
    // drop.
    let src = format!(
        "fn f() {{ if a {{ }}{} }}",
        " else if a { }".repeat(100_000)
    );
    assert_eq!(on_one_mebibyte(move || parse(&src).codes()), [Code::E1050]);
}

#[test]
fn the_error_after_an_overflow_is_not_followed_by_a_cascade() {
    // The rest of the file after the overflow is read normally.
    let src = format!(
        "fn f() {{ {} }}\nfn g() {{ let = 1; }}\nfn h() {{}}",
        nest("{ ", "} ", "x();", 1_000)
    );
    let run = parse(&src);
    assert_eq!(run.codes(), [Code::E1050, Code::E1001]);
    assert!(run.dump().contains("(fn h (params) (block))"));
}

#[test]
fn the_overflow_is_reported_again_for_the_next_statement() {
    let one = nest("{ ", "} ", "x();", 300);
    let src = format!("fn f() {{ {one} {one} }}");
    let run = parse(&src);
    // Each overflowing statement is a mistake of its own.
    assert_eq!(run.codes(), [Code::E1050, Code::E1050]);
}

#[test]
fn deep_nesting_inside_a_member_does_not_disturb_the_next_one() {
    let src = format!(
        "scene S {{ {} b: 2; }}",
        nest("entity E { ", "} ", "a: 1;", 1_000)
    );
    let run = parse(&src);
    assert_eq!(run.codes(), [Code::E1050]);
    assert!(
        run.dump().ends_with("(init b (lit int 2))))"),
        "{}",
        run.dump()
    );
}

#[test]
fn an_expression_in_deep_blocks_has_the_levels_that_are_left() {
    // The one counter covers blocks and expressions together.
    let src = format!(
        "fn f() {{ {} }}",
        nest(
            "{ ",
            "} ",
            &format!("g({});", nest("(", ")", "1", 300)),
            100
        )
    );
    assert_eq!(parse(&src).codes(), [Code::E1050]);
}

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

/// A small deterministic generator (xorshift64*), so failures reproduce.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

const PIECES: [&str; 70] = [
    "fn",
    "cpu",
    "scene",
    "entity",
    "prefab",
    "material",
    "struct",
    "const",
    "let",
    "var",
    "if",
    "else",
    "for",
    "in",
    "return",
    "break",
    "continue",
    "state",
    "param",
    "on",
    "import",
    "export",
    "bind",
    "from",
    "x",
    "y",
    "Box",
    "camera",
    "update",
    "fragment",
    "vertex",
    "while",
    "1",
    "2.5",
    "\"s\"",
    "#fff000",
    "true",
    "self",
    "_",
    "{",
    "}",
    "(",
    ")",
    "[",
    "]",
    ",",
    ";",
    ":",
    ".",
    "..",
    "->",
    "+",
    "-",
    "*",
    "/",
    "=",
    "==",
    "!=",
    "<",
    "<=",
    ">",
    ">=",
    ">>",
    "&&",
    "||",
    "&",
    "~",
    "/// doc\n",
    "// c\n",
    "/* b */",
];

#[test]
fn junk_never_panics_and_every_span_stays_inside_the_text() {
    let mut rng = Rng(0xdead_beef_cafe_f00d);
    for _ in 0..6000 {
        let mut src = String::new();
        for _ in 0..rng.below(24) {
            src.push_str(PIECES[rng.below(PIECES.len())]);
            if rng.below(3) > 0 {
                src.push(' ');
            }
        }
        let run = parse(&src);
        check_tree(&run);
        for d in &run.diagnostics {
            let span = d.primary.as_ref().map(|l| l.span).unwrap();
            assert!(span.end as usize <= src.len(), "{src:?}: {d:?}");
            assert!(span.start <= span.end, "{src:?}: {d:?}");
        }
        for edit in &run.edits {
            assert!(edit.at.end as usize <= src.len(), "{src:?}");
        }
    }
}

const PROGRAM: &str = "import { A, B } from \"./a.mtek\";
/// pulse
fn pulse(t: f32) -> f32 { return 0.65 + 0.35 * sin(t); }
material Pulse {
    param tint: color = #6b5cff;
    fragment(input: SurfaceInput) -> color { return color.linear(tint.rgb * pulse(1.0), tint.a); }
}
prefab Crate { param origin: vec3 = vec3(0.0); position: origin; }
scene Demo {
    state speed: f32 = 0.7;
    camera Main { position: vec3(0.0, 2.0, 5.0); }
    entity Cube {
        mesh: Box { size: vec3(1.0, 1.0, 1.0) };
        material: Pulse { tint: bind(tint); phase: bind(frame.time) };
        update(dt: f32) {
            for i in 0..3 { if i == 1 { break; } else if i == 2 { continue; } else { speed += dt; } }
            self.rotation *= quat.axis_angle(vec3(0.0, 1.0, 0.0), speed * dt);
        }
    }
    entity First: Crate { origin: vec3(0.0, 3.0, 0.0); }
    on key_down(Key.Space) { speed = -speed; }
}
";

#[test]
fn the_sample_program_is_clean() {
    let run = parse(PROGRAM);
    assert!(run.diagnostics.is_empty(), "{:?}", run.diagnostics);
    check_tree(&run);
}

#[test]
fn truncating_the_program_anywhere_never_panics() {
    for end in 0..=PROGRAM.len() {
        if !PROGRAM.is_char_boundary(end) {
            continue;
        }
        let run = parse(&PROGRAM[..end]);
        check_tree(&run);
    }
}

#[test]
fn deleting_or_duplicating_a_token_never_panics_and_reports_something() {
    let lexed = lex_str(FILE, PROGRAM);
    let tokens = &lexed.tokens;
    let mut broken = 0;
    for (index, token) in tokens.iter().enumerate() {
        if token.span.is_empty() {
            continue;
        }
        let range = token.span.range();
        let deleted = format!("{}{}", &PROGRAM[..range.start], &PROGRAM[range.end..]);
        let duplicated = format!(
            "{}{} {}",
            &PROGRAM[..range.end],
            &PROGRAM[range.clone()],
            &PROGRAM[range.end..]
        );
        for src in [deleted, duplicated] {
            let run = parse(&src);
            check_tree(&run);
            if !run.diagnostics.is_empty() {
                broken += 1;
            }
        }
        let _ = index;
    }
    assert!(broken > 100, "{broken} of the mutations were flagged");
}

#[test]
fn swapping_two_tokens_never_panics() {
    let lexed = lex_str(FILE, PROGRAM);
    let tokens: Vec<_> = lexed
        .tokens
        .iter()
        .filter(|t| !t.span.is_empty())
        .map(|t| t.span.range())
        .collect();
    let mut rng = Rng(0x1234_5678_9abc_def0);
    for _ in 0..1500 {
        let a = rng.below(tokens.len());
        let b = rng.below(tokens.len());
        if a == b {
            continue;
        }
        let (a, b) = (a.min(b), a.max(b));
        let (ra, rb) = (&tokens[a], &tokens[b]);
        let src = format!(
            "{}{}{}{}{}",
            &PROGRAM[..ra.start],
            &PROGRAM[rb.clone()],
            &PROGRAM[ra.end..rb.start],
            &PROGRAM[ra.clone()],
            &PROGRAM[rb.end..]
        );
        check_tree(&parse(&src));
    }
}

#[test]
fn every_token_stream_ends_the_parse_even_without_eof() {
    // A hand-built token list without `Eof` is still parsed to its end.
    let src = "fn f() { let x = 1; }";
    let mut lexed = lex_str(FILE, src);
    lexed.tokens.pop();
    let mut sink = Diagnostics::new();
    let parsed = parse_module(src, &lexed.tokens, &lexed.trivia, &mut sink);
    assert!(sink.finish().diagnostics.is_empty());
    assert_eq!(parsed.module.items.len(), 1);
    let mut sink = Diagnostics::new();
    let parsed = parse_module("", &[], &lexed.trivia, &mut sink);
    assert!(parsed.module.items.is_empty());
}
