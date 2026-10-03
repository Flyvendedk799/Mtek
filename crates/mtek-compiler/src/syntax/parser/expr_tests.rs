//! Unit tests of the expression parser: exact AST shapes through the dump,
//! diagnostics with their spans, the structural invariants of every tree, a
//! differential test against a plain recursive-descent reading of the EBNF,
//! the nesting limit with stack bounds, and robustness on junk.

use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::FileId;
use crate::syntax::ast::{Expr, ExprKind, Node};
use crate::syntax::{
    MAX_NESTING_DEPTH, NodeInfo, ParsedExpr, TokenKind, dump_expr, lex_str, parse_expression,
    parse_expression_no_desc, walk_expr,
};

const FILE: FileId = FileId(0);

/// The result of parsing `src`, lexical diagnostics included.
struct Run {
    parsed: ParsedExpr,
    diagnostics: Vec<Diagnostic>,
}

impl Run {
    fn codes(&self) -> Vec<Code> {
        self.diagnostics.iter().map(|d| d.code).collect()
    }

    /// The source text of the primary span of each diagnostic.
    fn spans<'a>(&self, src: &'a str) -> Vec<&'a str> {
        self.diagnostics
            .iter()
            .map(|d| {
                let span = d.primary.as_ref().map(|l| l.span).unwrap();
                src.get(span.range()).unwrap()
            })
            .collect()
    }
}

fn run_with(src: &str, allow_descriptor: bool) -> Run {
    let mut lexed = lex_str(FILE, src);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = if allow_descriptor {
        parse_expression(src, &lexed.tokens, &mut sink)
    } else {
        parse_expression_no_desc(src, &lexed.tokens, &mut sink)
    };
    Run {
        parsed,
        diagnostics: sink.finish().diagnostics,
    }
}

fn run(src: &str) -> Run {
    run_with(src, true)
}

/// The dump of `src` on one line; `src` must parse without diagnostics.
fn flat(src: &str) -> String {
    let run = run(src);
    assert!(run.diagnostics.is_empty(), "{src}: {:?}", run.diagnostics);
    one_line(&dump_expr(&run.parsed.expr))
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

// ---------------------------------------------------------------------------
// Literals, names and the shape of the dump
// ---------------------------------------------------------------------------

#[test]
fn literals_dump_with_their_kind_and_value() {
    assert_eq!(flat("42"), "(lit int 42)");
    assert_eq!(flat("0"), "(lit int 0)");
    assert_eq!(flat("2.5e-3"), "(lit float 0.0025)");
    assert_eq!(flat("1.0"), "(lit float 1.0)");
    assert_eq!(flat("\"a\\n\\\"b\\\"\""), "(lit string \"a\\n\\\"b\\\"\")");
    assert_eq!(flat("#6b5cff"), "(lit color #6b5cff)");
    assert_eq!(flat("#6B5CFFcc"), "(lit color #6b5cffcc)");
    assert_eq!(flat("true"), "(lit bool true)");
    assert_eq!(flat("false"), "(lit bool false)");
    assert_eq!(flat("self"), "(self)");
    assert_eq!(flat("speed"), "(name speed)");
    assert_eq!(flat("_"), "(name _)");
}

#[test]
fn an_integer_that_does_not_fit_u64_keeps_the_value_unknown() {
    assert_eq!(
        flat("18446744073709551615"),
        "(lit int 18446744073709551615)"
    );
    assert_eq!(flat("18446744073709551616"), "(lit int overflow)");
}

#[test]
fn parentheses_are_kept_in_the_tree() {
    assert_eq!(
        flat("(a + b) * c"),
        "(binary * (paren (binary + (name a) (name b))) (name c))"
    );
    assert_eq!(flat("-(5)"), "(unary - (paren (lit int 5)))");
    assert_eq!(flat("-5"), "(unary - (lit int 5))");
}

#[test]
fn long_dumps_break_between_children_and_keep_leading_atoms() {
    let src =
        "alpha_long_name + beta_long_name * gamma_long_name - delta_long_name / epsilon_long_name";
    let run = run(src);
    assert_eq!(
        dump_expr(&run.parsed.expr),
        "(binary -\n  (binary +\n    (name alpha_long_name)\n    (binary * (name beta_long_name) (name gamma_long_name)))\n  (binary / (name delta_long_name) (name epsilon_long_name)))\n"
    );
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary - (binary + (name alpha_long_name) (binary * (name beta_long_name) (name gamma_long_name))) (binary / (name delta_long_name) (name epsilon_long_name)))"
    );
}

// ---------------------------------------------------------------------------
// Precedence and associativity
// ---------------------------------------------------------------------------

#[test]
fn binary_operators_follow_the_table() {
    assert_eq!(
        flat("1 + 2 * 3"),
        "(binary + (lit int 1) (binary * (lit int 2) (lit int 3)))"
    );
    assert_eq!(
        flat("1 * 2 + 3"),
        "(binary + (binary * (lit int 1) (lit int 2)) (lit int 3))"
    );
    assert_eq!(
        flat("a || b && c"),
        "(binary || (name a) (binary && (name b) (name c)))"
    );
    assert_eq!(
        flat("a && b || c"),
        "(binary || (binary && (name a) (name b)) (name c))"
    );
}

/// The operators of the table, loosest first: `(level, a sample operator)`.
const LEVELS: [(u8, &str); 6] = [
    (1, "||"),
    (2, "&&"),
    (3, "=="),
    (4, "<"),
    (5, "+"),
    (6, "*"),
];

