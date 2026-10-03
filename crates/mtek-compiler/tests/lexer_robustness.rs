//! Robustness of the lexer (`spec/testing.md` section 3.3): deterministic,
//! seeded generators throw random bytes, random token sequences and mutated
//! corpus files at it. For every input the lexer must return without
//! panicking and its output must satisfy the invariants of
//! [`check_invariants`]: the stream ends with one `Eof`, every span is in
//! bounds on character boundaries, tokens and comments do not overlap, every
//! byte that is neither covered nor plain whitespace is explained by a
//! diagnostic, and every diagnostic is a lexical catalogue code.

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::{Code, Severity};
use mtek_compiler::source::{ProjectPath, SourceMap, Span};
use mtek_compiler::syntax::{Lexed, MAX_LEXICAL_DIAGNOSTICS, TokenKind, TokenValue, lex, lex_str};

/// SplitMix64: a tiny deterministic generator, so that the tests need no
/// dependency and every run sees the same inputs.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A value in `0..bound` (`bound` must not be 0).
    fn below(&mut self, bound: usize) -> usize {
        usize::try_from(self.next() % u64::try_from(bound).unwrap()).unwrap()
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}

/// Random inputs per generator: 6 000 byte strings (a third of them uniformly
/// random, most rejected by the source map as invalid UTF-8), 4 000 lossily
/// converted byte strings, 5 000 token sequences and, in
/// `mutated_corpus_files_never_panic`, at least 5 000 corpus mutations: the
/// minimums of `spec/testing.md` section 3.3, and above the 10 000 cases that
/// work item M1-03 requires.
const BYTE_CASES: usize = 6000;
const TEXT_CASES: usize = 4000;
const TOKEN_SEQUENCE_CASES: usize = 5000;
const _: () = assert!(BYTE_CASES + TEXT_CASES + TOKEN_SEQUENCE_CASES >= 10_000);

fn corpus_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/syntax/lex")
}

/// Contents of every corpus file, in sorted order.
fn corpus() -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<(String, Vec<u8>)> = fs::read_dir(corpus_dir())
        .unwrap()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            name.ends_with(".mtek")
                .then(|| (name, fs::read(entry.path()).unwrap()))
        })
        .collect();
    files.sort();
    files
}

fn len(text: &str) -> u32 {
    u32::try_from(text.len()).unwrap()
}

fn assert_in_bounds(text: &str, span: Span, what: &str) {
    assert!(span.start <= span.end, "{what}: inverted {span:?}");
    assert!(
        span.end <= len(text),
        "{what}: {span:?} beyond {}",
        text.len()
    );
    assert!(
        text.get(span.range()).is_some(),
        "{what}: {span:?} splits a character"
    );
}

