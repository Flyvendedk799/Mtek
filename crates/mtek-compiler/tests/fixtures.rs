//! The syntax fixture runner (`spec/testing.md` section 3.1,
//! `spec/compiler-architecture.md` section 10): directory-driven, fixtures
//! discovered in sorted order, expected files rewritten only with
//! `MTEK_BLESS=1 cargo test` (review the diff like code). No snapshot library:
//! the expected files are plain text.
//!
//! Suites, under `tests/syntax/`:
//!
//! * `pass/<name>.mtek` must lex and parse with **zero** diagnostics (also no
//!   warnings), into a sound tree. Files are named after the grammar
//!   production they exercise (`Handler.mtek`), or after the source they come
//!   from (`blueprint_3_1.mtek`, `spec_scenes_entity.mtek`).
//! * `ast/<name>.mtek` with `<name>.ast`: the golden S-expression dump of the
//!   tree. A file whose first line starts with `---` holds expressions, a
//!   case after each such line (see below); any other file is a whole module.
//! * `fail/<name>.mtek` with `<name>.diag.json`: the diagnostics of the lexer
//!   and the parser, which must match exactly (codes, primary spans, messages,
//!   order; `related`, `notes` and `candidateEdits` are compared when the
//!   expected file has them).
//!
//! The lexer fixtures of `tests/syntax/lex` have their own runner
//! (`lexer_fixtures.rs`); M1-09 extends this one to `tests/semantics/`.
//!
//! Expression files: cases are introduced by a line starting with `---`; the
//! text up to the next such line (without its trailing line break) is one
//! expression. The rest of a `---` line is a remark shown in the golden file,
//! except that a remark starting with `no-desc` makes the case parse as
//! `ExprNoDesc` (no descriptor literal at the top level, the condition of an
//! `if`). The `.ast` file shows for each case the remark (`;; ...`), the
//! source (each line behind `; `), the indented dump of the tree, and one line
//! per diagnostic and candidate edit, in the order the compiler reports them,
//! with byte offsets into the case text:
//!
//! ```text
//! ; E1010 6..9 `<` message
//! ; edit E1011 "(" at 0..0, ")" at 17..17
//! ```
//!
//! Module files have the same diagnostic lines after the dump, with offsets
//! into the file; the source is not repeated. A fixture named `fail_*` must
//! produce diagnostics somewhere, every other fixture none. Every tree
//! without diagnostics has its structural invariants checked: the ids are
//! exactly `0..node_count`, parents have larger ids than their children, and
//! every span nests in its parent's.

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::{Diagnostic, Diagnostics};
use mtek_compiler::source::{FileId, ProjectPath, SourceMap};
use mtek_compiler::syntax::ast::Module;
use mtek_compiler::syntax::{
    CandidateEdit, dump_expr, dump_module, lex, lex_str, parse_expression,
    parse_expression_no_desc, parse_module, walk_expr, walk_module,
};
use serde_json::{Map, Value};

fn syntax_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/syntax")
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

/// File names of `dir` (relative to `tests/syntax`) with `extension`, without
/// it, in sorted order.
fn fixture_names(dir: &str, extension: &str) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(syntax_dir().join(dir))
        .unwrap_or_else(|e| panic!("cannot list {dir}: {e}"))
        .filter_map(|entry| {
            let file = entry.ok()?.file_name().into_string().ok()?;
            file.strip_suffix(extension).map(str::to_owned)
        })
        .collect();
    names.sort();
    names
}

/// Compare `actual` with the file at `path`, or write it when blessing.
fn check_golden(path: &Path, actual: &str) {
    if blessing() {
        fs::write(path, actual).unwrap();
        return;
    }
    let expected = fs::read_to_string(path).unwrap_or_else(|e| {
        panic!(
            "missing golden {} ({e}); run `MTEK_BLESS=1 cargo test` and review it",
            path.display()
        )
    });
    assert_eq!(
        expected,
        actual,
        "golden {} differs; if the change is intended run `MTEK_BLESS=1 cargo test` and review the diff",
        path.display()
    );
}