#[test]
fn every_pair_of_binary_levels_nests_the_tighter_one() {
    for (i, (_, loose)) in LEVELS.iter().enumerate() {
        for (_, tight) in &LEVELS[i + 1..] {
            assert_eq!(
                flat(&format!("a {loose} b {tight} c")),
                format!("(binary {loose} (name a) (binary {tight} (name b) (name c)))"),
                "a {loose} b {tight} c"
            );
            assert_eq!(
                flat(&format!("a {tight} b {loose} c")),
                format!("(binary {loose} (binary {tight} (name a) (name b)) (name c))"),
                "a {tight} b {loose} c"
            );
        }
    }
}

#[test]
fn every_operator_of_a_level_binds_like_its_level() {
    let levels: [&[&str]; 6] = [
        &["||"],
        &["&&"],
        &["==", "!="],
        &["<", "<=", ">", ">="],
        &["+", "-"],
        &["*", "/", "%"],
    ];
    for (i, loose_ops) in levels.iter().enumerate() {
        for tight_ops in &levels[i + 1..] {
            for loose in *loose_ops {
                for tight in *tight_ops {
                    assert_eq!(
                        flat(&format!("a {loose} b {tight} c")),
                        format!("(binary {loose} (name a) (binary {tight} (name b) (name c)))"),
                    );
                }
            }
        }
    }
}

#[test]
fn unary_binds_tighter_than_every_binary_operator_and_looser_than_postfix() {
    assert_eq!(flat("-a * b"), "(binary * (unary - (name a)) (name b))");
    assert_eq!(flat("!a && b"), "(binary && (unary ! (name a)) (name b))");
    assert_eq!(flat("-a.b"), "(unary - (field (name a) b))");
    assert_eq!(flat("!f(x)"), "(unary ! (call (name f) (name x)))");
    assert_eq!(flat("-a[0]"), "(unary - (index (name a) (lit int 0)))");
    assert_eq!(flat("- -a"), "(unary - (unary - (name a)))");
    assert_eq!(flat("!!a"), "(unary ! (unary ! (name a)))");
    assert_eq!(flat("a - -b"), "(binary - (name a) (unary - (name b)))");
}

#[test]
fn additive_and_multiplicative_operators_are_left_associative() {
    assert_eq!(
        flat("a - b - c"),
        "(binary - (binary - (name a) (name b)) (name c))"
    );
    assert_eq!(
        flat("a / b / c"),
        "(binary / (binary / (name a) (name b)) (name c))"
    );
    assert_eq!(
        flat("a % b % c"),
        "(binary % (binary % (name a) (name b)) (name c))"
    );
    assert_eq!(
        flat("a / b % c * d"),
        "(binary * (binary % (binary / (name a) (name b)) (name c)) (name d))"
    );
    assert_eq!(
        flat("a + b - c + d"),
        "(binary + (binary - (binary + (name a) (name b)) (name c)) (name d))"
    );
    assert_eq!(
        flat("a || b || c"),
        "(binary || (binary || (name a) (name b)) (name c))"
    );
    assert_eq!(
        flat("a && b && c"),
        "(binary && (binary && (name a) (name b)) (name c))"
    );
}

#[test]
fn postfix_operators_chain_left_to_right() {
    assert_eq!(
        flat("a.b(c)[d].e"),
        "(field (index (call (field (name a) b) (name c)) (name d)) e)"
    );
    assert_eq!(flat("f()()"), "(call (call (name f)))");
    assert_eq!(
        flat("quat.axis_angle(vec3(0.0, 1.0, 0.0), speed * dt)"),
        "(call (field (name quat) axis_angle) (call (name vec3) (lit float 0.0) (lit float 1.0) (lit float 0.0)) (binary * (name speed) (name dt)))"
    );
    assert_eq!(flat("v.zyx"), "(field (name v) zyx)");
    assert_eq!(flat("self.position.y"), "(field (field (self) position) y)");
    assert_eq!(flat("Key.Space"), "(field (name Key) Space)");
    assert_eq!(
        flat("m[2][1]"),
        "(index (index (name m) (lit int 2)) (lit int 1))"
    );
}

#[test]
fn trailing_commas_are_allowed_in_calls_and_arrays() {
    assert_eq!(flat("f(a, b,)"), "(call (name f) (name a) (name b))");
    assert_eq!(
        flat("[1, 2, 3,]"),
        "(array (lit int 1) (lit int 2) (lit int 3))"
    );
    assert_eq!(flat("[1]"), "(array (lit int 1))");
}

#[test]
fn comparison_and_equality_mix_without_error_across_levels() {
    assert_eq!(
        flat("a < b == c < d"),
        "(binary == (binary < (name a) (name b)) (binary < (name c) (name d)))"
    );
    assert_eq!(
        flat("a == b < c"),
        "(binary == (name a) (binary < (name b) (name c)))"
    );
    assert_eq!(
        flat("(a < b) < c"),
        "(binary < (paren (binary < (name a) (name b))) (name c))"
    );
    assert_eq!(
        flat("a < b && b < c"),
        "(binary && (binary < (name a) (name b)) (binary < (name b) (name c)))"
    );
}

// ---------------------------------------------------------------------------
// E1010: chained comparison
// ---------------------------------------------------------------------------