/// The invariants every lexer output must satisfy. `text` is the lexed text.
fn check_invariants(text: &str, lexed: &Lexed) {
    // The stream ends with exactly one Eof at the end of the text.
    let (eof, rest) = lexed.tokens.split_last().expect("at least the Eof token");
    assert_eq!(eof.kind, TokenKind::Eof);
    assert_eq!(eof.span, Span::at(eof.span.file, len(text)));
    assert!(rest.iter().all(|t| t.kind != TokenKind::Eof));

    // Regions covered by tokens and comments, in source order.
    let mut regions: Vec<(u32, u32)> = Vec::new();
    for token in rest {
        assert_in_bounds(text, token.span, "token");
        assert!(!token.span.is_empty(), "empty token {token:?}");
        regions.push((token.span.start, token.span.end));
        // Values agree with kinds.
        let consistent = match (&token.kind, &token.value) {
            (TokenKind::Ident, TokenValue::Ident { .. }) => true,
            (TokenKind::Int, TokenValue::Int { .. } | TokenValue::Malformed) => true,
            (TokenKind::Float, TokenValue::Float { .. } | TokenValue::Malformed) => true,
            (TokenKind::String, TokenValue::String(_) | TokenValue::Malformed) => true,
            (TokenKind::Color, TokenValue::Color { .. } | TokenValue::Malformed) => true,
            (
                TokenKind::Ident
                | TokenKind::Int
                | TokenKind::Float
                | TokenKind::String
                | TokenKind::Color,
                _,
            ) => false,
            (_, value) => *value == TokenValue::None,
        };
        assert!(consistent, "kind and value disagree: {token:?}");
    }
    let mut previous_next = 0;
    for item in lexed.trivia.items() {
        assert_in_bounds(text, item.span, "comment");
        assert!(item.next_token < lexed.tokens.len());
        assert!(
            item.next_token >= previous_next,
            "trivia keys must not decrease"
        );
        previous_next = item.next_token;
        regions.push((item.span.start, item.span.end));
    }
    regions.sort_unstable();
    for pair in regions.windows(2) {
        assert!(pair[0].1 <= pair[1].0, "overlap between {pair:?}");
    }

    // Diagnostics: lexical catalogue codes only, errors, located in bounds.
    for diagnostic in &lexed.diagnostics {
        assert_ne!(
            diagnostic.code,
            Code::E9999,
            "the lexer must not fail internally"
        );
        assert!(
            matches!(diagnostic.code.short().as_bytes().get(1), Some(b'0')),
            "{:?} is not a lexical code",
            diagnostic.code
        );
        assert_eq!(diagnostic.severity, Severity::Error);
        let span = diagnostic.primary.as_ref().expect("located").span;
        assert_in_bounds(text, span, "diagnostic");
        assert!(
            !span.is_empty(),
            "empty diagnostic span for {:?}",
            diagnostic.code
        );
    }
    assert!(lexed.diagnostics.len() <= MAX_LEXICAL_DIAGNOSTICS);

    // Every fix belongs to an E0022 diagnostic with the same span.
    let float_diagnostics: Vec<Span> = lexed
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::E0022)
        .map(|d| d.primary.as_ref().unwrap().span)
        .collect();
    let fix_spans: Vec<Span> = lexed.float_fixes.iter().map(|f| f.span).collect();
    assert_eq!(fix_spans, float_diagnostics);

    // Nothing is dropped silently: a byte outside every token and comment is
    // plain whitespace, a leading byte-order mark, or covered by a diagnostic.
    let covered_by_diagnostic = |offset: u32| {
        lexed.diagnostics.iter().any(|d| {
            d.primary
                .as_ref()
                .is_some_and(|label| label.span.contains(offset))
        })
    };
    // With suppressed diagnostics the check would be unsound.
    if lexed.suppressed_diagnostics == 0 {
        let mut cursor = 0u32;
        let mut gaps: Vec<(u32, u32)> = Vec::new();
        for &(start, end) in &regions {
            gaps.push((cursor, start));
            cursor = end;
        }
        gaps.push((cursor, len(text)));
        for (start, end) in gaps {
            let gap = text.get(start as usize..end as usize).unwrap();
            for (index, c) in gap.char_indices() {
                let offset = start + u32::try_from(index).unwrap();
                let plain = matches!(c, ' ' | '\t' | '\n' | '\r');
                let bom = c == '\u{feff}' && offset == 0;
                assert!(
                    plain || bom || covered_by_diagnostic(offset),
                    "byte {offset} ({c:?}) was dropped silently in {text:?}"
                );
            }
        }
    }
}

/// Lex `text` twice, check the invariants and that the result is stable.
fn run(text: &str) {
    let first = lex_str(mtek_compiler::source::FileId(0), text);
    check_invariants(text, &first);
    let second = lex_str(mtek_compiler::source::FileId(0), text);
    assert_eq!(first, second, "lexing is not deterministic for {text:?}");
}

/// Add `bytes` to a source map the way the compiler does and lex it if it is
/// accepted; a rejection must be one of the source-level codes. Returns true
/// if the bytes were accepted.
fn run_bytes(bytes: &[u8]) -> bool {
    let mut map = SourceMap::new();
    match map.add(ProjectPath::new("fuzz.mtek").unwrap(), bytes) {
        Ok(id) => {
            let file = map.get(id).unwrap();
            let lexed = lex(file);
            check_invariants(file.text(), &lexed);
            true
        }
        Err(error) => {
            assert!(
                matches!(error.code(), "E0001" | "E0002" | "E0004"),
                "{error}"
            );
            false
        }
    }
}

