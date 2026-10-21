//! The audit of every diagnostic against `spec/diagnostics.md` sections 5 to 7
//! (decision 0071): what can be checked mechanically is checked here, over
//! two corpora.
//!
//! * The **fixture corpus**: every diagnostic that a golden file of the
//!   repository expects (`tests/syntax/{fail,lex}`, `tests/semantics`,
//!   `tests/assets`). It is the messages as they are really produced.
//! * The **source corpus**: the Rust sources of the compiler, for what no
//!   fixture reaches (internal errors) and for how edits are produced.
//!
//! The rules are those of section 7 ("writing messages") and of the catalogue
//! (the related spans its trigger column promises). A rule that needs an
//! exception names it, with the reason, in the table next to the rule; the
//! tables are exact (an exception that no longer applies fails the test).

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::Code;
use serde_json::Value;

const SPEC: &str = include_str!("../../../spec/diagnostics.md");

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

// ---------------------------------------------------------------------------
// The fixture corpus
// ---------------------------------------------------------------------------

/// One diagnostic of a golden file.
struct Item {
    /// Where it is expected: the golden file, relative to `tests/`.
    label: String,
    code: Code,
    message: String,
    related: usize,
    notes: Vec<String>,
}

fn golden_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            golden_files(&path, out);
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".diag.json"))
        {
            out.push(path);
        }
    }
}

fn corpus() -> Vec<Item> {
    let tests = repo().join("tests");
    let mut files = Vec::new();
    for dir in ["syntax", "semantics", "assets"] {
        golden_files(&tests.join(dir), &mut files);
    }
    let mut items = Vec::new();
    for path in files {
        let label = path
            .strip_prefix(&tests)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let text = fs::read_to_string(&path).unwrap();
        let list: Vec<Value> = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("{label} is not a diagnostics list: {e}"));
        for entry in list {
            let code = Code::parse(entry["code"].as_str().unwrap())
                .unwrap_or_else(|| panic!("{label}: unknown code {}", entry["code"]));
            items.push(Item {
                label: label.clone(),
                code,
                message: entry["message"].as_str().unwrap().to_owned(),
                related: entry["related"].as_array().map_or(0, Vec::len),
                notes: entry["notes"]
                    .as_array()
                    .map(|notes| {
                        notes
                            .iter()
                            .map(|n| n.as_str().unwrap().to_owned())
                            .collect()
                    })
                    .unwrap_or_default(),
            });
        }
    }
    items
}

// ---------------------------------------------------------------------------
// Message rules (spec section 7)
// ---------------------------------------------------------------------------

/// The words of the compiler's own vocabulary that no message may use
/// (section 7: prefer Mtek vocabulary over compiler internals). `WGSL` and
/// `Naga` are the subject of `E6100` and `E8051` and allowed there.
const INTERNAL_WORDS: &[&str] = &["DefId", "NodeId", "TyId", "HIR", "Naga", "WGSL"];

/// Codes whose messages may name the shader language: the generated shader is
/// what they are about.
const MAY_NAME_THE_SHADER_LANGUAGE: &[&str] = &["E6100", "E8051"];

/// The problems of `message` as a diagnostic message of `code`; empty if it
/// follows the rules.
fn message_problems(code: Code, message: &str) -> Vec<String> {
    let mut problems = Vec::new();
    if message != message.trim() {
        problems.push("has leading or trailing whitespace".to_owned());
    }
    if message.contains('\n') || message.contains("  ") {
        problems.push("has a line break or a double space".to_owned());
    }
    if message.starts_with(|c: char| c.is_ascii_lowercase()) {
        problems.push("does not start a sentence (starts with a lowercase letter)".to_owned());
    }
    if !message.ends_with('.') {
        problems.push("is not a complete sentence (does not end with a full stop)".to_owned());
    }
    if message
        .to_ascii_lowercase()
        .trim_end_matches('.')
        .eq(code.title())
    {
        problems.push("repeats the catalogue title instead of being specific".to_owned());
    }
    for word in INTERNAL_WORDS {
        let allowed = MAY_NAME_THE_SHADER_LANGUAGE.contains(&code.short())
            && matches!(*word, "Naga" | "WGSL");
        if !allowed
            && message
                .split(|c: char| !c.is_alphanumeric())
                .any(|w| w == *word)
        {
            problems.push(format!("uses the compiler's own word {word}"));
        }
    }
    if code.is_unsupported_feature() && !message.contains("v0.1") {
        problems.push("names an unsupported feature without saying \"v0.1\"".to_owned());
    }
    problems
}