#[test]
fn a_second_comparison_is_e1010_and_parsing_continues_left_associatively() {
    let src = "a < b < c";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E1010]);
    assert_eq!(run.spans(src), ["<"]);
    assert_eq!(run.diagnostics[0].primary.as_ref().unwrap().span.start, 6);
    assert_eq!(
        run.diagnostics[0].related.len(),
        1,
        "points at the first `<`"
    );
    assert_eq!(run.diagnostics[0].related[0].span.start, 2);
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary < (binary < (name a) (name b)) (name c))"
    );
}

#[test]
fn every_pair_of_chained_operators_of_one_level_is_e1010() {
    for ops in [&["<", "<=", ">", ">="][..], &["==", "!="][..]] {
        for first in ops {
            for second in ops {
                let src = format!("a {first} b {second} c");
                let run = run(&src);
                assert_eq!(run.codes(), [Code::E1010], "{src}");
            }
        }
    }
}

#[test]
fn a_long_chain_gets_one_e1010() {
    let src = "a < b < c < d <= e";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E1010], "one diagnostic per chain");
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary <= (binary < (binary < (binary < (name a) (name b)) (name c)) (name d)) (name e))"
    );
}

#[test]
fn separate_chains_each_get_their_own_e1010() {
    let src = "a < b < c && d == e == f";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E1010, Code::E1010]);
    assert_eq!(run.spans(src), ["<", "=="]);
}

#[test]
fn an_equality_after_a_comparison_chain_is_not_a_second_error() {
    let src = "a < b < c == d";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E1010]);
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary == (binary < (binary < (name a) (name b)) (name c)) (name d))"
    );
}

#[test]
fn the_message_names_both_operators() {
    let run = run("a == b != c");
    let message = &run.diagnostics[0].message;
    assert!(message.contains("Equality"), "{message}");
    assert!(
        message.contains("`!=`") && message.contains("`==`"),
        "{message}"
    );
    let run = self::run("a < b >= c");
    assert!(run.diagnostics[0].message.contains("Comparison"));
}

// ---------------------------------------------------------------------------
// E1901: bitwise operators
// ---------------------------------------------------------------------------

#[test]
fn an_infix_bitwise_operator_is_e1901_and_is_dropped_with_its_operand() {
    for (src, op) in [
        ("a & b", "&"),
        ("a | b", "|"),
        ("a ^ b", "^"),
        ("a << 2", "<<"),
        ("a >> 2", ">>"),
    ] {
        let run = run(src);
        assert_eq!(run.codes(), [Code::E1901], "{src}");
        assert_eq!(run.spans(src), [op], "{src}");
        assert_eq!(one_line(&dump_expr(&run.parsed.expr)), "(name a)", "{src}");
    }
}

#[test]
fn parsing_continues_after_a_bitwise_operator() {
    let src = "a & b + c";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E1901]);
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary + (name a) (name c))"
    );
}

#[test]
fn a_prefix_bitwise_operator_is_e1901_and_is_ignored() {
    let src = "~a";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E1901]);
    assert_eq!(one_line(&dump_expr(&run.parsed.expr)), "(name a)");
    let run = self::run("1 + ~a");
    assert_eq!(run.codes(), [Code::E1901]);
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary + (lit int 1) (name a))"
    );
}

#[test]
fn bitwise_operators_inside_brackets_are_reported_too() {
    let src = "f(a | b, [c & d])";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E1901, Code::E1901]);
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(call (name f) (name a) (array (name c)))"
    );
}

#[test]
fn dropping_a_bitwise_operand_gives_its_ids_back() {
    let run = run("a & b");
    // Only `a` is in the tree: ids are exactly 0..node_count.
    assert_eq!(run.parsed.node_count, 1);
    assert_eq!(run.parsed.expr.id.0, 0);
}

// ---------------------------------------------------------------------------
// Descriptor literals and ExprNoDesc
// ---------------------------------------------------------------------------

#[test]
fn descriptor_literals_separate_fields_with_semicolons() {
    assert_eq!(
        flat("Box { size: vec3(1.0, 1.0, 1.0) }"),
        "(desc Box (field size (call (name vec3) (lit float 1.0) (lit float 1.0) (lit float 1.0))))"
    );
    assert_eq!(
        flat("Unlit { color: #6b5cff; }"),
        "(desc Unlit (field color (lit color #6b5cff)))"
    );
    assert_eq!(flat("Empty {}"), "(desc Empty)");
    assert_eq!(
        flat("P { a: 1; b: 2; }"),
        "(desc P (field a (lit int 1)) (field b (lit int 2)))"
    );
}

#[test]
fn bind_is_a_field_value() {
    assert_eq!(
        flat("Pulse { tint: bind(tint); phase: bind(frame.time) }"),
        "(desc Pulse (field tint (bind (name tint))) (field phase (bind (field (name frame) time))))"
    );
}

#[test]
fn descriptors_nest_and_take_postfix_operators() {
    assert_eq!(
        flat("A { b: B { c: 1 } }"),
        "(desc A (field b (desc B (field c (lit int 1)))))"
    );
    assert_eq!(
        flat("Box { s: 1 }.size"),
        "(field (desc Box (field s (lit int 1))) size)"
    );
    assert_eq!(
        flat("[Box { s: 1 }, Box { s: 2 }]"),
        "(array (desc Box (field s (lit int 1))) (desc Box (field s (lit int 2))))"
    );
}

