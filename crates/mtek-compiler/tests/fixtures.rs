//! The compiler fixture runner for `tests/syntax/` and `tests/semantics/`
//! (`spec/testing.md` section 3.1,
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
//! (`lexer_fixtures.rs`). The semantic suites, `tests/semantics/pass/<name>/`
//! and `tests/semantics/fail/<name>/` (a project directory with `mtek.toml`
//! and an exact `expected.diag.json`), are described where their tests start,
//! below the syntax tests.
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

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::{Code, Diagnostic, Diagnostics, Severity, to_report};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::{Construct, IMPLEMENTED_MILESTONE, construct_gate, resolve_module};
use mtek_compiler::source::{FileId, MemFs, ProjectPath, SourceMap};
use mtek_compiler::stdlib::{ColorValue, Milestone};
use mtek_compiler::syntax::ast::Module;
use mtek_compiler::syntax::{
    CandidateEdit, dump_expr, dump_module, lex, lex_str, parse_expression,
    parse_expression_no_desc, parse_module, walk_expr, walk_module,
};
use mtek_compiler::types::scene::MAX_STATIC_ENTITIES;
use mtek_compiler::types::{CheckedEntity, CheckedField, CheckedScene, ConstValue};
use mtek_compiler::{CheckResult, check};
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
/// primary span and message of each exactly, and `expected`, `actual`,
/// `related`, `notes` and `candidateEdits` when the expected diagnostic has
/// them.
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
        for key in ["expected", "actual", "related", "notes", "candidateEdits"] {
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

// ---------------------------------------------------------------------------
// Semantic fixtures (`tests/semantics/`)
// ---------------------------------------------------------------------------
//
// A semantic fixture is a directory: `mtek.toml`, the sources (`src/main.mtek`
// unless the project file says otherwise) and `expected.diag.json`. Every
// file of the directory except `expected.diag.json` is put into an in-memory
// file system rooted at the directory, and the project is checked with
// `mtek_compiler::check`.
//
// * `pass/<name>/` must check with zero errors; warnings, if any, are listed
//   in `expected.diag.json`, which is absent when there are no diagnostics.
// * `fail/<name>/` must report at least one error, and its diagnostics must
//   match `expected.diag.json` exactly (code, file, primary span, message and
//   order; `related` and `notes` when the expected diagnostic has them).
//
// Fixtures named `gate_*` hold constructs this build does not implement
// (`E9010`); a test below checks that every gated construct of the
// resolver's table has one.

/// The file that holds a semantic fixture's expected diagnostics.
const EXPECTED: &str = "expected.diag.json";

fn semantics_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/semantics")
}

/// The fixture directories of `suite` (`pass` or `fail`), in sorted order.
fn semantic_fixtures(suite: &str) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(semantics_dir().join(suite))
        .unwrap_or_else(|e| panic!("cannot list tests/semantics/{suite}: {e}"))
        .filter_map(|entry| {
            let entry = entry.ok()?;
            entry.file_type().ok()?.is_dir().then_some(())?;
            entry.file_name().into_string().ok()
        })
        .collect();
    names.sort();
    names
}

/// Every file under `dir` except the expected diagnostics, with its path
/// relative to the fixture root, in sorted order.
fn fixture_files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            fixture_files(root, &path, out);
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .unwrap()
            .components()
            .map(|c| c.as_os_str().to_str().unwrap().to_owned())
            .collect::<Vec<_>>()
            .join("/");
        if relative != EXPECTED {
            out.push((relative, fs::read(&path).unwrap()));
        }
    }
}

/// The in-memory project of the fixture `<suite>/<name>`.
fn fixture_fs(suite: &str, name: &str, shuffle: Option<u64>) -> MemFs {
    let root = semantics_dir().join(suite).join(name);
    let mut files = Vec::new();
    fixture_files(&root, &root, &mut files);
    let mut memory = match shuffle {
        Some(seed) => MemFs::new().with_shuffled_listing(seed),
        None => MemFs::new(),
    };
    for (path, bytes) in files {
        memory.insert(ProjectPath::new(&path).unwrap(), bytes);
    }
    memory
}

/// Check the fixture `<suite>/<name>`.
fn check_fixture(suite: &str, name: &str) -> CheckResult {
    check(&ProjectRoot::at_base(), &fixture_fs(suite, name, None))
}