#[test]
fn every_message_of_the_fixture_corpus_follows_the_message_rules() {
    let items = corpus();
    assert!(items.len() > 500, "{} diagnostics", items.len());
    let mut problems = Vec::new();
    for item in &items {
        for problem in message_problems(item.code, &item.message) {
            problems.push(format!(
                "{} {:?} ({}): {problem}",
                item.code.short(),
                item.message,
                item.label
            ));
        }
    }
    problems.sort();
    problems.dedup();
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn the_message_rules_catch_what_they_are_for() {
    let bad = [
        (Code::E2003, "unknown name 'x'."),
        (Code::E2003, "Unknown name 'x'"),
        (Code::E2003, "Unknown  name 'x'."),
        (Code::E2003, "Unknown name 'x'.\n"),
        (Code::E2003, "unknown name."),
        (Code::E2003, "The DefId 3 has no NodeId."),
        (Code::E1901, "The operator `&` is not supported."),
        (Code::E2003, "Unknown name."),
    ];
    for (code, message) in bad {
        let title = code.title();
        let problems = message_problems(code, message);
        assert!(!problems.is_empty(), "{message:?} passed ({title})");
    }
    assert!(message_problems(Code::E2003, "Unknown name 'x'.").is_empty());
    assert!(message_problems(Code::E1901, "The operator `&` is not supported in v0.1.").is_empty());
    assert!(
        message_problems(
            Code::E6100,
            "The generated WGSL is not valid: this is a compiler bug."
        )
        .is_empty()
    );
    // A message may start with a quoted name or a code span.
    assert!(message_problems(Code::E2033, "'ACCENT' is not exported by 'a.mtek'.").is_empty());
    assert!(
        message_problems(Code::E0012, "`_` is reserved and cannot be used as a name.").is_empty()
    );
}

#[test]
fn notes_are_written_like_notes() {
    for item in corpus() {
        for note in &item.notes {
            assert!(
                note == note.trim() && !note.is_empty() && !note.contains('\n'),
                "{} ({}): the note {note:?} has stray whitespace or a line break",
                item.code.short(),
                item.label
            );
            if let Some(hint) = note.strip_prefix("help: ") {
                assert!(
                    !hint.starts_with(|c: char| c.is_ascii_uppercase()) || hint.starts_with("Mtek"),
                    "{} ({}): the hint {note:?} starts with a capital; a hint continues `help:`",
                    item.code.short(),
                    item.label
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Related spans
// ---------------------------------------------------------------------------

/// Diagnostics that must name a second location, because the catalogue says so
/// (section 5 of the specification) or because repairing them means looking at
/// the declaration the diagnostic is about: `(code, a substring of the message
/// that selects the diagnostics, or none for all of the code, why)`.
const RELATED_REQUIRED: &[(&str, Option<&str>, &str)] = &[
    ("E1002", None, "section 5.1: a related span at the opener"),
    ("E2020", None, "section 5.2: the full path of the cycle"),
    ("E2035", None, "section 5.2: the full path of the cycle"),
    ("E3020", None, "the structs of the cycle"),
    (
        "E3021",
        None,
        "the struct declaration, where the fields are",
    ),
    ("E3022", None, "the first time the field is given"),
    (
        "E3023",
        Some("The struct "),
        "the struct declaration, where the fields are",
    ),
    ("E3080", None, "the written result type"),
    (
        "E3202",
        None,
        "the earlier pattern that makes the arm unreachable",
    ),
    (
        "E3206",
        None,
        "the first arm, whose type the others must have",
    ),
    (
        "E4001",
        None,
        "section 5.4: the call cycle in related spans",
    ),
    ("E4002", None, "section 5.4: the full call chain"),
    ("E5002", None, "the first time the field is set"),
    (
        "E5003",
        Some(" on material "),
        "the declaration of the param that is missing",
    ),
    (
        "E5041",
        None,
        "section 5.5: the param's declaration as related span",
    ),
    (
        "E5042",
        None,
        "the prefab declaration, where the params are",
    ),
    (
        "E5051",
        None,
        "the first declaration of the lifecycle function",
    ),
    ("E5070", None, "section 5.5: a related span at `bind`"),
    ("E5075", None, "section 5.5: the full path of the cycle"),
    (
        "E3102",
        Some(" of material "),
        "section 2.1: the param's declaration",
    ),
    (
        "E3102",
        Some(" of prefab "),
        "section 2.1: the param's declaration",
    ),
    ("E2002", Some("Duplicate "), "the first declaration"),
    (
        "E3001",
        Some(" is declared as "),
        "the annotation the expectation comes from",
    ),
    ("E3001", Some(" returns "), "the written result type"),
];

/// Messages of the table above that have no declaration to point at: the built-in materials are
/// registry schemas, which have no source text.
const RELATED_EXCEPTIONS: &[(&str, &str)] =
    &[("E3102", "of material Unlit"), ("E3102", "of material Pbr")];

#[test]
fn diagnostics_that_the_catalogue_or_the_audit_gives_a_related_span_have_one() {
    let items = corpus();
    let mut problems = Vec::new();
    for (short, selector, why) in RELATED_REQUIRED {
        let code = Code::parse_short(short).unwrap();
        let selected: Vec<&Item> = items
            .iter()
            .filter(|i| i.code == code && selector.is_none_or(|s| i.message.contains(s)))
            .filter(|i| {
                !RELATED_EXCEPTIONS
                    .iter()
                    .any(|(c, text)| *c == *short && i.message.contains(text))
            })
            .collect();
        if selected.is_empty() {
            problems.push(format!("{short} {selector:?}: no fixture produces it"));
        }
        for item in selected {
            if item.related == 0 {
                problems.push(format!(
                    "{short} {:?} ({}) has no related span ({why})",
                    item.message, item.label
                ));
            }
        }
    }
    problems.sort();
    problems.dedup();
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn the_catalogue_promises_no_related_span_the_audit_table_lacks() {
    // Every trigger cell of section 5 that says "related span" or "related
    // spans" (and is not about an optional "did you mean") is a code of the
    // table above.
    let required: BTreeSet<&str> = RELATED_REQUIRED.iter().map(|(code, _, _)| *code).collect();
    let mut promised = BTreeSet::new();
    for line in SPEC.lines().filter(|l| l.starts_with("| <a id=")) {
        let cells: Vec<&str> = line.split('|').map(str::trim).collect();
        let (Some(code_cell), Some(trigger)) = (cells.get(1), cells.get(3)) else {
            continue;
        };
        let code = code_cell.rsplit("</a>").next().unwrap_or("");
        if trigger.contains("related span") && !trigger.contains("did you mean") {
            promised.insert(code.to_owned());
        }
    }
    assert!(promised.len() >= 4, "{promised:?}");
    for code in &promised {
        assert!(
            required.contains(code.as_str()),
            "{code}: the catalogue promises a related span, but RELATED_REQUIRED does not list it"
        );
    }
}

// ---------------------------------------------------------------------------
// Files named in diagnostics about files
// ---------------------------------------------------------------------------

#[test]
fn a_diagnostic_about_the_content_of_an_asset_file_names_the_file() {
    // E7001-E7019 and E7025 are about the inside of a `.glb` or an image
    // (`spec/assets.md` section 3); section 7 asks to name the entity, and the
    // file is the entity. The message names it, or a note does.
    let names_a_file = |text: &str| {
        text.split('\'').any(|quoted| {
            [".glb", ".gltf", ".png", ".jpg", ".jpeg", ".dat"]
                .iter()
                .any(|extension| quoted.ends_with(extension))
        })
    };
    let mut problems = Vec::new();
    for item in corpus() {
        let number: u32 = item.code.short()[1..].parse().unwrap();
        if !((7001..=7019).contains(&number) || number == 7025) {
            continue;
        }
        if !names_a_file(&item.message) && !item.notes.iter().any(|n| names_a_file(n)) {
            problems.push(format!(
                "{} {:?} ({}) does not name the file",
                item.code.short(),
                item.message,
                item.label
            ));
        }
    }
    problems.sort();
    problems.dedup();
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

#[test]
fn every_code_a_fixture_expects_has_its_anchor_in_the_specification() {
    let mut missing = BTreeSet::new();
    for item in corpus() {
        let anchor = format!(
            "<a id=\"{}\"></a>",
            item.code.docs().rsplit('#').next().unwrap()
        );
        if !SPEC.contains(&anchor) {
            missing.insert(item.code.short());
        }
    }
    assert!(missing.is_empty(), "no anchor for {missing:?}");
}

// ---------------------------------------------------------------------------
// The source corpus
// ---------------------------------------------------------------------------

/// The Rust sources of the compiler library and the command line tool, without
/// their `#[cfg(test)]` parts: `(path relative to the repository, text)`.
fn sources() -> Vec<(String, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }
    let mut files = Vec::new();
    walk(&repo().join("crates/mtek-compiler/src"), &mut files);
    walk(&repo().join("crates/mtek-cli/src"), &mut files);
    files.sort();
    files
        .into_iter()
        .filter(|path| {
            let name = path.file_name().unwrap().to_string_lossy();
            !(name == "tests.rs" || name.ends_with("_tests.rs"))
                && !path.components().any(|c| c.as_os_str() == "tests")
        })
        .map(|path| {
            let text = fs::read_to_string(&path).unwrap().replace("\r\n", "\n");
            let live = match text.find("#[cfg(test)]") {
                Some(at) => text[..at].to_owned(),
                None => text,
            };
            let label = path
                .strip_prefix(repo())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            (label, live)
        })
        .collect()
}

#[test]
fn internal_errors_say_that_they_are_a_compiler_bug() {
    // Section 7: never blame the user for compiler defects. Every place that
    // builds an E9999 or E6100 says so within its message.
    let mut sites = 0;
    let mut problems = Vec::new();
    for (label, text) in sources() {
        for code in ["Code::E9999,", "Code::E6100,"] {
            for (at, _) in text.match_indices(code) {
                sites += 1;
                let window: String = text[at..].chars().take(700).collect();
                if !window.to_ascii_lowercase().contains("compiler bug") {
                    let line = text[..at].matches('\n').count() + 1;
                    problems.push(format!("{label}:{line}: {code} without \"compiler bug\""));
                }
            }
        }
    }
    assert!(sites >= 8, "only {sites} sites found");
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn only_the_edits_module_attaches_edits() {
    // Reporting stages propose with `.candidate(..)`; attaching with `.edit(..)`
    // is the validator's alone (`src/edits.rs`).
    let mut problems = Vec::new();
    for (label, text) in sources() {
        if label.ends_with("src/edits.rs") || label.ends_with("diagnostics/model.rs") {
            continue;
        }
        if text.contains(".edit(") && text.contains("SuggestedEdit") {
            problems.push(format!("{label} attaches an edit without validation"));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn edits_are_proposed_for_exactly_the_documented_codes() {
    // The files that propose edits, and the code each proposes for. A new
    // proposer must be added here, to the specification (section 6) and to
    // decision 0071.
    let expected: &[(&str, &str)] = &[
        ("crates/mtek-compiler/src/syntax/lexer.rs", "Code::E0022"),
        (
            "crates/mtek-compiler/src/syntax/parser/recover.rs",
            "Code::E1003",
        ),
        (
            "crates/mtek-compiler/src/syntax/parser/expr.rs",
            "Code::E1011",
        ),
        (
            "crates/mtek-compiler/src/resolve/resolver.rs",
            "Code::E2003",
        ),
        // The accessor failures carry their own code; `E7024` is made where the name is looked up.
        ("crates/mtek-compiler/src/types/assets.rs", "rename"),
    ];
    let proposers: BTreeSet<String> = sources()
        .into_iter()
        .filter(|(label, text)| {
            !label.ends_with("diagnostics/model.rs") && text.contains(".candidate(")
        })
        .map(|(label, _)| label)
        .collect();
    let wanted: BTreeSet<String> = expected
        .iter()
        .map(|(file, _)| (*file).to_owned())
        .collect();
    assert_eq!(proposers, wanted);
    for (file, code) in expected {
        let text = sources()
            .into_iter()
            .find(|(label, _)| label == file)
            .map(|(_, text)| text)
            .unwrap();
        assert!(text.contains(code), "{file} does not mention {code}");
    }
    // And the specification lists them.
    for code in ["E0022", "E1003", "E1011", "E2003", "E7024"] {
        assert!(
            SPEC.contains(&format!("`{code}`")),
            "section 6 of the specification does not name {code}"
        );
    }
}
