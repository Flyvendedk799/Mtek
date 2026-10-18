//! Unit tests of the formatter: one test per rule of `spec/tooling.md` section 5 and per
//! decision of decision 0070. The corpus properties are in `tests/format_corpus.rs`.

use super::*;
use crate::diagnostics::Severity;

fn fmt(text: &str) -> String {
    let formatted = format_text(FileId(0), text).unwrap_or_else(|d| panic!("{d:?}\n{text}"));
    // Every expectation below is also a fixed point.
    let again = format_text(FileId(0), &formatted).unwrap_or_else(|d| panic!("{d:?}"));
    assert_eq!(formatted, again, "not idempotent");
    formatted
}

/// `input` formats to `expected` (given without the final newline).
#[track_caller]
fn check(input: &str, expected: &str) {
    assert_eq!(fmt(input), format!("{expected}\n"), "input: {input}");
}

/// `text` is canonical already.
#[track_caller]
fn stays(text: &str) {
    check(text, text);
}

// ----- layout ---------------------------------------------------------------------------

#[test]
fn indentation_braces_and_terminators() {
    check(
        "fn f(a:f32)->f32{let x=a;if x>1.0{return x;}else if x<0.0{return -x;}else{return 0.0;}}",
        "fn f(a: f32) -> f32 {
    let x = a;
    if x > 1.0 {
        return x;
    } else if x < 0.0 {
        return -x;
    } else {
        return 0.0;
    }
}",
    );
}

#[test]
fn an_empty_body_is_one_pair_of_braces() {
    check("fn f(){}\nscene S{ }", "fn f() {}\n\nscene S {}");
}

#[test]
fn line_endings_are_lf_and_the_file_ends_in_one_newline() {
    assert_eq!(fmt("fn f() {}\r\n\r\n\r\n"), "fn f() {}\n");
    assert_eq!(fmt("fn f() {}"), "fn f() {}\n");
    assert_eq!(fmt("fn f() {   \r\n   return;   \r\n}\r\n"), "fn f() {\n    return;\n}\n");
}

#[test]
fn an_empty_file_stays_empty_and_a_byte_order_mark_goes() {
    assert_eq!(fmt(""), "");
    assert_eq!(fmt("  \n\n"), "");
    assert_eq!(fmt("\u{feff}fn f() {}\n"), "fn f() {}\n");
}

#[test]
fn members_stay_in_their_order() {
    let text = "scene S {\n    update(dt: f32) {}\n    state a: f32 = 1.0;\n    clear_color: #000000;\n}";
    stays(text);
}

#[test]
fn operators_have_spaces_and_unary_operators_do_not() {
    check(
        "fn f(){let a=-x+!y*2.0/3.0%4.0;a+=1.0;a-=1.0;a*=2.0;a/=2.0;let b=x<=y&&x>=y||x!=y;let c=v[0]+v.x;}",
        "fn f() {
    let a = -x + !y * 2.0 / 3.0 % 4.0;
    a += 1.0;
    a -= 1.0;
    a *= 2.0;
    a /= 2.0;
    let b = x <= y && x >= y || x != y;
    let c = v[0] + v.x;
}",
    );
}

#[test]
fn parentheses_are_the_authors() {
    // `-(5)` and `-5` differ (`spec/language.md` 6.6), and redundant parentheses are kept.
    check("fn f(){let a=-( 5 );let b=( a+b )*c;let c=((a));}", "fn f() {\n    let a = -(5);\n    let b = (a + b) * c;\n    let c = ((a));\n}");
}

#[test]
fn for_headers_have_no_spaces_around_the_range() {
    check("fn f(){for i in 0..10{}for j in xs{}}", "fn f() {\n    for i in 0..10 {}\n    for j in xs {}\n}");
}

#[test]
fn types_are_spaced() {
    check(
        "const A:array<array<f32,2>,3>=[[1.0,2.0],[3.0,4.0],[5.0,6.0]];",
        "const A: array<array<f32, 2>, 3> = [[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]];",
    );
}

// ----- literals -------------------------------------------------------------------------

