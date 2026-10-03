//! `spec/diagnostics.md` section 5 and `diagnostics/codes.rs` must list exactly
//! the same codes, severities and titles (D10: the code table is the single
//! source of truth, this test is the guard).
//!
//! Every catalogue row also carries an HTML anchor in its code cell,
//! `| <a id="mtek-e3102"></a>E3102 | ... |`, so that the `docs` field of a
//! diagnostic (`spec/diagnostics.md#mtek-e3102`) resolves: markdown tables
//! give their cells no ids of their own. The second half of this file guards
//! those anchors.

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::{Code, Severity};

const SPEC: &str = include_str!("../../../spec/diagnostics.md");

/// The file every `docs` field points into, relative to the repository root.
const DOCS_FILE: &str = "spec/diagnostics.md";

const ANCHOR_OPEN: &str = "<a id=\"";
const ANCHOR_CLOSE: &str = "\"></a>";

#[derive(Debug, PartialEq, Eq)]
struct Row {
    code: String,
    severity: Severity,
    title: String,
}

/// A catalogue row as written in the spec: the row plus the anchor id of its
/// code cell, if it has one.
#[derive(Debug)]
struct SpecRow {
    row: Row,
    anchor: Option<String>,
}

fn is_code(cell: &str) -> bool {
    let bytes = cell.as_bytes();
    bytes.len() == 5
        && matches!(bytes.first(), Some(b'E' | b'W'))
        && bytes.iter().skip(1).all(u8::is_ascii_digit)
}

/// Splits a code cell into its anchor id (if the cell starts with
/// `<a id="..."></a>`) and the rest of the cell.
fn split_code_cell(cell: &str) -> (Option<&str>, &str) {
    cell.strip_prefix(ANCHOR_OPEN)
        .and_then(|rest| rest.split_once(ANCHOR_CLOSE))
        .map_or((None, cell), |(id, code)| (Some(id), code.trim()))
}

/// The rows of the catalogue tables of section 5, in document order, with or
/// without an anchor in the code cell. Rows that are not a concrete code (the
/// `(E7001-E7099)` range rows) are skipped.
fn catalogue_rows(spec: &str) -> Vec<SpecRow> {
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
        let (Some(cell), Some(title)) = (cells.get(1), cells.get(2)) else {
            continue;
        };
        let (anchor, code) = split_code_cell(cell);
        if !is_code(code) {
            continue;
        }
        let severity = if code.starts_with('E') {
            Severity::Error
        } else {
            Severity::Warning
        };
        rows.push(SpecRow {
            row: Row {
                code: code.to_string(),
                severity,
                title: (*title).to_string(),
            },
            anchor: anchor.map(str::to_string),
        });
    }
    rows
}

fn spec_rows(spec: &str) -> Vec<Row> {
    catalogue_rows(spec).into_iter().map(|r| r.row).collect()
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

/// Every `<a id="...">` anchor anywhere in the document, in document order.
fn all_anchor_ids(spec: &str) -> Vec<&str> {
    let mut ids = Vec::new();
    let mut rest = spec;
    while let Some(start) = rest.find(ANCHOR_OPEN) {
        let after = &rest[start + ANCHOR_OPEN.len()..];
        let Some(end) = after.find('"') else {
            break;
        };
        ids.push(&after[..end]);
        rest = &after[end..];
    }
    ids
}

/// The fragment of a code's `docs` field (`mtek-e3102`), or a problem if the
/// field does not point into [`DOCS_FILE`].
fn docs_fragment(code: Code) -> Result<String, String> {
    let docs = code.docs();
    docs.strip_prefix(DOCS_FILE)
        .and_then(|rest| rest.strip_prefix('#'))
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "{}: docs {docs:?} does not point into {DOCS_FILE}",
                code.short()
            )
        })
}

/// Human-readable anchor problems; empty when every code in `codes.rs` has
/// exactly one anchor in the document, that anchor sits in the code cell of
/// the code's own catalogue row and equals the fragment of its `docs` field,
/// and no anchor exists that is not such a fragment.
fn anchor_problems(spec: &str) -> Vec<String> {
    let rows = catalogue_rows(spec);
    let ids = all_anchor_ids(spec);
    let mut problems = Vec::new();
    let mut fragments = Vec::new();
    for &code in Code::ALL {
        let fragment = match docs_fragment(code) {
            Ok(fragment) => fragment,
            Err(problem) => {
                problems.push(problem);
                continue;
            }
        };
        let short = code.short();
        let count = ids.iter().filter(|id| **id == fragment).count();
        match count {
            0 => problems.push(format!("{short} has no anchor {fragment:?}")),
            1 => {}
            n => problems.push(format!("{short} has {n} anchors {fragment:?}")),
        }
        if let Some(row) = rows.iter().find(|r| r.row.code == short) {
            match row.anchor.as_deref() {
                Some(anchor) if anchor == fragment => {}
                Some(anchor) => problems.push(format!(
                    "{short}: its row has anchor {anchor:?}, its docs fragment is {fragment:?}"
                )),
                None if count > 0 => problems.push(format!(
                    "{short}: anchor {fragment:?} is not in the code cell of its row"
                )),
                None => {}
            }
        }
        fragments.push(fragment);
    }
    for id in &ids {
        if !fragments.iter().any(|f| f == id) {
            problems.push(format!("anchor {id:?} belongs to no code"));
        }
    }
    problems
}

