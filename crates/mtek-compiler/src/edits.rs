//! Suggested edits: the one place that decides whether a proposed fix may be
//! attached to a diagnostic (`spec/diagnostics.md` section 6, decision 0071).
//!
//! # The data model
//!
//! A [`SuggestedEdit`] is a titled (`description`) list of [`TextEdit`]s, each
//! a half-open byte range of one file and the text that replaces it. Offsets
//! are those of the diagnostic envelope: bytes of the file as stored on disk,
//! all in *original* offsets (the edits of one suggestion are applied together,
//! in any order, by [`apply_edits`]). An insertion is an empty range. The
//! guarantees a consumer (the command line tool, a language server) may rely
//! on for every attached edit:
//!
//! * the edits of one suggestion do not overlap each other (two insertions at
//!   one offset count as overlapping: their order would be ambiguous);
//! * the suggestions of different diagnostics of one report never overlap
//!   ([`spans_conflict`]); where two would, only the first in report order
//!   keeps its edit;
//! * a diagnostic has at most one suggestion (several proposals mean the
//!   intent is ambiguous, and then there is none);
//! * an edit never deletes text without writing something in its place, and
//!   never changes the program except through the reporter's mechanical rewrite
//!   (a rename, a missing `;`, parentheses, a float literal spelled out);
//! * the suggestion was *validated*: see below.
//!
//! # Validation
//!
//! Reporting stages only *propose* ([`Diagnostic::candidate`]). When a report
//! is finished through [`finish`] (the single path of `check`, `analyze`,
//! `build` and `inspect`), every proposal is judged by re-running the front
//! end (`check.rs`: load, lex, parse, resolve, type-check, the scene and asset
//! checks, effects) on an in-memory copy of the project with the edit applied
//! ([`EditedFs`]; nothing on disk is touched). The edit is attached only if
//! the copy no longer has the diagnostic and has no error that the unedited
//! project did not have. Diagnostics are compared by `(severity, code, file,
//! message)`; byte offsets are left out because the edit moves them. The check
//! is deliberately conservative: it rejects an edit whenever it cannot prove
//! it, never attaches one on a guess.
//!
//! Limits of what is proven, stated in the decision record: the re-check is the
//! front end, which is every stage that reports a catalogue code with an edit;
//! errors of the later emit stage are not part of the comparison, because
//! `check` does not report them either. Reports in which diagnostics were
//! suppressed (the per-file cap of 200) get no edits, because a suppressed
//! error could hide a new one. At most [`MAX_EDIT_VALIDATIONS`] proposals are
//! re-checked per report, in report order, so that the cost stays bounded.

use std::collections::BTreeMap;
use std::fmt;

use crate::check::{AnalyzeOptions, front_end_with};
use crate::diagnostics::{Code, Diagnostic, Diagnostics, Report, Severity, SuggestedEdit, TextEdit};
use crate::project::ProjectRoot;
use crate::source::{Fs, FsError, ProjectPath, SourceMap, Span};

#[cfg(test)]
mod tests;

/// At most this many proposals of one report are re-checked; later ones (in
/// report order) get no edit. Each re-check runs the whole front end once.
pub const MAX_EDIT_VALIDATIONS: usize = 32;

/// Why a set of edits cannot be applied to a text.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EditError {
    /// An edit reaches past the end of the text.
    OutOfRange,
    /// An edit starts or ends inside a multi-byte character.
    NotOnCharBoundary,
    /// Two edits overlap (see [`spans_conflict`]).
    Overlap,
}

impl fmt::Display for EditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            EditError::OutOfRange => "an edit reaches past the end of the text",
            EditError::NotOnCharBoundary => "an edit splits a character",
            EditError::Overlap => "two edits overlap",
        })
    }
}

impl std::error::Error for EditError {}

/// Whether two edit ranges overlap, so that they cannot both be applied.
/// Ranges in different files never do. Two non-empty ranges overlap if they
/// share a byte; an insertion overlaps a non-empty range only strictly inside
/// it (at either end it is applied before or after the replacement); two
/// insertions at the same offset overlap, because their order is ambiguous.
#[must_use]
pub fn spans_conflict(a: Span, b: Span) -> bool {
    if a.file != b.file {
        return false;
    }
    match (a.is_empty(), b.is_empty()) {
        (true, true) => a.start == b.start,
        (true, false) => b.start < a.start && a.start < b.end,
        (false, true) => a.start < b.start && b.start < a.end,
        (false, false) => a.start < b.end && b.start < a.end,
    }
}