#[test]
fn colors_are_lowercased_and_other_literals_are_kept_as_written() {
    check(
        "const A=#AABBCC;const B=#AaBbCcDd;const C=1.0;const D=1;const E=2.50e-3;const F=1.0E3;const G=\"a\\u{41}\\n\\\"\";",
        "const A = #aabbcc;

const B = #aabbccdd;

const C = 1.0;

const D = 1;

const E = 2.50e-3;

const F = 1.0E3;

const G = \"a\\u{41}\\n\\\"\";",
    );
}

#[test]
fn a_number_is_never_respelled() {
    // `1.0` is an f32 and `1` an integer: the spelling decides the type.
    let out = fmt("const A = 1.0; const B = 1; const C = 0.10; const D = 100000000.0;");
    for literal in ["1.0", " 1;", "0.10", "100000000.0"] {
        assert!(out.contains(literal), "{literal} in {out}");
    }
}

// ----- descriptor literals ----------------------------------------------------------------

#[test]
fn a_descriptor_that_fits_is_one_line_without_a_trailing_semicolon() {
    check(
        "scene S { entity E { mesh: Box { size: vec3(1.0, 1.0, 1.0); }; material: Pbr { base_color: #ffffff; roughness: 0.5; }; body: Static {}; } }",
        "scene S {
    entity E {
        mesh: Box { size: vec3(1.0, 1.0, 1.0) };
        material: Pbr { base_color: #ffffff; roughness: 0.5 };
        body: Static {};
    }
}",
    );
}

#[test]
fn a_descriptor_that_does_not_fit_has_one_field_per_line_each_ending_in_a_semicolon() {
    check(
        "scene S { entity E { collider: BoxCollider { size: vec3(14.0, 1.0, 8.0); friction: 0.8; restitution: 0.25; sensor: false }; } }",
        "scene S {
    entity E {
        collider: BoxCollider {
            size: vec3(14.0, 1.0, 8.0);
            friction: 0.8;
            restitution: 0.25;
            sensor: false;
        };
    }
}",
    );
}

#[test]
fn the_descriptor_rule_counts_the_whole_line() {
    // 100 columns exactly fit; 101 do not.
    let field = |n: usize| format!("scene S {{ a: Box {{ size: {}; }}; }}", "x".repeat(n));
    let one_line = |n: usize| format!("    a: Box {{ size: {} }};", "x".repeat(n));
    let n = 100 - one_line(0).chars().count();
    let at_limit = fmt(&field(n));
    assert!(at_limit.contains(&one_line(n)), "{at_limit}");
    let over = fmt(&field(n + 1));
    assert!(over.contains("a: Box {\n        size: "), "{over}");
}

#[test]
fn nested_descriptors_break_from_the_outside() {
    check(
        "scene S { a: Outer { inner_one: Inner { value: 1.0 }; inner_two: Inner { value: 2.0; other: 3.0 }; name_that_is_long: Inner { value: 4.0 }; }; }",
        "scene S {
    a: Outer {
        inner_one: Inner { value: 1.0 };
        inner_two: Inner { value: 2.0; other: 3.0 };
        name_that_is_long: Inner { value: 4.0 };
    };
}",
    );
}

#[test]
fn bind_is_part_of_a_field_value() {
    check("scene S { a: Pulse { tint: bind( tint ); phase: bind(frame.time) }; }", "scene S {\n    a: Pulse { tint: bind(tint); phase: bind(frame.time) };\n}");
}

// ----- width ------------------------------------------------------------------------------

#[test]
fn a_call_that_is_too_wide_has_one_argument_per_line_and_a_trailing_comma() {
    check(
        "fn f(){let v=some_function_with_a_long_name(first_argument_value, second_argument_value, third_argument_value);}",
        "fn f() {
    let v = some_function_with_a_long_name(
        first_argument_value,
        second_argument_value,
        third_argument_value,
    );
}",
    );
}

#[test]
fn a_call_that_fits_has_no_trailing_comma_whatever_the_source_had() {
    check("fn f(){g(a,b,);let v=[1.0,2.0,];}", "fn f() {\n    g(a, b);\n    let v = [1.0, 2.0];\n}");
}