/// The project-relative path of `file`.
fn path_of(result: &CheckResult, file: FileId) -> Value {
    result
        .project
        .as_ref()
        .and_then(|project| project.sources.get(file))
        .map_or(Value::Null, |source| source.path().as_str().into())
}

/// The `expected.diag.json` content of a check result.
fn semantic_json(result: &CheckResult) -> String {
    let items: Vec<Value> = result
        .report
        .diagnostics
        .iter()
        .map(|d| {
            let mut object = Map::new();
            object.insert("code".into(), d.code.as_str().into());
            let span = d.primary.as_ref().map(|label| label.span);
            object.insert(
                "file".into(),
                span.map_or(Value::Null, |s| path_of(result, s.file)),
            );
            object.insert(
                "startByte".into(),
                span.map_or(Value::Null, |s| s.start.into()),
            );
            object.insert("endByte".into(), span.map_or(Value::Null, |s| s.end.into()));
            object.insert("message".into(), d.message.as_str().into());
            if let Some(expected) = &d.expected {
                object.insert("expected".into(), expected.as_str().into());
            }
            if let Some(actual) = &d.actual {
                object.insert("actual".into(), actual.as_str().into());
            }
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
                        related.insert("file".into(), path_of(result, label.span.file));
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
            Value::Object(object)
        })
        .collect();
    let mut text = serde_json::to_string_pretty(&Value::Array(items)).unwrap();
    text.push('\n');
    text
}

fn error_count(result: &CheckResult) -> usize {
    result
        .report
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .count()
}

/// The report of `result` must be valid against `spec/diagnostic.schema.json`
/// (`spec/diagnostics.md` 2.2: every golden diagnostic fixture is validated).
fn assert_report_schema_valid(label: &str, result: &CheckResult) {
    let schema: Value =
        serde_json::from_str(include_str!("../../../spec/diagnostic.schema.json")).unwrap();
    let validator = jsonschema::draft202012::new(&schema).unwrap();
    let empty = SourceMap::new();
    let map = result.project.as_ref().map_or(&empty, |p| &p.sources);
    let json = to_report(&result.report, None, map);
    let problems: Vec<String> = validator
        .iter_errors(&json)
        .map(|e| format!("{e} at {}", e.instance_path()))
        .collect();
    assert!(problems.is_empty(), "{label}: {problems:#?}");
}

/// The checked entry scene of `result`.
fn entry_scene(result: &CheckResult) -> &CheckedScene {
    let (Some(resolution), Some(types)) = (&result.resolution, &result.types) else {
        panic!("the project was not checked")
    };
    resolution
        .entry_scene()
        .and_then(|def| types.scene(def))
        .expect("a checked entry scene")
}

/// A program without errors has a complete checked entry scene, which the
/// typed IR is built from: every field has a value and exactly one camera
/// is active.
fn assert_complete_scene(label: &str, result: &CheckResult) {
    fn entity_complete(entity: &CheckedEntity) -> bool {
        entity.fields.iter().all(|f| f.value.is_some())
            && entity.children.iter().all(entity_complete)
    }
    let scene = entry_scene(result);
    assert!(
        scene.fields.iter().all(|f| f.value.is_some())
            && scene
                .objects
                .iter()
                .all(|o| o.fields.iter().all(|f| f.value.is_some()))
            && scene.entities.iter().all(entity_complete),
        "{label}: a checked field has no value: {scene:#?}"
    );
    assert_eq!(
        scene.objects.iter().filter(|o| o.active).count(),
        1,
        "{label}: not exactly one active camera"
    );
}

#[test]
fn every_semantic_pass_fixture_checks_without_errors() {
    let names = semantic_fixtures("pass");
    assert!(names.len() >= 5, "fixtures are missing: {names:?}");
    for name in &names {
        let result = check_fixture("pass", name);
        let json = semantic_json(&result);
        assert_eq!(
            error_count(&result),
            0,
            "semantics/pass/{name} has errors:\n{json}"
        );
        assert!(
            result.resolution.is_some(),
            "semantics/pass/{name} was not resolved"
        );
        assert!(
            result
                .resolution
                .as_ref()
                .is_some_and(|r| r.entry_scene().is_some()),
            "semantics/pass/{name} has no entry scene"
        );
        assert_complete_scene(&format!("pass/{name}"), &result);
        let expected = semantics_dir().join("pass").join(name).join(EXPECTED);
        if result.report.diagnostics.is_empty() {
            assert!(
                !expected.exists(),
                "semantics/pass/{name}: {EXPECTED} lists diagnostics, but there are none"
            );
        } else {
            check_diagnostics(&expected, &json);
        }
        assert_report_schema_valid(&format!("pass/{name}"), &result);
    }
}