/// `text` with `edits` applied, all in the original offsets of `text`
/// (the `file` of the spans is not looked at: the caller passes the edits of
/// one file).
///
/// # Errors
/// [`EditError`] if an edit is out of range, splits a character, or overlaps
/// another.
pub fn apply_edits(text: &str, edits: &[TextEdit]) -> Result<String, EditError> {
    let mut sorted: Vec<&TextEdit> = edits.iter().collect();
    sorted.sort_by_key(|edit| (edit.span.start, edit.span.end));
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    let mut previous: Option<&TextEdit> = None;
    for edit in sorted {
        let (start, end) = (edit.span.start as usize, edit.span.end as usize);
        if end > text.len() {
            return Err(EditError::OutOfRange);
        }
        if !text.is_char_boundary(start) || !text.is_char_boundary(end) {
            return Err(EditError::NotOnCharBoundary);
        }
        if previous.is_some_and(|p| spans_conflict(p.span, edit.span)) || start < cursor {
            return Err(EditError::Overlap);
        }
        out.push_str(text.get(cursor..start).ok_or(EditError::OutOfRange)?);
        out.push_str(&edit.replacement);
        cursor = end;
        previous = Some(edit);
    }
    out.push_str(text.get(cursor..).ok_or(EditError::OutOfRange)?);
    Ok(out)
}

/// What the re-check runs the front end on: the project as the report was made
/// from.
pub(crate) struct Recheck<'a> {
    pub(crate) root: &'a ProjectRoot,
    pub(crate) fs: &'a dyn Fs,
    pub(crate) options: &'a AnalyzeOptions,
}

/// Finish `sink` into a [`Report`] and attach the validated edits of its
/// diagnostics. `sources` is the source map of the project the report was
/// made from (`None` if it did not load: nothing to edit then).
///
/// This is the one way a report with suggested edits comes about.
pub(crate) fn finish(
    sink: Diagnostics,
    recheck: &Recheck<'_>,
    sources: Option<&SourceMap>,
) -> Report {
    let mut report = sink.finish();
    attach_validated(&mut report, recheck, sources);
    report
}

/// Validate the proposals of `report` and attach the survivors. Afterwards no
/// diagnostic has a proposal left.
fn attach_validated(report: &mut Report, recheck: &Recheck<'_>, sources: Option<&SourceMap>) {
    let any = report.diagnostics.iter().any(|d| !d.candidates.is_empty());
    let mut validator = if any {
        sources.and_then(|sources| Validator::start(recheck, sources))
    } else {
        None
    };
    // The ranges the attached edits of earlier diagnostics (in report order)
    // occupy.
    let mut claimed: Vec<Span> = Vec::new();
    for diagnostic in &mut report.diagnostics {
        let proposals = std::mem::take(&mut diagnostic.candidates);
        // Several proposals: the intent is ambiguous, nothing is attached.
        let Ok([proposal]) = <[SuggestedEdit; 1]>::try_from(proposals) else {
            continue;
        };
        let Some(validator) = validator.as_mut() else {
            continue;
        };
        let Some(proposal) = well_formed(proposal) else {
            continue;
        };
        let overlaps = proposal.edits.iter().any(|edit| {
            claimed
                .iter()
                .any(|taken| spans_conflict(edit.span, *taken))
        });
        if overlaps || !validator.proves(diagnostic, &proposal) {
            continue;
        }
        claimed.extend(proposal.edits.iter().map(|edit| edit.span));
        diagnostic.edits.push(proposal);
    }
}

/// The proposal with its edits in order, or `None` if it breaks a rule that is
/// visible without re-checking: no title, no edit, a deletion.
fn well_formed(mut proposal: SuggestedEdit) -> Option<SuggestedEdit> {
    if proposal.description.trim().is_empty() || proposal.edits.is_empty() {
        return None;
    }
    if proposal
        .edits
        .iter()
        .any(|edit| edit.replacement.is_empty() && !edit.span.is_empty())
    {
        return None;
    }
    proposal
        .edits
        .sort_by_key(|edit| (edit.span.file, edit.span.start, edit.span.end));
    Some(proposal)
}

/// A diagnostic as the comparison sees it: everything except the byte
/// offsets, which an edit moves.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
struct Key {
    severity: Severity,
    code: Code,
    file: Option<String>,
    message: String,
}

impl Key {
    fn of(diagnostic: &Diagnostic, sources: &SourceMap) -> Self {
        Self {
            severity: diagnostic.severity,
            code: diagnostic.code,
            file: diagnostic
                .primary
                .as_ref()
                .and_then(|label| sources.get(label.span.file))
                .map(|file| file.path().as_str().to_owned()),
            message: diagnostic.message.clone(),
        }
    }
}