#[test]
fn without_descriptors_a_name_before_a_brace_is_just_a_name() {
    let run = run_with("x { y", false);
    // `x` is the whole expression; `{ y` is what follows it (the block of an
    // `if`), which `parse_expression_no_desc` reports as trailing.
    assert_eq!(one_line(&dump_expr(&run.parsed.expr)), "(name x)");
    assert_eq!(run.codes(), [Code::E1001]);
}

#[test]
fn no_desc_allows_descriptors_again_inside_brackets() {
    for src in [
        "f(Box { s: 1 })",
        "(Box { s: 1 })",
        "[Box { s: 1 }]",
        "a[Box { s: 1 }.x]",
    ] {
        let run = run_with(src, false);
        assert!(run.diagnostics.is_empty(), "{src}: {:?}", run.diagnostics);
        assert!(
            one_line(&dump_expr(&run.parsed.expr)).contains("(desc Box"),
            "{src}"
        );
    }
}

#[test]
fn a_descriptor_directly_in_a_condition_is_e1011_with_a_candidate_edit() {
    let src = "Box { s: 1 }.s == 1.0";
    let run = run_with(src, false);
    assert_eq!(run.codes(), [Code::E1011]);
    assert_eq!(run.spans(src), ["Box { s: 1 }"]);
    // The parse carries on as if the descriptor were parenthesised.
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary == (field (desc Box (field s (lit int 1))) s) (lit float 1.0))"
    );
    assert_eq!(run.parsed.candidate_edits.len(), 1);
    let candidate = &run.parsed.candidate_edits[0];
    assert_eq!(candidate.code, Code::E1011);
    assert_eq!(candidate.at.range(), 0..12);
    let edits = &candidate.edit.edits;
    assert_eq!(edits.len(), 2);
    assert_eq!(
        (edits[0].span.range(), edits[0].replacement.as_str()),
        (0..0, "(")
    );
    assert_eq!(
        (edits[1].span.range(), edits[1].replacement.as_str()),
        (12..12, ")")
    );
}

#[test]
fn a_descriptor_in_a_condition_is_not_reported_when_a_block_follows() {
    // `if x { y: ... }` cannot be told from a descriptor, but `x { y; }` and
    // `x { y = 1; }` are blocks: only `{ name :` is a descriptor.
    let run = run_with("x { y", false);
    assert!(!run.codes().contains(&Code::E1011));
    let run = self::run_with("x { y = 1; }", false);
    assert!(!run.codes().contains(&Code::E1011));
}

#[test]
fn descriptor_diagnostics_use_the_catalogue_codes() {
    let src = "Box { size 1 }";
    let run = run(src);
    assert!(run.codes().contains(&Code::E1001), "{:?}", run.diagnostics);
    let src = "Box { size: 1";
    let run = self::run(src);
    assert_eq!(run.codes(), [Code::E1002]);
    assert_eq!(run.diagnostics[0].related.len(), 1);
}

// ---------------------------------------------------------------------------
// Errors and recovery
// ---------------------------------------------------------------------------

#[test]
fn a_malformed_literal_is_an_error_node_without_a_second_diagnostic() {
    let run = run("1.");
    assert_eq!(run.codes(), [Code::E0022], "only the lexer's diagnostic");
    assert_eq!(dump_expr(&run.parsed.expr), "(error)\n");
    let run = self::run("1 + 007");
    assert_eq!(run.codes(), [Code::E0020]);
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary + (lit int 1) (error))"
    );
}

#[test]
fn missing_pieces_are_reported_once_each() {
    let cases: [(&str, &[Code]); 12] = [
        ("", &[Code::E1004]),
        ("1 +", &[Code::E1004]),
        (")", &[Code::E1001]),
        ("1 2", &[Code::E1001]),
        ("(1", &[Code::E1002]),
        ("f(1", &[Code::E1002]),
        ("f(1 2)", &[Code::E1001]),
        ("[1,", &[Code::E1002]),
        ("[]", &[Code::E1001]),
        ("a.", &[Code::E1001]),
        ("a[", &[Code::E1004]),
        ("()", &[Code::E1001]),
    ];
    for (src, expected) in cases {
        let run = run(src);
        assert_eq!(run.codes(), expected, "{src:?}: {:?}", run.diagnostics);
    }
}

#[test]
fn bind_outside_a_field_value_is_explained() {
    let run = run("bind(x)");
    assert_eq!(run.codes(), [Code::E1001]);
    assert!(run.diagnostics[0].message.contains("bind"));
}

#[test]
fn reserved_words_used_as_names_are_e0013() {
    let src = "while + x";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E0013]);
    assert_eq!(run.spans(src), ["while"]);
    assert_eq!(
        one_line(&dump_expr(&run.parsed.expr)),
        "(binary + (name while) (name x))"
    );
    let run = self::run("a.type");
    assert_eq!(run.codes(), [Code::E0013]);
    let run = self::run("Box { async: 1 }");
    assert_eq!(run.codes(), [Code::E0013]);
}

#[test]
fn an_unclosed_delimiter_points_at_its_opener() {
    let run = run("f(a, b");
    let d = &run.diagnostics[0];
    assert_eq!(d.code, Code::E1002);
    assert_eq!(d.related.len(), 1);
    assert_eq!(d.related[0].span.range(), 1..2);
}