#[test]
fn every_semantic_fail_fixture_has_exactly_the_expected_diagnostics() {
    let names = semantic_fixtures("fail");
    assert!(names.len() >= 30, "fixtures are missing: {names:?}");
    for name in &names {
        let result = check_fixture("fail", name);
        assert!(
            error_count(&result) > 0,
            "semantics/fail/{name} reports no error"
        );
        let json = semantic_json(&result);
        check_diagnostics(
            &semantics_dir().join("fail").join(name).join(EXPECTED),
            &json,
        );
        assert_report_schema_valid(&format!("fail/{name}"), &result);
    }
}

#[test]
fn every_semantic_fixture_directory_is_a_project() {
    for suite in ["pass", "fail"] {
        for name in semantic_fixtures(suite) {
            let dir = semantics_dir().join(suite).join(&name);
            assert!(
                dir.join("mtek.toml").is_file(),
                "semantics/{suite}/{name} has no mtek.toml"
            );
            if suite == "fail" {
                assert!(
                    dir.join(EXPECTED).is_file(),
                    "semantics/fail/{name} has no {EXPECTED}"
                );
            }
        }
    }
}

#[test]
fn semantic_results_are_deterministic() {
    // The same fixture checked twice, and with shuffled directory listings,
    // gives identical diagnostics (`spec/compiler-architecture.md` 5).
    for suite in ["pass", "fail"] {
        for name in semantic_fixtures(suite) {
            let first = semantic_json(&check_fixture(suite, &name));
            let second = semantic_json(&check_fixture(suite, &name));
            assert_eq!(first, second, "{suite}/{name}");
            for seed in [1, 2, 3] {
                let memory = fixture_fs(suite, &name, Some(seed));
                let shuffled = semantic_json(&check(&ProjectRoot::at_base(), &memory));
                assert_eq!(first, shuffled, "{suite}/{name} with seed {seed}");
            }
        }
    }
}

#[test]
fn semantic_pass_fixtures_fold_their_constants() {
    // Every constant of the typed-constants fixture is folded, and the
    // fixture's values are the exact results (`tests/consteval_goldens.rs`
    // has the bit-pattern table).
    let result = check_fixture("pass", "typed_constants");
    let (Some(resolution), Some(types)) = (&result.resolution, &result.types) else {
        panic!("typed_constants was not checked");
    };
    let mut constants = 0;
    for def in resolution.defs() {
        if def.kind == mtek_compiler::resolve::DefKind::Const {
            let info = types.const_info(def.id).unwrap();
            assert!(info.value.is_some(), "{} was not folded", def.name);
            constants += 1;
        }
    }
    assert_eq!(constants, 9);
}

fn srgb(r: u8, g: u8, b: u8) -> ConstValue {
    ConstValue::Color(ColorValue::from_srgb8(r, g, b, 255).linear)
}

fn descriptor(name: &str, fields: &[(&str, ConstValue)]) -> ConstValue {
    ConstValue::Struct {
        name: name.to_owned(),
        fields: fields
            .iter()
            .map(|(n, v)| ((*n).to_owned(), v.clone()))
            .collect(),
    }
}

fn value_of<'a>(fields: &'a [CheckedField], name: &str) -> Option<&'a ConstValue> {
    fields
        .iter()
        .find(|f| f.name == name)
        .and_then(|f| f.value.as_ref())
}

