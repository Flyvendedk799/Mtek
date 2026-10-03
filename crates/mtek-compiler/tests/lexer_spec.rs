//! The token tables of the lexer must list exactly the words and symbols of
//! the specification: `spec/language.md` sections 2.2, 2.3 and 2.6 and the
//! lexical productions of `spec/grammar.ebnf`. A change to either side fails
//! this test until both agree (the specification is the authority).

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;

use mtek_compiler::syntax::{KEYWORDS, PUNCTUATION, RESERVED_WORDS};

const LANGUAGE: &str = include_str!("../../../spec/language.md");
const GRAMMAR: &str = include_str!("../../../spec/grammar.ebnf");

/// The whitespace-separated words of the first fenced block after the line
/// that starts with `marker`.
fn words_of_fence_after(spec: &str, marker: &str) -> BTreeSet<String> {
    let mut lines = spec.lines().skip_while(|line| !line.starts_with(marker));
    assert!(lines.next().is_some(), "marker {marker:?} not found");
    let mut lines = lines.skip_while(|line| !line.starts_with("```"));
    assert!(lines.next().is_some(), "no fence after {marker:?}");
    lines
        .take_while(|line| !line.starts_with("```"))
        .flat_map(str::split_whitespace)
        .map(str::to_owned)
        .collect()
}

/// The quoted words (`'word'`) of a grammar production, from the line that
/// starts with `name` up to the next blank line.
fn quoted_words_of_production(grammar: &str, name: &str) -> BTreeSet<String> {
    let block: Vec<&str> = grammar
        .lines()
        .skip_while(|line| !line.starts_with(name))
        .take_while(|line| !line.trim().is_empty())
        .collect();
    assert!(!block.is_empty(), "production {name:?} not found");
    block
        .join(" ")
        .split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

fn set_of(words: impl IntoIterator<Item = impl AsRef<str>>) -> BTreeSet<String> {
    words.into_iter().map(|w| w.as_ref().to_owned()).collect()
}

#[test]
fn keywords_match_language_md_2_2() {
    let spec = words_of_fence_after(LANGUAGE, "2.2 **Keywords");
    assert_eq!(set_of(KEYWORDS.iter().map(|(text, _)| *text)), spec);
    assert_eq!(spec.len(), 26);
}

#[test]
fn reserved_words_match_language_md_2_3() {
    let spec = words_of_fence_after(LANGUAGE, "2.3 **Reserved for future use");
    assert_eq!(set_of(RESERVED_WORDS.iter().copied()), spec);
    assert_eq!(spec.len(), 30);
}

#[test]
fn keywords_and_reserved_words_match_grammar_ebnf() {
    assert_eq!(
        set_of(KEYWORDS.iter().map(|(text, _)| *text)),
        quoted_words_of_production(GRAMMAR, "Keyword  ")
    );
    assert_eq!(
        set_of(RESERVED_WORDS.iter().copied()),
        quoted_words_of_production(GRAMMAR, "Reserved  ")
    );
}

#[test]
fn punctuation_and_operators_match_language_md_2_6() {
    // The code block lists the v0.1 operators; the bitwise ones that are
    // lexed only to be rejected with E1901 are named in the prose below it.
    let mut spec = words_of_fence_after(LANGUAGE, "2.6 **Punctuation and operators");
    let prose = LANGUAGE
        .lines()
        .find(|line| line.contains("Bitwise operators (`"))
        .unwrap();
    let bitwise = prose
        .split("Bitwise operators (`")
        .nth(1)
        .and_then(|rest| rest.split('`').next())
        .unwrap();
    spec.extend(bitwise.split_whitespace().map(str::to_owned));
    assert_eq!(
        set_of(PUNCTUATION.iter().map(|(text, _)| *text)),
        spec,
        "token table and language.md section 2.6 differ"
    );
    assert_eq!(bitwise, "& | ^ ~ << >>");
}