#[test]
fn a_line_of_exactly_100_columns_fits_and_101_does_not() {
    let call = |n: usize| format!("fn f() {{ let v = g({}); }}", "a".repeat(n));
    let flat = |n: usize| format!("    let v = g({});", "a".repeat(n));
    let n = 100 - flat(0).chars().count();
    assert!(fmt(&call(n)).contains(&flat(n)));
    assert!(fmt(&call(n + 1)).contains("g(\n        aaa"));
}

#[test]
fn a_long_binary_expression_breaks_before_its_operators() {
    check(
        "fn f(){let total=first_operand_with_a_long_name*second_operand_with_a_long_name+third_operand_with_a_long_name-fourth_operand_name;}",
        "fn f() {
    let total = first_operand_with_a_long_name * second_operand_with_a_long_name
        + third_operand_with_a_long_name
        - fourth_operand_name;
}",
    );
}

#[test]
fn a_long_parameter_list_and_import_list_break_with_a_trailing_comma() {
    check(
        "fn function_with_many_parameters(first_parameter: vec3, second_parameter: vec3, third_parameter: f32) -> vec3 { return first_parameter; }",
        "fn function_with_many_parameters(
    first_parameter: vec3,
    second_parameter: vec3,
    third_parameter: f32,
) -> vec3 {
    return first_parameter;
}",
    );
    check(
        "import {Alpha,Beta} from \"./a.mtek\";import {A_very_long_name_number_one,A_very_long_name_number_two,A_very_long_name_number_three} from \"./b.mtek\";",
        "import { Alpha, Beta } from \"./a.mtek\";
import {
    A_very_long_name_number_one,
    A_very_long_name_number_two,
    A_very_long_name_number_three,
} from \"./b.mtek\";",
    );
}

// ----- blank lines ------------------------------------------------------------------------

#[test]
fn items_are_one_blank_line_apart_but_imports_stay_grouped() {
    check(
        "import {A} from \"./a.mtek\";\nimport {B} from \"./b.mtek\";\n\nimport {C} from \"./c.mtek\";\nconst X=1;\n\n\n\nconst Y=2;\nfn f(){}\nstruct S{a:f32;}",
        "import { A } from \"./a.mtek\";
import { B } from \"./b.mtek\";

import { C } from \"./c.mtek\";

const X = 1;

const Y = 2;

fn f() {}

struct S {
    a: f32;
}",
    );
}

#[test]
fn at_most_one_blank_line_is_kept_in_a_body_and_none_at_its_edges() {
    check(
        "fn f() {\n\n\n    let a = 1;\n\n\n\n    let b = 2;\n    let c = 3;\n\n}",
        "fn f() {
    let a = 1;

    let b = 2;
    let c = 3;
}",
    );
}

// ----- comments -------------------------------------------------------------------------

#[test]
fn comments_before_a_member_on_a_line_of_their_own_and_after_it_on_its_line() {
    check(
        "scene S {\n  // about a\n  state a: f32 = 1.0; // trailing a\n\n\n  /* about b */\n  state b: f32 = 2.0; /* trailing b */\n}",
        "scene S {
    // about a
    state a: f32 = 1.0; // trailing a

    /* about b */
    state b: f32 = 2.0; /* trailing b */
}",
    );
}

#[test]
fn comments_at_the_edges_of_a_body() {
    check(
        "fn f() { // after the brace\n    // first\n    let a = 1;\n    // last\n}",
        "fn f() { // after the brace
    // first
    let a = 1;
    // last
}",
    );
    check("fn f() {\n    // only a comment\n}", "fn f() {\n    // only a comment\n}");
    check("fn f() { /* only */ }", "fn f() { /* only */\n}");
}

#[test]
fn comments_at_the_top_and_bottom_of_a_file() {
    stays("// header\n\n// second paragraph\nfn f() {}\n\n// footer");
    check("fn f() {}\n// glued footer\n\n\n// spaced footer", "fn f() {}\n// glued footer\n\n// spaced footer");
}

#[test]
fn a_comment_before_an_item_stays_with_it_and_the_items_are_a_blank_line_apart() {
    check("const A = 1;\n// about B\nconst B = 2;", "const A = 1;\n\n// about B\nconst B = 2;");
}