#[test]
fn random_byte_strings_never_panic() {
    // Whole UTF-8 sequences that matter to the lexer: comment and string
    // delimiters, number characters, a carriage return, a non-breaking space,
    // an astral character, ... (a byte-order mark is left out: the source map would reject nearly every input)
    const SPICE: &[&[u8]] = &[
        b"/",
        b"*",
        b"\"",
        b"\\",
        b"#",
        b".",
        b"0",
        b"1",
        b"7",
        b"9",
        b"e",
        b"E",
        b"x",
        b"b",
        b"_",
        b" ",
        b"\t",
        b"\r",
        b"\n",
        b"{",
        b"}",
        b"(",
        b")",
        b"[",
        b"]",
        b"<",
        b">",
        b",",
        b";",
        b":",
        b"+",
        b"-",
        b"=",
        b"!",
        b"&",
        b"|",
        b"^",
        b"~",
        b"%",
        b"@",
        b"$",
        b"`",
        b"'",
        b"?",
        b"a",
        b"Z",
        b"f",
        b"n",
        "\u{a0}".as_bytes(),
        "\u{2028}".as_bytes(),
        "\u{1F600}".as_bytes(),
        "\u{e9}".as_bytes(),
        "\u{65e5}".as_bytes(),
    ];
    let mut rng = Rng(0x4D54_454B_0001);
    let mut accepted = 0;
    let mut rejected = 0;
    for case in 0..BYTE_CASES {
        let length = rng.below(120);
        // Three kinds of input: only meaningful fragments, fragments with a
        // few random bytes mixed in, and uniformly random bytes.
        let mut bytes: Vec<u8> = Vec::new();
        for _ in 0..length {
            match case % 3 {
                0 => bytes.extend_from_slice(rng.pick(SPICE)),
                1 if rng.below(20) == 0 => bytes.push(u8::try_from(rng.below(256)).unwrap()),
                1 => bytes.extend_from_slice(rng.pick(SPICE)),
                _ => bytes.push(u8::try_from(rng.below(256)).unwrap()),
            }
        }
        if run_bytes(&bytes) {
            accepted += 1;
        } else {
            rejected += 1;
        }
    }
    // Both outcomes must really be exercised.
    assert!(accepted > 2000, "accepted {accepted}");
    assert!(rejected > 500, "rejected {rejected}");
}

#[test]
fn random_valid_text_never_panics() {
    // Lossy conversion of random bytes: valid UTF-8 full of replacement
    // characters, controls and astral characters.
    let mut rng = Rng(0x4D54_454B_0002);
    for _ in 0..TEXT_CASES {
        let length = rng.below(200);
        let bytes: Vec<u8> = (0..length)
            .map(|_| u8::try_from(rng.below(256)).unwrap())
            .collect();
        run(&String::from_utf8_lossy(&bytes));
    }
}

const FRAGMENTS: &[&str] = &[
    "fn",
    "let",
    "var",
    "const",
    "scene",
    "entity",
    "self",
    "true",
    "false",
    "while",
    "_",
    "__x",
    "foo",
    "Bar",
    "é",
    "日本",
    "0",
    "7",
    "007",
    "0x1F",
    "1_000",
    "10u32",
    "1.",
    ".5",
    "1e3",
    "1.5",
    "2.5e-3",
    "1.e3",
    "18446744073709551616",
    "0..n",
    "..",
    ".",
    "->",
    "-",
    "+",
    "+=",
    "*",
    "*=",
    "/",
    "/=",
    "%",
    "!",
    "!=",
    "=",
    "==",
    "<",
    "<=",
    "<<",
    ">",
    ">=",
    ">>",
    "&",
    "&&",
    "|",
    "||",
    "^",
    "~",
    "(",
    ")",
    "{",
    "}",
    "[",
    "]",
    ",",
    ";",
    ":",
    "\"",
    "\"abc\"",
    "\"a\\n\"",
    "\"\\q\"",
    "\"\\u{41}\"",
    "\"\\u{110000}\"",
    "\"unterminated",
    "\\",
    "#",
    "#fff",
    "#6b5cff",
    "#6b5cffcc",
    "#12345g",
    "//",
    "/// doc",
    "/*",
    "*/",
    "/* a */",
    "/* /* */ */",
    "@",
    "$",
    "`",
    "\u{a0}",
    "\u{feff}",
    "\u{1F600}",
    "\r",
    "\r\n",
    "\n",
    "\t",
    " ",
    "\0",
];