/// What one run of the front end reported.
struct Outcome {
    counts: BTreeMap<Key, usize>,
    suppressed: usize,
}

impl Outcome {
    fn of(report: &Report, sources: &SourceMap) -> Self {
        let mut counts = BTreeMap::new();
        for diagnostic in &report.diagnostics {
            *counts.entry(Key::of(diagnostic, sources)).or_insert(0) += 1;
        }
        Self {
            counts,
            suppressed: report.summary.suppressed,
        }
    }

    fn count(&self, key: &Key) -> usize {
        self.counts.get(key).copied().unwrap_or(0)
    }
}

/// Re-checks proposals against the unedited project.
struct Validator<'a> {
    recheck: &'a Recheck<'a>,
    sources: &'a SourceMap,
    baseline: Outcome,
    runs: usize,
}

impl<'a> Validator<'a> {
    /// The validator, or `None` if the unedited project cannot serve as the
    /// baseline: it did not load, or diagnostics were suppressed (a suppressed
    /// error could hide a new one).
    fn start(recheck: &'a Recheck<'a>, sources: &'a SourceMap) -> Option<Self> {
        let baseline = run(recheck, &BTreeMap::new())?;
        (baseline.suppressed == 0).then_some(Self {
            recheck,
            sources,
            baseline,
            runs: 0,
        })
    }

    /// Whether the project with `proposal` applied no longer has `diagnostic`
    /// and has no error that the unedited project lacks.
    fn proves(&mut self, diagnostic: &Diagnostic, proposal: &SuggestedEdit) -> bool {
        if self.runs >= MAX_EDIT_VALIDATIONS {
            return false;
        }
        let target = Key::of(diagnostic, self.sources);
        let Some(replaced) = self.apply(proposal) else {
            return false;
        };
        self.runs += 1;
        let Some(edited) = run(self.recheck, &replaced) else {
            return false;
        };
        if edited.suppressed > 0 || edited.count(&target) >= self.baseline.count(&target) {
            return false;
        }
        // No error beyond those of the baseline: a fix may remove other
        // errors too, but must not add one.
        edited
            .counts
            .iter()
            .filter(|(key, _)| key.severity == Severity::Error)
            .all(|(key, count)| *count <= self.baseline.count(key))
    }

    /// The new contents (by path in the real file system) of the files the
    /// proposal changes; `None` if an edit is out of range, overlaps, names an
    /// unknown file, or changes nothing.
    fn apply(&self, proposal: &SuggestedEdit) -> Option<BTreeMap<ProjectPath, Vec<u8>>> {
        let mut per_file: BTreeMap<_, Vec<TextEdit>> = BTreeMap::new();
        for edit in &proposal.edits {
            per_file
                .entry(edit.span.file)
                .or_default()
                .push(edit.clone());
        }
        let mut replaced = BTreeMap::new();
        for (file, edits) in per_file {
            let source = self.sources.get(file)?;
            let text = apply_edits(source.text(), &edits).ok()?;
            if text == source.text() {
                return None;
            }
            replaced.insert(
                self.recheck.root.dir().join(source.path()),
                text.into_bytes(),
            );
        }
        Some(replaced)
    }
}

/// Run the front end over the project with `replaced` files substituted.
fn run(recheck: &Recheck<'_>, replaced: &BTreeMap<ProjectPath, Vec<u8>>) -> Option<Outcome> {
    let fs = EditedFs {
        inner: recheck.fs,
        replaced,
    };
    let mut sink = Diagnostics::new();
    let front = front_end_with(recheck.root, &fs, recheck.options, &mut sink);
    let report = sink.finish();
    let sources = front.project.as_ref()?.sources.clone();
    Some(Outcome::of(&report, &sources))
}

/// A file system that serves `inner`, except that some files have other
/// contents: the in-memory copy of a project with an edit applied. Paths are
/// those of `inner` (relative to its base, not to the project root).
pub(crate) struct EditedFs<'a> {
    inner: &'a dyn Fs,
    replaced: &'a BTreeMap<ProjectPath, Vec<u8>>,
}

impl Fs for EditedFs<'_> {
    fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError> {
        match self.replaced.get(p) {
            Some(bytes) => Ok(bytes.clone()),
            None => self.inner.read(p),
        }
    }

    fn len(&self, p: &ProjectPath) -> Result<u64, FsError> {
        match self.replaced.get(p) {
            Some(bytes) => Ok(bytes.len() as u64),
            None => self.inner.len(p),
        }
    }

    fn exact_case_exists(&self, p: &ProjectPath) -> bool {
        self.inner.exact_case_exists(p)
    }

    fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError> {
        self.inner.list_dir(p)
    }
}
