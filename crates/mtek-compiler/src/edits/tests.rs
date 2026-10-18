//! Tests of [`super`]: applying edits, the overlap rule and the validation of
//! proposals against a real front-end re-run.

use super::*;
use crate::analyze;
use crate::source::{FileId, MemFs};

const PROJECT: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";
const F: FileId = FileId(0);

fn edit(start: u32, end: u32, replacement: &str) -> TextEdit {
    TextEdit {
        span: Span::new(F, start, end),
        replacement: replacement.to_owned(),
    }
}

fn project(source: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(ProjectPath::new("mtek.toml").unwrap(), PROJECT)
        .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    fs
}

/// The report of the front end on `fs` after `inject` changed the sink: a way
/// to propose edits that no stage proposes today.
fn finish_with(fs: &MemFs, inject: impl FnOnce(&mut Diagnostics)) -> Report {
    let root = ProjectRoot::at_base();
    let options = AnalyzeOptions::default();
    let mut sink = Diagnostics::new();
    let front = front_end_with(&root, fs, &options, &mut sink);
    inject(&mut sink);
    let recheck = Recheck {
        root: &root,
        fs,
        options: &options,
    };
    finish(
        sink,
        &recheck,
        front.project.as_ref().map(|project| &project.sources),
    )
}

fn proposal(description: &str, edits: &[(u32, u32, &str)]) -> SuggestedEdit {
    edits
        .iter()
        .fold(SuggestedEdit::new(description), |acc, (s, e, text)| {
            acc.replace(Span::new(F, *s, *e), *text)
        })
}

/// `(start, end, replacement)` of one edit.
type Replacement = (u32, u32, String);

fn attached(report: &Report) -> Vec<(Code, Vec<Replacement>)> {
    report
        .diagnostics
        .iter()
        .filter(|d| !d.edits.is_empty())
        .map(|d| {
            let spans = d
                .edits
                .iter()
                .flat_map(|e| e.edits.iter())
                .map(|e| (e.span.start, e.span.end, e.replacement.clone()))
                .collect();
            (d.code, spans)
        })
        .collect()
}

// ----- applying edits -------------------------------------------------------

#[test]
fn edits_apply_in_original_offsets_whatever_their_order() {
    let text = "let a = 1.;";
    let both = [edit(10, 10, " // x"), edit(8, 10, "1.0")];
    assert_eq!(apply_edits(text, &both).unwrap(), "let a = 1.0 // x;");
    assert_eq!(apply_edits(text, &[]).unwrap(), text);
}

#[test]
fn an_insertion_before_a_replacement_at_the_same_offset_comes_first() {
    let edits = [edit(3, 6, "Box"), edit(3, 3, "(")];
    assert_eq!(apply_edits("if Bxx {", &edits).unwrap(), "if (Box {");
}

#[test]
fn overlapping_out_of_range_and_split_edits_are_errors() {
    assert_eq!(
        apply_edits("abcdef", &[edit(1, 4, "x"), edit(3, 5, "y")]),
        Err(EditError::Overlap)
    );
    assert_eq!(
        apply_edits("abcdef", &[edit(2, 2, "x"), edit(2, 2, "y")]),
        Err(EditError::Overlap)
    );
    assert_eq!(
        apply_edits("abcdef", &[edit(1, 4, "x"), edit(2, 2, "y")]),
        Err(EditError::Overlap)
    );
    assert_eq!(
        apply_edits("abc", &[edit(2, 9, "x")]),
        Err(EditError::OutOfRange)
    );
    assert_eq!(
        apply_edits("aéb", &[edit(2, 3, "x")]),
        Err(EditError::NotOnCharBoundary)
    );
}

#[test]
fn touching_ranges_do_not_overlap() {
    assert!(!spans_conflict(Span::new(F, 1, 3), Span::new(F, 3, 5)));
    assert!(!spans_conflict(Span::at(F, 3), Span::new(F, 3, 5)));
    assert!(!spans_conflict(Span::at(F, 5), Span::new(F, 3, 5)));
    assert!(spans_conflict(Span::at(F, 4), Span::new(F, 3, 5)));
    assert!(spans_conflict(Span::at(F, 4), Span::at(F, 4)));
    assert!(!spans_conflict(Span::at(F, 4), Span::at(F, 5)));
    assert!(spans_conflict(Span::new(F, 1, 4), Span::new(F, 3, 6)));
    assert!(!spans_conflict(
        Span::new(F, 1, 4),
        Span::new(FileId(1), 1, 4)
    ));
}

