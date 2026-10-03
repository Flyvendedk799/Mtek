//! Golden AST fixtures: every `tests/syntax/ast/<name>.mtek` is a list of
//! expressions, each parsed on its own and compared with `<name>.ast`
//! (`spec/testing.md` section 3.1).
//!
//! Format of the `.mtek` file: cases are introduced by a line starting with
//! `---`; the text up to the next such line (without its trailing line break)
//! is one expression. The rest of a `---` line is a remark shown in the
//! golden file, except that a remark starting with `no-desc` makes the case
//! parse as `ExprNoDesc` (no descriptor literal at the top level, the
//! condition of an `if`).
//!
//! Format of the `.ast` file: for each case, the remark (`;; ...`), the source
//! (each line behind `; `), the indented S-expression dump of the tree, and one
//! line per diagnostic and candidate edit, in the order the compiler reports
//! them, with byte offsets into the case text:
//!
//! ```text
//! ; E1010 6..9 `<` message
//! ; edit E1011 "(" at 0..0, ")" at 17..17
//! ```
//!
//! A fixture named `fail_*` must produce diagnostics somewhere, every other
//! fixture none. Every case also has its structural invariants checked: the
//! ids of an error-free tree are exactly `0..node_count`, parents have larger
//! ids than their children, and every span nests in its parent's.
//!
//! `MTEK_BLESS=1 cargo test` rewrites the golden files; review the diff like
//! code (`spec/compiler-architecture.md` section 10).

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::Diagnostics;
use mtek_compiler::source::FileId;
use mtek_compiler::syntax::{
    dump_expr, lex_str, parse_expression, parse_expression_no_desc, walk_expr,
};

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/syntax/ast")
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

/// Fixture names (`<name>.mtek`) in sorted order.
fn fixture_names() -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(fixture_dir())
        .unwrap()
        .filter_map(|entry| {
            let file = entry.ok()?.file_name().into_string().ok()?;
            file.strip_suffix(".mtek").map(str::to_owned)
        })
        .collect();
    names.sort();
    names
}

/// One case of a fixture file.
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
                .expect("a fixture starts with a `---` line");
            if !case.source.is_empty() {
                case.source.push('\n');
            }
            case.source.push_str(line);
        }
    }
    cases
}

/// The result of one case: the golden text and whether it had diagnostics.
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
    for d in &report.diagnostics {
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
    for candidate in &parsed.candidate_edits {
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

    if report.diagnostics.is_empty() {
        check_invariants(source, &parsed.expr, parsed.node_count);
    }
    (out, !report.diagnostics.is_empty())
}

fn check_invariants(source: &str, expr: &mtek_compiler::syntax::ast::Expr, node_count: u32) {
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

#[test]
fn every_fixture_matches_its_golden() {
    let names = fixture_names();
    assert!(names.len() >= 10, "fixtures are missing: {names:?}");
    for name in &names {
        let text = fs::read_to_string(fixture_dir().join(format!("{name}.mtek"))).unwrap();
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
        assert_eq!(
            any_diagnostics,
            name.starts_with("fail_"),
            "{name}: fixture naming and diagnostics disagree"
        );
        check_golden(&fixture_dir().join(format!("{name}.ast")), &golden);
    }
}

#[test]
fn every_pair_of_precedence_levels_has_a_case() {
    // The operators of the table of `spec/language.md` 6.1 that can meet in a
    // binary expression, loosest first; unary and postfix operators are
    // covered by `precedence_unary_postfix.mtek`.
    let levels = ["||", "&&", "==", "<", "+", "*"];
    let text = fs::read_to_string(fixture_dir().join("precedence_pairs.mtek")).unwrap();
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