// ---------------------------------------------------------------------------
// Whole files
// ---------------------------------------------------------------------------

/// Everything the front end made of one file.
struct Parsed {
    module: Module,
    text: String,
    diagnostics: Vec<Diagnostic>,
    edits: Vec<CandidateEdit>,
}

/// Lex and parse the fixture `<dir>/<name>.mtek`.
fn parse_fixture(dir: &str, name: &str) -> Parsed {
    let path = syntax_dir().join(dir).join(format!("{name}.mtek"));
    let bytes = fs::read(&path).unwrap();
    let mut map = SourceMap::new();
    let id = map
        .add(ProjectPath::new(&format!("{name}.mtek")).unwrap(), &bytes)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let file = map.get(id).unwrap();
    let mut lexed = lex(file);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(file.text(), &lexed.tokens, &lexed.trivia, &mut sink);
    Parsed {
        module: parsed.module,
        text: file.text().to_owned(),
        diagnostics: sink.finish().diagnostics,
        edits: parsed.candidate_edits,
    }
}

/// The structural invariants of a tree without errors (see the module
/// documentation).
fn check_module_invariants(name: &str, parsed: &Parsed) {
    let mut ids = Vec::new();
    walk_module(&parsed.module, &mut |info, parent| {
        ids.push(info.id.0);
        assert!(
            info.span.end as usize <= parsed.text.len(),
            "{name}: {info:?} is outside the text"
        );
        if let Some(parent) = parent {
            assert!(
                parent.id > info.id,
                "{name}: children are numbered first ({info:?})"
            );
            assert!(
                parent.span.contains_span(info.span),
                "{name}: {info:?} is outside its parent {parent:?}"
            );
        }
    });
    ids.sort_unstable();
    assert_eq!(
        ids,
        (0..parsed.module.node_count).collect::<Vec<_>>(),
        "{name}: ids are dense"
    );
}

#[test]
fn every_pass_fixture_parses_without_diagnostics() {
    let names = fixture_names("pass", ".mtek");
    assert!(names.len() >= 80, "fixtures are missing: {names:?}");
    for name in &names {
        let parsed = parse_fixture("pass", name);
        assert!(
            parsed.diagnostics.is_empty(),
            "pass/{name}.mtek: {:#?}",
            parsed
                .diagnostics
                .iter()
                .map(|d| format!(
                    "{} {:?}: {}",
                    d.code,
                    d.primary.as_ref().map(|l| (l.span.start, l.span.end)),
                    d.message
                ))
                .collect::<Vec<_>>()
        );
        check_module_invariants(name, &parsed);
    }
}

/// The `.diag.json` content of the diagnostics of `file_name`.
fn diagnostics_json(file_name: &str, parsed: &Parsed) -> String {
    let items: Vec<Value> = parsed
        .diagnostics
        .iter()
        .map(|d| {
            let span = d.primary.as_ref().map(|label| label.span).unwrap();
            let mut object = Map::new();
            object.insert("code".into(), d.code.as_str().into());
            object.insert("file".into(), file_name.into());
            object.insert("startByte".into(), span.start.into());
            object.insert("endByte".into(), span.end.into());
            object.insert("message".into(), d.message.as_str().into());
            if !d.related.is_empty() {
                let related: Vec<Value> = d
                    .related
                    .iter()
                    .map(|label| {
                        let mut related = Map::new();
                        related.insert(
                            "message".into(),
                            label.message.clone().unwrap_or_default().into(),
                        );
                        related.insert("startByte".into(), label.span.start.into());
                        related.insert("endByte".into(), label.span.end.into());
                        Value::Object(related)
                    })
                    .collect();
                object.insert("related".into(), Value::Array(related));
            }
            if !d.notes.is_empty() {
                object.insert("notes".into(), d.notes.clone().into());
            }
            let candidates: Vec<Value> = parsed
                .edits
                .iter()
                .filter(|candidate| candidate.code == d.code && candidate.at == span)
                .map(|candidate| {
                    let edits: Vec<Value> = candidate
                        .edit
                        .edits
                        .iter()
                        .map(|edit| {
                            let mut one = Map::new();
                            one.insert("startByte".into(), edit.span.start.into());
                            one.insert("endByte".into(), edit.span.end.into());
                            one.insert("replacement".into(), edit.replacement.as_str().into());
                            Value::Object(one)
                        })
                        .collect();
                    let mut suggestion = Map::new();
                    suggestion.insert(
                        "description".into(),
                        candidate.edit.description.as_str().into(),
                    );
                    suggestion.insert("edits".into(), Value::Array(edits));
                    Value::Object(suggestion)
                })
                .collect();
            if !candidates.is_empty() {
                object.insert("candidateEdits".into(), Value::Array(candidates));
            }
            Value::Object(object)
        })
        .collect();
    let mut text = serde_json::to_string_pretty(&Value::Array(items)).unwrap();
    text.push('\n');
    text
}