#[test]
fn trailing_tokens_after_an_expression_are_reported() {
    let src = "a b";
    let run = run(src);
    assert_eq!(run.codes(), [Code::E1001]);
    assert_eq!(run.spans(src), ["b"]);
    assert_eq!(dump_expr(&run.parsed.expr), "(name a)\n");
}

#[test]
fn syntax_errors_are_spaced_out_but_dedicated_diagnostics_are_not() {
    // One mistake, one report: the follow-up errors within three tokens are
    // suppressed.
    let run = run("f(1 2 3 4)");
    assert_eq!(run.codes(), [Code::E1001]);
    // `E1901` is never suppressed.
    let run = self::run("a & b & c & d");
    assert_eq!(run.codes(), [Code::E1901; 3]);
}

#[test]
fn a_token_stream_without_eof_does_not_panic() {
    let src = "a + b";
    let mut lexed = lex_str(FILE, src);
    lexed.tokens.pop();
    let mut sink = Diagnostics::new();
    let parsed = parse_expression(src, &lexed.tokens, &mut sink);
    assert_eq!(
        one_line(&dump_expr(&parsed.expr)),
        "(binary + (name a) (name b))"
    );
    let parsed = parse_expression(src, &[], &mut sink);
    assert_eq!(dump_expr(&parsed.expr), "(error)\n");
}

// ---------------------------------------------------------------------------
// Ids and spans
// ---------------------------------------------------------------------------

/// Every node of `expr`: its info and its parent.
fn nodes(expr: &Expr) -> Vec<(NodeInfo, Option<NodeInfo>)> {
    let mut nodes = Vec::new();
    walk_expr(expr, &mut |info, parent| nodes.push((info, parent)));
    nodes
}

/// The structural invariants of a tree parsed from `src` without errors.
fn check_tree(src: &str, run: &Run) {
    let nodes = nodes(&run.parsed.expr);
    // Ids: unique and exactly 0..node_count; children before parents.
    let mut ids: Vec<u32> = nodes.iter().map(|(info, _)| info.id.0).collect();
    ids.sort_unstable();
    let expected: Vec<u32> = (0..run.parsed.node_count).collect();
    assert_eq!(ids, expected, "{src}: ids are dense");
    assert_eq!(
        run.parsed.expr.id.0 + 1,
        run.parsed.node_count,
        "{src}: the root has the largest id"
    );
    for (info, parent) in &nodes {
        assert_eq!(info.span.file, FILE);
        assert!(
            info.span.end as usize <= src.len(),
            "{src}: span {:?} is outside the text",
            info.span
        );
        if let Some(parent) = parent {
            assert!(info.id < parent.id, "{src}: children are numbered first");
            assert!(
                parent.span.contains_span(info.span),
                "{src}: {} {:?} lies outside its parent {} {:?}",
                info.kind,
                info.span,
                parent.kind,
                parent.span
            );
        }
    }
}

#[test]
fn ids_are_dense_and_post_order_and_spans_nest() {
    for src in [
        "1",
        "a + b * c",
        "-a.b(c)[d].e",
        "(a + b) * c",
        "Pulse { tint: bind(tint); phase: bind(frame.time) }",
        "f(Box { s: [1, 2, 3] }, !x)",
        "quat.axis_angle(vec3(0.0, 1.0, 0.0), speed * dt)",
        "a || b && c == d < e + f * -g.h",
    ] {
        let run = run(src);
        assert!(run.diagnostics.is_empty(), "{src}: {:?}", run.diagnostics);
        check_tree(src, &run);
    }
}

#[test]
fn node_spans_cover_exactly_their_text() {
    let src = "  a + f(b, c)[0] * -d ";
    let run = run(src);
    let texts: Vec<(&str, &str)> = nodes(&run.parsed.expr)
        .iter()
        .map(|(info, _)| (info.kind, src.get(info.span.range()).unwrap()))
        .collect();
    assert_eq!(
        texts,
        [
            ("binary", "a + f(b, c)[0] * -d"),
            ("name", "a"),
            ("binary", "f(b, c)[0] * -d"),
            ("index", "f(b, c)[0]"),
            ("call", "f(b, c)"),
            ("name", "f"),
            ("name", "b"),
            ("name", "c"),
            ("lit", "0"),
            ("unary", "-d"),
            ("name", "d"),
        ]
    );
}

#[test]
fn identifier_nodes_of_fields_and_descriptors_have_their_own_spans() {
    let src = "Box { size: a.xy }";
    let run = run(src);
    let texts: Vec<(&str, &str)> = nodes(&run.parsed.expr)
        .iter()
        .map(|(info, _)| (info.kind, src.get(info.span.range()).unwrap()))
        .collect();
    assert_eq!(
        texts,
        [
            ("desc", "Box { size: a.xy }"),
            ("ident", "Box"),
            ("field", "size: a.xy"),
            ("ident", "size"),
            ("field-access", "a.xy"),
            ("name", "a"),
            ("ident", "xy"),
        ]
    );
}

#[test]
fn every_node_kind_of_an_expression_carries_id_and_span() {
    // The `Node` trait is implemented for the expression itself.
    let run = run("a + 1");
    let root = &run.parsed.expr;
    assert_eq!(Node::id(root), root.id);
    assert_eq!(Node::span(root).range(), 0..5);
}

// ---------------------------------------------------------------------------
// A differential test against the EBNF
// ---------------------------------------------------------------------------

