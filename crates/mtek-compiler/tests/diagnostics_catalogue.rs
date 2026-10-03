//! `spec/diagnostics.md` section 5 and `diagnostics/codes.rs` must list exactly
//! the same codes, severities and titles (D10: the code table is the single
//! source of truth, this test is the guard).

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::{Code, Severity};

const SPEC: &str = include_str!("../../../spec/diagnostics.md");

#[derive(Debug, PartialEq, Eq)]
struct Row {
    code: String,
    severity: Severity,
    title: String,
}

fn is_code(cell: &str) -> bool {
    let bytes = cell.as_bytes();
    bytes.len() == 5
        && matches!(bytes.first(), Some(b'E' | b'W'))
        && bytes.iter().skip(1).all(u8::is_ascii_digit)
}

/// The rows of the catalogue tables of section 5, in document order. Rows
/// that are not a concrete code (the `(E7001-E7099)` range rows) are skipped.
fn spec_rows(spec: &str) -> Vec<Row> {
    let mut rows = Vec::new();
    let mut in_catalogue = false;
    for line in spec.lines() {
        if line.starts_with("## ") {
            in_catalogue = line.starts_with("## 5. Catalogue");
            continue;
        }
        if !in_catalogue || !line.starts_with('|') {
            continue;
        }
        let cells: Vec<&str> = line.split('|').map(str::trim).collect();
        // cells[0] is empty (before the first pipe).
        let (Some(code), Some(title)) = (cells.get(1), cells.get(2)) else {
            continue;
        };
        if !is_code(code) {
            continue;
        }
        let severity = if code.starts_with('E') {
            Severity::Error
        } else {
            Severity::Warning
        };
        rows.push(Row {
            code: (*code).to_string(),
            severity,
            title: (*title).to_string(),
        });
    }
    rows
}

fn code_rows() -> Vec<Row> {
    Code::ALL
        .iter()
        .map(|code| Row {
            code: code.short().to_string(),
            severity: code.severity(),
            title: code.title().to_string(),
        })
        .collect()
}

/// Human-readable differences; empty when the spec and `codes.rs` agree.
fn differences(spec: &str) -> Vec<String> {
    let spec_rows = spec_rows(spec);
    let code_rows = code_rows();
    let mut problems = Vec::new();
    for row in &spec_rows {
        match code_rows.iter().find(|c| c.code == row.code) {
            None => problems.push(format!("{} is in the spec but not in codes.rs", row.code)),
            Some(c) => {
                if c.severity != row.severity {
                    problems.push(format!(
                        "{}: severity {:?} in codes.rs, {:?} in the spec",
                        row.code, c.severity, row.severity
                    ));
                }
                if c.title != row.title {
                    problems.push(format!(
                        "{}: title {:?} in codes.rs, {:?} in the spec",
                        row.code, c.title, row.title
                    ));
                }
            }
        }
    }
    for row in &code_rows {
        if !spec_rows.iter().any(|s| s.code == row.code) {
            problems.push(format!("{} is in codes.rs but not in the spec", row.code));
        }
    }
    if problems.is_empty() && spec_rows != code_rows {
        problems.push("codes appear in a different order in the spec and in codes.rs".into());
    }
    problems
}

#[test]
fn spec_catalogue_and_codes_rs_agree() {
    let problems = differences(SPEC);
    assert!(
        problems.is_empty(),
        "spec/diagnostics.md section 5 and codes.rs differ:\n{}",
        problems.join("\n")
    );
}

#[test]
fn the_parser_finds_the_whole_catalogue() {
    let rows = spec_rows(SPEC);
    assert_eq!(rows.len(), Code::ALL.len());
    assert!(rows.len() > 150, "parsed only {} rows", rows.len());
    // Range placeholders are not codes.
    assert!(rows.iter().all(|r| is_code(&r.code)));
    assert!(!rows.iter().any(|r| r.code == "E7001"));
    assert!(!rows.iter().any(|r| r.code == "E8101"));
}

#[test]
fn a_changed_title_is_detected() {
    let edited = SPEC.replacen(
        "| E3102 | field or parameter type mismatch |",
        "| E3102 | field type mismatch |",
        1,
    );
    assert_ne!(edited, SPEC, "the E3102 row was not found");
    let problems = differences(&edited);
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(problems[0].starts_with("E3102: title"), "{problems:?}");
}

#[test]
fn a_changed_severity_letter_is_detected() {
    let edited = SPEC.replacen(
        "| W0030 | naming convention |",
        "| E0030 | naming convention |",
        1,
    );
    assert_ne!(edited, SPEC);
    let problems = differences(&edited);
    assert!(
        problems.iter().any(|p| p.starts_with("E0030")),
        "{problems:?}"
    );
}

#[test]
fn a_missing_or_extra_code_is_detected() {
    let without: String = SPEC
        .lines()
        .filter(|line| !line.starts_with("| E3102 |"))
        .collect::<Vec<_>>()
        .join("\n");
    let problems = differences(&without);
    assert_eq!(
        problems,
        ["E3102 is in codes.rs but not in the spec".to_string()]
    );

    let with_extra = SPEC.replacen(
        "| E9999 | internal compiler error |",
        "| E9998 | invented |  |\n| E9999 | internal compiler error |",
        1,
    );
    let problems = differences(&with_extra);
    assert_eq!(
        problems,
        ["E9998 is in the spec but not in codes.rs".to_string()]
    );
}

#[test]
fn a_reordered_table_is_detected() {
    let swapped = SPEC
        .replacen("| E0001 |", "| EXXXX |", 1)
        .replacen("| E0002 |", "| E0001 |", 1)
        .replacen("| EXXXX |", "| E0002 |", 1);
    // Titles now mismatch too; the point is that a swap never passes.
    assert!(!differences(&swapped).is_empty());
}

#[test]
fn titles_have_no_surrounding_whitespace_and_codes_are_unique() {
    let mut seen = std::collections::BTreeSet::new();
    for code in Code::ALL {
        assert_eq!(code.title(), code.title().trim());
        assert!(seen.insert(code.as_str()), "{code}");
    }
}
