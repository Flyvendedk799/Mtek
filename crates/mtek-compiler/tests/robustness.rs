//! Robustness of the whole front end (`spec/testing.md` section 3.3,
//! `spec/compiler-architecture.md` sections 3 and 9): source loading, lexing
//! and parsing must return on *any* input, without panicking, in bounded
//! time, with every span inside its file and every diagnostic code taken from
//! the catalogue.
//!
//! A deterministic generator (a hand-rolled xorshift64*, no dependency)
//! produces three categories of input, 5 000 cases each per run:
//!
//! * **bytes**: random byte strings of 0 to 4 096 bytes: uniformly random
//!   bytes (mostly invalid UTF-8, rejected by the source map), fragments that
//!   matter to the lexer, random Unicode text, and "feature soup" mixing lone
//!   `\r`, NUL, huge digit runs, 300-deep bracket and operator nesting,
//!   broken UTF-8 sequences, byte-order marks and unterminated literals;
//! * **tokens**: random token sequences assembled from the token vocabulary
//!   (keywords, punctuation, reserved words, every token text of the
//!   `tests/syntax/pass/` corpus, runs of consecutive corpus tokens and
//!   awkward literals) with random separators;
//! * **mutations**: the `tests/syntax/pass/` corpus with random tokens
//!   deleted, duplicated or swapped, plus a few corpus files truncated at
//!   every 7th byte.
//!
//! Every case runs on a thread of its own with the 16 MiB stack the compiler
//! uses (section 3), inside `catch_unwind`, and the test waits for it with
//! `recv_timeout`: a case that takes longer than [`CASE_TIME_BUDGET`] fails
//! the test and prints the input; a panic or a broken invariant fails it and
//! prints the input minimised by delta debugging, together with the seed and
//! the case index.
//!
//! The invariants of a case ([`front_end_with`]): a rejected file is
//! rejected with a source-text code and an in-bounds range; an accepted one
//! lexes to tokens that end with exactly one `Eof` at the end of the text, and
//! parses to a module that covers the whole file (the parser reached `Eof`),
//! whose nodes lie inside their parents and the file and have distinct ids
//! below `node_count`; every token, float fix, candidate edit and diagnostic
//! span (primary, related, edits) lies within the file on character
//! boundaries; every diagnostic code is a catalogue code of the front end,
//! with its catalogued severity, never `E9999`, and at most the per-file cap
//! of them is reported. Every [`RENDER_EVERY`]th case also renders its
//! report as text and JSON, as the driver does (rendering every case would
//! triple the runtime).
//!
//! # Seeds
//!
//! Each category has a fixed seed derived from [`DEFAULT_SEED`]; the seeds are
//! printed at the start of each test (visible with `--nocapture`, and in the
//! output of a failing test). `MTEK_TEST_SEED=<decimal or 0x-hex>` replaces
//! the base seed, to reproduce a reported failure or to explore new inputs.
//! Every case draws from its own generator, derived from the category seed
//! and the case index, so a case does not depend on the cases before it.
//!
//! # The long run
//!
//! `fifty_thousand_cases` (ignored by default) runs 50 000 cases. Run it
//! locally, preferably optimised:
//!
//! ```text
//! cargo test -p mtek-compiler --test robustness --release -- --ignored --nocapture
//! ```

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::any::Any;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Once, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use mtek_compiler::diagnostics::{
    Code, Diagnostic, Diagnostics, MAX_DIAGNOSTICS_PER_FILE, RenderOptions, render_report,
    to_report,
};
use mtek_compiler::source::{FileId, ProjectPath, SourceMap, Span};
use mtek_compiler::syntax::{
    KEYWORDS, PUNCTUATION, RESERVED_WORDS, TokenKind, dump_module, lex, lex_str, parse_module,
    walk_module,
};

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/// Cases per category in the default run: 15 000 in all (`spec/testing.md`
/// section 3.3).
const CASES_PER_CATEGORY: usize = 5000;

/// Cases of the ignored long run, over all three categories.
const LONG_RUN_CASES: usize = 50_000;

/// The longest random byte string and token sequence.
const MAX_INPUT_LEN: usize = 4096;

/// Wall-clock time one case may take before the test fails.
const CASE_TIME_BUDGET: Duration = Duration::from_secs(2);

/// The stack of the compilation thread (`spec/compiler-architecture.md` §3).
const CASE_STACK_BYTES: usize = 16 << 20;

/// The base seed of the default run ("MTEK", "M1", work item 06).
const DEFAULT_SEED: u64 = 0x4D54_454B_4D31_0006;

/// Most candidate inputs the minimiser tries before printing what it has.
const MINIMISE_ATTEMPTS: usize = 3000;

/// Name of the threads whose panics are expected and not printed (the
/// minimiser's candidates and the harness self-tests).
const QUIET_THREAD: &str = "robustness-quiet";

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/// One step of SplitMix64, used to spread seeds (and never to generate).
fn splitmix64(seed: u64) -> u64 {
    let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// xorshift64* (Vigna): small, fast, deterministic on every platform.
struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u64) -> Self {
        // xorshift must not start from 0, where it stays forever.
        let state = match splitmix64(seed) {
            0 => 0x2545_F491_4F6C_DD1D,
            state => state,
        };
        Rng { state }
    }

    /// The generator of case `index` of the category seeded with `seed`.
    fn for_case(seed: u64, index: usize) -> Self {
        Rng::new(seed ^ splitmix64(index as u64))
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// A value in `0..bound` (`bound` > 0), without modulo bias worth noting.
    fn below(&mut self, bound: usize) -> usize {
        assert!(bound > 0);
        ((u128::from(self.next_u64()) * bound as u128) >> 64) as usize
    }

    /// A value in `low..=high`.
    fn between(&mut self, low: usize, high: usize) -> usize {
        low + self.below(high - low + 1)
    }

    /// True with probability `numerator / denominator`.
    fn chance(&mut self, numerator: usize, denominator: usize) -> bool {
        self.below(denominator) < numerator
    }

    fn byte(&mut self) -> u8 {
        (self.next_u64() >> 56) as u8
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}

/// Parse `MTEK_TEST_SEED`: decimal, or hexadecimal with `0x`; `_` allowed.
fn parse_seed(text: &str) -> Option<u64> {
    let text = text.trim().replace('_', "");
    match text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        Some(hex) => u64::from_str_radix(hex, 16).ok(),
        None => text.parse().ok(),
    }
}