/// A plain recursive-descent reading of `spec/grammar.ebnf` section 7 for the
/// operators, names, integers, parentheses and postfix forms, producing the
/// flat dump. `None` if the input is not one expression of the grammar
/// (which, for the generated inputs, means a chained comparison).
struct Reference {
    tokens: Vec<(TokenKind, String)>,
    pos: usize,
    /// A closing delimiter was missing where the EBNF requires one: the
    /// input is not one expression of the grammar.
    stuck: bool,
}

impl Reference {
    fn expect(&mut self, kind: TokenKind) {
        if self.kind() == kind {
            self.pos += 1;
        } else {
            self.stuck = true;
        }
    }
}

impl Reference {
    fn kind(&self) -> TokenKind {
        self.tokens.get(self.pos).map_or(TokenKind::Eof, |t| t.0)
    }

    fn take(&mut self) -> String {
        let text = self.tokens[self.pos].1.clone();
        self.pos += 1;
        text
    }

    fn expr(&mut self) -> String {
        let mut lhs = self.and();
        while self.kind() == TokenKind::OrOr {
            self.pos += 1;
            let rhs = self.and();
            lhs = format!("(binary || {lhs} {rhs})");
        }
        lhs
    }

    fn and(&mut self) -> String {
        let mut lhs = self.equality();
        while self.kind() == TokenKind::AndAnd {
            self.pos += 1;
            let rhs = self.equality();
            lhs = format!("(binary && {lhs} {rhs})");
        }
        lhs
    }

    fn equality(&mut self) -> String {
        let lhs = self.relational();
        if matches!(self.kind(), TokenKind::EqEq | TokenKind::BangEq) {
            let op = self.take();
            let rhs = self.relational();
            return format!("(binary {op} {lhs} {rhs})");
        }
        lhs
    }

    fn relational(&mut self) -> String {
        let lhs = self.additive();
        if matches!(
            self.kind(),
            TokenKind::Lt | TokenKind::Le | TokenKind::Gt | TokenKind::Ge
        ) {
            let op = self.take();
            let rhs = self.additive();
            return format!("(binary {op} {lhs} {rhs})");
        }
        lhs
    }

    fn additive(&mut self) -> String {
        let mut lhs = self.multiplicative();
        while matches!(self.kind(), TokenKind::Plus | TokenKind::Minus) {
            let op = self.take();
            let rhs = self.multiplicative();
            lhs = format!("(binary {op} {lhs} {rhs})");
        }
        lhs
    }

    fn multiplicative(&mut self) -> String {
        let mut lhs = self.unary();
        while matches!(
            self.kind(),
            TokenKind::Star | TokenKind::Slash | TokenKind::Percent
        ) {
            let op = self.take();
            let rhs = self.unary();
            lhs = format!("(binary {op} {lhs} {rhs})");
        }
        lhs
    }

    fn unary(&mut self) -> String {
        if matches!(self.kind(), TokenKind::Minus | TokenKind::Bang) {
            let op = self.take();
            let operand = self.unary();
            return format!("(unary {op} {operand})");
        }
        self.postfix()
    }

    fn postfix(&mut self) -> String {
        let mut lhs = self.primary();
        loop {
            match self.kind() {
                TokenKind::LParen => {
                    self.pos += 1;
                    let mut call = format!("(call {lhs}");
                    while self.kind() != TokenKind::RParen && !self.stuck {
                        call.push(' ');
                        call.push_str(&self.expr());
                        if self.kind() == TokenKind::Comma {
                            self.pos += 1;
                        } else if self.kind() != TokenKind::RParen {
                            self.stuck = true;
                        }
                    }
                    self.expect(TokenKind::RParen);
                    call.push(')');
                    lhs = call;
                }
                TokenKind::Dot => {
                    self.pos += 1;
                    let name = self.take();
                    lhs = format!("(field {lhs} {name})");
                }
                TokenKind::LBracket => {
                    self.pos += 1;
                    let index = self.expr();
                    self.expect(TokenKind::RBracket);
                    lhs = format!("(index {lhs} {index})");
                }
                _ => return lhs,
            }
        }
    }

    fn primary(&mut self) -> String {
        match self.kind() {
            TokenKind::Int => format!("(lit int {})", self.take()),
            TokenKind::Ident => format!("(name {})", self.take()),
            _ => {
                self.pos += 1;
                let inner = self.expr();
                self.expect(TokenKind::RParen);
                format!("(paren {inner})")
            }
        }
    }
}

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

fn generate(rng: &mut Rng, depth: u32, out: &mut String) {
    const BINARY: [&str; 13] = [
        "||", "&&", "==", "!=", "<", "<=", ">", ">=", "+", "-", "*", "/", "%",
    ];
    // Operand, then up to a few `op operand` pairs.
    let pairs = if depth == 0 { 0 } else { rng.below(4) };
    operand(rng, depth, out);
    for _ in 0..pairs {
        out.push(' ');
        out.push_str(BINARY[rng.below(BINARY.len())]);
        out.push(' ');
        operand(rng, depth, out);
    }
}