/// The spec with every anchor removed, as it was before anchors existed.
fn strip_anchors(spec: &str) -> String {
    let mut out = String::with_capacity(spec.len());
    let mut rest = spec;
    while let Some(start) = rest.find(ANCHOR_OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let end = after
            .find(ANCHOR_CLOSE)
            .expect("an anchor without its closing tag");
        rest = &after[end + ANCHOR_CLOSE.len()..];
    }
    out.push_str(rest);
    out
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
fn the_parser_reads_rows_with_and_without_an_anchor() {
    let stripped = strip_anchors(SPEC);
    assert!(!stripped.contains(ANCHOR_OPEN));
    assert_eq!(spec_rows(&stripped), spec_rows(SPEC));
    assert!(differences(&stripped).is_empty());
    assert_eq!(
        split_code_cell("<a id=\"mtek-e3102\"></a>E3102"),
        (Some("mtek-e3102"), "E3102")
    );
    assert_eq!(split_code_cell("E3102"), (None, "E3102"));
    assert_eq!(split_code_cell("(E7001–E7099)"), (None, "(E7001–E7099)"));
}

#[test]
fn a_changed_title_is_detected() {
    let edited = SPEC.replacen(
        "E3102 | field or parameter type mismatch |",
        "E3102 | field type mismatch |",
        1,
    );
    assert_ne!(edited, SPEC, "the E3102 row was not found");
    let problems = differences(&edited);
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(problems[0].starts_with("E3102: title"), "{problems:?}");
}

#[test]
fn a_changed_severity_letter_is_detected() {
    let edited = strip_anchors(SPEC).replacen(
        "| W0030 | naming convention |",
        "| E0030 | naming convention |",
        1,
    );
    assert_ne!(edited, strip_anchors(SPEC));
    let problems = differences(&edited);
    assert!(
        problems.iter().any(|p| p.starts_with("E0030")),
        "{problems:?}"
    );
}

#[test]
fn a_missing_or_extra_code_is_detected() {
    let without: String = strip_anchors(SPEC)
        .lines()
        .filter(|line| !line.starts_with("| E3102 |"))
        .collect::<Vec<_>>()
        .join("\n");
    let problems = differences(&without);
    assert_eq!(
        problems,
        ["E3102 is in codes.rs but not in the spec".to_string()]
    );

    let with_extra = strip_anchors(SPEC).replacen(
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
    let swapped = strip_anchors(SPEC)
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

#[test]
fn every_catalogue_code_has_exactly_one_anchor_matching_its_docs_fragment() {
    let problems = anchor_problems(SPEC);
    assert!(
        problems.is_empty(),
        "spec/diagnostics.md anchors and the docs fields of codes.rs differ:\n{}",
        problems.join("\n")
    );
    // Every anchor of the document is a catalogue row's, one per code.
    assert_eq!(all_anchor_ids(SPEC).len(), Code::ALL.len());
    for row in catalogue_rows(SPEC) {
        let code = Code::parse_short(&row.row.code).unwrap();
        assert_eq!(
            row.anchor.as_deref(),
            Some(docs_fragment(code).unwrap().as_str())
        );
    }
}

#[test]
fn docs_fragments_are_lowercase_mtek_codes() {
    for &code in Code::ALL {
        let fragment = docs_fragment(code).unwrap();
        assert_eq!(
            fragment,
            format!("mtek-{}", code.short().to_ascii_lowercase())
        );
    }
}

#[test]
fn a_missing_anchor_is_detected() {
    let edited = SPEC.replacen("<a id=\"mtek-e3102\"></a>E3102 |", "E3102 |", 1);
    assert_ne!(edited, SPEC, "the anchored E3102 row was not found");
    assert!(differences(&edited).is_empty());
    assert_eq!(
        anchor_problems(&edited),
        ["E3102 has no anchor \"mtek-e3102\"".to_string()]
    );
}

#[test]
fn a_wrong_anchor_is_detected() {
    let edited = SPEC.replacen(
        "<a id=\"mtek-e3102\"></a>E3102 |",
        "<a id=\"mtek-E3102\"></a>E3102 |",
        1,
    );
    assert_ne!(edited, SPEC, "the anchored E3102 row was not found");
    assert_eq!(
        anchor_problems(&edited),
        [
            "E3102 has no anchor \"mtek-e3102\"".to_string(),
            "E3102: its row has anchor \"mtek-E3102\", its docs fragment is \"mtek-e3102\""
                .to_string(),
            "anchor \"mtek-E3102\" belongs to no code".to_string(),
        ]
    );
}

#[test]
fn a_duplicate_or_misplaced_anchor_is_detected() {
    // A second anchor for E3102 elsewhere in the document.
    let duplicated = SPEC.replacen(
        "## 6. Suggested edits",
        "## 6. Suggested edits <a id=\"mtek-e3102\"></a>",
        1,
    );
    assert_ne!(duplicated, SPEC);
    assert_eq!(
        anchor_problems(&duplicated),
        ["E3102 has 2 anchors \"mtek-e3102\"".to_string()]
    );

    // The only anchor for E3102 moved out of its row.
    let moved = SPEC
        .replacen("<a id=\"mtek-e3102\"></a>E3102 |", "E3102 |", 1)
        .replacen(
            "## 6. Suggested edits",
            "## 6. Suggested edits <a id=\"mtek-e3102\"></a>",
            1,
        );
    assert_eq!(
        anchor_problems(&moved),
        ["E3102: anchor \"mtek-e3102\" is not in the code cell of its row".to_string()]
    );
}

#[test]
fn an_anchor_without_a_code_is_detected() {
    let edited = SPEC.replacen(
        "| (E7001–E7099) |",
        "| <a id=\"mtek-e7001\"></a>(E7001–E7099) |",
        1,
    );
    assert_ne!(edited, SPEC, "the E7001-E7099 range row was not found");
    assert_eq!(
        anchor_problems(&edited),
        ["anchor \"mtek-e7001\" belongs to no code".to_string()]
    );
}