#[test]
fn pass_scene_a_target_camera_and_unlit_box() {
    // M1-11 pass scene A: one camera with a target, one `Box` with `Unlit`.
    let result = check_fixture("pass", "scene_a_target_camera_box");
    let scene = entry_scene(&result);
    assert_eq!(scene.name, "Gallery");
    assert_eq!(
        value_of(&scene.fields, "clear_color"),
        Some(&srgb(0x20, 0x28, 0x30))
    );
    let camera = scene.active_object("camera").expect("an active camera");
    assert_eq!(
        value_of(&camera.fields, "target"),
        Some(&ConstValue::Vec3([0.0, 0.5, 0.0]))
    );
    assert_eq!(
        value_of(&camera.fields, "projection"),
        Some(&descriptor(
            "Perspective",
            &[
                ("fov_y", ConstValue::F32(0.9)),
                ("near", ConstValue::F32(0.1)),
                ("far", ConstValue::F32(1000.0)),
            ]
        ))
    );
    let [crate_entity] = scene.entities.as_slice() else {
        panic!("one entity expected")
    };
    assert!(crate_entity.children.is_empty());
    assert_eq!(
        value_of(&crate_entity.fields, "mesh"),
        Some(&descriptor("Box", &[("size", ConstValue::Vec3([1.0; 3]))]))
    );
    assert_eq!(
        value_of(&crate_entity.fields, "material"),
        Some(&descriptor("Unlit", &[("color", srgb(0x6b, 0x5c, 0xff))]))
    );
}

#[test]
fn pass_scene_b_orthographic_camera_and_nested_entities() {
    // M1-11 pass scene B: an orthographic camera with a rotation, a `Sphere`
    // and a `Plane`, a nested child with non-uniform positive scale, module
    // constants in fields, defaults filled in.
    let result = check_fixture("pass", "scene_b_orthographic_nested");
    let scene = entry_scene(&result);
    let camera = scene.active_object("camera").expect("an active camera");
    assert!(camera.field("target").is_none());
    assert!(matches!(
        value_of(&camera.fields, "rotation"),
        Some(ConstValue::Quat(_))
    ));
    assert_eq!(
        value_of(&camera.fields, "projection"),
        Some(&descriptor(
            "Orthographic",
            &[
                ("height", ConstValue::F32(20.0)),
                ("near", ConstValue::F32(0.5)),
                ("far", ConstValue::F32(40.0)),
            ]
        ))
    );
    let [ground, lamp] = scene.entities.as_slice() else {
        panic!("two root entities expected")
    };
    assert_eq!(
        value_of(&ground.fields, "mesh"),
        Some(&descriptor(
            "Plane",
            &[("size", ConstValue::Vec2([20.0; 2]))]
        ))
    );
    let [fountain] = ground.children.as_slice() else {
        panic!("one child expected")
    };
    assert_eq!(fountain.name, "Fountain");
    assert_eq!(
        value_of(&fountain.fields, "scale"),
        Some(&ConstValue::Vec3([2.0, 0.5, 2.0]))
    );
    assert_eq!(
        value_of(&fountain.fields, "mesh"),
        Some(&descriptor(
            "Sphere",
            &[
                ("radius", ConstValue::F32(1.0)),
                ("segments", ConstValue::U32(24)),
                ("rings", ConstValue::U32(12)),
            ]
        ))
    );
    assert_eq!(
        value_of(&fountain.fields, "material"),
        Some(&descriptor("Unlit", &[("color", srgb(0xff, 0xcc, 0x00))]))
    );
    // `Sphere {}` and the default material, every field at its default.
    assert_eq!(
        value_of(&lamp.fields, "mesh"),
        Some(&descriptor(
            "Sphere",
            &[
                ("radius", ConstValue::F32(0.5)),
                ("segments", ConstValue::U32(32)),
                ("rings", ConstValue::U32(16)),
            ]
        ))
    );
    assert_eq!(
        value_of(&lamp.fields, "material"),
        Some(&descriptor("Unlit", &[("color", srgb(0xff, 0xff, 0xff))]))
    );
    let order: Vec<&str> = scene
        .entities_in_order()
        .iter()
        .map(|e| e.name.as_str())
        .collect();
    assert_eq!(order, ["Ground", "Fountain", "Lamp"]);
}