/// The base seed of this run.
fn base_seed() -> u64 {
    match std::env::var("MTEK_TEST_SEED") {
        Ok(text) => parse_seed(&text)
            .unwrap_or_else(|| panic!("MTEK_TEST_SEED={text:?} is not a decimal or 0x-hex u64")),
        Err(_) => DEFAULT_SEED,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Category {
    Bytes,
    Tokens,
    Mutations,
}

impl Category {
    const ALL: [Category; 3] = [Category::Bytes, Category::Tokens, Category::Mutations];

    fn name(self) -> &'static str {
        match self {
            Category::Bytes => "bytes",
            Category::Tokens => "tokens",
            Category::Mutations => "mutations",
        }
    }

    /// The seed of this category in a run with base seed `base`.
    fn seed(self, base: u64) -> u64 {
        let tag = match self {
            Category::Bytes => 1,
            Category::Tokens => 2,
            Category::Mutations => 3,
        };
        splitmix64(base ^ tag)
    }
}

// ---------------------------------------------------------------------------
// The corpus and the token vocabulary
// ---------------------------------------------------------------------------

fn pass_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/syntax/pass")
}

/// One corpus file split into its tokens and the text between them:
/// `gaps.len() == tokens.len() + 1`, and the file is
/// `gaps[0] tokens[0] gaps[1] ... tokens[n-1] gaps[n]`.
struct CorpusFile {
    name: String,
    bytes: Vec<u8>,
    tokens: Vec<String>,
    gaps: Vec<String>,
}

impl CorpusFile {
    fn new(name: String, bytes: Vec<u8>) -> Self {
        let text = std::str::from_utf8(&bytes)
            .unwrap_or_else(|e| panic!("pass/{name} is not UTF-8: {e}"))
            .to_owned();
        let lexed = lex_str(FileId(0), &text);
        let mut tokens = Vec::new();
        let mut gaps = Vec::new();
        let mut cursor = 0;
        for token in lexed.tokens.iter().filter(|t| t.kind != TokenKind::Eof) {
            let range = token.span.range();
            gaps.push(text[cursor..range.start].to_owned());
            tokens.push(text[range.clone()].to_owned());
            cursor = range.end;
        }
        gaps.push(text[cursor..].to_owned());
        CorpusFile {
            name,
            bytes,
            tokens,
            gaps,
        }
    }
}

/// Every `tests/syntax/pass/*.mtek` file, in sorted order.
fn corpus() -> Vec<CorpusFile> {
    let mut names: Vec<String> = fs::read_dir(pass_dir())
        .unwrap()
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().into_string().ok()?;
            name.ends_with(".mtek").then_some(name)
        })
        .collect();
    names.sort();
    let files: Vec<CorpusFile> = names
        .into_iter()
        .map(|name| {
            let bytes = fs::read(pass_dir().join(&name)).unwrap();
            CorpusFile::new(name, bytes)
        })
        .collect();
    assert!(files.len() >= 80, "the pass corpus is missing files");
    files
}

/// Literals and characters that are awkward for the lexer or the parser.
const AWKWARD: &[&str] = &[
    "0",
    "007",
    "0x",
    "0x1F",
    "0b101",
    "1_000",
    "1__0",
    "10u32",
    "1.",
    ".5",
    "1e",
    "1e3",
    "1.e3",
    "2.5e-3",
    "1e+",
    "18446744073709551616",
    "340282366920938463463374607431768211456",
    "1e999999",
    "0..n",
    "\"\"",
    "\"abc\"",
    "\"a\\n\"",
    "\"\\q\"",
    "\"\\u{41}\"",
    "\"\\u{110000}\"",
    "\"\\u{\"",
    "\"unterminated",
    "#fff",
    "#6b5cff",
    "#6b5cffcc",
    "#12345g",
    "#",
    "//",
    "/// doc",
    "/*",
    "*/",
    "/* a */",
    "/* /* */ */",
    "@",
    "$",
    "`",
    "'",
    "?",
    "\\",
    "\0",
    "\r",
    "\u{a0}",
    "\u{2028}",
    "\u{1F600}",
    "\u{65e5}\u{672c}",
    "\u{e9}",
    "_",
    "__x",
    "self",
];

/// The token vocabulary: keywords, punctuation, reserved words, awkward
/// literals and every distinct token text of the corpus (which brings in the
/// contextual words, type names and literals of real programs).
fn vocabulary(corpus: &[CorpusFile]) -> Vec<String> {
    let mut words: BTreeSet<String> = BTreeSet::new();
    words.extend(KEYWORDS.iter().map(|(text, _)| (*text).to_owned()));
    words.extend(PUNCTUATION.iter().map(|(text, _)| (*text).to_owned()));
    words.extend(RESERVED_WORDS.iter().map(|text| (*text).to_owned()));
    words.extend(AWKWARD.iter().map(|text| (*text).to_owned()));
    for file in corpus {
        words.extend(file.tokens.iter().cloned());
    }
    words.into_iter().collect()
}

/// Everything the generators draw from, built once per test.
struct Material {
    corpus: Vec<CorpusFile>,
    vocabulary: Vec<String>,
    /// `(file, token)` of every corpus token, for frequency-weighted picks
    /// and runs of consecutive tokens.
    occurrences: Vec<(usize, usize)>,
}

impl Material {
    fn new() -> Self {
        let corpus = corpus();
        let vocabulary = vocabulary(&corpus);
        let occurrences = corpus
            .iter()
            .enumerate()
            .flat_map(|(f, file)| (0..file.tokens.len()).map(move |t| (f, t)))
            .collect();
        Material {
            corpus,
            vocabulary,
            occurrences,
        }
    }
}

// ---------------------------------------------------------------------------
// Category 1: random byte strings
// ---------------------------------------------------------------------------

