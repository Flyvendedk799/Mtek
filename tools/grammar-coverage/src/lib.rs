//! Grammar coverage of the Mtek syntax corpus (`spec/grammar-notes.md` note
//! 4, `spec/testing.md` section 3.2, decision 0042).
//!
//! Two questions, answered from the repository as it is:
//!
//! 1. **Does the parser build every production of `spec/grammar.ebnf`, and
//!    every top-level alternative of it, from some positive fixture in
//!    `tests/syntax/pass/`?** Each fixture is lexed and parsed by
//!    `mtek-compiler` and the hits are read off the tokens and the tree
//!    ([`hits`]); a fixture's file name proves nothing. `Reserved` is the one
//!    production no positive fixture can contain: its alternatives are hit by
//!    fail fixtures that report `E0013` on exactly that word.
//! 2. **Is every semantic restriction `[S: rule-id: …]` of the grammar
//!    exercised by a negative fixture?** A fail fixture of
//!    `tests/syntax/fail/` or `tests/semantics/fail/` declares the rules it
//!    covers with a line comment `// covers: [S: rule-id]` in one of its
//!    `.mtek` files. Every code the rule names must be reported by one of the
//!    fixtures declaring it, and every declaring fixture must report one of
//!    them. The codes are read from the fixtures' expected diagnostics, which
//!    `crates/mtek-compiler/tests/fixtures.rs` compares exactly with the
//!    compiler's output. A rule whose construct this build does not implement
//!    yet ([`GATED_RULES`]) is covered by a declaring fixture that reports
//!    the construct's `E9010` instead; once the construct is implemented the
//!    entry must go and the codes are required.
//!
//! [`measure`] works on an in-memory [`Corpus`]; [`corpus::load`] reads the
//! repository. `cargo run -p mtek-grammar-coverage` prints the report, and
//! the test `tests/coverage.rs` fails on any problem.

pub mod corpus;
pub mod ebnf;
pub mod hits;

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use mtek_compiler::resolve::{Construct, IMPLEMENTED_MILESTONE, construct_gate};

use crate::hits::Point;

/// A positive fixture: `tests/syntax/pass/<name>.mtek`.
#[derive(Clone, Debug)]
pub struct PassFixture {
    /// `syntax/pass/<name>`.
    pub name: String,
    pub text: String,
}

/// A source file of a fail fixture.
#[derive(Clone, Debug)]
pub struct Source {
    /// The path the expected diagnostics use for it.
    pub path: String,
    pub text: String,
}

/// One expected diagnostic of a fail fixture.
#[derive(Clone, Debug)]
pub struct Expected {
    /// The short code, `E0013`.
    pub code: String,
    pub file: String,
    pub start: usize,
    pub end: usize,
    pub message: String,
}

/// A negative fixture with its sources and expected diagnostics.
#[derive(Clone, Debug)]
pub struct FailFixture {
    /// `syntax/fail/<name>` or `semantics/fail/<name>`.
    pub name: String,
    pub sources: Vec<Source>,
    pub diagnostics: Vec<Expected>,
}

/// Everything the measurement reads.
#[derive(Clone, Debug, Default)]
pub struct Corpus {
    /// The text of `spec/grammar.ebnf`.
    pub grammar: String,
    pub pass: Vec<PassFixture>,
    pub fail: Vec<FailFixture>,
}

/// A rule whose construct may not be implemented by this build.
#[derive(Clone, Debug)]
pub struct Gate {
    pub rule: String,
    /// The start of the construct's `E9010` message.
    pub subject: String,
    /// The milestone that implements the construct.
    pub milestone: String,
    pub implemented: bool,
}

/// Productions only negative fixtures can exercise, and the code that
/// rejects each of their words.
pub const NEGATIVE_PRODUCTIONS: &[(&str, &str)] = &[("Reserved", "E0013")];

/// The rules of `spec/grammar.ebnf` that check a construct this build may
/// gate (`E9010`, decision 0025), with the construct.
pub const GATED_RULES: &[(&str, Construct)] = &[
    ("prefab-no-nested-entity", Construct::Prefab),
    ("prefab-instance-params", Construct::PrefabInstance),
];