fn operand(rng: &mut Rng, depth: u32, out: &mut String) {
    for _ in 0..rng.below(3) {
        out.push_str(["-", "!"][rng.below(2)]);
    }
    let choices = if depth > 0 { 8 } else { 2 };
    match rng.below(choices) {
        0 => out.push_str(["a", "b", "c", "dt"][rng.below(4)]),
        1 => out.push_str(["1", "2", "30"][rng.below(3)]),
        2 => {
            out.push('(');
            generate(rng, depth - 1, out);
            out.push(')');
        }
        3 => {
            out.push_str("f(");
            for i in 0..rng.below(3) {
                if i > 0 {
                    out.push_str(", ");
                }
                generate(rng, depth - 1, out);
            }
            out.push(')');
        }
        4 => {
            out.push_str("v.");
            out.push_str(["x", "yz"][rng.below(2)]);
        }
        5 => {
            out.push_str("m[");
            generate(rng, depth - 1, out);
            out.push(']');
        }
        6 => {
            out.push_str("g(x).y[0]");
        }
        _ => out.push('q'),
    }
}

#[test]
fn the_parser_agrees_with_a_plain_reading_of_the_ebnf() {
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let (mut agreed, mut chained) = (0, 0);
    for _ in 0..4000 {
        let mut src = String::new();
        generate(&mut rng, 3, &mut src);
        let lexed = lex_str(FILE, &src);
        let tokens: Vec<(TokenKind, String)> = lexed
            .tokens
            .iter()
            .map(|t| (t.kind, t.text(&src).to_owned()))
            .collect();
        let mut reference = Reference {
            tokens,
            pos: 0,
            stuck: false,
        };
        let expected = reference.expr();
        let run = run(&src);
        if reference.kind() == TokenKind::Eof && !reference.stuck {
            assert!(run.diagnostics.is_empty(), "{src}: {:?}", run.diagnostics);
            assert_eq!(one_line(&dump_expr(&run.parsed.expr)), expected, "{src}");
            check_tree(&src, &run);
            agreed += 1;
        } else {
            // The EBNF stops at a second comparison or equality operator.
            assert!(
                run.codes().contains(&Code::E1010),
                "{src}: {:?}",
                run.codes()
            );
            chained += 1;
        }
    }
    assert!(agreed > 2500, "{agreed} agreeing expressions");
    assert!(chained > 50, "{chained} chained expressions");
}

// ---------------------------------------------------------------------------
// The nesting limit
// ---------------------------------------------------------------------------

/// `n` levels of the construct `open ... close` around `core`.
fn nest(open: &str, close: &str, core: &str, n: u32) -> String {
    format!(
        "{}{core}{}",
        open.repeat(n as usize),
        close.repeat(n as usize)
    )
}

/// The nesting shapes: each wraps `n` levels around `1`.
fn shapes(n: u32) -> Vec<(&'static str, String)> {
    vec![
        ("parentheses", nest("(", ")", "1", n)),
        ("unary minus", format!("{}1", "-".repeat(n as usize))),
        ("not", format!("{}x", "!".repeat(n as usize))),
        ("arrays", nest("[", "]", "1", n)),
        ("calls", nest("f(", ")", "1", n)),
        ("descriptors", nest("A { x: ", " }", "1", n)),
        ("bind", nest("A { x: bind(", ") }", "1", n)),
        ("index", nest("a[", "]", "1", n)),
        ("arguments after a callee", nest("f(1, ", ")", "1", n)),
        ("binary right operands", nest("1 + (", ")", "1", n / 2)),
        (
            "a ladder of operators",
            nest("a || (a && (a == (a < (a + (a * (", ")))))) ", "1", n / 12),
        ),
    ]
}

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

#[test]
fn nesting_to_the_limit_parses_on_a_one_mebibyte_stack() {
    let n = MAX_NESTING_DEPTH;
    for (what, src) in shapes(n) {
        let outcome = on_one_mebibyte({
            let src = src.clone();
            move || {
                let run = run(&src);
                let dump = dump_expr(&run.parsed.expr);
                let walked = nodes(&run.parsed.expr).len();
                (run.codes(), dump.len(), walked)
            }
        });
        assert!(outcome.0.is_empty(), "{what}: {:?}", outcome.0);
        assert!(outcome.1 > 0 && outcome.2 > 0, "{what}");
    }
}

#[test]
fn nesting_beyond_the_limit_is_one_e1050() {
    for (what, src) in shapes(MAX_NESTING_DEPTH + 40) {
        let outcome = on_one_mebibyte(move || run(&src).codes());
        assert_eq!(outcome, [Code::E1050], "{what}");
    }
}

#[test]
fn ten_thousand_nested_parentheses_are_e1050_without_crashing() {
    let src = nest("(", ")", "1", 10_000);
    let (codes, dump) = on_one_mebibyte(move || {
        let run = run(&src);
        (run.codes(), dump_expr(&run.parsed.expr))
    });
    assert_eq!(codes, [Code::E1050]);
    assert!(
        dump.starts_with("(paren"),
        "the outer levels are kept: {dump}"
    );
}

#[test]
fn the_limit_is_exactly_two_hundred_and_fifty_six_levels() {
    assert_eq!(MAX_NESTING_DEPTH, 256);
    let run256 = run(&nest("(", ")", "1", 256));
    assert!(run256.diagnostics.is_empty());
    let run257 = run(&nest("(", ")", "1", 257));
    assert_eq!(run257.codes(), [Code::E1050]);
}

#[test]
fn deep_nesting_inside_one_bracket_does_not_disturb_the_rest() {
    // The overflow is skipped as a unit: the second argument still parses.
    let src = format!("f({}, y)", nest("(", ")", "1", 1_000));
    let run = run(&src);
    assert_eq!(run.codes(), [Code::E1050]);
    let dump = one_line(&dump_expr(&run.parsed.expr));
    assert!(dump.ends_with("(name y))"), "{dump}");
}