/// Whole UTF-8 sequences that matter to the lexer.
const SPICE: &[&str] = &[
    "/",
    "*",
    "\"",
    "\\",
    "#",
    ".",
    "0",
    "1",
    "7",
    "9",
    "e",
    "E",
    "x",
    "_",
    " ",
    "\t",
    "\r",
    "\n",
    "{",
    "}",
    "(",
    ")",
    "[",
    "]",
    "<",
    ">",
    ",",
    ";",
    ":",
    "+",
    "-",
    "=",
    "!",
    "&",
    "|",
    "^",
    "~",
    "%",
    "@",
    "$",
    "`",
    "'",
    "?",
    "a",
    "Z",
    "f",
    "n",
    "u",
    "\0",
    "\u{a0}",
    "\u{2028}",
    "\u{1F600}",
    "\u{e9}",
    "\u{65e5}",
];

/// Byte sequences that are not UTF-8: stray continuation bytes, truncated
/// sequences, overlong encodings, surrogates, bytes that never occur.
const BROKEN_UTF8: &[&[u8]] = &[
    &[0x80],
    &[0xBF],
    &[0xC3],
    &[0xE2, 0x82],
    &[0xF0, 0x9F, 0x98],
    &[0xC0, 0xAF],
    &[0xE0, 0x80, 0xAF],
    &[0xED, 0xA0, 0x80],
    &[0xF4, 0x90, 0x80, 0x80],
    &[0xFE],
    &[0xFF],
];

/// Text in front of a deep nesting, so that it reaches the different parsers.
const NESTING_CONTEXTS: &[&str] = &[
    "",
    "fn f() { ",
    "fn f() { let x = ",
    "fn f() { return ",
    "const C = ",
    "fn f() -> array<",
    "struct S { a: array<",
    "scene S { ",
    "prefab P() { ",
    "scene S { entity E { ",
    "fn f(a: ",
    "fn f() { x = g(",
];

/// One level of a deep nesting: what opens it and what closes it.
const NESTING_LEVELS: &[(&str, &str)] = &[
    ("(", ")"),
    ("[", "]"),
    ("{", "}"),
    ("<", ">"),
    ("-", ""),
    ("!", ""),
    ("f(", ")"),
    ("if a { ", " }"),
    ("{ ", " }"),
    ("entity E { ", " }"),
    ("array<", ", 2>"),
    ("T { a: ", " }"),
    ("a.", ""),
    ("a + ", ""),
    (" else if a { ", " }"),
];

/// A nesting at least 300 levels deep, closed properly, partly, wrongly or
/// not at all.
fn deep_nesting(rng: &mut Rng, out: &mut Vec<u8>) {
    out.extend_from_slice(rng.pick(NESTING_CONTEXTS).as_bytes());
    let depth = rng.between(300, 320);
    let mixed = rng.chance(1, 3);
    let first = *rng.pick(NESTING_LEVELS);
    let mut closers = Vec::with_capacity(depth);
    for _ in 0..depth {
        let (open, close) = if mixed {
            *rng.pick(NESTING_LEVELS)
        } else {
            first
        };
        out.extend_from_slice(open.as_bytes());
        closers.push(close);
    }
    out.extend_from_slice(rng.pick(&["a", "1", "", "x.y", "\"s\"", ";"]).as_bytes());
    match rng.below(4) {
        0 => {}
        1 => {
            let keep = rng.below(depth);
            for close in closers.iter().rev().take(keep) {
                out.extend_from_slice(close.as_bytes());
            }
        }
        2 => {
            for _ in 0..depth {
                out.extend_from_slice(rng.pick(&[")", "]", "}", ">"]).as_bytes());
            }
        }
        _ => {
            for close in closers.iter().rev() {
                out.extend_from_slice(close.as_bytes());
            }
        }
    }
}

/// A run of hundreds or thousands of digits, sometimes shaped like a literal.
fn digit_run(rng: &mut Rng, out: &mut Vec<u8>) {
    out.extend_from_slice(rng.pick(&["", "", "0x", "-", "1.", "0", "#"]).as_bytes());
    let length = rng.between(100, 2000);
    let digits: &[u8] = if rng.chance(1, 2) {
        b"9"
    } else {
        b"0123456789"
    };
    for _ in 0..length {
        out.push(*rng.pick(digits));
    }
    out.extend_from_slice(
        rng.pick(&["", "", ".5", "e9", "e", "u32", "_", ".."])
            .as_bytes(),
    );
}

/// A random Unicode scalar value, biased towards the interesting planes.
fn random_char(rng: &mut Rng) -> char {
    let value = match rng.below(5) {
        0 => rng.below(0x80),
        1 => rng.below(0x800),
        2 => rng.below(0x1_0000),
        3 => rng.below(0x11_0000),
        _ => *rng.pick(&[
            0x0, 0x9, 0xA, 0xD, 0x85, 0xA0, 0x2028, 0x2029, 0xFEFF, 0xFFFD,
        ]),
    };
    char::from_u32(u32::try_from(value).unwrap()).unwrap_or('\u{FFFD}')
}

fn random_bytes(rng: &mut Rng) -> Vec<u8> {
    let target = if rng.chance(1, 8) {
        rng.below(17)
    } else {
        rng.below(MAX_INPUT_LEN + 1)
    };
    let mut out: Vec<u8> = Vec::with_capacity(target + 64);
    match rng.below(20) {
        // Uniformly random bytes: almost always invalid UTF-8.
        0..=2 => out.extend((0..target).map(|_| rng.byte())),
        // Lexer fragments; in a quarter of the cases a random byte now and then.
        3..=8 => {
            let salted = rng.chance(1, 4);
            while out.len() < target {
                if salted && rng.chance(1, 40) {
                    out.push(rng.byte());
                } else {
                    out.extend_from_slice(rng.pick(SPICE).as_bytes());
                }
            }
        }
        // Random Unicode text: always valid UTF-8.
        9..=11 => {
            while out.len() < target {
                let mut buffer = [0; 4];
                out.extend_from_slice(random_char(rng).encode_utf8(&mut buffer).as_bytes());
            }
        }
        // Feature soup; in a quarter of the cases with broken UTF-8 and
        // misplaced byte-order marks, which the source map rejects.
        _ => {
            let broken = rng.chance(1, 4);
            if rng.chance(1, 8) {
                out.extend_from_slice("\u{feff}".as_bytes());
            }
            while out.len() < target {
                match rng.below(12) {
                    0 => out.push(b'\r'),
                    1 => out.extend_from_slice(rng.pick(&["\r\n", "\n", "\n\r"]).as_bytes()),
                    2 => out.push(0),
                    3 => digit_run(rng, &mut out),
                    4 => deep_nesting(rng, &mut out),
                    5 if broken && rng.chance(1, 4) => {
                        out.extend_from_slice(rng.pick(BROKEN_UTF8));
                    }
                    6 if broken && rng.chance(1, 4) => {
                        out.extend_from_slice("\u{feff}".as_bytes());
                    }
                    7 => out.extend_from_slice(rng.pick(AWKWARD).as_bytes()),
                    8 => out.extend_from_slice(rng.pick(KEYWORDS).0.as_bytes()),
                    9 => out.extend_from_slice(rng.pick(PUNCTUATION).0.as_bytes()),
                    10 => out.extend_from_slice(rng.pick(&["\"", "/*", "///", "\"\\"]).as_bytes()),
                    _ => out.extend_from_slice(rng.pick(SPICE).as_bytes()),
                }
            }
        }
    }
    // Cutting may split a character: that is one more kind of broken input.
    out.truncate(MAX_INPUT_LEN);
    out
}