#[test]
fn random_token_sequences_never_panic() {
    let mut rng = Rng(0x4D54_454B_0003);
    for _ in 0..TOKEN_SEQUENCE_CASES {
        let count = rng.below(40);
        let mut text = String::new();
        for _ in 0..count {
            text.push_str(rng.pick(FRAGMENTS));
            match rng.below(4) {
                0 => {}
                1 => text.push('\n'),
                _ => text.push(' '),
            }
        }
        run(&text);
    }
}

#[test]
fn mutated_corpus_files_never_panic() {
    let files = corpus();
    assert!(files.len() >= 10);
    let mut rng = Rng(0x4D54_454B_0004);
    let mut cases = 0;
    for (name, bytes) in &files {
        let text = std::str::from_utf8(bytes).unwrap();
        let chars: Vec<char> = text.chars().collect();

        // The file itself, and truncated at every 7th byte (lossily, so the
        // cut may fall inside a character).
        run(text);
        for end in (0..bytes.len()).step_by(7) {
            run(&String::from_utf8_lossy(&bytes[..end]));
            cases += 1;
        }

        // Random deletions, duplications, swaps and insertions of characters.
        for _ in 0..400 {
            let mut mutated = chars.clone();
            for _ in 0..=rng.below(4) {
                if mutated.is_empty() {
                    break;
                }
                let at = rng.below(mutated.len());
                match rng.below(4) {
                    0 => {
                        mutated.remove(at);
                    }
                    1 => mutated.insert(at, mutated[at]),
                    2 => {
                        let other = rng.below(mutated.len());
                        mutated.swap(at, other);
                    }
                    _ => {
                        let fragment = rng.pick(FRAGMENTS);
                        for (offset, c) in fragment.chars().enumerate() {
                            mutated.insert((at + offset).min(mutated.len()), c);
                        }
                    }
                }
            }
            run(&mutated.into_iter().collect::<String>());
            cases += 1;
        }
        assert!(cases > 0, "{name}");
    }
    assert!(cases >= 5000, "only {cases} cases");
}

#[test]
fn every_prefix_of_every_corpus_file_never_panics() {
    for (_, bytes) in corpus() {
        let text = String::from_utf8(bytes).unwrap();
        for (end, _) in text.char_indices() {
            run(&text[..end]);
        }
        run(&text);
    }
}

#[test]
fn extreme_inputs_are_handled() {
    // Deep comment nesting does not recurse.
    let deep = "/*".repeat(200_000) + &"*/".repeat(200_000);
    let lexed = lex_str(mtek_compiler::source::FileId(0), &deep);
    assert!(lexed.diagnostics.is_empty());
    assert_eq!(lexed.trivia.len(), 1);
    let unclosed = "/*".repeat(200_000);
    let lexed = lex_str(mtek_compiler::source::FileId(0), &unclosed);
    assert_eq!(lexed.diagnostics.len(), 1);
    assert!(lexed.diagnostics[0].notes[0].contains("200000 block comments"));

    // Very long literals.
    run(&"9".repeat(100_000));
    run(&format!("1.{}e5", "0".repeat(100_000)));
    run(&format!("\"{}\"", "a".repeat(1_000_000)));
    run(&format!("#{}", "f".repeat(100_000)));
    run(&"é".repeat(100_000));
    run(&"_".repeat(100_000));
    run(&"\\".repeat(1000));
    run(&format!("\"{}", "\\".repeat(1001)));

    // The empty file and a file of one byte of every kind.
    run("");
    for byte in 0u8..=127 {
        run(&char::from(byte).to_string());
    }
}