#[test]
fn too_many_static_entities_is_e5092() {
    // `spec/compiler-architecture.md` 9: at most 16 384 static entities per
    // scene, nested ones included. Generated rather than a fixture file: a
    // project of 16 385 entities is too large to review.
    let program = |roots: usize, extra: bool| {
        let mut text = String::from("scene Demo {\n    camera Main {}\n");
        for index in 0..roots {
            text.push_str(&format!("    entity R{index} {{ entity C{index} {{}} }}\n"));
        }
        if extra {
            text.push_str("    entity Extra {}\n");
        }
        text.push_str("}\n");
        text
    };
    let run = |text: String| {
        let mut memory = MemFs::new();
        memory
            .insert(
                ProjectPath::new("mtek.toml").unwrap(),
                "[project]\nname = \"fixture\"\nlanguage = \"0.1\"\n",
            )
            .insert(ProjectPath::new("src/main.mtek").unwrap(), text.clone());
        (check(&ProjectRoot::at_base(), &memory), text)
    };
    let (at_limit, _) = run(program(MAX_STATIC_ENTITIES / 2, false));
    assert!(
        at_limit.report.diagnostics.is_empty(),
        "{}",
        semantic_json(&at_limit)
    );
    let (over, text) = run(program(MAX_STATIC_ENTITIES / 2, true));
    let found: Vec<(&str, &str, &str)> = over
        .report
        .diagnostics
        .iter()
        .map(|d| {
            let span = d.primary.as_ref().unwrap().span;
            (
                d.code.short(),
                text.get(span.range()).unwrap(),
                d.message.as_str(),
            )
        })
        .collect();
    assert_eq!(
        found,
        [(
            "E5092",
            "Extra",
            "Scene 'Demo' declares 16385 static entities, but at most 16384 are allowed."
        )]
    );
}

/// The `E9010` messages of every `gate_*` fail fixture.
fn gate_messages() -> Vec<(String, String)> {
    let mut messages = Vec::new();
    for name in semantic_fixtures("fail") {
        if !name.starts_with("gate_") {
            continue;
        }
        for d in check_fixture("fail", &name).report.diagnostics {
            if d.code == Code::E9010 {
                messages.push((name.clone(), d.message));
            }
        }
    }
    messages
}

#[test]
fn every_gated_construct_has_a_gating_fixture() {
    // Acceptance criterion of M1-09: every gated construct produces `E9010`
    // naming its planned milestone. One `gate_*` fixture per construct of the
    // table that this build does not implement, and per kind of registry
    // item.
    let messages = gate_messages();
    let produced = |prefix: &str, milestone: &str| {
        let ending = format!("(planned for {milestone}).");
        messages
            .iter()
            .any(|(_, message)| message.starts_with(prefix) && message.ends_with(&ending))
    };
    let mut gated = 0;
    for construct in Construct::ALL {
        let gate = construct_gate(construct);
        if gate.since.is_reached_by(IMPLEMENTED_MILESTONE) {
            continue;
        }
        gated += 1;
        // The subject may be followed by detail: "Event handlers (`on
        // key_down`) are specified …".
        assert!(
            produced(gate.subject, gate.since.as_str()),
            "no gate_* fixture reports {construct:?}: {messages:#?}"
        );
    }
    assert!(gated >= 16, "{gated} gated constructs");
    // Registry items, by kind (each message names the item and its `since`).
    for (prefix, milestone) in [
        ("The built-in type `mat4`", "M2"),
        ("The built-in function `sin`", "M2"),
        ("The built-in namespace `frame`", "M3"),
        ("The built-in enum `Key`", "M3"),
        ("The built-in schema `Pbr`", "M4"),
        ("The `Entity` field `light`", "M4"),
        ("The `Scene` field `gravity`", "M5"),
        ("Event handlers (`on collision_enter`)", "M5"),
    ] {
        assert!(
            produced(prefix, milestone),
            "no gate_* fixture reports {prefix}: {messages:#?}"
        );
    }
}

#[test]
fn registry_gates_without_a_fixture_are_unreachable_in_this_build() {
    // Scene-object kinds and namespace/enum members are gated by their own
    // `since` too, but today no kind is later than M1 and no member is later
    // than its owner (whose own `E9010` covers it). When that changes, this
    // test fails as a reminder to add a `gate_*` fixture for it.
    let registry = mtek_compiler::stdlib::registry();
    let implemented = |m: Milestone| m.is_reached_by(IMPLEMENTED_MILESTONE);
    for kind in &registry.scene_objects {
        assert!(
            implemented(kind.since),
            "scene object kind {}",
            kind.keyword
        );
    }
    for namespace in &registry.namespaces {
        for member in &namespace.members {
            assert!(
                !implemented(namespace.since) || implemented(member.since()),
                "{}.{}",
                namespace.name,
                member.name()
            );
        }
    }
    for enumeration in &registry.enums {
        for member in &enumeration.members {
            assert!(
                !implemented(enumeration.since) || implemented(member.since),
                "{}.{}",
                enumeration.name,
                member.name
            );
        }
    }
}