/// The gates of [`GATED_RULES`] in this build.
#[must_use]
pub fn gates() -> Vec<Gate> {
    GATED_RULES
        .iter()
        .map(|&(rule, construct)| {
            let gate = construct_gate(construct);
            Gate {
                rule: rule.to_owned(),
                subject: gate.subject.to_owned(),
                milestone: gate.since.as_str().to_owned(),
                implemented: gate.since.is_reached_by(IMPLEMENTED_MILESTONE),
            }
        })
        .collect()
}

/// How one production was covered.
#[derive(Clone, Debug)]
pub struct ProductionCoverage {
    pub name: String,
    /// Covered by fail fixtures ([`NEGATIVE_PRODUCTIONS`]).
    pub negative: bool,
    /// The fixtures that hit it, sorted.
    pub fixtures: Vec<String>,
    /// For a production with several top-level alternatives: each, with the
    /// fixtures that hit it.
    pub alternatives: Vec<(String, Vec<String>)>,
}

/// How one rule was covered.
#[derive(Clone, Debug)]
pub struct RuleCoverage {
    pub id: String,
    pub production: String,
    /// Each code of the rule with the declaring fixtures that report it.
    pub codes: Vec<(String, Vec<String>)>,
    /// The fixtures declaring `// covers: [S: id]`.
    pub fixtures: Vec<String>,
    /// `(subject, milestone)` while the rule's construct is gated.
    pub gated: Option<(String, String)>,
}

/// The result of [`measure`].
#[derive(Clone, Debug, Default)]
pub struct Coverage {
    pub productions: Vec<ProductionCoverage>,
    pub rules: Vec<RuleCoverage>,
    /// Everything that is not covered or not consistent, in a stable order.
    /// Empty is the M2 gate's requirement.
    pub problems: Vec<String>,
}

impl Coverage {
    /// `(hit, total)` productions.
    #[must_use]
    pub fn production_counts(&self) -> (usize, usize) {
        let hit = self
            .productions
            .iter()
            .filter(|p| !p.fixtures.is_empty())
            .count();
        (hit, self.productions.len())
    }

    /// `(hit, total)` alternatives of the productions that have several.
    #[must_use]
    pub fn alternative_counts(&self) -> (usize, usize) {
        let all = self.productions.iter().flat_map(|p| &p.alternatives);
        let hit = all.clone().filter(|(_, f)| !f.is_empty()).count();
        (hit, all.count())
    }

    /// `(covered, gated, total)` rules; `covered` includes the gated ones
    /// covered by their `E9010`.
    #[must_use]
    pub fn rule_counts(&self) -> (usize, usize, usize) {
        let covered = self
            .rules
            .iter()
            .filter(|r| match r.gated {
                Some(_) => !r.fixtures.is_empty(),
                None => r.codes.iter().all(|(_, f)| !f.is_empty()),
            })
            .count();
        let gated = self.rules.iter().filter(|r| r.gated.is_some()).count();
        (covered, gated, self.rules.len())
    }

    /// The human-readable report: counts, every production and rule with the
    /// first fixture that covers it, then the problems.
    #[must_use]
    pub fn render(&self) -> String {
        let first = |fixtures: &[String]| match fixtures {
            [] => "NOT COVERED".to_owned(),
            [one] => one.clone(),
            [one, rest @ ..] => format!("{one} (+{})", rest.len()),
        };
        let mut out = String::new();
        let (hit, total) = self.production_counts();
        let (alt_hit, alt_total) = self.alternative_counts();
        let (covered, gated, rules) = self.rule_counts();
        let _ = writeln!(out, "Grammar coverage of spec/grammar.ebnf");
        let _ = writeln!(out, "productions:  {hit}/{total} hit");
        let _ = writeln!(out, "alternatives: {alt_hit}/{alt_total} hit");
        let _ = writeln!(
            out,
            "rules:        {covered}/{rules} covered ({gated} by the E9010 of a gated construct)"
        );
        let _ = writeln!(out, "\nProductions");
        for p in &self.productions {
            let tag = if p.negative { " [negative]" } else { "" };
            let _ = writeln!(out, "  {}{tag}: {}", p.name, first(&p.fixtures));
            for (alternative, fixtures) in &p.alternatives {
                let _ = writeln!(out, "    | {alternative}: {}", first(fixtures));
            }
        }
        let _ = writeln!(out, "\nRules");
        for r in &self.rules {
            let _ = writeln!(out, "  [S: {}] ({})", r.id, r.production);
            match &r.gated {
                Some((subject, milestone)) => {
                    let _ = writeln!(
                        out,
                        "    gated: {subject} (planned for {milestone}): {}",
                        first(&r.fixtures)
                    );
                }
                None => {
                    for (code, fixtures) in &r.codes {
                        let _ = writeln!(out, "    {code}: {}", first(fixtures));
                    }
                }
            }
        }
        let _ = writeln!(out, "\nProblems: {}", self.problems.len());
        for problem in &self.problems {
            let _ = writeln!(out, "  {problem}");
        }
        out
    }
}