/// Compare the actual diagnostics with the expected file: the code, file,
/// primary span and message of each exactly, and `related`, `notes` and
/// `candidateEdits` when the expected diagnostic has them.
fn check_diagnostics(path: &Path, actual: &str) {
    if blessing() {
        fs::write(path, actual).unwrap();
        return;
    }
    let expected_text = fs::read_to_string(path).unwrap_or_else(|e| {
        panic!(
            "missing {} ({e}); run `MTEK_BLESS=1 cargo test` and review it",
            path.display()
        )
    });
    let expected: Vec<Value> = serde_json::from_str(&expected_text)
        .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", path.display()));
    let actual: Vec<Value> = serde_json::from_str(actual).unwrap();
    assert_eq!(
        expected.len(),
        actual.len(),
        "{}: expected {} diagnostics, got {}:\n{}",
        path.display(),
        expected.len(),
        actual.len(),
        serde_json::to_string_pretty(&actual).unwrap()
    );
    for (index, (want, got)) in expected.iter().zip(&actual).enumerate() {
        for key in ["code", "file", "startByte", "endByte", "message"] {
            assert_eq!(
                want.get(key),
                got.get(key),
                "{}: diagnostic {index}, `{key}`; if the change is intended run `MTEK_BLESS=1 cargo test` and review the diff",
                path.display()
            );
        }
        for key in ["related", "notes", "candidateEdits"] {
            if let Some(want_value) = want.get(key) {
                assert_eq!(
                    Some(want_value),
                    got.get(key),
                    "{}: diagnostic {index}, `{key}`",
                    path.display()
                );
            }
        }
    }
}

#[test]
fn every_fail_fixture_has_exactly_the_expected_diagnostics() {
    let names = fixture_names("fail", ".mtek");
    assert!(names.len() >= 40, "fixtures are missing: {names:?}");
    for name in &names {
        let parsed = parse_fixture("fail", name);
        assert!(
            !parsed.diagnostics.is_empty(),
            "fail/{name}.mtek produces no diagnostics"
        );
        for d in &parsed.diagnostics {
            let span = d.primary.as_ref().unwrap().span;
            assert!(
                span.start <= span.end && span.end as usize <= parsed.text.len(),
                "fail/{name}.mtek: {d:?} is outside the text"
            );
        }
        let json = diagnostics_json(&format!("{name}.mtek"), &parsed);
        check_diagnostics(
            &syntax_dir().join("fail").join(format!("{name}.diag.json")),
            &json,
        );
    }
}

#[test]
fn every_fail_fixture_has_a_source_and_every_expectation_a_fixture() {
    let sources = fixture_names("fail", ".mtek");
    let expectations = fixture_names("fail", ".diag.json");
    assert_eq!(
        sources, expectations,
        "fail/: unmatched .mtek or .diag.json"
    );
}