// ---------------------------------------------------------------------------
// Category 2: random token sequences
// ---------------------------------------------------------------------------

const SEPARATORS: &[(&str, usize)] = &[
    (" ", 50),
    ("", 10),
    ("\n", 20),
    ("\r\n", 5),
    ("\t", 4),
    ("\r", 3),
    (" // c\n", 4),
    (" /* c */ ", 2),
    ("\n/// d\n", 2),
];

fn separator(rng: &mut Rng) -> &'static str {
    let total: usize = SEPARATORS.iter().map(|(_, weight)| weight).sum();
    let mut roll = rng.below(total);
    for (text, weight) in SEPARATORS {
        if roll < *weight {
            return text;
        }
        roll -= weight;
    }
    " "
}

fn random_tokens(rng: &mut Rng, material: &Material) -> Vec<u8> {
    let count = if rng.chance(1, 10) {
        rng.below(8)
    } else {
        rng.below(400)
    };
    let mut out = String::new();
    // A byte-order mark is allowed only at the start (anywhere else the
    // source map rejects the file, so it is not in the vocabulary).
    if rng.chance(1, 16) {
        out.push('\u{feff}');
    }
    for _ in 0..count {
        let mut piece = String::new();
        match rng.below(20) {
            // A corpus token, weighted by how often it occurs.
            0..=8 => {
                let (f, t) = *rng.pick(&material.occurrences);
                piece.push_str(&material.corpus[f].tokens[t]);
            }
            // Any word of the vocabulary.
            9..=14 => piece.push_str(rng.pick(&material.vocabulary)),
            // A run of consecutive corpus tokens, to get deeper into the grammar.
            15..=17 => {
                let (f, t) = *rng.pick(&material.occurrences);
                let tokens = &material.corpus[f].tokens;
                let end = (t + rng.between(2, 12)).min(tokens.len());
                piece.push_str(&tokens[t..end].join(" "));
            }
            _ => piece.push_str(rng.pick(AWKWARD)),
        }
        if out.len() + piece.len() + 8 > MAX_INPUT_LEN {
            break;
        }
        out.push_str(&piece);
        out.push_str(separator(rng));
    }
    out.into_bytes()
}

// ---------------------------------------------------------------------------
// Category 3: corpus mutations
// ---------------------------------------------------------------------------

/// The corpus files cut at every 7th byte, and how many such cases there are.
struct Truncations {
    files: Vec<usize>,
    cases: usize,
}

/// A few corpus files (picked by the category seed) to truncate.
fn truncations(seed: u64, corpus: &[CorpusFile]) -> Truncations {
    let mut rng = Rng::new(seed ^ 0x7);
    let mut files: Vec<usize> = Vec::new();
    while files.len() < 3 {
        let pick = rng.below(corpus.len());
        if !files.contains(&pick) {
            files.push(pick);
        }
    }
    let cases = files
        .iter()
        .map(|&f| corpus[f].bytes.len().div_ceil(7))
        .sum();
    Truncations { files, cases }
}

/// Mutation case `index`: first the truncations, then token mutations.
fn mutation(
    index: usize,
    rng: &mut Rng,
    material: &Material,
    truncations: &Truncations,
) -> Vec<u8> {
    if index < truncations.cases {
        let mut rest = index;
        for &f in &truncations.files {
            let bytes = &material.corpus[f].bytes;
            let ends = bytes.len().div_ceil(7);
            if rest < ends {
                // Raw bytes: a cut inside a character is invalid UTF-8.
                return bytes[..rest * 7].to_vec();
            }
            rest -= ends;
        }
    }
    let file = rng.pick(&material.corpus);
    let mut tokens = file.tokens.clone();
    if !tokens.is_empty() {
        for _ in 0..rng.between(1, 3) {
            let at = rng.below(tokens.len());
            match rng.below(3) {
                0 => tokens[at].clear(),
                1 => {
                    let copy = tokens[at].clone();
                    let glue = if rng.chance(1, 5) { "" } else { " " };
                    tokens[at] = format!("{copy}{glue}{copy}");
                }
                _ => {
                    let other = rng.below(tokens.len());
                    tokens.swap(at, other);
                }
            }
        }
    }
    let mut out = String::new();
    for (gap, token) in file.gaps.iter().zip(&tokens) {
        out.push_str(gap);
        out.push_str(token);
    }
    out.push_str(file.gaps.last().map_or("", String::as_str));
    out.into_bytes()
}

/// Input `index` of `category`.
fn generate(
    category: Category,
    seed: u64,
    index: usize,
    material: &Material,
    truncations: &Truncations,
) -> Vec<u8> {
    let mut rng = Rng::for_case(seed, index);
    match category {
        Category::Bytes => random_bytes(&mut rng),
        Category::Tokens => random_tokens(&mut rng, material),
        Category::Mutations => mutation(index, &mut rng, material, truncations),
    }
}

// ---------------------------------------------------------------------------
// One case: source loading, lexing, parsing, and the invariants
// ---------------------------------------------------------------------------

