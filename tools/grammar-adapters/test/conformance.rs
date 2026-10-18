//! Adapter conformance (`spec/ai-and-benchmarks.md` section 3, decision 0073):
//! the GBNF that `mtek grammar export --format gbnf` prints, run through the
//! pinned llama.cpp validator, against the compiler's lexer and parser.
//!
//! * every positive syntax fixture (`tests/syntax/pass/`) is accepted;
//! * every syntax fixture of `tests/syntax/fail/` and `tests/syntax/lex/` gets
//!   the verdict its lexical and syntax codes call for (rejected), or, for the
//!   restriction codes the grammar does not express, accepted;
//! * every other `.mtek` file of the repository (the holdout set excepted)
//!   gets the verdict of the compiler;
//! * strings with every escape, comments of each kind, numeric and colour
//!   literal edge cases, word boundaries and separators behave as the
//!   compiler does (each case also states the expected verdict, checked
//!   against the compiler, so a case cannot silently test nothing);
//! * every prefix of every positive fixture cut at a token boundary or inside
//!   a token (truncated output) gets the verdict of the compiler;
//! * every positive fixture with one token deleted gets the verdict of the
//!   compiler.
//!
//! The known differences (`KNOWN_DIFFERENCES`) are the only disagreements
//! allowed, and each is counted. This is evidence of consistency, not a
//! proof of equivalence (blueprint §4.6).
//!
//! Without the pinned validator the suite prints NOT-RUN and exits 0 (CI,
//! decision 0073); with `MTEK_REQUIRE_GBNF_VALIDATOR=1` it fails instead.
//! It is a `harness = false` test so that its report is always printed.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, VecDeque};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Mutex;

use mtek_compiler::source::FileId;
use mtek_compiler::syntax::{TokenKind, lex_str};
use mtek_grammar_adapters::{
    Expectation, Install, Pins, Scratch, Validator, Verdict, compiler_verdict, default_install_dir,
};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// One input and what the grammar must do with it.
struct Case {
    section: &'static str,
    name: String,
    text: String,
    expected: Expected,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Expected {
    Accept,
    Reject,
    /// Accepted by the grammar although the compiler rejects it: a known
    /// difference (index into `KNOWN_DIFFERENCES`).
    AcceptKnown(usize),
}

/// The disagreements the suite allows, with why. Each is counted in the
/// report. Decision 0073 lists them.
const KNOWN_DIFFERENCES: [(&str, &str); 2] = [
    (
        "nesting-limit",
        "the compiler rejects nesting deeper than 256 levels (E1050, decision 0022); GBNF has no depth bound",
    ),
    (
        "param-only-in-prefab",
        "a `param` in an entity that is not a prefab is grammatical; E1040 is the [S: param-only-in-prefab] restriction",
    ),
];

/// The fail fixtures whose only error is `E1040`, by verdict: a member in a
/// body whose production does not have it is ungrammatical; `param` in an
/// entity is grammatical (the restriction `param-only-in-prefab`).
const E1040_UNGRAMMATICAL: [&str; 13] = [
    "recovery_misplaced_members_then_clean",
    "e1040_entity_at_top_level",
    "e1040_field_in_material",
    "e1040_fn_in_function",
    "e1040_fn_in_scene",
    "e1040_handler_in_material",
    "e1040_import_in_scene",
    "e1040_param_in_scene",
    "e1040_scene_object_in_entity",
    "e1040_state_in_function",
    "e1040_state_in_material",
    "e1040_statement_in_scene",
    "e1040_struct_in_scene",
];
const E1040_GRAMMATICAL: [&str; 1] = ["e1040_param_in_entity"];

/// The expectation for a corpus file from the compiler's verdict, with the
/// known differences and the `E1040` tables.
fn corpus_expectation(name: &str, text: &str) -> Result<Expected, String> {
    let verdict = compiler_verdict(text);
    match verdict.expectation() {
        Expectation::Accept => Ok(Expected::Accept),
        Expectation::Reject => Ok(Expected::Reject),
        Expectation::Undetermined => {
            let only = |codes: &[&str]| verdict.errors.iter().all(|c| codes.contains(&c.as_str()));
            if only(&["E1050", "E0011", "E1020", "E1030"]) {
                Ok(Expected::AcceptKnown(0))
            } else if E1040_GRAMMATICAL.contains(&name) {
                Ok(Expected::AcceptKnown(1))
            } else if E1040_UNGRAMMATICAL.contains(&name) {
                Ok(Expected::Reject)
            } else {
                Err(format!(
                    "{name}: the compiler reports only {:?}; classify it in E1040_GRAMMATICAL or E1040_UNGRAMMATICAL",
                    verdict.errors
                ))
            }
        }
    }
}

fn mtek_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(listing) = std::fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = listing.filter_map(|e| e.ok().map(|e| e.path())).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            // Never read the holdout set (spec/ai-and-benchmarks.md 6.2), nor
            // generated or installed trees.
            if matches!(
                name,
                "holdout" | "node_modules" | "target" | ".cache" | "dist" | ".out"
            ) {
                continue;
            }
            mtek_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "mtek") {
            out.push(path);
        }
    }
}