#[test]
fn a_single_mistake_is_a_single_error() {
    // Recovery: nothing after the first error of a construct is a cascade
    // (`spec/testing.md` 3.2). Fixtures named `recovery_*` hold several
    // independent mistakes and list all of them; every other fail fixture is
    // one mistake, which must give one error (and perhaps warnings).
    for name in fixture_names("fail", ".mtek") {
        if name.starts_with("recovery_") {
            continue;
        }
        let parsed = parse_fixture("fail", &name);
        let errors = parsed
            .diagnostics
            .iter()
            .filter(|d| d.severity == mtek_compiler::diagnostics::Severity::Error)
            .count();
        assert!(
            errors <= 1,
            "fail/{name}.mtek: one mistake, at most one error, got {errors}"
        );
    }
}

#[test]
fn every_syntax_code_has_a_fail_fixture() {
    // `spec/testing.md` 3.2: every diagnostic code needs at least one
    // negative fixture. These are the codes the parser reports.
    let mut seen = BTreeSet::new();
    for name in fixture_names("fail", ".mtek") {
        for d in parse_fixture("fail", &name).diagnostics {
            seen.insert(d.code.short());
        }
    }
    for code in [
        "E1001", "E1002", "E1003", "E1004", "E1010", "E1011", "E1020", "E1030", "E1040", "E1050",
        "E1901", "E4901", "E0013", "W0007",
    ] {
        assert!(
            seen.contains(code),
            "no fail fixture produces {code}: {seen:?}"
        );
    }
}

// ---------------------------------------------------------------------------
// AST goldens
// ---------------------------------------------------------------------------

/// One case of an expression file.
struct Case {
    remark: String,
    no_desc: bool,
    source: String,
}

fn split_cases(text: &str) -> Vec<Case> {
    let mut cases: Vec<Case> = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("---") {
            let rest = rest.trim();
            let no_desc = rest.starts_with("no-desc");
            let remark = rest
                .strip_prefix("no-desc")
                .unwrap_or(rest)
                .trim_start_matches(':')
                .trim()
                .to_owned();
            cases.push(Case {
                remark,
                no_desc,
                source: String::new(),
            });
        } else {
            let case = cases
                .last_mut()
                .expect("an expression fixture starts with a `---` line");
            if !case.source.is_empty() {
                case.source.push('\n');
            }
            case.source.push_str(line);
        }
    }
    cases
}

/// The diagnostic and candidate edit lines of a golden file.
fn diagnostic_lines(
    out: &mut String,
    source: &str,
    diagnostics: &[Diagnostic],
    edits: &[CandidateEdit],
) {
    for d in diagnostics {
        let span = d.primary.as_ref().map(|label| label.span).unwrap();
        let _ = writeln!(
            out,
            "; {} {}..{} `{}` {}",
            d.code,
            span.start,
            span.end,
            source.get(span.range()).unwrap(),
            d.message
        );
    }
    for candidate in edits {
        let edits: Vec<String> = candidate
            .edit
            .edits
            .iter()
            .map(|edit| {
                format!(
                    "{:?} at {}..{}",
                    edit.replacement, edit.span.start, edit.span.end
                )
            })
            .collect();
        let _ = writeln!(out, "; edit {} {}", candidate.code, edits.join(", "));
    }
}

/// The result of one expression case: the golden text and whether it had
/// diagnostics.
fn run_case(case: &Case) -> (String, bool) {
    let source = case.source.as_str();
    let mut lexed = lex_str(FileId(0), source);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = if case.no_desc {
        parse_expression_no_desc(source, &lexed.tokens, &mut sink)
    } else {
        parse_expression(source, &lexed.tokens, &mut sink)
    };
    let report = sink.finish();

    let mut out = String::new();
    if !case.remark.is_empty() {
        let _ = writeln!(out, ";; {}", case.remark);
    }
    if case.no_desc {
        out.push_str("; [no-desc]\n");
    }
    for line in source.split('\n') {
        let _ = writeln!(out, "; {line}");
    }
    out.push_str(&dump_expr(&parsed.expr));
    diagnostic_lines(
        &mut out,
        source,
        &report.diagnostics,
        &parsed.candidate_edits,
    );

    if report.diagnostics.is_empty() {
        check_expr_invariants(source, &parsed.expr, parsed.node_count);
    }
    (out, !report.diagnostics.is_empty())
}