/// The rule ids declared by `// covers: [S: id]` lines of `text`.
///
/// # Errors
///
/// A `// covers:` line with anything but `[S: id]` entries (separated by
/// spaces or commas).
pub fn covers_in(text: &str) -> Result<Vec<String>, String> {
    const MARK: &str = "// covers:";
    let mut ids = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let Some(at) = line.find(MARK) else {
            continue;
        };
        let mut rest = line[at + MARK.len()..].trim();
        if rest.is_empty() {
            return Err(format!("line {}: `// covers:` names no rule", n + 1));
        }
        while !rest.is_empty() {
            let entry = rest
                .strip_prefix("[S:")
                .and_then(|r| r.split_once(']'))
                .map(|(id, tail)| (id.trim(), tail))
                .filter(|(id, _)| !id.is_empty() && !id.contains(char::is_whitespace));
            let Some((id, tail)) = entry else {
                return Err(format!(
                    "line {}: a covers line lists `[S: rule-id]` entries, found `{rest}`",
                    n + 1
                ));
            };
            ids.push(id.to_owned());
            rest = tail.trim_start_matches([',', ' ', '\t']);
        }
    }
    Ok(ids)
}

/// Measure `corpus` against its grammar.
///
/// # Errors
///
/// The grammar cannot be read ([`ebnf::parse`]).
pub fn measure(corpus: &Corpus, gates: &[Gate]) -> Result<Coverage, String> {
    let grammar = ebnf::parse(&corpus.grammar).map_err(|e| format!("spec/grammar.ebnf: {e}"))?;
    let mut problems = Vec::new();

    // ----- positive fixtures ----------------------------------------------
    let mut hits: BTreeMap<Point, BTreeSet<String>> = BTreeMap::new();
    for fixture in &corpus.pass {
        match hits::points_of(&fixture.text) {
            Ok(points) => {
                for point in points {
                    hits.entry(point).or_default().insert(fixture.name.clone());
                }
            }
            Err(diagnostics) => problems.push(format!(
                "{}: a positive fixture must lex and parse without diagnostics: {}",
                fixture.name,
                diagnostics.join("; ")
            )),
        }
        if !covers_in(&fixture.text).unwrap_or_default().is_empty() {
            problems.push(format!(
                "{}: `// covers:` belongs in fail fixtures",
                fixture.name
            ));
        }
    }

    // ----- negative productions -------------------------------------------
    for &(production, code) in NEGATIVE_PRODUCTIONS {
        for fixture in &corpus.fail {
            for d in fixture.diagnostics.iter().filter(|d| d.code == code) {
                let word = fixture
                    .sources
                    .iter()
                    .find(|s| s.path == d.file)
                    .and_then(|s| s.text.get(d.start..d.end))
                    .unwrap_or_default();
                for point in [
                    Point::production(production),
                    Point::alternative(production, &format!("'{word}'")),
                ] {
                    hits.entry(point).or_default().insert(fixture.name.clone());
                }
            }
        }
    }

    // ----- productions and alternatives -----------------------------------
    let mut known = BTreeSet::new();
    let mut productions = Vec::new();
    for p in &grammar.productions {
        let fixtures_of = |point: &Point| -> Vec<String> {
            hits.get(point)
                .map(|f| f.iter().cloned().collect())
                .unwrap_or_default()
        };
        let negative = NEGATIVE_PRODUCTIONS.iter().any(|&(name, _)| name == p.name);
        let whole = Point::production(&p.name);
        let fixtures = fixtures_of(&whole);
        let source = if negative {
            "a fail fixture"
        } else {
            "tests/syntax/pass"
        };
        if fixtures.is_empty() {
            problems.push(format!(
                "production {} (line {}) is not hit by {source}",
                p.name, p.line
            ));
        }
        known.insert(whole);
        let mut alternatives = Vec::new();
        if p.alternatives.len() > 1 {
            for alternative in &p.alternatives {
                let point = Point::alternative(&p.name, alternative);
                let fixtures = fixtures_of(&point);
                if fixtures.is_empty() {
                    problems.push(format!(
                        "alternative `{alternative}` of {} (line {}) is not hit by {source}",
                        p.name, p.line
                    ));
                }
                alternatives.push((alternative.clone(), fixtures));
                known.insert(point);
            }
        }
        productions.push(ProductionCoverage {
            name: p.name.clone(),
            negative,
            fixtures,
            alternatives,
        });
    }
    for (point, fixtures) in &hits {
        if !known.contains(point) {
            let first = fixtures.iter().next().cloned().unwrap_or_default();
            problems.push(format!(
                "the measurement names `{point}` (from {first}), which spec/grammar.ebnf does not define"
            ));
        }
    }

    // ----- rules --------------------------------------------------------------
    let mut declared: BTreeMap<String, Vec<&FailFixture>> = BTreeMap::new();
    for fixture in &corpus.fail {
        let mut ids = BTreeSet::new();
        for source in &fixture.sources {
            match covers_in(&source.text) {
                Ok(found) => ids.extend(found),
                Err(e) => problems.push(format!("{} ({}): {e}", fixture.name, source.path)),
            }
        }
        for id in ids {
            if grammar.rules.iter().any(|r| r.id == id) {
                declared.entry(id).or_default().push(fixture);
            } else {
                problems.push(format!(
                    "{}: `// covers: [S: {id}]` names no rule of spec/grammar.ebnf",
                    fixture.name
                ));
            }
        }
    }
    for gate in gates {
        if !grammar.rules.iter().any(|r| r.id == gate.rule) {
            problems.push(format!(
                "GATED_RULES lists `{}`, which is no rule of spec/grammar.ebnf",
                gate.rule
            ));
        } else if gate.implemented {
            problems.push(format!(
                "GATED_RULES lists `{}`, but this build implements {} ({}): remove the entry and cover the rule's codes",
                gate.rule, gate.subject, gate.milestone
            ));
        }
    }
    let mut rules = Vec::new();
    for rule in &grammar.rules {
        let fixtures = declared.get(&rule.id).cloned().unwrap_or_default();
        let gate = gates.iter().find(|g| g.rule == rule.id && !g.implemented);
        let reports_gate = |f: &FailFixture| {
            gate.is_some_and(|g| {
                f.diagnostics
                    .iter()
                    .any(|d| d.code == "E9010" && d.message.starts_with(&g.subject))
            })
        };
        let reports = |f: &FailFixture, code: &str| f.diagnostics.iter().any(|d| d.code == code);
        for f in &fixtures {
            if !reports_gate(f) && !rule.codes.iter().any(|c| reports(f, c)) {
                problems.push(format!(
                    "{} declares [S: {}] but reports none of {}",
                    f.name,
                    rule.id,
                    rule.codes.join(", ")
                ));
            }
        }
        let codes: Vec<(String, Vec<String>)> = rule
            .codes
            .iter()
            .map(|code| {
                let by: Vec<String> = fixtures
                    .iter()
                    .filter(|f| reports(f, code))
                    .map(|f| f.name.clone())
                    .collect();
                (code.clone(), by)
            })
            .collect();
        match gate {
            Some(g) => {
                if !fixtures.iter().any(|f| reports_gate(f)) {
                    problems.push(format!(
                        "rule [S: {}] (line {}): its construct is gated ({} planned for {}); no fail fixture declaring it reports that E9010",
                        rule.id, rule.line, g.subject, g.milestone
                    ));
                }
            }
            None => {
                for (code, by) in &codes {
                    if by.is_empty() {
                        problems.push(format!(
                            "rule [S: {}] (line {}): no fail fixture declaring `// covers: [S: {}]` reports {code}",
                            rule.id, rule.line, rule.id
                        ));
                    }
                }
            }
        }
        let mut names: Vec<String> = fixtures.iter().map(|f| f.name.clone()).collect();
        names.sort();
        rules.push(RuleCoverage {
            id: rule.id.clone(),
            production: rule.production.clone(),
            codes,
            fixtures: names,
            gated: gate.map(|g| (g.subject.clone(), g.milestone.clone())),
        });
    }

    Ok(Coverage {
        productions,
        rules,
        problems,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const GRAMMAR: &str = "\
Module  ::= Item*
Item    ::= Const | Reserved
Const   ::= 'const' Ident '=' Int ';'
            /* [S: const-name: names are checked (E0012, E0011)] */
Ident   ::= [a-z]+
Int     ::= '0' | [1-9] [0-9]*
Reserved ::= 'type' | 'as'
Keyword ::= 'const'
";

    fn pass(name: &str, text: &str) -> PassFixture {
        PassFixture {
            name: name.to_owned(),
            text: text.to_owned(),
        }
    }

    fn fail(name: &str, text: &str, diagnostics: &[(&str, usize, usize, &str)]) -> FailFixture {
        FailFixture {
            name: name.to_owned(),
            sources: vec![Source {
                path: "main.mtek".to_owned(),
                text: text.to_owned(),
            }],
            diagnostics: diagnostics
                .iter()
                .map(|&(code, start, end, message)| Expected {
                    code: code.to_owned(),
                    file: "main.mtek".to_owned(),
                    start,
                    end,
                    message: message.to_owned(),
                })
                .collect(),
        }
    }

    /// A corpus that covers everything of [`GRAMMAR`] that the measurement
    /// maps (`Item`, `Ident`... are names the real grammar shares).
    fn corpus() -> Corpus {
        Corpus {
            grammar: GRAMMAR.to_owned(),
            pass: vec![pass("pass/a", "const zero = 0;\nconst ten = 10;\n")],
            fail: vec![
                fail(
                    "fail/b",
                    "const type = 1;\nconst as = 2;\n// covers: [S: const-name]\n",
                    &[
                        ("E0013", 6, 10, "reserved"),
                        ("E0013", 22, 24, "reserved"),
                        ("E0012", 0, 1, "underscore"),
                    ],
                ),
                fail(
                    "fail/c",
                    "// covers: [S: const-name]\n",
                    &[("E0011", 0, 1, "__")],
                ),
            ],
        }
    }

    fn problems_of(corpus: &Corpus, gates: &[Gate]) -> Vec<String> {
        measure(corpus, gates).unwrap().problems
    }

    /// The problems of the sample that come from its toy grammar (its `Item`
    /// and `Const` are not the real productions), which every test shares.
    fn baseline() -> Vec<String> {
        problems_of(&corpus(), &[])
    }

    #[test]
    fn covers_lines_are_read_strictly() {
        assert_eq!(
            covers_in("x\n// covers: [S: a], [S: b-c]\n  // covers: [S: d]").unwrap(),
            ["a", "b-c", "d"]
        );
        assert!(
            covers_in("// covers:")
                .unwrap_err()
                .contains("names no rule")
        );
        assert!(
            covers_in("// covers: S: a")
                .unwrap_err()
                .contains("found `S: a`")
        );
        assert!(covers_in("// covers: [S: a b]").is_err());
    }

    #[test]
    fn the_sample_corpus_has_only_the_problems_of_its_toy_grammar() {
        // The measurement maps the real tree, so the toy grammar's `Item` and
        // `Const` disagree with it (and the tree's `ConstDecl`, `Expr`, ...
        // are unknown to it); everything that the sample is about is covered.
        let coverage = measure(&corpus(), &[]).unwrap();
        for name in ["Module", "Ident", "Int", "Reserved", "Keyword"] {
            let p = coverage
                .productions
                .iter()
                .find(|p| p.name == name)
                .unwrap();
            assert!(!p.fixtures.is_empty(), "{name}");
            assert!(p.alternatives.iter().all(|(_, f)| !f.is_empty()), "{p:?}");
        }
        assert_eq!(coverage.rule_counts(), (1, 0, 1));
        assert!(
            coverage.problems.iter().all(|p| !p.contains("[S:")),
            "{:#?}",
            coverage.problems
        );
        assert!(coverage.problems.contains(
            &"the measurement names `ConstDecl` (from pass/a), which spec/grammar.ebnf does not define"
                .to_owned()
        ));
    }

    #[test]
    fn an_unhit_production_or_alternative_is_a_problem() {
        let mut corpus = corpus();
        corpus.pass = vec![pass("pass/a", "const ten = 10;\n")];
        let problems = problems_of(&corpus, &[]);
        let new: Vec<&String> = problems
            .iter()
            .filter(|p| !baseline().contains(p))
            .collect();
        assert_eq!(
            new,
            ["alternative `'0'` of Int (line 6) is not hit by tests/syntax/pass"]
        );
        corpus.pass.clear();
        let problems = problems_of(&corpus, &[]);
        assert!(
            problems
                .contains(&"production Module (line 1) is not hit by tests/syntax/pass".to_owned())
        );
    }

    #[test]
    fn a_reserved_word_without_its_e0013_is_a_problem() {
        let mut corpus = corpus();
        corpus.fail[0].diagnostics.remove(1);
        let problems = problems_of(&corpus, &[]);
        assert!(
            problems.contains(
                &"alternative `'as'` of Reserved (line 7) is not hit by a fail fixture".to_owned()
            ),
            "{problems:#?}"
        );
    }

    #[test]
    fn a_rule_code_without_a_declaring_fixture_is_a_problem() {
        let mut corpus = corpus();
        // `fail/c` reports E0011 but no longer declares the rule.
        corpus.fail[1].sources[0].text = String::new();
        let problems = problems_of(&corpus, &[]);
        let new: Vec<&String> = problems
            .iter()
            .filter(|p| !baseline().contains(p))
            .collect();
        assert_eq!(
            new,
            [
                "rule [S: const-name] (line 4): no fail fixture declaring `// covers: [S: const-name]` reports E0011"
            ]
        );
    }

    #[test]
    fn a_false_or_unknown_declaration_is_a_problem() {
        let mut corpus = corpus();
        corpus.fail[1].diagnostics[0].code = "E1001".to_owned();
        corpus.fail[1].sources[0]
            .text
            .push_str("// covers: [S: nothing]\n");
        let problems = problems_of(&corpus, &[]);
        let new: Vec<&String> = problems
            .iter()
            .filter(|p| !baseline().contains(p))
            .collect();
        assert_eq!(
            new,
            [
                "fail/c: `// covers: [S: nothing]` names no rule of spec/grammar.ebnf",
                "fail/c declares [S: const-name] but reports none of E0012, E0011",
                "rule [S: const-name] (line 4): no fail fixture declaring `// covers: [S: const-name]` reports E0011",
            ]
        );
    }

    #[test]
    fn a_gated_rule_is_covered_by_its_e9010_until_the_construct_is_implemented() {
        let gate = |implemented| Gate {
            rule: "const-name".to_owned(),
            subject: "Names".to_owned(),
            milestone: "M9".to_owned(),
            implemented,
        };
        let mut corpus = corpus();
        // Only a gate fixture declares the rule now.
        for fixture in &mut corpus.fail {
            fixture.sources[0].text = fixture.sources[0].text.replace("// covers:", "//");
        }
        corpus.fail.push(fail(
            "fail/gate",
            "// covers: [S: const-name]\n",
            &[(
                "E9010",
                0,
                1,
                "Names are specified for v0.1 but not implemented",
            )],
        ));
        let coverage = measure(&corpus, &[gate(false)]).unwrap();
        let new: Vec<&String> = coverage
            .problems
            .iter()
            .filter(|p| !baseline().contains(p))
            .collect();
        assert!(new.is_empty(), "{new:#?}");
        assert_eq!(coverage.rule_counts(), (1, 1, 1));
        // Implemented: the entry is stale and the codes are required.
        let problems = problems_of(&corpus, &[gate(true)]);
        let new: Vec<&String> = problems
            .iter()
            .filter(|p| !baseline().contains(p))
            .collect();
        assert_eq!(new.len(), 4, "{new:#?}");
        assert!(
            new[0].starts_with(
                "GATED_RULES lists `const-name`, but this build implements Names (M9)"
            )
        );
        assert!(new[1].starts_with("fail/gate declares [S: const-name] but reports none"));
        // Without its fixture a gated rule is not covered.
        corpus.fail.pop();
        let problems = problems_of(&corpus, &[gate(false)]);
        assert!(
            problems
                .iter()
                .any(|p| p.contains("its construct is gated (Names planned for M9)")),
            "{problems:#?}"
        );
    }

    #[test]
    fn a_positive_fixture_with_diagnostics_or_covers_is_a_problem() {
        let mut corpus = corpus();
        corpus.pass.push(pass("pass/bad", "const = 1;\n"));
        corpus
            .pass
            .push(pass("pass/covers", "// covers: [S: const-name]\n"));
        let problems = problems_of(&corpus, &[]);
        assert!(problems.iter().any(|p| p.starts_with(
            "pass/bad: a positive fixture must lex and parse without diagnostics: E1001"
        )));
        assert!(
            problems.contains(&"pass/covers: `// covers:` belongs in fail fixtures".to_owned())
        );
    }
}