/// What happened to an input that passed.
#[derive(Clone, PartialEq, Eq, Debug)]
enum Outcome {
    /// The source map rejected it with this code (`E0001`, `E0002`, `E0004`).
    Rejected(&'static str),
    /// It was lexed and parsed; these codes were reported (with repeats).
    Parsed(Vec<Code>),
}

/// Why a case failed.
#[derive(Clone, PartialEq, Eq, Debug)]
enum Failure {
    /// The front end panicked with this message.
    Panic(String),
    /// An invariant does not hold; the message starts with `[rule]`.
    Invariant(String),
    /// The case did not finish within the time budget.
    Timeout,
}

impl Failure {
    /// What must stay the same while the minimiser shrinks the input: the
    /// panic message, or the rule an invariant message starts with.
    fn signature(&self) -> String {
        match self {
            Failure::Panic(message) => format!("panic: {message}"),
            Failure::Invariant(message) => {
                let rule = message.split(']').next().unwrap_or(message);
                format!("invariant {rule}]")
            }
            Failure::Timeout => "timeout".to_owned(),
        }
    }
}

macro_rules! ensure {
    ($condition:expr, $rule:literal, $format:literal $($arguments:tt)*) => {
        if !$condition {
            let message = format!($format $($arguments)*);
            return Err(format!("[{}] {message}", $rule));
        }
    };
}

/// A span lies within the file `file` of `text.len()` bytes, on character
/// boundaries.
fn check_span(span: Span, file: FileId, text: &str, what: &str) -> Result<(), String> {
    ensure!(
        span.file == file,
        "span-file",
        "{what}: {span:?} is in another file"
    );
    ensure!(
        span.start <= span.end,
        "span-order",
        "{what}: {span:?} is inverted"
    );
    ensure!(
        span.end as usize <= text.len(),
        "span-bounds",
        "{what}: {span:?} ends beyond the {} bytes of the file",
        text.len()
    );
    ensure!(
        text.get(span.range()).is_some(),
        "span-boundary",
        "{what}: {span:?} splits a character"
    );
    Ok(())
}

/// The codes the front end (source map, lexer, parser, sink) may report: the
/// source-text and syntax ranges, `E4901` (a stage the parser rejects) and the
/// sink's `W9003`. Never `E9999`.
fn front_end_code(code: Code) -> bool {
    code != Code::E9999
        && (matches!(code.range(), 0 | 1) || matches!(code, Code::E4901 | Code::W9003))
}

/// A diagnostic of the file `file`: catalogue code, catalogued severity,
/// every span in bounds.
fn check_diagnostic(diagnostic: &Diagnostic, file: FileId, text: &str) -> Result<(), String> {
    let code = diagnostic.code;
    ensure!(
        Code::ALL.contains(&code) && Code::parse(code.as_str()) == Some(code),
        "catalogue",
        "{code:?} is not a catalogue code"
    );
    ensure!(
        front_end_code(code),
        "catalogue",
        "{code} is not a front-end code"
    );
    ensure!(
        diagnostic.severity == code.severity(),
        "severity",
        "{code} reported as {:?}",
        diagnostic.severity
    );
    let Some(primary) = &diagnostic.primary else {
        return Err(format!("[unlocated] {code} has no location"));
    };
    check_span(primary.span, file, text, code.short())?;
    for label in &diagnostic.related {
        check_span(label.span, file, text, &format!("{code} related"))?;
    }
    for edit in diagnostic.edits.iter().flat_map(|e| &e.edits) {
        check_span(edit.span, file, text, &format!("{code} edit"))?;
    }
    Ok(())
}

/// Load, lex and parse `bytes` as the compiler does, and check every
/// invariant. Returns `Err` with a `[rule] message` for a broken invariant.
fn front_end_with(bytes: &[u8], render: bool) -> Result<Outcome, String> {
    let mut map = SourceMap::new();
    let path = ProjectPath::new("src/fuzz.mtek").map_err(|e| format!("[harness] {e}"))?;
    let id = match map.add(path, bytes) {
        Ok(id) => id,
        Err(error) => {
            let code = error.code();
            ensure!(
                matches!(code, "E0001" | "E0002" | "E0004"),
                "source",
                "unexpected rejection {code}: {error}"
            );
            let diagnostic = Diagnostic::from_source_error(&error);
            ensure!(
                diagnostic.code.short() == code && Code::ALL.contains(&diagnostic.code),
                "catalogue",
                "rejection {code} became {:?}",
                diagnostic.code
            );
            if let Some((start, end)) = error.byte_range() {
                ensure!(
                    start < end && end as usize <= bytes.len(),
                    "span-bounds",
                    "rejection {code} at {start}..{end} of {} bytes",
                    bytes.len()
                );
            }
            return Ok(Outcome::Rejected(code));
        }
    };
    let Some(file) = map.get(id) else {
        return Err("[harness] the added file is missing".to_owned());
    };
    let text = file.text();
    let end = u32::try_from(text.len()).map_err(|e| format!("[harness] {e}"))?;

    // Lexing: one Eof, at the end of the text; every token in bounds.
    let mut lexed = lex(file);
    let Some((eof, tokens)) = lexed.tokens.split_last() else {
        return Err("[eof] the token stream is empty".to_owned());
    };
    ensure!(
        eof.kind == TokenKind::Eof && eof.span == Span::at(id, end),
        "eof",
        "the stream ends with {eof:?}, not Eof at {end}"
    );
    for token in tokens {
        ensure!(
            token.kind != TokenKind::Eof,
            "eof",
            "Eof before the end at {:?}",
            token.span
        );
        check_span(token.span, id, text, "token")?;
    }
    for fix in &lexed.float_fixes {
        check_span(fix.span, id, text, "float fix")?;
    }

    // Parsing: the module covers the file, so the parser reached Eof.
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    let module = &parsed.module;
    ensure!(
        module.span == Span::new(id, 0, end),
        "eof",
        "the module spans {:?}, not the whole file",
        module.span
    );
    let mut seen = vec![false; module.node_count as usize];
    let mut tree: Result<(), String> = Ok(());
    walk_module(module, &mut |node, parent| {
        if tree.is_err() {
            return;
        }
        if let Some(parent) = parent.filter(|p| !p.span.contains_span(node.span)) {
            tree = Err(format!(
                "[node-nesting] {} {:?} lies outside its parent {} {:?}",
                node.kind, node.span, parent.kind, parent.span
            ));
            return;
        }
        tree = check_span(node.span, id, text, node.kind).and_then(|()| {
            match seen.get_mut(node.id.0 as usize) {
                Some(slot) if !*slot => {
                    *slot = true;
                    Ok(())
                }
                Some(_) => Err(format!("[node-id] {:?} is used twice", node.id)),
                None => Err(format!(
                    "[node-id] {:?} is not below node_count {}",
                    node.id, module.node_count
                )),
            }
        });
    });
    tree?;
    // Later passes dump and walk the tree; dropping it happens at the end.
    let _dump = dump_module(module);

    for candidate in &parsed.candidate_edits {
        check_span(candidate.at, id, text, "candidate edit")?;
        for edit in &candidate.edit.edits {
            check_span(edit.span, id, text, "candidate edit")?;
        }
    }

    let report = sink.finish();
    ensure!(
        report.diagnostics.len() <= MAX_DIAGNOSTICS_PER_FILE + 1,
        "cap",
        "{} diagnostics in one file",
        report.diagnostics.len()
    );
    for diagnostic in &report.diagnostics {
        check_diagnostic(diagnostic, id, text)?;
    }
    // The driver renders what it reports; that must not fail either. It is
    // slow next to lexing and parsing, so only some cases do it.
    if render {
        let _human = render_report(&report, &map, RenderOptions { color: false });
        let _json = to_report(&report, None, &map);
    }
    Ok(Outcome::Parsed(
        report.diagnostics.iter().map(|d| d.code).collect(),
    ))
}

/// Every [`RENDER_EVERY`]th case also renders its diagnostics.
const RENDER_EVERY: usize = 8;

/// [`front_end_with`] without rendering.
fn front_end(bytes: &[u8]) -> Result<Outcome, String> {
    front_end_with(bytes, false)
}

/// [`front_end_with`], rendering the report as text and JSON.
fn front_end_rendered(bytes: &[u8]) -> Result<Outcome, String> {
    front_end_with(bytes, true)
}

// ---------------------------------------------------------------------------
// The harness: a thread per case, a time budget, the minimiser
// ---------------------------------------------------------------------------

/// Keep the panic messages of [`QUIET_THREAD`] threads out of the output.
fn install_quiet_panic_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let previous = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            if thread::current().name() != Some(QUIET_THREAD) {
                previous(info);
            }
        }));
    });
}

fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_owned()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "a panic without a message".to_owned()
    }
}

/// Run `case(bytes)` on a thread of its own and wait at most `budget`.
fn run_case_with(
    bytes: &[u8],
    case: fn(&[u8]) -> Result<Outcome, String>,
    budget: Duration,
    quiet: bool,
) -> Result<Outcome, Failure> {
    install_quiet_panic_hook();
    let (sender, receiver) = mpsc::channel();
    let input = bytes.to_vec();
    let name = if quiet {
        QUIET_THREAD
    } else {
        "robustness-case"
    };
    let handle = thread::Builder::new()
        .name(name.to_owned())
        .stack_size(CASE_STACK_BYTES)
        .spawn(move || {
            let result = panic::catch_unwind(AssertUnwindSafe(|| case(&input)));
            // The receiver is gone if the case ran out of time; nobody to tell.
            let _ = sender.send(result.map_err(|payload| panic_message(&*payload)));
        })
        .expect("cannot spawn a case thread");
    match receiver.recv_timeout(budget) {
        Ok(result) => {
            // The thread has sent its last message and ends now.
            let _ = handle.join();
            match result {
                Ok(Ok(outcome)) => Ok(outcome),
                Ok(Err(violation)) => Err(Failure::Invariant(violation)),
                Err(message) => Err(Failure::Panic(message)),
            }
        }
        // The thread is left running; the test fails anyway.
        Err(mpsc::RecvTimeoutError::Timeout) => Err(Failure::Timeout),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(Failure::Panic(
            "the case thread ended without a result".to_owned(),
        )),
    }
}

/// Shrink `input` while `case` keeps failing with the same signature (delta
/// debugging: remove ever smaller chunks), within [`MINIMISE_ATTEMPTS`].
fn minimise(
    input: &[u8],
    failure: &Failure,
    case: fn(&[u8]) -> Result<Outcome, String>,
    budget: Duration,
) -> Vec<u8> {
    let signature = failure.signature();
    let still_fails = |candidate: &[u8]| {
        run_case_with(candidate, case, budget, true)
            .err()
            .is_some_and(|f| f.signature() == signature)
    };
    let mut current = input.to_vec();
    let mut chunk = current.len().div_ceil(2).max(1);
    let mut attempts = 0;
    while attempts < MINIMISE_ATTEMPTS && !current.is_empty() {
        let mut progressed = false;
        let mut at = 0;
        while at < current.len() && attempts < MINIMISE_ATTEMPTS {
            let end = (at + chunk).min(current.len());
            let mut candidate = current[..at].to_vec();
            candidate.extend_from_slice(&current[end..]);
            attempts += 1;
            if still_fails(&candidate) {
                current = candidate;
                progressed = true;
            } else {
                at = end;
            }
        }
        if !progressed {
            if chunk == 1 {
                break;
            }
            chunk = chunk.div_ceil(2);
        }
    }
    current
}

/// `bytes` as a Rust byte string literal, to paste into a regression test.
fn byte_literal(bytes: &[u8]) -> String {
    let mut out = String::from("b\"");
    for &byte in bytes {
        match byte {
            b'"' => out.push_str("\\\""),
            b'\\' => out.push_str("\\\\"),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            b'\0' => out.push_str("\\0"),
            0x20..=0x7E => out.push(char::from(byte)),
            _ => out.push_str(&format!("\\x{byte:02x}")),
        }
    }
    out.push('"');
    out
}

/// Fail the test for case `index`, printing everything needed to reproduce it.
fn report_failure(
    category: Category,
    base: u64,
    index: usize,
    input: &[u8],
    failure: &Failure,
    case: fn(&[u8]) -> Result<Outcome, String>,
    budget: Duration,
) -> ! {
    let header = format!(
        "{} case {index} failed (MTEK_TEST_SEED={base:#018x}): {failure:?}",
        category.name()
    );
    if *failure == Failure::Timeout {
        panic!(
            "{header}\ntook longer than {budget:?}; input ({} bytes):\n{}",
            input.len(),
            byte_literal(input)
        );
    }
    let minimal = minimise(input, failure, case, budget);
    panic!(
        "{header}\nminimised input ({} of {} bytes):\n{}\nfull input:\n{}",
        minimal.len(),
        input.len(),
        byte_literal(&minimal),
        byte_literal(input)
    );
}