// ----- validation against a real re-check ---------------------------------

#[test]
fn a_float_fix_that_removes_the_error_is_attached() {
    let text = "const A: f32 = 1.;\nscene Demo { camera Main {} }\n";
    let result = analyze(&ProjectRoot::at_base(), &project(text));
    assert_eq!(
        attached(&result.report),
        [(Code::E0022, vec![(15, 17, "1.0".to_owned())])]
    );
    let d = &result.report.diagnostics[0];
    assert_eq!(d.edits[0].description, "write the float literal as `1.0`");
    assert!(d.candidates.is_empty(), "proposals are consumed");
}

#[test]
fn a_fix_that_creates_a_new_error_is_not_attached() {
    // `1.` as an i32 would be fixed to a float, which does not fit: the edit
    // would turn one error into another, so there is none.
    let text = "const A: i32 = 1.;\nscene Demo { camera Main {} }\n";
    let result = analyze(&ProjectRoot::at_base(), &project(text));
    assert!(
        attached(&result.report).is_empty(),
        "{:?}",
        result.report.diagnostics
    );
    assert!(result.has_errors());
}

#[test]
fn a_rename_is_attached_only_if_the_renamed_program_checks() {
    // `lenght` has the one candidate `length`, and `length(v)` is an f32.
    let fits = "const V = vec3(1.0, 2.0, 2.0);\nconst L: f32 = lenght(V);\nscene Demo { camera Main {} }\n";
    let result = analyze(&ProjectRoot::at_base(), &project(fits));
    let codes: Vec<Code> = result.report.diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(codes, [Code::E2003], "{:?}", result.report.diagnostics);
    assert_eq!(result.report.diagnostics[0].edits.len(), 1);

    // The same typo where the result is used as a vec3: the rename would give
    // a type error, so the diagnostic gets no edit.
    let misfit = "const V = vec3(1.0, 2.0, 2.0);\nconst L: vec3 = lenght(V);\nscene Demo { camera Main {} }\n";
    let result = analyze(&ProjectRoot::at_base(), &project(misfit));
    assert_eq!(result.report.diagnostics.len(), 1);
    assert!(result.report.diagnostics[0].edits.is_empty());
}

#[test]
fn several_proposals_are_ambiguous_and_attach_nothing() {
    let fs = project("const A = 1.;\nscene Demo { camera Main {} }\n");
    let report = finish_with(&fs, |sink| {
        sink.push(
            Diagnostic::new(Code::E2003, "Unknown name 'x'.")
                .at(Span::new(F, 0, 1))
                .candidate(proposal("one", &[(10, 12, "1.0")]))
                .candidate(proposal("two", &[(10, 12, "1.5")])),
        );
    });
    // The lexer's own E0022 proposal is attached; the ambiguous one is not.
    let codes: Vec<Code> = attached(&report).into_iter().map(|(c, _)| c).collect();
    assert_eq!(codes, [Code::E0022]);
}

#[test]
fn a_proposal_that_does_not_remove_its_diagnostic_is_dropped() {
    let fs = project("const A = 1.;\nscene Demo { camera Main {} }\n");
    let report = finish_with(&fs, |sink| {
        // Fabricate a diagnostic that exists in the baseline and propose an
        // edit elsewhere (a comment): the diagnostic is still there.
        sink.push(
            Diagnostic::new(Code::E5012, "Scene 'Demo' has no camera.")
                .at(Span::new(F, 15, 22))
                .candidate(proposal("add a comment", &[(0, 0, "// hi\n")])),
        );
    });
    assert!(
        attached(&report)
            .iter()
            .all(|(code, _)| *code != Code::E5012)
    );
}

#[test]
fn overlapping_proposals_keep_only_the_first_in_report_order() {
    let fs = project("const A = 1.;\nconst B = 2.;\nscene Demo { camera Main {} }\n");
    let report = finish_with(&fs, |sink| {
        // Two extra proposals on the first literal `1.` (bytes 10..12): the
        // lexer's own proposal for it comes first in report order and wins.
        sink.push(
            Diagnostic::new(Code::E0022, "Float literal `1.` has no digits after the decimal point; floats need digits on both sides of the point.")
                .at(Span::new(F, 10, 12))
                .candidate(proposal("write 1.00", &[(10, 12, "1.00")])),
        );
    });
    let got = attached(&report);
    let first: Vec<_> = got.iter().filter(|(_, e)| e[0].0 == 10).collect();
    assert_eq!(first.len(), 1, "{got:?}");
    assert_eq!(first[0].1[0].2, "1.0");
    // The second literal is not in the way of the first.
    assert!(got.iter().any(|(_, e)| e[0].0 == 24), "{got:?}");
}