#[test]
fn doc_comments_stay_attached_to_the_declaration() {
    check(
        "/// First line.\n\n/// Second line.\n\nfn f() {}\nscene S {\n    /// A state.\n\n    state a: f32 = 1.0;\n}",
        "/// First line.
/// Second line.
fn f() {}

scene S {
    /// A state.
    state a: f32 = 1.0;
}",
    );
}

#[test]
fn a_doc_comment_that_documents_nothing_stays_that_way() {
    // The warning W0007 is not turned into a documentation by the formatting.
    let text = "scene S {\n    entity E /// misplaced\n    {\n        a: 1.0;\n    }\n}";
    let out = fmt(text);
    assert!(out.contains("entity E /// misplaced\n"), "{out}");
    let warnings = |t: &str| {
        let mut lexed = lex_str(FileId(0), t);
        let mut sink = Diagnostics::new();
        lexed.report_into(&mut sink);
        let _ = parse_module(t, &lexed.tokens, &lexed.trivia, &mut sink);
        sink.finish().summary.warnings
    };
    assert_eq!(warnings(text), 1);
    assert_eq!(warnings(&out), 1);
}

#[test]
fn comments_inside_expressions_and_lists() {
    check(
        "fn f(){let x=a /* after a */ + b // after b\n + c;\ng(a, // first\n b, /* second */ c);}",
        "fn f() {
    let x = a /* after a */
        + b // after b
        + c;
    g(
        a, // first
        b, /* second */
        c,
    );
}",
    );
}

#[test]
fn a_comment_on_its_own_line_inside_a_list_keeps_its_line() {
    check(
        "const A=[\n  1.0,\n  // two\n  2.0,\n  3.0, // three\n  // end\n];",
        "const A = [
    1.0,
    // two
    2.0,
    3.0, // three
    // end
];",
    );
}

#[test]
fn a_comment_between_the_header_and_the_brace_stays_before_the_brace() {
    check("fn f() /* before */ {}", "fn f() /* before */ {}");
    check("fn f() // before\n{ return; }", "fn f() // before\n{\n    return;\n}");
}

#[test]
fn block_comments_nest_and_are_kept_verbatim() {
    stays("/* a /* nested */ b */\nfn f() {}");
    check(
        "fn f() {\n        /* line one\n           line two */\n    return;\n}",
        "fn f() {\n    /* line one\n           line two */\n    return;\n}",
    );
}

#[test]
fn a_line_comment_loses_its_trailing_white_space_and_nothing_else() {
    assert_eq!(fmt("//   spaced   \t\nfn f() {}"), "//   spaced\nfn f() {}\n");
    assert_eq!(fmt("//no space\n/// doc\nfn f() {}"), "//no space\n/// doc\nfn f() {}\n");
}

#[test]
fn an_if_chain_with_comments() {
    check(
        "fn f(){if a { x(); } // after then\n else { y(); }}",
        "fn f() {
    if a {
        x();
    } else // after then
    {
        y();
    }
}",
    );
}

// ----- refusing and reporting ---------------------------------------------------------------

#[test]
fn a_file_that_does_not_parse_is_refused_with_its_diagnostics() {
    let errors = format_text(FileId(0), "fn f( {\n").unwrap_err();
    assert!(!errors.is_empty());
    assert!(errors.iter().any(|d| d.code.severity() == Severity::Error));
    assert!(errors.iter().all(|d| d.code != Code::E9999));
    // A lexical error too.
    assert!(format_text(FileId(0), "const A = 1.;").is_err());
    assert!(format_text(FileId(0), "/* never closed").is_err());
}

#[test]
fn warnings_do_not_stop_the_formatting() {
    assert_eq!(fmt("/// nothing follows\n"), "/// nothing follows\n");
}

#[test]
fn comment_texts_are_what_the_formatter_keeps() {
    let texts = comment_texts(FileId(0), "// b  \n/* a */ fn f() {} /// c\r\n/* x\r\ny */");
    assert_eq!(texts, ["/* a */", "/* x\ny */", "// b", "/// c"]);
}
