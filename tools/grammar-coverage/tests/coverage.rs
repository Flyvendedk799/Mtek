//! The M2 grammar freeze (`spec/grammar-notes.md` note 4, decision 0042):
//! every production and top-level alternative of `spec/grammar.ebnf` is
//! built by the parser from some fixture of `tests/syntax/pass/`, and every
//! `[S: …]` rule is covered by a fail fixture declaring it.

// Test-only code: helpers may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::process::Command;

use mtek_grammar_coverage::{Corpus, Coverage, corpus, gates, measure};

fn repository() -> Corpus {
    corpus::load(&corpus::repository_root()).unwrap()
}

fn coverage_of(corpus: &Corpus) -> Coverage {
    measure(corpus, &gates()).unwrap()
}

#[test]
fn every_production_alternative_and_rule_is_covered() {
    let coverage = coverage_of(&repository());
    assert!(coverage.problems.is_empty(), "{}", coverage.render());
    let (hit, productions) = coverage.production_counts();
    let (alternatives_hit, alternatives) = coverage.alternative_counts();
    let (covered, _, rules) = coverage.rule_counts();
    assert_eq!(
        (hit, alternatives_hit, covered),
        (productions, alternatives, rules)
    );
    // The grammar as frozen at M2 (`spec/grammar-notes.md`, "Frozen subset"):
    // a production, alternative or rule added or removed changes these.
    assert_eq!((productions, alternatives, rules), (73, 116, 11));
}

#[test]
fn a_point_covered_by_one_fixture_is_reported_without_it() {
    // The test above fails when coverage is lost: remove each positive
    // fixture that alone hits a production or alternative, and the point is
    // reported.
    let corpus = repository();
    let coverage = coverage_of(&corpus);
    let mut sole: Vec<(String, String)> = Vec::new();
    for p in coverage.productions.iter().filter(|p| !p.negative) {
        if let [only] = p.fixtures.as_slice() {
            sole.push((only.clone(), format!("production {} ", p.name)));
        }
        for (alternative, fixtures) in &p.alternatives {
            if let [only] = fixtures.as_slice() {
                sole.push((
                    only.clone(),
                    format!("alternative `{alternative}` of {} ", p.name),
                ));
            }
        }
    }
    assert!(!sole.is_empty());
    for (fixture, expected) in sole {
        let mut reduced = corpus.clone();
        reduced.pass.retain(|f| f.name != fixture);
        let problems = coverage_of(&reduced).problems;
        assert!(
            problems.iter().any(|p| p.starts_with(&expected)),
            "without {fixture}: {problems:#?}"
        );
    }
}

#[test]
fn a_rule_code_covered_by_one_fixture_is_reported_without_its_declaration() {
    let corpus = repository();
    let coverage = coverage_of(&corpus);
    let mut checked = 0;
    for rule in coverage.rules.iter().filter(|r| r.gated.is_none()) {
        for (code, fixtures) in &rule.codes {
            let [only] = fixtures.as_slice() else {
                continue;
            };
            let mut reduced = corpus.clone();
            for fixture in reduced.fail.iter_mut().filter(|f| &f.name == only) {
                for source in &mut fixture.sources {
                    source.text = source.text.replace("// covers:", "// was:");
                }
            }
            let problems = coverage_of(&reduced).problems;
            let start = format!("rule [S: {}] ", rule.id);
            let end = format!("reports {code}");
            assert!(
                problems
                    .iter()
                    .any(|p| p.starts_with(&start) && p.ends_with(&end)),
                "without the declaration of {only}: {problems:#?}"
            );
            checked += 1;
        }
    }
    assert!(checked >= 5, "{checked}");
}

#[test]
fn the_report_is_deterministic() {
    let first = coverage_of(&repository()).render();
    let second = coverage_of(&repository()).render();
    assert_eq!(first, second);
    assert!(first.contains("\nProblems: 0\n"), "{first}");
}

#[test]
fn the_command_prints_the_report_and_succeeds() {
    let output = Command::new(env!("CARGO_BIN_EXE_grammar-coverage"))
        .arg(corpus::repository_root())
        .output()
        .unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(output.status.success(), "{stdout}");
    assert!(stdout.starts_with("Grammar coverage of spec/grammar.ebnf\nproductions:  73/73 hit\n"));
    // A directory that is no repository is an error, not a report.
    let missing = Command::new(env!("CARGO_BIN_EXE_grammar-coverage"))
        .arg(corpus::repository_root().join("no-such-directory"))
        .output()
        .unwrap();
    assert_eq!(missing.status.code(), Some(2));
}
