//! The formatter over the whole corpus of `.mtek` files of the repository
//! (`spec/tooling.md` section 5, decision 0070): every file that parses is
//! formatted, and the result must
//!
//! * be a fixed point: `fmt(fmt(x)) == fmt(x)`;
//! * parse to the same syntax tree (ignoring spans), with the same literals as
//!   written (a number is never re-spelled);
//! * keep every comment (the multiset of comment texts is equal);
//! * raise the same diagnostics (codes) as the original when parsed;
//! * be canonical text: `\n` only, one final newline, no trailing spaces, no
//!   tab, no blank line at the start of a body or two in a row.
//!
//! Every file that does not parse must be refused with error diagnostics. The
//! corpus is every `.mtek` file under the repository root (`tests/syntax`,
//! `tests/semantics` with the fixtures that must fail, `tests/codegen`,
//! `tests/assets`, `tests/browser`, `tests/modules`, `examples`, `benchmarks`,
//! the CLI template, the standard materials).
//!
//! The mutation test goes further: it inserts comments of every kind at token
//! boundaries of the corpus and checks the same properties, which is what the
//! corpus alone cannot do (real programs have few comments in odd places).

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::{Code, Diagnostics, Severity};
use mtek_compiler::format::{comment_texts, format_text};
use mtek_compiler::source::FileId;
use mtek_compiler::syntax::{TokenKind, TriviaKind, dump_module, lex_str, parse_module};

const FILE: FileId = FileId(0);

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Directories that hold no corpus: dependencies, build output, version
/// control, other checkouts.
fn skipped(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | "target" | ".git" | ".claude" | "dist" | ".out" | "results"
    )
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if path.is_dir() {
            if !skipped(&name) {
                collect(&path, out);
            }
        } else if path.extension().is_some_and(|ext| ext == "mtek") {
            out.push(path);
        }
    }
}

/// Every `.mtek` file of the repository, sorted.
fn corpus() -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect(&repo_root(), &mut files);
    files
}