/// What a category run saw, for the coverage assertions.
#[derive(Default, Debug)]
struct Coverage {
    cases: usize,
    rejected: BTreeMap<&'static str, usize>,
    parsed: usize,
    parsed_with_diagnostics: usize,
    codes: BTreeMap<Code, usize>,
    /// Inputs (by scanning the bytes) with a NUL, a lone `\r`, a run of at
    /// least 100 digits, and brackets nested at least 300 deep.
    nul: usize,
    lone_cr: usize,
    digit_runs: usize,
    deep: usize,
    longest: usize,
    slowest: Duration,
}

impl Coverage {
    fn scan(&mut self, bytes: &[u8]) {
        self.cases += 1;
        self.longest = self.longest.max(bytes.len());
        if bytes.contains(&0) {
            self.nul += 1;
        }
        let lone_cr = bytes
            .iter()
            .enumerate()
            .any(|(i, &b)| b == b'\r' && bytes.get(i + 1) != Some(&b'\n'));
        if lone_cr {
            self.lone_cr += 1;
        }
        let (mut run, mut longest_run) = (0usize, 0usize);
        let (mut depth, mut deepest) = (0i64, 0i64);
        for &b in bytes {
            run = if b.is_ascii_digit() { run + 1 } else { 0 };
            longest_run = longest_run.max(run);
            match b {
                b'(' | b'[' | b'{' | b'<' => depth += 1,
                b')' | b']' | b'}' | b'>' => depth -= 1,
                _ => {}
            }
            deepest = deepest.max(depth);
        }
        if longest_run >= 100 {
            self.digit_runs += 1;
        }
        if deepest >= 300 {
            self.deep += 1;
        }
    }

    fn record(&mut self, outcome: Outcome) {
        match outcome {
            Outcome::Rejected(code) => *self.rejected.entry(code).or_default() += 1,
            Outcome::Parsed(codes) => {
                self.parsed += 1;
                if !codes.is_empty() {
                    self.parsed_with_diagnostics += 1;
                }
                for code in codes {
                    *self.codes.entry(code).or_default() += 1;
                }
            }
        }
    }

    fn saw(&self, code: Code) -> usize {
        self.codes.get(&code).copied().unwrap_or(0)
    }

    fn rejections(&self, code: &str) -> usize {
        self.rejected.get(code).copied().unwrap_or(0)
    }
}

/// Run `cases` cases of `category` and return what they covered.
fn run_category(category: Category, cases: usize, material: &Material) -> Coverage {
    let base = base_seed();
    let seed = category.seed(base);
    let truncations = truncations(seed, &material.corpus);
    println!(
        "robustness {}: {cases} cases, base seed {base:#018x} (MTEK_TEST_SEED overrides), category seed {seed:#018x}",
        category.name()
    );
    if category == Category::Mutations {
        let names: Vec<&str> = truncations
            .files
            .iter()
            .map(|&f| material.corpus[f].name.as_str())
            .collect();
        println!(
            "robustness mutations: {} truncations of {names:?}",
            truncations.cases.min(cases)
        );
    }
    let started = Instant::now();
    let mut coverage = Coverage::default();
    for index in 0..cases {
        let input = generate(category, seed, index, material, &truncations);
        coverage.scan(&input);
        let case: fn(&[u8]) -> Result<Outcome, String> = if index % RENDER_EVERY == 0 {
            front_end_rendered
        } else {
            front_end
        };
        let case_started = Instant::now();
        match run_case_with(&input, case, CASE_TIME_BUDGET, false) {
            Ok(outcome) => coverage.record(outcome),
            Err(failure) => report_failure(
                category,
                base,
                index,
                &input,
                &failure,
                case,
                CASE_TIME_BUDGET,
            ),
        }
        coverage.slowest = coverage.slowest.max(case_started.elapsed());
    }
    println!(
        "robustness {}: {} cases in {:.2?} (slowest {:.2?}, longest {} bytes); rejected {:?}, parsed {} ({} with diagnostics); nul {}, lone CR {}, digit runs {}, deep nesting {}; codes {:?}",
        category.name(),
        coverage.cases,
        started.elapsed(),
        coverage.slowest,
        coverage.longest,
        coverage.rejected,
        coverage.parsed,
        coverage.parsed_with_diagnostics,
        coverage.nul,
        coverage.lone_cr,
        coverage.digit_runs,
        coverage.deep,
        coverage.codes
    );
    coverage
}

// ---------------------------------------------------------------------------
// The default run: 15 000 cases
// ---------------------------------------------------------------------------

#[test]
fn random_byte_strings_never_break_the_front_end() {
    let material = Material::new();
    let c = run_category(Category::Bytes, CASES_PER_CATEGORY, &material);
    assert_eq!(c.cases, CASES_PER_CATEGORY);
    assert!(
        c.longest <= MAX_INPUT_LEN && c.longest > MAX_INPUT_LEN - 64,
        "{c:?}"
    );
    // Every kind of input really occurs, whatever the seed (the bounds are
    // about half of what the default seed produces).
    assert!(c.rejections("E0001") >= 600, "invalid UTF-8: {c:?}");
    assert!(
        c.rejections("E0002") >= 200,
        "misplaced byte-order marks: {c:?}"
    );
    assert!(c.parsed >= 2000, "accepted inputs: {c:?}");
    assert!(c.nul >= 1000 && c.lone_cr >= 1000, "NUL and lone CR: {c:?}");
    assert!(c.digit_runs >= 500, "huge digit runs: {c:?}");
    assert!(c.deep >= 300, "300-deep nesting: {c:?}");
    assert!(
        c.saw(Code::E1050) >= 50,
        "the nesting limit is reached: {c:?}"
    );
    assert!(
        c.saw(Code::W9003) >= 100,
        "the diagnostic cap is reached: {c:?}"
    );
}

#[test]
fn random_token_sequences_never_break_the_front_end() {
    let material = Material::new();
    let c = run_category(Category::Tokens, CASES_PER_CATEGORY, &material);
    assert_eq!(c.cases, CASES_PER_CATEGORY);
    // Valid UTF-8 without a misplaced byte-order mark: all of it is parsed.
    assert_eq!(c.parsed, CASES_PER_CATEGORY, "{c:?}");
    assert!(c.parsed_with_diagnostics >= 4000, "{c:?}");
    // The parser's diagnostics, not only the lexer's, are exercised.
    for code in [Code::E1001, Code::E1002, Code::E1004, Code::E1040] {
        assert!(c.saw(code) >= 10, "{code} is rare: {c:?}");
    }
}