fn relative(path: &Path) -> String {
    let root = repo().canonicalize().unwrap();
    let path = path.canonicalize().unwrap();
    path.strip_prefix(&root)
        .unwrap_or(&path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn fixture_cases(cases: &mut Vec<Case>, problems: &mut Vec<String>) {
    let root = repo();
    // Positive syntax fixtures: accepted, and clean for the compiler.
    let mut pass = Vec::new();
    mtek_files(&root.join("tests/syntax/pass"), &mut pass);
    assert!(pass.len() >= 90, "the positive syntax corpus is missing");
    for path in &pass {
        let text = std::fs::read_to_string(path).unwrap();
        if !compiler_verdict(&text).errors.is_empty() {
            problems.push(format!("{}: a positive fixture has errors", relative(path)));
        }
        cases.push(Case {
            section: "positive syntax fixtures",
            name: relative(path),
            text,
            expected: Expected::Accept,
        });
    }
    // Syntax negatives and lexer fixtures.
    let mut syntax = Vec::new();
    mtek_files(&root.join("tests/syntax/fail"), &mut syntax);
    mtek_files(&root.join("tests/syntax/lex"), &mut syntax);
    mtek_files(&root.join("tests/syntax/ast"), &mut syntax);
    for path in &syntax {
        let Ok(text) = std::fs::read_to_string(path) else {
            // Not UTF-8 (E0001): outside the domain of a grammar over characters.
            continue;
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        match corpus_expectation(stem, &text) {
            Ok(expected) => cases.push(Case {
                section: "syntax fail, lex and ast fixtures",
                name: relative(path),
                text,
                expected,
            }),
            Err(problem) => problems.push(problem),
        }
    }
    // Everything else.
    let mut rest = Vec::new();
    for dir in ["tests", "examples", "benchmarks", "packages"] {
        mtek_files(&root.join(dir), &mut rest);
    }
    for path in &rest {
        let name = relative(path);
        if name.starts_with("tests/syntax/") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        match corpus_expectation(stem, &text) {
            Ok(expected) => cases.push(Case {
                section: "other repository sources",
                name,
                text,
                expected,
            }),
            Err(problem) => problems.push(problem),
        }
    }
}

fn in_fn(body: &str) -> String {
    format!("fn f() {{\n    {body}\n}}\n")
}

fn edge_cases() -> Vec<(&'static str, String, Expected)> {
    use Expected::{Accept as A, Reject as R};
    let s = |value: &str| in_fn(&format!("let s = \"{value}\";"));
    let e = |expr: &str| in_fn(&format!("let a = {expr};"));
    let mut cases: Vec<(&'static str, String, Expected)> = vec![
        // Strings and escapes.
        ("string: every simple escape", s(r#"\" \\ \n \t \r \0"#), A),
        ("string: \\u{41}", s(r"\u{41}"), A),
        ("string: \\u{0}", s(r"\u{0}"), A),
        ("string: \\u{7FF}", s(r"\u{7FF}"), A),
        ("string: \\u{d7ff}", s(r"\u{d7ff}"), A),
        ("string: \\u{E000}", s(r"\u{E000}"), A),
        ("string: \\u{FFFF}", s(r"\u{FFFF}"), A),
        ("string: \\u{10000}", s(r"\u{10000}"), A),
        ("string: \\u{10FFFF}", s(r"\u{10FFFF}"), A),
        ("string: \\u{000041} (six digits)", s(r"\u{000041}"), A),
        ("string: \\u{00D7FF}", s(r"\u{00D7FF}"), A),
        ("string: \\u{0FFFFF}", s(r"\u{0FFFFF}"), A),
        ("string: \\u{0E000}", s(r"\u{0E000}"), A),
        ("string: a tab and non-ASCII text", s("a\tb é ü 雪"), A),
        ("string: a raw byte-order mark", s("\u{feff}"), A),
        ("string: empty", s(""), A),
        ("string: \\q", s(r"\q"), R),
        ("string: \\x41", s(r"\x41"), R),
        ("string: \\'", s(r"\'"), R),
        ("string: \\u41", s(r"\u41"), R),
        ("string: \\u{}", s(r"\u{}"), R),
        ("string: \\u{1234567} (seven digits)", s(r"\u{1234567}"), R),
        ("string: \\u{D800} (surrogate)", s(r"\u{D800}"), R),
        ("string: \\u{dfff} (surrogate)", s(r"\u{dfff}"), R),
        ("string: \\u{00DFFF} (surrogate)", s(r"\u{00DFFF}"), R),
        ("string: \\u{110000}", s(r"\u{110000}"), R),
        ("string: \\u{FFFFFF}", s(r"\u{FFFFFF}"), R),
        ("string: \\u{12 unclosed", s(r"\u{12"), R),
        ("string: unterminated", in_fn("let s = \"abc;"), R),
        ("string: a line break inside", in_fn("let s = \"a\nb\";"), R),
        (
            "string: a backslash at the end of the line",
            in_fn("let s = \"a\\\n\";"),
            R,
        ),
        // Comments.
        (
            "comment: line",
            "// a line comment\nfn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: doc before a function",
            "/// Documents f.\nfn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: //// banner",
            "//// banner\nfn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: line comment ends the file without a line break",
            "fn f() {} // end".to_owned(),
            A,
        ),
        (
            "comment: only a line comment, no line break",
            "// nothing else".to_owned(),
            A,
        ),
        ("comment: block", "/* block */ fn f() {}\n".to_owned(), A),
        ("comment: empty block /**/", "/**/fn f() {}\n".to_owned(), A),
        ("comment: /***/", "/***/ fn f() {}\n".to_owned(), A),
        (
            "comment: stars before the end",
            "/* a **/ fn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: slash after the opener",
            "/*/ x */ fn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: nested",
            "/* a /* b */ c */ fn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: //* inside opens a nested comment",
            "/* //* x */ */ fn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: stars and slashes",
            "/* * / ** // */ fn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: between every token",
            "fn/**/f(/**/)/**/{/**/}\n".to_owned(),
            A,
        ),
        ("comment: separates two words", in_fn("let/* */x = 1;"), A),
        (
            "comment: multi-line block",
            "/*\n line\n line\n*/\nfn f() {}\n".to_owned(),
            A,
        ),
        (
            "comment: block at the end",
            "fn f() {} /* end */".to_owned(),
            A,
        ),
        ("comment: unterminated", "fn f() {} /* open".to_owned(), R),
        (
            "comment: nested, unbalanced",
            "/* a /* b */ fn f() {}\n".to_owned(),
            R,
        ),
        ("comment: /*/", "/*/ fn f() {}\n".to_owned(), R),
        ("comment: stray */", "fn f() {} */\n".to_owned(), R),
        (
            "comment: lone carriage return inside a block comment",
            "/* a\rb */ fn f() {}\n".to_owned(),
            R,
        ),
        (
            "comment: lone carriage return after a line comment",
            "// a\rfn f() {}\n".to_owned(),
            R,
        ),
        (
            "whitespace: lone carriage return",
            "fn f() {}\r".to_owned(),
            R,
        ),
        (
            "whitespace: CRLF line endings",
            "// c\r\nfn f() {\r\n    let a = 1;\r\n}\r\n".to_owned(),
            A,
        ),
        (
            "whitespace: tabs",
            "fn\tf()\t{\tlet a = 1;\t}\n".to_owned(),
            A,
        ),
        ("whitespace: empty file", String::new(), A),
        ("whitespace: only blank lines", "\n\n  \n".to_owned(), A),
        (
            "whitespace: vertical tab (E0005)",
            "fn f() {}\u{0B}\n".to_owned(),
            R,
        ),
        (
            "whitespace: no-break space (E0005)",
            "fn\u{a0}f() {}\n".to_owned(),
            R,
        ),
        (
            "whitespace: byte-order mark at the start",
            "\u{feff}fn f() {}\n".to_owned(),
            A,
        ),
        (
            "whitespace: byte-order mark later (E0002)",
            "fn f() {}\n\u{feff}".to_owned(),
            R,
        ),
        // Numbers and colours.
        ("number: 0", e("0"), A),
        ("number: 1234567890", e("1234567890"), A),
        ("number: 0.0", e("0.0"), A),
        ("number: 1.5e3", e("1.5e3"), A),
        ("number: 1.5E-3", e("1.5E-3"), A),
        ("number: 1.5e+3", e("1.5e+3"), A),
        ("number: -1", e("-1"), A),
        ("number: 1-1", e("1-1"), A),
        ("number: 1 .x (field of an integer)", e("1 .x"), A),
        ("number: 1.0.x", e("1.0.x"), A),
        ("number: 0..n range", in_fn("for i in 0..n { g(i); }"), A),
        (
            "number: 0.5..1.5 range",
            in_fn("for i in 0.5..1.5 { g(i); }"),
            A,
        ),
        ("number: 00", e("00"), R),
        ("number: 01", e("01"), R),
        ("number: 1.", e("1."), R),
        ("number: .5", e(".5"), R),
        ("number: 1e3", e("1e3"), R),
        ("number: 1.5e", e("1.5e"), R),
        ("number: 1.5e+", e("1.5e+"), R),
        ("number: 0x1F", e("0x1F"), R),
        ("number: 0b1", e("0b1"), R),
        ("number: 1_000", e("1_000"), R),
        ("number: 1u", e("1u"), R),
        ("number: 1.0f", e("1.0f"), R),
        ("number: 1.x", e("1.x"), R),
        ("number: x.0", e("x.0"), R),
        ("color: #ffffff", e("#ffffff"), A),
        ("color: #FFFFFFFF", e("#FFFFFFFF"), A),
        ("color: #00aaBB", e("#00aaBB"), A),
        ("color: #fff", e("#fff"), R),
        ("color: #fffffff (seven)", e("#fffffff"), R),
        ("color: #ffffffx", e("#ffffffx"), R),
        ("color: #gggggg", e("#gggggg"), R),
        ("color: #fffffffff (nine)", e("#fffffffff"), R),
        // Words, keywords and field names.
        (
            "word: a name that starts with a keyword",
            in_fn("let iffy = 1;"),
            A,
        ),
        (
            "word: a name that a keyword starts with",
            in_fn("let i = 1;"),
            A,
        ),
        ("word: _x", in_fn("let _x = 1;"), A),
        ("word: __x (E0011, a restriction)", in_fn("let __x = 1;"), A),
        (
            "word: assignment to a name that starts with let",
            in_fn("letx = 1;"),
            A,
        ),
        (
            "word: a call that starts with return",
            in_fn("returnx();"),
            A,
        ),
        ("word: return(1)", in_fn("return(1);"), A),
        (
            "word: _ as a declared name (E0012 is the resolver's)",
            in_fn("let _ = 1;"),
            A,
        ),
        ("word: _ as a descriptor name (E1001)", e("_ { a: 1 }"), R),
        ("word: _x as a descriptor name", e("_x { a: 1 }"), A),
        (
            "word: _ as a scene object name (E1001)",
            "scene Main { camera _ { } }\n".to_owned(),
            R,
        ),
        (
            "word: _ as a scene object kind",
            "scene Main { _ Main { } }\n".to_owned(),
            A,
        ),
        (
            "word: _ as a field name",
            "scene Main { entity E { _: 1; } }\n".to_owned(),
            A,
        ),
        ("word: _ after a dot", e("a._"), A),
        ("word: keyword as a name", in_fn("let if = 1;"), R),
        ("word: reserved word as a name", in_fn("let type = 1;"), R),
        ("word: every keyword as a name", in_fn("let true = 1;"), R),
        ("word: non-ASCII name (E0010)", in_fn("let café = 1;"), R),
        ("word: glued keywords", "fnf() {}\n".to_owned(), R),
        ("word: glued export", "exportfn f() {}\n".to_owned(), R),
        (
            "word: glued keyword and name",
            "scene Main { stateangle: f32 = 0.0; }\n".to_owned(),
            R,
        ),
        (
            "word: material is a field name",
            "scene Main {\n    entity Cube { material: Unlit { color: #ffffff }; }\n}\n".to_owned(),
            A,
        ),
        (
            "word: material after a dot",
            in_fn("Cube.material.color = #ffffff;"),
            A,
        ),
        (
            "word: material as a descriptor field",
            e("Unlit { material: 1 }"),
            A,
        ),
        (
            "word: material as a struct field",
            "struct S { material: f32; }\n".to_owned(),
            R,
        ),
        (
            "word: material as a local name",
            in_fn("let material = 1;"),
            R,
        ),
        // Separators between punctuation.
        (
            "operator: >= after type arguments",
            in_fn("let a: array<f32, 2>= x;"),
            A,
        ),
        ("operator: a=-b", in_fn("a=-b;"), A),
        ("operator: a<-b", e("a<-b"), A),
        ("operator: = = is not ==", e("a = = b"), R),
        ("operator: < = is not <=", e("a < = b"), R),
        ("operator: | | is not ||", e("a | | b"), R),
        ("operator: chained comparison (E1010)", e("a < b < c"), R),
        ("operator: chained equality (E1010)", e("a == b == c"), R),
        ("operator: bitwise and (E1901)", e("a & b"), R),
        ("operator: shift (E1901)", e("a << b"), R),
        ("operator: ...", in_fn("for i in a...b { }"), R),
        // ExprNoDesc.
        (
            "condition: descriptor literal (E1011)",
            in_fn("if Box { size: 1.0 } { g(); }"),
            R,
        ),
        (
            "condition: parenthesised descriptor",
            in_fn("if (Box { size: 1.0 }).size > 0.0 { g(); }"),
            A,
        ),
        ("condition: name then two blocks", in_fn("if x {} {}"), A),
        (
            "condition: descriptor in a call argument",
            in_fn("if f(Box { s: 1 }) { g(); }"),
            A,
        ),
        (
            "for: descriptor iterable (E1011)",
            in_fn("for x in Items { a: 1 } { g(x); }"),
            R,
        ),
        // Structure.
        ("item: export const", "export const A = 1;\n".to_owned(), A),
        ("item: cpu fn", "cpu fn f() {}\n".to_owned(), A),
        (
            "item: export cpu fn",
            "export cpu fn f() {}\n".to_owned(),
            A,
        ),
        (
            "item: import",
            "import { A, B, } from \"./a.mtek\";\n".to_owned(),
            A,
        ),
        (
            "item: import glued from",
            "import { A }from\"./a.mtek\";\n".to_owned(),
            A,
        ),
        ("item: trailing garbage", "fn f() {} }\n".to_owned(), R),
    ];
    // Deep nesting that the compiler accepts, and a nested comment 64 deep.
    let depth = 200;
    cases.push((
        "nesting: 200 parentheses",
        format!("const A = {}1{};\n", "(".repeat(depth), ")".repeat(depth)),
        A,
    ));
    cases.push((
        "comment: 64 levels of nested block comments",
        format!("{}x{} fn f() {{}}\n", "/* ".repeat(64), " */".repeat(64)),
        A,
    ));
    cases.push((
        "comment: 64 levels, one */ missing",
        format!("{}x{} fn f() {{}}\n", "/* ".repeat(64), " */".repeat(63)),
        R,
    ));
    cases
}

/// Offsets to cut a text at: the start and end of every token and the middle
/// of every token longer than two bytes, and of every comment.
fn cut_points(text: &str) -> Vec<usize> {
    let lexed = lex_str(FileId(0), text);
    let mut points = std::collections::BTreeSet::new();
    let mut add_span = |start: usize, end: usize| {
        points.insert(start);
        points.insert(end);
        if end > start + 2 {
            let mut mid = start + (end - start) / 2;
            while !text.is_char_boundary(mid) {
                mid += 1;
            }
            points.insert(mid);
        }
    };
    for token in &lexed.tokens {
        if token.kind != TokenKind::Eof {
            add_span(token.span.start as usize, token.span.end as usize);
        }
    }
    for item in lexed.trivia.items() {
        add_span(item.span.start as usize, item.span.end as usize);
    }
    points.remove(&text.len());
    points.into_iter().filter(|p| *p <= text.len()).collect()
}

fn derived_cases(pass: &[(String, String)]) -> Vec<Case> {
    let mut cases = Vec::new();
    for (name, text) in pass {
        for cut in cut_points(text) {
            let prefix = text[..cut].to_owned();
            let expected = match corpus_expectation(name, &prefix) {
                Ok(e) => e,
                Err(_) => continue,
            };
            cases.push(Case {
                section: "truncated positive fixtures",
                name: format!("{name} cut at byte {cut}"),
                text: prefix,
                expected,
            });
        }
        let lexed = lex_str(FileId(0), text);
        let tokens: Vec<_> = lexed
            .tokens
            .iter()
            .filter(|t| t.kind != TokenKind::Eof)
            .collect();
        for (index, token) in tokens.iter().enumerate() {
            let (start, end) = (token.span.start as usize, token.span.end as usize);
            let mutated = format!("{}{}", &text[..start], &text[end..]);
            let Ok(expected) = corpus_expectation(name, &mutated) else {
                continue;
            };
            cases.push(Case {
                section: "positive fixtures with one token deleted",
                name: format!("{name} without token {index} `{}`", &text[start..end]),
                text: mutated,
                expected,
            });
        }
        // Every name, keyword and literal word replaced by `_`, by the
        // field-name keyword `material`, by a reserved word and by another
        // keyword: the positions where the parser takes a token kind other
        // than the grammar's `Ident`.
        for (index, token) in tokens.iter().enumerate() {
            let (start, end) = (token.span.start as usize, token.span.end as usize);
            let word = &text[start..end];
            if !word.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') {
                continue;
            }
            for replacement in ["_", "material", "type", "self"] {
                if replacement == word {
                    continue;
                }
                let mutated = format!("{}{replacement}{}", &text[..start], &text[end..]);
                let Ok(expected) = corpus_expectation(name, &mutated) else {
                    continue;
                };
                cases.push(Case {
                    section: "positive fixtures with one word replaced",
                    name: format!("{name} with token {index} `{word}` replaced by `{replacement}`"),
                    text: mutated,
                    expected,
                });
            }
        }
    }
    cases
}

fn main() -> ExitCode {
    let required = std::env::var("MTEK_REQUIRE_GBNF_VALIDATOR").is_ok_and(|v| v == "1");
    let not_run = |reason: String| {
        println!("grammar adapter conformance: NOT-RUN: {reason}");
        if required {
            println!("MTEK_REQUIRE_GBNF_VALIDATOR=1: failing because the suite did not run");
            ExitCode::FAILURE
        } else {
            ExitCode::SUCCESS
        }
    };
    let pins = Pins::load().unwrap();
    let dir = default_install_dir();
    let install = match Install::read(&dir, &pins) {
        Ok(install) => install,
        Err(reason) => return not_run(reason),
    };
    let Some(validator) = install.validator.filter(|p| p.is_file()) else {
        return not_run(format!(
            "the pinned validator is not built in {} (run `node tools/grammar-adapters/fetch-backend.mjs --validator`)",
            dir.display()
        ));
    };
    let validator = Validator { path: validator };
    let grammar = mtek_compiler::syntax::gbnf().unwrap();
    let scratch = Scratch::new("conformance").unwrap();
    let grammar_path = scratch.write("mtek.gbnf", grammar.as_bytes()).unwrap();

    let mut problems = Vec::new();

    // Sensitivity: the validator really applies the grammar. With the
    // required separators weakened to optional ones, glued words parse.
    let weakened = grammar.replace(" ws1 ", " ws ");
    let weakened_path = scratch.write("weakened.gbnf", weakened.as_bytes()).unwrap();
    let glued = scratch.write("glued.mtek", b"fnf() {}\n").unwrap();
    match (
        validator.validate_file(&grammar_path, &glued),
        validator.validate_file(&weakened_path, &glued),
    ) {
        (Ok(Verdict::Rejected(_)), Ok(Verdict::Accepted)) => {
            println!("  sensitivity check: `fnf() {{}}` rejected, accepted with `ws1` weakened to `ws`");
        }
        other => problems.push(format!(
            "sensitivity check: `fnf() {{}}` should be rejected by the grammar and accepted with `ws1` weakened to `ws`, got {other:?}"
        )),
    }

    let mut cases = Vec::new();
    fixture_cases(&mut cases, &mut problems);
    let pass: Vec<(String, String)> = cases
        .iter()
        .filter(|c| c.section == "positive syntax fixtures")
        .map(|c| (c.name.clone(), c.text.clone()))
        .collect();
    for (name, text, expected) in edge_cases() {
        // The stated verdict must be the compiler's (or a known difference).
        let compiler = corpus_expectation(name, &text);
        let agrees = match (&compiler, expected) {
            (Ok(Expected::AcceptKnown(_) | Expected::Accept), Expected::Accept)
            | (Ok(Expected::Reject), Expected::Reject) => true,
            _ => false,
        };
        if !agrees {
            problems.push(format!(
                "edge case {name:?}: stated {expected:?}, the compiler says {compiler:?} ({:?})",
                compiler_verdict(&text).errors
            ));
        }
        cases.push(Case {
            section: "edge cases",
            name: name.to_owned(),
            text,
            expected,
        });
    }
    cases.extend(derived_cases(&pass));

    // Run the validator over every case, in parallel.
    let queue: Mutex<VecDeque<usize>> = Mutex::new((0..cases.len()).collect());
    let results: Mutex<BTreeMap<usize, Result<Verdict, String>>> = Mutex::new(BTreeMap::new());
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get().min(12));
    std::thread::scope(|scope| {
        for worker in 0..workers {
            let (queue, results, cases, scratch, validator, grammar_path) = (
                &queue,
                &results,
                &cases,
                &scratch,
                &validator,
                &grammar_path,
            );
            scope.spawn(move || {
                loop {
                    let Some(index) = queue.lock().unwrap().pop_front() else {
                        break;
                    };
                    let input = scratch
                        .write(&format!("w{worker}.mtek"), cases[index].text.as_bytes())
                        .and_then(|path| validator.validate_file(grammar_path, &path));
                    results.lock().unwrap().insert(index, input);
                }
            });
        }
    });
    let results = results.into_inner().unwrap();

    // Report.
    let mut sections: BTreeMap<&str, (usize, usize, usize, usize)> = BTreeMap::new();
    let mut known = [0usize; KNOWN_DIFFERENCES.len()];
    let mut mismatches = Vec::new();
    for (index, case) in cases.iter().enumerate() {
        let entry = sections.entry(case.section).or_default();
        entry.0 += 1;
        let verdict = match results.get(&index) {
            Some(Ok(v)) => v.clone(),
            Some(Err(e)) => {
                mismatches.push(format!("[{}] {}: {e}", case.section, case.name));
                continue;
            }
            None => {
                mismatches.push(format!("[{}] {}: not run", case.section, case.name));
                continue;
            }
        };
        let accepted = verdict == Verdict::Accepted;
        if accepted {
            entry.1 += 1;
        } else {
            entry.2 += 1;
        }
        let ok = match case.expected {
            Expected::Accept => accepted,
            Expected::Reject => !accepted,
            Expected::AcceptKnown(k) => {
                if accepted {
                    known[k] += 1;
                    entry.3 += 1;
                }
                accepted
            }
        };
        if !ok {
            let detail = match &verdict {
                Verdict::Rejected(line) => line.clone(),
                Verdict::Accepted => "accepted".to_owned(),
            };
            let mut shown: String = case.text.chars().take(160).collect();
            shown = shown.replace('\n', "\\n");
            mismatches.push(format!(
                "[{}] {}: expected {:?}, the validator says {detail} (compiler {:?}) text: {shown}",
                case.section,
                case.name,
                case.expected,
                compiler_verdict(&case.text).errors
            ));
        }
    }
    let mut report = String::new();
    let _ = writeln!(
        report,
        "grammar adapter conformance: llama.cpp {} ({}), validator {}",
        pins.release,
        &pins.commit[..8],
        validator.path.display()
    );
    for (section, (total, accepted, rejected, known_accepts)) in &sections {
        let _ = writeln!(
            report,
            "  {section}: {total} inputs, {accepted} accepted, {rejected} rejected{}",
            if *known_accepts > 0 {
                format!(" ({known_accepts} accepted under a known difference)")
            } else {
                String::new()
            }
        );
    }
    for ((id, why), count) in KNOWN_DIFFERENCES.iter().zip(known) {
        let _ = writeln!(report, "  known difference {id}: {count} inputs ({why})");
    }
    print!("{report}");
    for problem in &problems {
        println!("PROBLEM: {problem}");
    }
    for mismatch in mismatches.iter().take(60) {
        println!("MISMATCH: {mismatch}");
    }
    if mismatches.len() > 60 {
        println!("... {} mismatches in all", mismatches.len());
    }
    if problems.is_empty() && mismatches.is_empty() {
        println!("grammar adapter conformance: PASS ({} inputs)", cases.len());
        ExitCode::SUCCESS
    } else {
        println!(
            "grammar adapter conformance: FAIL ({} mismatches, {} problems)",
            mismatches.len(),
            problems.len()
        );
        ExitCode::FAILURE
    }
}