#[test]
fn a_file_of_junk_does_not_exhaust_memory_through_diagnostics() {
    let junk = "@".repeat(100_000);
    let lexed = lex_str(mtek_compiler::source::FileId(0), &junk);
    assert_eq!(lexed.diagnostics.len(), MAX_LEXICAL_DIAGNOSTICS);
    assert_eq!(
        lexed.suppressed_diagnostics,
        100_000 - MAX_LEXICAL_DIAGNOSTICS
    );
    assert_eq!(lexed.tokens.len(), 1);
    check_invariants(&junk, &lexed);

    let floats = "1. ".repeat(5000);
    let lexed = lex_str(mtek_compiler::source::FileId(0), &floats);
    assert_eq!(lexed.diagnostics.len(), MAX_LEXICAL_DIAGNOSTICS);
    assert_eq!(lexed.float_fixes.len(), MAX_LEXICAL_DIAGNOSTICS);
    assert_eq!(lexed.tokens.len(), 5001);
    check_invariants(&floats, &lexed);
}

#[test]
fn suppressed_lexical_diagnostics_reach_the_sink_with_the_true_total() {
    use mtek_compiler::diagnostics::{Diagnostics, MAX_DIAGNOSTICS_PER_FILE};
    use mtek_compiler::source::FileId;

    // A file id other than 0, so that a hard-coded id would show.
    let file = FileId(3);
    let total = 2 * MAX_LEXICAL_DIAGNOSTICS + 345;
    let text = "@ ".repeat(total);
    let mut lexed = lex_str(file, &text);
    assert_eq!(lexed.diagnostics.len(), MAX_LEXICAL_DIAGNOSTICS);
    assert_eq!(
        lexed.suppressed_diagnostics,
        total - MAX_LEXICAL_DIAGNOSTICS
    );
    assert_eq!(lexed.suppressed_errors, lexed.suppressed_diagnostics);

    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    // The diagnostics were moved out, so reporting again counts nothing twice.
    assert!(lexed.diagnostics.is_empty());
    assert_eq!(lexed.suppressed_diagnostics, 0);
    lexed.report_into(&mut sink);

    assert!(sink.has_errors());
    let dropped = total - MAX_DIAGNOSTICS_PER_FILE;
    assert_eq!(sink.suppressed(), dropped);
    let report = sink.finish();
    assert_eq!(report.summary.suppressed, dropped);
    assert_eq!(report.summary.errors, MAX_DIAGNOSTICS_PER_FILE);
    let notes: Vec<_> = report
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::W9003)
        .collect();
    assert_eq!(notes.len(), 1);
    assert_eq!(
        notes[0].message,
        format!(
            "{dropped} further diagnostics in this file are suppressed after the first {MAX_DIAGNOSTICS_PER_FILE}."
        )
    );

    // Tokens are untouched by reporting.
    assert_eq!(lexed.tokens.len(), 1);
}

#[test]
fn a_file_with_few_errors_reports_everything_and_suppresses_nothing() {
    use mtek_compiler::diagnostics::Diagnostics;
    use mtek_compiler::source::FileId;

    let mut lexed = lex_str(FileId(0), "@ 007 1.");
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    assert_eq!(sink.suppressed(), 0);
    let report = sink.finish();
    assert_eq!(report.summary.errors, 3);
    assert_eq!(report.summary.suppressed, 0);
    assert_eq!(report.diagnostics.len(), 3);
}

#[test]
fn the_largest_accepted_source_file_lexes() {
    // 4 MiB of tokens is the largest file the source map accepts.
    let unit = "let x = 1.5 + 2; // c\n";
    let count = (4 * 1024 * 1024) / unit.len();
    let text = unit.repeat(count);
    assert!(text.len() <= 4 * 1024 * 1024);
    let mut map = SourceMap::new();
    let id = map
        .add(ProjectPath::new("big.mtek").unwrap(), text.as_bytes())
        .unwrap();
    let lexed = lex(map.get(id).unwrap());
    assert!(lexed.diagnostics.is_empty());
    assert_eq!(lexed.tokens.len(), count * 7 + 1);
    assert_eq!(lexed.trivia.len(), count);
}