fn check_expr_invariants(source: &str, expr: &mtek_compiler::syntax::ast::Expr, node_count: u32) {
    let mut ids = Vec::new();
    walk_expr(expr, &mut |info, parent| {
        ids.push(info.id.0);
        assert!(
            info.span.end as usize <= source.len(),
            "{source:?}: {info:?} is outside the text"
        );
        if let Some(parent) = parent {
            assert!(
                parent.id > info.id,
                "{source:?}: children are numbered first"
            );
            assert!(
                parent.span.contains_span(info.span),
                "{source:?}: {info:?} is outside its parent {parent:?}"
            );
        }
    });
    ids.sort_unstable();
    assert_eq!(
        ids,
        (0..node_count).collect::<Vec<_>>(),
        "{source:?}: ids are dense"
    );
}

/// The golden text of a whole module file.
fn module_golden(name: &str) -> (String, bool) {
    let parsed = parse_fixture("ast", name);
    let mut out = dump_module(&parsed.module);
    diagnostic_lines(&mut out, &parsed.text, &parsed.diagnostics, &parsed.edits);
    if parsed.diagnostics.is_empty() {
        check_module_invariants(name, &parsed);
    }
    (out, !parsed.diagnostics.is_empty())
}

#[test]
fn every_ast_fixture_matches_its_golden() {
    let names = fixture_names("ast", ".mtek");
    assert!(names.len() >= 20, "fixtures are missing: {names:?}");
    let dir = syntax_dir().join("ast");
    let mut modules = 0;
    for name in &names {
        let text = fs::read_to_string(dir.join(format!("{name}.mtek"))).unwrap();
        let (golden, any_diagnostics) = if text.starts_with("---") {
            let cases = split_cases(&text);
            assert!(!cases.is_empty(), "{name}: no cases");
            let mut golden = String::new();
            let mut any_diagnostics = false;
            for (index, case) in cases.iter().enumerate() {
                if index > 0 {
                    golden.push('\n');
                }
                let (text, had_diagnostics) = run_case(case);
                golden.push_str(&text);
                any_diagnostics |= had_diagnostics;
            }
            (golden, any_diagnostics)
        } else {
            modules += 1;
            module_golden(name)
        };
        assert_eq!(
            any_diagnostics,
            name.starts_with("fail_"),
            "{name}: fixture naming and diagnostics disagree"
        );
        check_golden(&dir.join(format!("{name}.ast")), &golden);
    }
    assert!(modules >= 8, "whole-module fixtures are missing");
}

#[test]
fn every_ast_golden_has_a_source() {
    assert_eq!(
        fixture_names("ast", ".mtek"),
        fixture_names("ast", ".ast"),
        "ast/: unmatched .mtek or .ast"
    );
}

#[test]
fn every_pair_of_precedence_levels_has_a_case() {
    // The operators of the table of `spec/language.md` 6.1 that can meet in a
    // binary expression, loosest first; unary and postfix operators are
    // covered by `precedence_unary_postfix.mtek`.
    let levels = ["||", "&&", "==", "<", "+", "*"];
    let text = fs::read_to_string(syntax_dir().join("ast/precedence_pairs.mtek")).unwrap();
    let sources: Vec<String> = split_cases(&text).into_iter().map(|c| c.source).collect();
    for (i, loose) in levels.iter().enumerate() {
        for tight in &levels[i + 1..] {
            for source in [
                format!("a {loose} b {tight} c"),
                format!("a {tight} b {loose} c"),
            ] {
                assert!(sources.contains(&source), "no case for `{source}`");
            }
        }
    }
}

