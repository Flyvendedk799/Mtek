//! `mtek grammar export` (decision 0073): the real binary prints
//! `spec/grammar.ebnf` byte for byte, and the GBNF translation of the same
//! model. The conformance of the GBNF with the compiler is tested by
//! `tools/grammar-adapters` against the pinned validator.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::Path;
use std::process::{Command, Output};

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn export_ebnf_prints_the_checked_in_grammar_exactly() {
    let out = run(&["grammar", "export", "--format", "ebnf"]);
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stderr.is_empty());
    let file =
        std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/grammar.ebnf"))
            .unwrap();
    assert!(out.stdout == file, "stdout differs from spec/grammar.ebnf");
}

#[test]
fn export_gbnf_prints_the_translation_with_a_root() {
    let out = run(&["grammar", "export", "--format", "gbnf"]);
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stderr.is_empty());
    let text = String::from_utf8(out.stdout).unwrap();
    assert_eq!(text, mtek_compiler::syntax::gbnf().unwrap());
    assert!(text.starts_with("# Mtek language 0.1: GBNF grammar"));
    assert!(text.lines().any(|l| l.starts_with("root ::= ")));
}

#[test]
fn export_without_a_known_format_is_a_usage_error() {
    for args in [
        &["grammar"][..],
        &["grammar", "export"],
        &["grammar", "export", "--format", "json"],
    ] {
        let out = run(args);
        assert_eq!(out.status.code(), Some(2), "{args:?}");
        assert!(out.stdout.is_empty(), "{args:?}");
    }
}