#[test]
fn mutated_corpus_files_never_break_the_front_end() {
    let material = Material::new();
    let c = run_category(Category::Mutations, CASES_PER_CATEGORY, &material);
    assert_eq!(c.cases, CASES_PER_CATEGORY);
    assert!(c.parsed >= 4500, "{c:?}");
    assert!(c.parsed_with_diagnostics >= 2500, "{c:?}");
    for code in [Code::E1001, Code::E1002, Code::E1003, Code::E1004] {
        assert!(c.saw(code) >= 10, "{code} is rare: {c:?}");
    }
}

/// The long variant: 50 000 cases. See the module documentation.
#[test]
#[ignore = "50 000 cases; run locally: cargo test -p mtek-compiler --test robustness --release -- --ignored"]
fn fifty_thousand_cases() {
    let material = Material::new();
    let mut total = 0;
    for (i, category) in Category::ALL.into_iter().enumerate() {
        let cases = LONG_RUN_CASES / 3 + usize::from(i < LONG_RUN_CASES % 3);
        total += run_category(category, cases, &material).cases;
    }
    assert_eq!(total, LONG_RUN_CASES);
}

// ---------------------------------------------------------------------------
// The generator and the harness themselves
// ---------------------------------------------------------------------------

#[test]
fn the_generator_is_deterministic_and_platform_independent() {
    // Golden values: a change here changes every input of every run.
    let mut rng = Rng::new(DEFAULT_SEED);
    let first: Vec<u64> = (0..3).map(|_| rng.next_u64()).collect();
    let mut again = Rng::new(DEFAULT_SEED);
    assert_eq!(first, (0..3).map(|_| again.next_u64()).collect::<Vec<_>>());
    assert_eq!(
        first,
        [GOLDEN[0], GOLDEN[1], GOLDEN[2]],
        "xorshift64* or its seeding changed"
    );
    // Seeds of different categories and cases differ.
    let seeds: BTreeSet<u64> = Category::ALL.iter().map(|c| c.seed(DEFAULT_SEED)).collect();
    assert_eq!(seeds.len(), 3);
    assert_ne!(
        Rng::for_case(1, 0).next_u64(),
        Rng::for_case(1, 1).next_u64()
    );
    // The same seed generates the same inputs, a different one others.
    let material = Material::new();
    for category in Category::ALL {
        let seed = category.seed(DEFAULT_SEED);
        let truncations = truncations(seed, &material.corpus);
        let inputs = |seed: u64| -> Vec<Vec<u8>> {
            (0..50)
                .map(|i| generate(category, seed, i, &material, &truncations))
                .collect()
        };
        assert_eq!(inputs(seed), inputs(seed), "{category:?}");
        if category != Category::Mutations {
            assert_ne!(inputs(seed), inputs(seed ^ 1), "{category:?}");
        }
    }
}

/// The first outputs of `Rng::new(DEFAULT_SEED)`.
const GOLDEN: [u64; 3] = [
    172_428_153_933_395_318,
    9_011_861_302_954_333_367,
    3_129_355_947_326_964_556,
];

#[test]
fn seeds_parse_in_decimal_and_hexadecimal() {
    assert_eq!(parse_seed("42"), Some(42));
    assert_eq!(parse_seed(" 0x2A "), Some(42));
    assert_eq!(parse_seed("0X4d54_454b"), Some(0x4D54_454B));
    assert_eq!(parse_seed("18446744073709551615"), Some(u64::MAX));
    assert_eq!(parse_seed("seed"), None);
    assert_eq!(parse_seed("0x"), None);
    assert_eq!(parse_seed("-1"), None);
}

fn panics_on_x(bytes: &[u8]) -> Result<Outcome, String> {
    if bytes.contains(&b'X') {
        panic!("found an X");
    }
    Ok(Outcome::Parsed(Vec::new()))
}

fn breaks_an_invariant_on_xy(bytes: &[u8]) -> Result<Outcome, String> {
    if bytes.windows(2).any(|w| w == b"XY") {
        return Err(format!("[xy] at {} bytes", bytes.len()));
    }
    Ok(Outcome::Parsed(Vec::new()))
}

fn sleeps(_: &[u8]) -> Result<Outcome, String> {
    thread::sleep(Duration::from_millis(500));
    Ok(Outcome::Parsed(Vec::new()))
}

#[test]
fn the_harness_catches_panics_and_minimises_the_input() {
    let budget = Duration::from_secs(5);
    let input = b"fn f() { let a = 1; X let b = 2; }";
    let failure = run_case_with(input, panics_on_x, budget, true).unwrap_err();
    assert_eq!(failure, Failure::Panic("found an X".to_owned()));
    assert_eq!(minimise(input, &failure, panics_on_x, budget), b"X");
    assert_eq!(
        run_case_with(b"fine", panics_on_x, budget, true),
        Ok(Outcome::Parsed(Vec::new()))
    );
}

#[test]
fn the_harness_reports_broken_invariants_and_minimises_them() {
    let budget = Duration::from_secs(5);
    let input = b"aaaaXbbbbXYcccc";
    let failure = run_case_with(input, breaks_an_invariant_on_xy, budget, true).unwrap_err();
    assert_eq!(failure, Failure::Invariant("[xy] at 15 bytes".to_owned()));
    assert_eq!(
        minimise(input, &failure, breaks_an_invariant_on_xy, budget),
        b"XY"
    );
}

#[test]
fn the_harness_enforces_the_time_budget() {
    let started = Instant::now();
    let failure = run_case_with(b"", sleeps, Duration::from_millis(50), true).unwrap_err();
    assert_eq!(failure, Failure::Timeout);
    assert!(started.elapsed() < Duration::from_millis(450));
}

#[test]
fn failures_print_a_reproducible_byte_literal() {
    assert_eq!(
        byte_literal(b"a\"\\\n\r\t\0\x7f\xff~"),
        r#"b"a\"\\\n\r\t\0\x7f\xff~""#
    );
}