#[test]
fn three_independent_errors_are_three_diagnostics() {
    // The acceptance criterion of M1-05: independent mistakes in one file
    // are all reported, once each, and nothing is a cascade.
    let parsed = parse_fixture("fail", "recovery_three_independent_errors");
    let codes: Vec<&str> = parsed.diagnostics.iter().map(|d| d.code.short()).collect();
    assert_eq!(
        codes,
        ["E1001", "E1001", "E1003"],
        "{:?}",
        parsed.diagnostics
    );
}

#[test]
fn every_mtek_example_of_the_specification_is_in_the_corpus() {
    // Every ```mtek block of the specification must be (part of) a pass
    // fixture, so that an example added to the specification is parsed. The
    // placeholders `{ … }` of the examples that elide code are written as
    // `{ }` in the fixtures.
    let corpus: Vec<String> = fixture_names("pass", ".mtek")
        .into_iter()
        .map(|name| {
            fs::read_to_string(syntax_dir().join("pass").join(format!("{name}.mtek"))).unwrap()
        })
        .collect();
    let spec = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec");
    let mut files: Vec<PathBuf> = fs::read_dir(spec)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "md"))
        .collect();
    files.sort();
    let mut blocks = 0;
    let fence = "```mtek\n";
    for file in files {
        let text = fs::read_to_string(&file).unwrap().replace("\r\n", "\n");
        let mut rest = text.as_str();
        while let Some(start) = rest.find(fence) {
            let body = &rest[start + fence.len()..];
            let end = body.find("```").unwrap();
            let block = body[..end].replace("{ … }", "{ }");
            assert!(
                !block.contains('…'),
                "{}: unknown placeholder",
                file.display()
            );
            assert!(
                corpus.iter().any(|fixture| fixture.contains(&block)),
                "{}: this example is in no tests/syntax/pass fixture:\n{block}",
                file.display()
            );
            blocks += 1;
            rest = &body[end..];
        }
    }
    assert!(blocks >= 10, "{blocks} examples found");
}

// ---------------------------------------------------------------------------
// Production coverage
// ---------------------------------------------------------------------------

/// The productions of `spec/grammar.ebnf` that a positive fixture exercises:
/// `pass/<Production>.mtek` must exist for each. (`tools/grammar-coverage` is
/// M2; until then this test is the check.)
const POSITIVE_PRODUCTIONS: &[&str] = &[
    // 1. Lexical grammar
    "Whitespace",
    "LineComment",
    "BlockComment",
    "Ident",
    "IdentStart",
    "IdentContinue",
    "Keyword",
    "Int",
    "Float",
    "IntPart",
    "Exponent",
    "String",
    "StringChar",
    "Escape",
    "Color",
    "Hex",
    "Bool",
    // 2. Modules and items
    "Module",
    "Item",
    "Import",
    "ConstDecl",
    "FnDecl",
    "ParamList",
    "Param",
    "StructDecl",
    "StructField",
    // 3. Materials
    "MaterialDecl",
    "MaterialMember",
    "ParamDecl",
    "StageFn",
    // 4. Scenes, entities, prefabs
    "SceneDecl",
    "SceneMember",
    "PrefabDecl",
    "EntityDecl",
    "EntityMember",
    "SceneObject",
    "StateDecl",
    "FieldInit",
    "FieldValue",
    "LifecycleFn",
    "Handler",
    "HandlerArgs",
    "HandlerArg",
    // 5. Types
    "Type",
    "ArrayLength",
    // 6. Statements
    "Block",
    "Statement",
    "LetStmt",
    "VarStmt",
    "SimpleStmt",
    "AssignOp",
    "IfStmt",
    "ForStmt",
    "ReturnStmt",
    "BreakStmt",
    "ContinueStmt",
    // 7. Expressions
    "Expr",
    "OrExpr",
    "AndExpr",
    "EqExpr",
    "RelExpr",
    "AddExpr",
    "MulExpr",
    "UnaryExpr",
    "PostfixExpr",
    "PostfixOp",
    "ArgList",
    "Primary",
    "ArrayLiteral",
    "DescriptorLiteral",
    "DescField",
    "ExprNoDesc",
];