#[test]
fn an_error_node_stands_in_for_the_skipped_nesting() {
    let src = nest("-(", ")", "1", 200); // 400 levels
    let run = run(&src);
    assert_eq!(run.codes(), [Code::E1050]);
    assert!(
        nodes(&run.parsed.expr)
            .iter()
            .any(|(info, _)| info.kind == "error")
    );
}

#[test]
fn long_operator_chains_are_bounded_by_the_height_of_the_tree() {
    let chain = |n: usize| format!("a{}", " + a".repeat(n));
    let at_limit = run(&chain(MAX_NESTING_DEPTH as usize + 1));
    assert!(
        at_limit.diagnostics.is_empty(),
        "{:?}",
        at_limit.diagnostics
    );
    let over = run(&chain(MAX_NESTING_DEPTH as usize + 2));
    assert_eq!(over.codes(), [Code::E1050]);
    // A chain of postfix operators nests as deep.
    let dots = format!("a{}", ".b".repeat(MAX_NESTING_DEPTH as usize + 2));
    assert_eq!(run(&dots).codes(), [Code::E1050]);
    let calls = format!("f{}", "()".repeat(MAX_NESTING_DEPTH as usize + 2));
    assert_eq!(run(&calls).codes(), [Code::E1050]);
}

#[test]
fn a_chain_of_a_million_operators_parses_and_drops_without_overflowing() {
    let src = format!("a{}", " + a".repeat(1_000_000));
    let (codes, kept) = on_one_mebibyte(move || {
        let run = run(&src);
        (run.codes(), run.parsed.node_count)
    });
    assert_eq!(codes, [Code::E1050], "reported once, not once per overflow");
    assert!(kept > 1_000_000);
}

#[test]
fn a_million_prefix_operators_do_not_recurse_without_limit() {
    for op in ["-", "!", "~"] {
        let src = format!("{}a", op.repeat(1_000_000));
        let codes = on_one_mebibyte(move || {
            let run = run(&src);
            run.diagnostics
                .iter()
                .map(|d| d.code)
                .filter(|code| !matches!(code, Code::E1901 | Code::W9003))
                .collect::<Vec<_>>()
        });
        let expected: &[Code] = if op == "~" { &[] } else { &[Code::E1050] };
        assert_eq!(codes, expected, "{op}");
    }
}

#[test]
fn the_nesting_report_resets_for_the_next_expression() {
    let mut sink = Diagnostics::new();
    for _ in 0..2 {
        let src = nest("(", ")", "1", 300);
        let lexed = lex_str(FILE, &src);
        let _ = parse_expression(&src, &lexed.tokens, &mut sink);
    }
    assert_eq!(sink.finish().diagnostics.len(), 2);
}

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

#[test]
fn junk_never_panics_and_every_span_stays_inside_the_text() {
    const PIECES: [&str; 43] = [
        "a", "b", "1", "2.5", "\"s\"", "#fff000", "true", "self", "_", "while", "(", ")", "[", "]",
        "{", "}", ",", ";", ":", ".", "..", "->", "+", "-", "*", "/", "%", "!", "=", "==", "!=",
        "<", "<=", ">", ">=", "&&", "||", "&", "|", "^", "~", "<<", "bind",
    ];
    let mut rng = Rng(0xdead_beef_cafe_f00d);
    for _ in 0..6000 {
        let mut src = String::new();
        for _ in 0..rng.below(14) {
            src.push_str(PIECES[rng.below(PIECES.len())]);
            if rng.below(3) > 0 {
                src.push(' ');
            }
        }
        for allow in [true, false] {
            let run = run_with(&src, allow);
            for (info, _) in nodes(&run.parsed.expr) {
                assert!(
                    info.span.start <= info.span.end && info.span.end as usize <= src.len(),
                    "{src:?}: {info:?}"
                );
            }
            let mut ids: Vec<u32> = nodes(&run.parsed.expr)
                .iter()
                .map(|(i, _)| i.id.0)
                .collect();
            ids.sort_unstable();
            assert!(
                ids.windows(2).all(|w| w[0] < w[1]),
                "{src:?}: ids are unique"
            );
            assert!(ids.iter().all(|&id| id < run.parsed.node_count), "{src:?}");
            for d in &run.diagnostics {
                let span = d.primary.as_ref().map(|l| l.span).unwrap();
                assert!(span.end as usize <= src.len(), "{src:?}: {d:?}");
            }
        }
    }
}

#[test]
fn an_error_leaf_never_hides_a_clean_parse() {
    // Parsing without any diagnostics produces no `Error` node, except for
    // malformed literals (which have a lexical diagnostic).
    for src in ["a", "f(a, [1, 2])", "A { x: 1 }", "a < b == c"] {
        let run = run(src);
        assert!(run.diagnostics.is_empty(), "{src}");
        assert!(
            nodes(&run.parsed.expr)
                .iter()
                .all(|(info, _)| info.kind != "error"),
            "{src}"
        );
    }
}

#[test]
fn expression_kinds_are_not_semantic() {
    // A swizzle is only a field access at this stage.
    let run = run("v.xyz");
    assert!(matches!(run.parsed.expr.kind, ExprKind::Field { .. }));
}