#[test]
fn ill_formed_proposals_are_dropped() {
    let fs = project("const A = 1.;\nscene Demo { camera Main {} }\n");
    let report = finish_with(&fs, |sink| {
        for (code, edit) in [
            // A deletion.
            (
                Code::E5012,
                SuggestedEdit::new("delete").replace(Span::new(F, 0, 3), ""),
            ),
            // No edits.
            (Code::E5013, SuggestedEdit::new("nothing")),
            // No title.
            (
                Code::E5014,
                SuggestedEdit::new("").replace(Span::new(F, 0, 0), "x"),
            ),
            // Out of range.
            (
                Code::E5020,
                SuggestedEdit::new("far").replace(Span::new(F, 999, 1000), "x"),
            ),
            // Two insertions at one offset.
            (
                Code::E5030,
                SuggestedEdit::new("twice")
                    .replace(Span::new(F, 0, 0), "a")
                    .replace(Span::new(F, 0, 0), "b"),
            ),
        ] {
            sink.push(
                Diagnostic::new(code, "x.")
                    .at(Span::new(F, 0, 1))
                    .candidate(edit),
            );
        }
    });
    assert!(
        attached(&report)
            .iter()
            .all(|(code, _)| *code == Code::E0022),
        "{:?}",
        attached(&report)
    );
}

#[test]
fn at_most_the_validation_budget_of_proposals_is_rechecked() {
    let mut text = String::new();
    let count = MAX_EDIT_VALIDATIONS + 5;
    for i in 0..count {
        text.push_str(&format!("const A{i} = 1\n"));
    }
    text.push_str("scene Demo { camera Main {} }\n");
    let result = analyze(&ProjectRoot::at_base(), &project(&text));
    let with_edit = result
        .report
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::E1003 && !d.edits.is_empty())
        .count();
    let total = result
        .report
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::E1003)
        .count();
    assert_eq!(total, count);
    assert_eq!(with_edit, MAX_EDIT_VALIDATIONS);
    // The ones that got an edit are the first in report order.
    let first_without = result
        .report
        .diagnostics
        .iter()
        .position(|d| d.code == Code::E1003 && d.edits.is_empty())
        .unwrap();
    assert_eq!(first_without, MAX_EDIT_VALIDATIONS);
}

#[test]
fn analysis_without_edits_has_the_same_diagnostics_and_never_an_edit() {
    // Two proposals the validator accepts (`1.` and a missing `;`) and an unknown name.
    let text = "const A: f32 = 1.;\nconst B: f32 = A\nconst C: f32 = Z;\nscene Demo { camera Main {} }\n";
    let fs = project(text);
    let validated = analyze(&ProjectRoot::at_base(), &fs);
    let plain = crate::analyze_without_edits(&ProjectRoot::at_base(), &fs);
    assert!(
        validated
            .report
            .diagnostics
            .iter()
            .any(|d| !d.edits.is_empty()),
        "the program has an edit to withhold"
    );
    assert!(
        plain
            .report
            .diagnostics
            .iter()
            .all(|d| d.edits.is_empty() && d.candidates.is_empty()),
        "no edit and no unvalidated proposal"
    );
    let strip = |report: &Report| -> Vec<Diagnostic> {
        report
            .diagnostics
            .iter()
            .cloned()
            .map(|mut d| {
                d.edits.clear();
                d
            })
            .collect()
    };
    assert_eq!(strip(&validated.report), strip(&plain.report));
    assert_eq!(validated.report.summary, plain.report.summary);
    // The tree is the same: the module and its names.
    assert_eq!(validated.module, plain.module);
    assert_eq!(validated.resolution, plain.resolution);
}

#[test]
fn the_edited_copy_is_in_memory_only() {
    let text = "const A: f32 = 1.;\nscene Demo { camera Main {} }\n";
    let fs = project(text);
    let _ = analyze(&ProjectRoot::at_base(), &fs);
    assert_eq!(
        fs.read(&ProjectPath::new("src/main.mtek").unwrap())
            .unwrap(),
        text.as_bytes()
    );
}