/// Productions that only have negative fixtures: the words reserved for
/// future use are rejected wherever they would be a name (`E0013`).
const NEGATIVE_PRODUCTIONS: &[(&str, &str)] = &[("Reserved", "E0013")];

/// The names of the productions defined in `spec/grammar.ebnf`.
fn grammar_productions() -> Vec<String> {
    let text =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/grammar.ebnf"))
            .unwrap();
    let mut names = Vec::new();
    for line in text.lines() {
        // `Name   ::= ...` at the start of a line, in the grammar proper.
        let Some((head, _)) = line.split_once("::=") else {
            continue;
        };
        let head = head.trim();
        if !head.is_empty()
            && !line.starts_with(char::is_whitespace)
            && head.chars().all(|c| c.is_ascii_alphanumeric())
        {
            names.push(head.to_owned());
        }
    }
    names
}

#[test]
fn the_production_list_is_the_production_list_of_the_grammar() {
    let mut listed: Vec<String> = POSITIVE_PRODUCTIONS
        .iter()
        .copied()
        .chain(NEGATIVE_PRODUCTIONS.iter().map(|&(name, _)| name))
        .map(str::to_owned)
        .collect();
    listed.sort();
    let mut grammar = grammar_productions();
    grammar.sort();
    assert_eq!(
        listed, grammar,
        "the constant list and spec/grammar.ebnf disagree: a production was added or removed"
    );
}

#[test]
fn every_production_has_a_fixture() {
    let pass: BTreeSet<String> = fixture_names("pass", ".mtek").into_iter().collect();
    let missing: Vec<&str> = POSITIVE_PRODUCTIONS
        .iter()
        .copied()
        .filter(|name| !pass.contains(*name))
        .collect();
    assert!(
        missing.is_empty(),
        "no tests/syntax/pass/<Production>.mtek for: {missing:?}"
    );
    for &(production, code) in NEGATIVE_PRODUCTIONS {
        let found = fixture_names("fail", ".mtek").into_iter().any(|name| {
            parse_fixture("fail", &name)
                .diagnostics
                .iter()
                .any(|d| d.code.short() == code)
        });
        assert!(found, "no fail fixture produces {code} for {production}");
    }
}

// ---------------------------------------------------------------------------
// Programs that exist elsewhere in the repository
// ---------------------------------------------------------------------------

/// Every `.mtek` file under `dir`, in sorted order.
fn mtek_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            if path.file_name().is_some_and(|n| n != "node_modules") {
                mtek_files(&path, out);
            }
        } else if path.extension().is_some_and(|ext| ext == "mtek") {
            out.push(path);
        }
    }
}

#[test]
fn the_benchmark_programs_parse() {
    // The starters and the reference solutions of `benchmarks/tasks`
    // (hand-written, never compiled until now). The holdout set is not used
    // while designing syntax (`spec/ai-and-benchmarks.md`) and is not read
    // here.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/tasks");
    let mut files = Vec::new();
    mtek_files(&root, &mut files);
    assert!(
        files.len() >= 8,
        "benchmark programs are missing: {files:?}"
    );
    let mut items = 0;
    for path in files {
        let text = fs::read_to_string(&path).unwrap();
        let mut lexed = lex_str(FileId(0), &text);
        let mut sink = Diagnostics::new();
        lexed.report_into(&mut sink);
        let parsed = parse_module(&text, &lexed.tokens, &lexed.trivia, &mut sink);
        let report = sink.finish();
        assert!(
            report.diagnostics.is_empty(),
            "{}: {:?}",
            path.display(),
            report
                .diagnostics
                .iter()
                .map(|d| (d.code.short(), d.message.clone()))
                .collect::<Vec<_>>()
        );
        items += parsed.module.items.len();
    }
    // The starters are comments; the reference solutions are scenes.
    assert!(items >= 4, "{items} items");
}
