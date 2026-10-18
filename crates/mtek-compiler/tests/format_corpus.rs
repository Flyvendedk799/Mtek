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
//!   tab in the indentation, indentation in steps of 4, no blank line at the
//!   start of a body or two in a row.
//!
//! Every file that does not parse must be refused with error diagnostics. The
//! corpus is every `.mtek` file under the repository root (`tests/syntax`,
//! `tests/semantics` with the fixtures that must fail, `tests/codegen`,
//! `tests/assets`, `tests/browser`, `tests/modules`, `examples`, `benchmarks`,
//! the CLI template, the standard materials).
//!
//! The mutation tests go further: they insert comments of every kind at token
//! boundaries of the corpus, one at a time and several at once, and check the
//! same properties. That is what the corpus alone cannot do: real programs have
//! few comments, and those are in the usual places. `MTEK_FMT_EXHAUSTIVE=1`
//! inserts every kind at every boundary of every file (about 15 times as many
//! programs; for the work on the formatter, not for every run).

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

/// The codes of everything the lexer and parser report, sorted, and whether
/// any is an error.
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
            "formatting is not idempotent; the second pass makes:\n{again}"
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
        let bytes = fs::read(path).unwrap_or_else(|e| panic!("{name}: unreadable: {e}"));
        let Ok(text) = String::from_utf8(bytes) else {
            // A fixture of E0001 (invalid UTF-8): not a module at all.
            skipped_count += 1;
            continue;
        };
        if codes_of(&text).1 {
            // The formatter refuses a file that does not parse, and says why.
            let diagnostics = format_text(FILE, &text)
                .expect_err(&format!("{name}: a file with errors was formatted"));
            assert!(
                diagnostics
                    .iter()
                    .any(|d| d.code.severity() == Severity::Error),
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

/// The mutations: each is a comment (with the white space around it) put
/// before a token.
const MUTATIONS: [&str; 6] = [
    " /* c */ ",
    " // c\n",
    "\n// own line\n",
    "\n/* a /* nested */ b */\n",
    " /* two\n   lines */ ",
    "\n\n/// doc\n",
];

/// `text` with the comments `inserts` (token start offset, comment) added.
fn with_comments(text: &str, inserts: &[(u32, &str)]) -> String {
    let mut sorted = inserts.to_vec();
    sorted.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
    let mut mutated = text.to_owned();
    for (at, comment) in sorted {
        mutated.insert_str(at as usize, comment);
    }
    mutated
}

/// A repeatable source of numbers (xorshift): the same corpus gives the same
/// programs on every run.
struct Random(u64);

impl Random {
    fn new(seed: &str) -> Self {
        let hash = seed.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
        });
        Random(hash | 1)
    }

    fn next(&mut self, below: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % below as u64) as usize
    }
}

/// The files the mutation tests use: those that parse, but never the holdout
/// of the benchmarks (`benchmarks/README.md`: it is not read for design, and a
/// failure here prints the program).
fn mutable_files() -> Vec<(String, String)> {
    corpus()
        .iter()
        .filter_map(|path| {
            let name = display(path);
            if name.starts_with("benchmarks/holdout/") {
                return None;
            }
            let text = fs::read_to_string(path).ok()?;
            (!codes_of(&text).1).then_some((name, text))
        })
        .collect()
}

fn fail(site: &str, mutated: &str, problem: &str) -> ! {
    let output = format_text(FILE, mutated).unwrap_or_default();
    panic!("{site}: {problem}\n--- input\n{mutated}\n--- output\n{output}");
}

fn token_starts(text: &str) -> Vec<u32> {
    lex_str(FILE, text)
        .tokens
        .iter()
        .map(|token| token.span.start)
        .collect()
}

#[test]
fn a_comment_in_any_place_survives_formatting() {
    let exhaustive = std::env::var("MTEK_FMT_EXHAUSTIVE").is_ok_and(|v| v == "1");
    let mut checked = 0usize;
    let files = mutable_files();
    for (name, text) in &files {
        let starts = token_starts(text);
        // Every boundary of a small file, a sample of a large one; the
        // mutation rotates so that every kind meets every kind of token
        // somewhere in the corpus.
        let stride = if exhaustive {
            1
        } else {
            (starts.len() / 24).max(1)
        };
        for (index, start) in starts.iter().enumerate().step_by(stride) {
            let kinds = if exhaustive {
                &MUTATIONS[..]
            } else {
                let rotate = (index / stride + checked) % MUTATIONS.len();
                &MUTATIONS[rotate..=rotate]
            };
            for insert in kinds {
                let mutated = with_comments(text, &[(*start, insert)]);
                if let Err(problem) = check_properties(&mutated) {
                    fail(
                        &format!("{name} (before token {index}, inserting {insert:?})"),
                        &mutated,
                        &problem,
                    );
                }
                checked += 1;
            }
        }
    }
    eprintln!(
        "single comment mutations: {checked} programs from {} files",
        files.len()
    );
    assert!(checked >= 5000, "only {checked} mutations");
}

#[test]
fn several_comments_at_once_survive_formatting() {
    let rounds = if std::env::var("MTEK_FMT_EXHAUSTIVE").is_ok_and(|v| v == "1") {
        60
    } else {
        4
    };
    let mut checked = 0usize;
    let files = mutable_files();
    for (name, text) in &files {
        let starts = token_starts(text);
        let mut random = Random::new(name);
        for round in 0..rounds {
            let count = 2 + random.next(4);
            let inserts: Vec<(u32, &str)> = (0..count)
                .map(|_| {
                    (
                        starts[random.next(starts.len())],
                        MUTATIONS[random.next(MUTATIONS.len())],
                    )
                })
                .collect();
            let mutated = with_comments(text, &inserts);
            if let Err(problem) = check_properties(&mutated) {
                fail(
                    &format!("{name} (round {round}, inserting {inserts:?})"),
                    &mutated,
                    &problem,
                );
            }
            checked += 1;
        }
    }
    eprintln!(
        "multiple comment mutations: {checked} programs from {} files",
        files.len()
    );
    assert!(checked >= 2000, "only {checked} mutations");
}
