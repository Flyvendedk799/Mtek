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

use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::{Code, Diagnostic, Diagnostics, Severity, to_report};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::{Construct, IMPLEMENTED_MILESTONE, construct_gate, resolve_module};
use mtek_compiler::source::{FileId, MemFs, ProjectPath, SourceMap};
use mtek_compiler::stdlib::Milestone;
use mtek_compiler::syntax::ast::Module;
use mtek_compiler::syntax::{
    CandidateEdit, dump_expr, dump_module, lex, lex_str, parse_expression,
    parse_expression_no_desc, parse_module, walk_expr, walk_module,
};
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
fn every_resolver_code_has_a_semantic_fail_fixture() {
    // `spec/testing.md` 3.2: every diagnostic code needs a negative fixture.
    // These are the codes of name resolution and of the `check` wiring
    // (`E0013` is the parser's, reported once even where the resolver meets
    // the word as a declared name).
    let mut seen = BTreeSet::new();
    for name in semantic_fixtures("fail") {
        for d in check_fixture("fail", &name).report.diagnostics {
            seen.insert(d.code.short());
        }
    }
    for code in [
        "E0012", "E0013", "E2001", "E2002", "E2003", "E2004", "E2005", "E3003", "E5014", "E9006",
        "E9010",
    ] {
        assert!(
            seen.contains(code),
            "no semantics/fail fixture produces {code}: {seen:?}"
        );
    }
}

#[test]
fn every_type_checker_code_has_a_semantic_fixture() {
    // The codes of type checking and constant evaluation (M1-10): errors in
    // `fail/`, the warning `W3050` in a `pass/` fixture.
    let mut seen = BTreeSet::new();
    for suite in ["pass", "fail"] {
        for name in semantic_fixtures(suite) {
            for d in check_fixture(suite, &name).report.diagnostics {
                seen.insert((suite, d.code.short()));
            }
        }
    }
    for code in [
        "E2020", "E3001", "E3002", "E3003", "E3010", "E3011", "E3013", "E3014", "E3040", "E3041",
        "E3090", "E5001",
    ] {
        assert!(
            seen.contains(&("fail", code)),
            "no semantics/fail fixture produces {code}: {seen:?}"
        );
    }
    assert!(
        seen.contains(&("pass", "W3050")),
        "no semantics/pass fixture produces W3050: {seen:?}"
    );
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