#[test]
fn a_construct_inside_a_gated_construct_is_not_reported_again() {
    // The outermost unimplemented construct is reported once; what it
    // contains is not gated again (no cascades), but its names are still
    // resolved.
    let result = check_fixture("fail", "gate_nested_reported_once");
    let codes: Vec<&str> = result
        .report
        .diagnostics
        .iter()
        .map(|d| d.code.short())
        .collect();
    assert_eq!(codes, ["E9010", "E2003"], "{}", semantic_json(&result));
}

#[test]
fn the_syntax_corpus_resolves_without_panicking() {
    // Every file of the syntax corpus, including the erroneous ones whose
    // trees are full of `Error` nodes, goes through name resolution; nothing
    // panics and every reported span lies inside its file.
    for (dir, extension) in [("pass", ".mtek"), ("fail", ".mtek"), ("ast", ".mtek")] {
        for name in fixture_names(dir, extension) {
            let parsed = parse_fixture(dir, &name);
            let mut sink = Diagnostics::new();
            let resolution = resolve_module(&parsed.module, &mut sink);
            for d in sink.finish().diagnostics {
                let span = d.primary.as_ref().map(|label| label.span).unwrap();
                assert!(
                    span.end as usize <= parsed.text.len(),
                    "{dir}/{name}: {d:?} is outside the text"
                );
                for related in &d.related {
                    assert!(related.span.end as usize <= parsed.text.len());
                }
            }
            for def in resolution.defs() {
                assert!(def.span.end as usize <= parsed.text.len());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Diagnostic-code coverage (`spec/testing.md` section 3.2)
// ---------------------------------------------------------------------------
//
// Every catalogue code needs at least one negative fixture. The expected
// files of the fixtures are compared with the compiler's output by the tests
// above, so the codes they list are exactly the codes the fixtures produce:
// `tests/syntax/lex/*.diag.json`, `tests/syntax/fail/*.diag.json`, the
// diagnostic lines of `tests/syntax/ast/*.ast` and
// `tests/semantics/{pass,fail}/*/expected.diag.json`. A catalogue code that no
// fixture produces must be listed below with its reason, and only then: the
// lists are exact, so a code that gains a fixture fails the test until it
// leaves its list. `NOT_YET_IMPLEMENTED` is the allow-list later milestones
// shrink; M7 requires it to be empty.

/// Codes this build does not report yet, with the milestone and work item
/// that implement them.
const NOT_YET_IMPLEMENTED: &[(&str, &str)] = &[
    ("W0030", "M6: the formatter's naming lint (`mtek fmt`)"),
    ("W2010", "M2-02: functions and statements"),
    ("E2030", "M2-03: imports"),
    ("E2031", "M2-03: imports"),
    ("E2032", "M2-03: imports"),
    ("E2033", "M2-03: imports"),
    ("E2034", "M2-03: imports"),
    ("E2035", "M2-03: imports"),
    ("E2036", "M2-03: imports"),
    ("E3012", "M2: equality operators (decision 0026)"),
    ("E3020", "M2-01: structs"),
    ("E3021", "M2-01: structs"),
    ("E3022", "M2-01: structs"),
    ("E3023", "M2-01: structs"),
    ("E3030", "M2: arrays"),
    ("E3031", "M2: arrays"),
    ("E3060", "M2-02: functions and statements"),
    ("E3061", "M2-02: functions and statements"),
    ("E3070", "M2-02: functions and statements"),
    ("E3080", "M2-02: functions and statements"),
    ("W3081", "M2-02: functions and statements"),
    ("E4001", "M2-02: functions and statements"),
    ("E4002", "M2-02: functions and statements"),
    ("W4003", "M2-02: functions and statements"),
    ("E4010", "M2-04: materials"),
    ("E4011", "M2-04: materials"),
    ("E4012", "M2-04: materials"),
    ("E4013", "M2-04: materials"),
    ("E4020", "M2-04: materials"),
    ("E4021", "M2-04: materials"),
    ("E4030", "M2-04: materials"),
    ("E4031", "M2-04: materials"),
    ("E4032", "M2-04: materials"),
    ("E4040", "M2-04: materials"),
    ("E4041", "M2-04: materials"),
    ("E5004", "M3-05: bind"),
    ("E5005", "M3-05: bind"),
    ("E5030", "M5: spawn and destroy"),
    ("E5040", "M5-01: prefabs"),
    ("E5041", "M5-01: prefabs"),
    ("E5042", "M5-01: prefabs"),
    ("E5050", "M3-02: lifecycle functions and handlers"),
    ("E5051", "M3-02: lifecycle functions and handlers"),
    ("E5052", "M3-02: lifecycle functions and handlers"),
    ("E5060", "M3-02: lifecycle functions and handlers"),
    ("E5061", "M3-02: lifecycle functions and handlers"),
    ("E5062", "M5: collision events"),
    ("E5070", "M3-05: bind"),
    ("E5071", "M5: physics"),
    ("E5072", "M5: physics"),
    ("E5073", "M3-02: field writes in handlers"),
    ("E5074", "M5: entity_ref"),
    ("E5075", "M3-05: bind"),
    ("E5080", "M5: spawn and destroy"),
    ("E5091", "M5: physics"),
    ("W5101", "M2-04: materials"),
    ("E5110", "M5: lights in prefabs"),
    ("E5111", "M4: lights"),
    (
        "E5901",
        "no v0.1 construct switches scenes (`spec/scenes.md` section 1)",
    ),
    ("E5902", "M2-04: materials"),
    ("E6001", "M2-04: materials"),
    ("E6002", "M2-04: materials"),
    ("E6003", "M2-04: materials"),
    ("E6100", "M2-04: materials (generated WGSL)"),
    ("E7010", "M4: assets"),
    ("E8011", "M3: run-time field writes"),
    ("W8030", "M2: arrays (run-time index clamping)"),
    ("E8030", "M5: spawn and destroy"),
    ("W8031", "M5: spawn and destroy"),
    ("W8032", "M5: spawn and destroy"),
    ("E8033", "M5: spawn and destroy"),
    ("E8041", "M3: host inputs (decision 0018)"),
    ("W8061", "M4-09: device-loss recovery (decision 0020)"),
    ("E8062", "M4-09: device-loss recovery (decision 0020)"),
    ("W8070", "M3: candidate-based hot reload"),
    ("E8080", "M6: preview builds"),
    ("E8090", "M3: run-time field writes"),
    ("E8100", "M3: run-time field writes and host inputs"),
    ("E9020", "M3: host inputs (decision 0018)"),
    ("E9021", "M3: host inputs (decision 0018)"),
    ("E9030", "M1: `mtek build` in the CLI"),
];

/// Codes this build implements that no program checked by this build can
/// produce, with the reason and the test file that covers them instead.
const UNREACHABLE_IN_THIS_BUILD: &[(&str, &str, &str)] = &[
    (
        "E5003",
        "no M1 schema has a required field (the first are the M5 colliders)",
        "src/types/scene_tests.rs",
    ),
    (
        "E9002",
        "imports are M2: a project this build checks has one module",
        "src/source/map.rs",
    ),
    (
        "E9999",
        "only a compiler defect produces it",
        "src/check.rs",
    ),
];

/// Codes a fixture cannot express (the bytes a fixture would need do not
/// survive `.gitattributes`, or the code concerns the project directory
/// itself), with the test file that covers them; that file must name the
/// code.
const COVERED_BY_OTHER_TESTS: &[(&str, &str)] = &[
    // Files the source manager rejects before they have an id; a carriage
    // return would not survive `.gitattributes` in a fixture file.
    ("E0001", "src/project/load/tests.rs"),
    ("E0002", "src/syntax/lexer_tests.rs"),
    ("E0003", "src/syntax/lexer_tests.rs"),
    ("E0004", "src/project/load/tests.rs"),
    // A fixture is a project directory with `mtek.toml`.
    ("E9004", "src/project/load/tests.rs"),
    // Too large to review as fixtures: more than 200 diagnostics in one
    // file, more than 16 384 entities (generated in this file).
    ("W9003", "src/diagnostics/sink.rs"),
    ("E5092", "tests/fixtures.rs"),
    // Runtime diagnostics: produced by `@mtek/runtime-web`, whose unit tests
    // are their fixtures (`spec/testing.md` section 2).
    ("E8001", "../../packages/runtime-web/src/gpu/device.test.ts"),
    ("E8002", "../../packages/runtime-web/src/gpu/device.test.ts"),
    ("E8003", "../../packages/runtime-web/src/abi/abi.test.ts"),
    ("E8004", "../../packages/runtime-web/src/gpu/device.test.ts"),
    ("E8005", "../../packages/runtime-web/src/gpu/device.test.ts"),
    ("E8006", "../../packages/runtime-web/src/abi/abi.test.ts"),
    ("E8040", "../../packages/runtime-web/src/host/app.test.ts"),
    ("E8050", "../../packages/runtime-web/src/host/app.test.ts"),
    (
        "E8051",
        "../../packages/runtime-web/src/host/shaders.test.ts",
    ),
    ("W8060", "../../packages/runtime-web/src/host/app.test.ts"),
    (
        "E8063",
        "../../packages/runtime-web/src/gpu/registry.test.ts",
    ),
];

/// The JSON diagnostics files of the fixture suites, and the codes in them.
fn fixture_codes() -> BTreeMap<String, BTreeSet<String>> {
    fn add_json(path: &Path, label: &str, out: &mut BTreeMap<String, BTreeSet<String>>) {
        let text = fs::read_to_string(path).unwrap();
        let items: Vec<Value> = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", path.display()));
        for item in items {
            if let Some(code) = item.get("code").and_then(Value::as_str) {
                out.entry(code.to_owned())
                    .or_default()
                    .insert(label.to_owned());
            }
        }
    }
    let mut codes: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for dir in ["lex", "fail"] {
        for name in fixture_names(dir, ".diag.json") {
            let path = syntax_dir().join(dir).join(format!("{name}.diag.json"));
            add_json(&path, &format!("syntax/{dir}/{name}"), &mut codes);
        }
    }
    for name in fixture_names("ast", ".ast") {
        let text =
            fs::read_to_string(syntax_dir().join("ast").join(format!("{name}.ast"))).unwrap();
        for line in text.lines() {
            if let Some(code) = line
                .strip_prefix("; ")
                .and_then(|rest| rest.split_whitespace().next())
                .filter(|word| word.starts_with("MTEK-"))
            {
                codes
                    .entry(code.to_owned())
                    .or_default()
                    .insert(format!("syntax/ast/{name}"));
            }
        }
    }
    for suite in ["pass", "fail"] {
        for name in semantic_fixtures(suite) {
            let path = semantics_dir().join(suite).join(&name).join(EXPECTED);
            if path.exists() {
                add_json(&path, &format!("semantics/{suite}/{name}"), &mut codes);
            }
        }
    }
    codes
}

#[test]
fn every_catalogue_code_has_a_fixture_or_a_listed_reason() {
    let produced = fixture_codes();
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut listed: BTreeMap<&str, &str> = BTreeMap::new();
    let mut problems = Vec::new();
    let lists = NOT_YET_IMPLEMENTED
        .iter()
        .map(|(code, _)| (*code, "NOT_YET_IMPLEMENTED"))
        .chain(
            UNREACHABLE_IN_THIS_BUILD
                .iter()
                .map(|(code, _, _)| (*code, "UNREACHABLE_IN_THIS_BUILD")),
        )
        .chain(
            COVERED_BY_OTHER_TESTS
                .iter()
                .map(|(code, _)| (*code, "COVERED_BY_OTHER_TESTS")),
        );
    for (code, list) in lists {
        if Code::parse_short(code).is_none() {
            problems.push(format!(
                "{list} lists {code}, which is not a catalogue code"
            ));
        }
        if let Some(other) = listed.insert(code, list) {
            problems.push(format!("{code} is listed in {other} and {list}"));
        }
    }
    for (code, file) in UNREACHABLE_IN_THIS_BUILD
        .iter()
        .map(|(code, _, file)| (*code, *file))
        .chain(COVERED_BY_OTHER_TESTS.iter().copied())
    {
        match fs::read_to_string(crate_dir.join(file)) {
            Ok(text) if text.contains(code) => {}
            Ok(_) => problems.push(format!("{code}: {file} does not name it")),
            Err(e) => problems.push(format!("{code}: cannot read {file}: {e}")),
        }
    }
    for code in Code::ALL {
        let short = code.short();
        let by_fixture = produced.contains_key(code.as_str());
        match (by_fixture, listed.get(short)) {
            (true, Some(list)) => problems.push(format!(
                "{short} now has a fixture ({:?}); remove it from {list}",
                produced.get(code.as_str())
            )),
            (false, None) => problems.push(format!(
                "no fixture produces {short} ({}); add one, or list it with its reason",
                code.title()
            )),
            _ => {}
        }
    }
    for code in produced.keys() {
        if Code::parse(code).is_none() {
            problems.push(format!(
                "a fixture expects {code}, which is not a catalogue code"
            ));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