fn display(path: &Path) -> String {
    path.strip_prefix(repo_root())
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// The codes of everything the lexer and parser report, sorted.
fn codes_of(text: &str) -> (Vec<String>, bool) {
    let mut lexed = lex_str(FILE, text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let _ = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    let report = sink.finish();
    let mut codes: Vec<String> = report
        .diagnostics
        .iter()
        .map(|d| d.code.to_string())
        .collect();
    codes.sort();
    (codes, report.summary.errors > 0)
}

fn tree_of(text: &str) -> String {
    let mut lexed = lex_str(FILE, text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    dump_module(&parsed.module)
}

/// The literals of the text as written, in order: numbers, strings and colors
/// (a color compared without case).
fn literals_of(text: &str) -> Vec<String> {
    let lexed = lex_str(FILE, text);
    lexed
        .tokens
        .iter()
        .filter(|token| {
            matches!(
                token.kind,
                TokenKind::Int | TokenKind::Float | TokenKind::String | TokenKind::Color
            )
        })
        .map(|token| {
            let written = token.text(text);
            if token.kind == TokenKind::Color {
                written.to_ascii_lowercase()
            } else {
                written.to_owned()
            }
        })
        .collect()
}

/// What canonical text looks like, whatever the program: checked on the
/// output only. Returns the first violation.
fn canonical_problem(formatted: &str) -> Option<String> {
    if formatted.is_empty() {
        return None;
    }
    if formatted.contains('\r') {
        return Some("a carriage return".to_owned());
    }
    if !formatted.ends_with('\n') || formatted.ends_with("\n\n") {
        return Some("not exactly one final newline".to_owned());
    }
    // The lines of a block comment that spans lines are the comment's own,
    // kept as written.
    let lexed = lex_str(FILE, formatted);
    let inside_block_comment = |offset: usize| {
        lexed.trivia.items().iter().any(|item| {
            item.kind == TriviaKind::BlockComment
                && (item.span.start as usize) < offset
                && offset < item.span.end as usize
        })
    };
    let lines: Vec<&str> = formatted.trim_end_matches('\n').split('\n').collect();
    let mut offset = 0;
    for (index, line) in lines.iter().enumerate() {
        let start_of_line = offset;
        let end_of_line = offset + line.len();
        offset = end_of_line + 1;
        if inside_block_comment(start_of_line) {
            continue;
        }
        if line.ends_with([' ', '\t']) && !inside_block_comment(end_of_line) {
            return Some(format!("trailing whitespace in {line:?}"));
        }
        if line.trim_start_matches(' ').starts_with('\t') {
            return Some(format!("a tab in the indentation of {line:?}"));
        }
        let indent = line.len() - line.trim_start_matches(' ').len();
        if indent % 4 != 0 {
            return Some(format!("indentation of {line:?} is not a multiple of 4"));
        }
        let previous = index.checked_sub(1).and_then(|i| lines.get(i)).copied();
        let next = lines.get(index + 1).copied();
        if line.is_empty() {
            if previous.is_none_or(str::is_empty) {
                return Some("a blank line at the start, or two in a row".to_owned());
            }
            if previous.is_some_and(|p| p.ends_with('{')) {
                return Some("a blank line after an opening brace".to_owned());
            }
            if next.is_some_and(|n| n.trim() == "}") {
                return Some("a blank line before a closing brace".to_owned());
            }
        }
    }
    None
}

/// All the properties of one text. The formatted text, or what is wrong.
fn check_properties(text: &str) -> Result<String, String> {
    let formatted = format_text(FILE, text).map_err(|d| format!("refused: {d:?}"))?;
    let again = format_text(FILE, &formatted)
        .map_err(|d| format!("the formatted text is refused: {d:?}"))?;
    if formatted != again {
        return Err(format!(
            "formatting is not idempotent; the second pass makes:
{again}"
        ));
    }
    if tree_of(text) != tree_of(&formatted) {
        return Err("the syntax tree changed".to_owned());
    }
    if literals_of(text) != literals_of(&formatted) {
        return Err("a literal was re-spelled".to_owned());
    }
    if comment_texts(FILE, text) != comment_texts(FILE, &formatted) {
        return Err("the comments changed".to_owned());
    }
    let (before, after) = (codes_of(text).0, codes_of(&formatted).0);
    if before != after {
        return Err(format!(
            "the diagnostics of the parser changed: {before:?} became {after:?}"
        ));
    }
    if let Some(problem) = canonical_problem(&formatted) {
        return Err(format!("the output is not canonical: {problem}"));
    }
    Ok(formatted)
}

#[test]
fn the_corpus_is_formatted_idempotently_and_without_loss() {
    let files = corpus();
    let (mut formatted_count, mut refused_count, mut skipped_count) = (0, 0, 0);
    let mut changed = 0;
    let mut comments = 0;
    for path in &files {
        let name = display(path);
        let Ok(bytes) = fs::read(path) else {
            panic!("{name}: unreadable");
        };
        let Ok(text) = String::from_utf8(bytes) else {
            // A fixture of E0001 (invalid UTF-8): not a module at all.
            skipped_count += 1;
            continue;
        };
        let (_, has_errors) = codes_of(&text);
        if has_errors {
            // The formatter refuses a file that does not parse, and says why.
            let refusal = format_text(FILE, &text);
            let diagnostics = refusal.expect_err(&format!("{name}: a file with errors was formatted"));
            assert!(
                diagnostics.iter().any(|d| d.code.severity() == Severity::Error),
                "{name}: refused without an error diagnostic"
            );
            assert!(
                diagnostics.iter().all(|d| d.code != Code::E9999),
                "{name}: refused as a formatter defect: {diagnostics:?}"
            );
            refused_count += 1;
            continue;
        }
        let formatted = check_properties(&text).unwrap_or_else(|problem| {
            panic!("{name}: {problem}");
        });
        comments += comment_texts(FILE, &text).len();
        if formatted != text {
            changed += 1;
        }
        formatted_count += 1;
    }
    eprintln!(
        "format corpus: {} files, {formatted_count} formatted ({changed} changed, {comments} comments), \
         {refused_count} refused (do not parse), {skipped_count} not UTF-8",
        files.len()
    );
    assert!(files.len() >= 800, "the corpus is {} files", files.len());
    assert!(formatted_count >= 600, "only {formatted_count} files parse");
    assert!(refused_count >= 50, "only {refused_count} refused files");
    assert!(comments >= 500, "only {comments} comments in the corpus");
}

/// The mutations: each inserts one comment at a token boundary.
const MUTATIONS: [&str; 6] = [
    " /* c */ ",
    " // c\n",
    "\n// own line\n",
    "\n/* a /* nested */ b */\n",
    " /* two\n   lines */ ",
    "\n\n/// doc\n",
];

/// The text with `insert` put before the token `index`.
fn with_comment_before(text: &str, token_start: u32, insert: &str) -> String {
    let at = token_start as usize;
    format!("{}{}{}", &text[..at], insert, &text[at..])
}

#[test]
fn comments_in_every_place_survive_formatting() {
    let files = corpus();
    let mut checked = 0usize;
    let mut sites = 0usize;
    for path in &files {
        let name = display(path);
        if name.starts_with("benchmarks/holdout/") {
            // Never read for design (benchmarks/README.md); the plain corpus
            // test above covers it without printing it.
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        if codes_of(&text).1 {
            continue;
        }
        let lexed = lex_str(FILE, &text);
        let boundaries: Vec<u32> = lexed.tokens.iter().map(|t| t.span.start).collect();
        // Every boundary of a small file; a sample of a large one. The
        // mutation rotates with the position so that every kind meets every
        // kind of token somewhere in the corpus.
        let stride = (boundaries.len() / 24).max(1);
        for (index, start) in boundaries.iter().enumerate().step_by(stride) {
            let insert = MUTATIONS[(index / stride + checked) % MUTATIONS.len()];
            let mutated = with_comment_before(&text, *start, insert);
            let site = format!("{name} (before token {index}, inserting {insert:?})");
            if let Err(problem) = check_properties(&mutated) {
                let output = format_text(FILE, &mutated).unwrap_or_default();
                panic!("{site}: {problem}
--- input
{mutated}
--- output
{output}");
            }
            checked += 1;
        }
        sites += 1;
    }
    eprintln!("comment mutations: {checked} mutated programs from {sites} files");
    assert!(checked >= 5000, "only {checked} mutations");
}
