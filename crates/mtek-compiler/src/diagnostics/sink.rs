//! The diagnostic sink: accumulation, the per-file cap and deterministic
//! ordering (`spec/compiler-architecture.md` sections 4.2, 7 and 9).

use std::collections::BTreeMap;

use super::codes::Code;
use super::model::{Diagnostic, Severity};
use crate::source::{FileId, Span};

/// Diagnostics kept per file before further ones are suppressed
/// (`spec/compiler-architecture.md` section 9, `W9003`).
pub const MAX_DIAGNOSTICS_PER_FILE: usize = 200;

/// Counts for the `summary` object of a report (`spec/diagnostics.md` 2.2).
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct Summary {
    pub errors: usize,
    pub warnings: usize,
    pub notes: usize,
    /// Diagnostics dropped by the per-file cap.
    pub suppressed: usize,
}

/// The finished, ordered diagnostics of one run.
#[derive(Clone, PartialEq, Eq, Default, Debug)]
pub struct Report {
    /// Ordered by `(file load order, start, end, code)`; diagnostics without
    /// a location come first.
    pub diagnostics: Vec<Diagnostic>,
    pub summary: Summary,
}

#[derive(Debug, Default)]
struct FileBucket {
    /// At most `limit` diagnostics, sorted by key.
    kept: Vec<Diagnostic>,
    dropped: usize,
}

/// Collects diagnostics from every stage; stages report all problems they
/// find instead of stopping at the first (`spec/compiler-architecture.md`
/// section 7).
///
/// Per file only the first [`MAX_DIAGNOSTICS_PER_FILE`] diagnostics in report
/// order (file, start, end, code) are kept, whatever the order they were
/// pushed in, so memory stays bounded and the result is deterministic.
/// [`Diagnostics::finish`] adds one `W9003` per file that lost diagnostics.
/// [`Diagnostics::has_errors`] still counts errors that were dropped.
#[derive(Debug)]
pub struct Diagnostics {
    limit: usize,
    files: BTreeMap<FileId, FileBucket>,
    unlocated: Vec<Diagnostic>,
    errors_seen: usize,
}

impl Default for Diagnostics {
    fn default() -> Self {
        Self::new()
    }
}

impl Diagnostics {
    /// An empty sink with the standard cap of 200 per file.
    #[must_use]
    pub fn new() -> Self {
        Self::with_limit(MAX_DIAGNOSTICS_PER_FILE)
    }

    /// An empty sink keeping at most `limit` diagnostics per file.
    #[must_use]
    pub fn with_limit(limit: usize) -> Self {
        Self {
            limit,
            files: BTreeMap::new(),
            unlocated: Vec::new(),
            errors_seen: 0,
        }
    }

    /// Report one diagnostic.
    pub fn push(&mut self, diagnostic: Diagnostic) {
        if diagnostic.severity == Severity::Error {
            self.errors_seen += 1;
        }
        let Some(file) = diagnostic.file() else {
            self.unlocated.push(diagnostic);
            return;
        };
        let bucket = self.files.entry(file).or_default();
        let key = diagnostic.sort_key();
        // After all equal keys: ties keep insertion order.
        let at = bucket.kept.partition_point(|kept| kept.sort_key() <= key);
        if at >= self.limit {
            bucket.dropped += 1;
            return;
        }
        bucket.kept.insert(at, diagnostic);
        if bucket.kept.len() > self.limit {
            bucket.kept.pop();
            bucket.dropped += 1;
        }
    }

    /// Report several diagnostics.
    pub fn extend(&mut self, diagnostics: impl IntoIterator<Item = Diagnostic>) {
        for diagnostic in diagnostics {
            self.push(diagnostic);
        }
    }

    /// True if any error was reported, including errors the cap dropped.
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.errors_seen > 0
    }

    /// Number of diagnostics currently kept (without the `W9003` notes that
    /// [`Self::finish`] adds).
    #[must_use]
    pub fn len(&self) -> usize {
        self.unlocated.len() + self.files.values().map(|b| b.kept.len()).sum::<usize>()
    }

    /// True if nothing was kept.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Number of diagnostics dropped by the per-file cap so far.
    #[must_use]
    pub fn suppressed(&self) -> usize {
        self.files.values().map(|b| b.dropped).sum()
    }

    /// Finish: the ordered diagnostics, one `W9003` per file that lost
    /// diagnostics (located just after the last kept diagnostic of that file),
    /// and the summary counts.
    #[must_use]
    pub fn finish(self) -> Report {
        let mut summary = Summary {
            suppressed: self.suppressed(),
            ..Summary::default()
        };
        let limit = self.limit;
        let mut all = self.unlocated;
        for (file, bucket) in self.files {
            let marker = (bucket.dropped > 0).then(|| {
                let at = bucket
                    .kept
                    .last()
                    .and_then(|d| d.primary.as_ref())
                    .map_or(0, |label| label.span.end);
                suppressed_note(file, at, bucket.dropped, limit)
            });
            all.extend(bucket.kept);
            all.extend(marker);
        }
        all.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
        for d in &all {
            match d.severity {
                Severity::Error => summary.errors += 1,
                Severity::Warning => summary.warnings += 1,
                Severity::Note => summary.notes += 1,
            }
        }
        Report {
            diagnostics: all,
            summary,
        }
    }
}

fn suppressed_note(file: FileId, at: u32, dropped: usize, limit: usize) -> Diagnostic {
    let message = if dropped == 1 {
        format!("1 further diagnostic in this file is suppressed after the first {limit}.")
    } else {
        format!(
            "{dropped} further diagnostics in this file are suppressed after the first {limit}."
        )
    };
    Diagnostic::new(Code::W9003, message).at(Span::at(file, at))
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: FileId = FileId(0);
    const B: FileId = FileId(1);

    fn err(file: FileId, start: u32) -> Diagnostic {
        Diagnostic::new(Code::E1001, format!("e{start}")).at(Span::new(file, start, start + 1))
    }

    fn starts(report: &Report) -> Vec<(u32, u32)> {
        report
            .diagnostics
            .iter()
            .map(|d| {
                let s = d.primary.as_ref().map_or(0, |l| l.span.start);
                (d.file().map_or(u32::MAX, |f| f.0), s)
            })
            .collect()
    }

    #[test]
    fn empty_sink() {
        let sink = Diagnostics::new();
        assert!(sink.is_empty());
        assert!(!sink.has_errors());
        assert_eq!(sink.suppressed(), 0);
        let report = sink.finish();
        assert!(report.diagnostics.is_empty());
        assert_eq!(report.summary, Summary::default());
    }

    #[test]
    fn sorts_by_file_start_end_code() {
        let mut sink = Diagnostics::new();
        sink.push(err(B, 1));
        sink.push(err(A, 30));
        sink.push(Diagnostic::new(Code::E3001, "x").at(Span::new(A, 10, 12)));
        sink.push(Diagnostic::new(Code::E1001, "x").at(Span::new(A, 10, 12)));
        sink.push(Diagnostic::new(Code::E1001, "x").at(Span::new(A, 10, 11)));
        sink.push(Diagnostic::new(Code::E9001, "project"));
        let report = sink.finish();
        let order: Vec<_> = report
            .diagnostics
            .iter()
            .map(|d| {
                (
                    d.file().map(|f| f.0),
                    d.sort_key().1,
                    d.sort_key().2,
                    d.code,
                )
            })
            .collect();
        assert_eq!(
            order,
            [
                (None, 0, 0, Code::E9001),
                (Some(0), 10, 11, Code::E1001),
                (Some(0), 10, 12, Code::E1001),
                (Some(0), 10, 12, Code::E3001),
                (Some(0), 30, 31, Code::E1001),
                (Some(1), 1, 2, Code::E1001),
            ]
        );
    }

    #[test]
    fn push_order_does_not_change_the_result() {
        let items: Vec<Diagnostic> = [5, 3, 9, 1, 7, 3].iter().map(|s| err(A, *s)).collect();
        let mut forward = Diagnostics::with_limit(4);
        forward.extend(items.clone());
        let mut backward = Diagnostics::with_limit(4);
        backward.extend(items.into_iter().rev());
        assert_eq!(forward.finish(), backward.finish());
    }

    #[test]
    fn ties_keep_insertion_order() {
        let mut sink = Diagnostics::new();
        for n in 0..3 {
            sink.push(Diagnostic::new(Code::E1001, format!("m{n}")).at(Span::new(A, 4, 5)));
        }
        let messages: Vec<_> = sink
            .finish()
            .diagnostics
            .into_iter()
            .map(|d| d.message)
            .collect();
        assert_eq!(messages, ["m0", "m1", "m2"]);
    }

    #[test]
    fn cap_is_200_per_file_with_one_w9003() {
        let mut sink = Diagnostics::new();
        for i in 0..250 {
            sink.push(err(A, i));
        }
        for i in 0..5 {
            sink.push(err(B, i));
        }
        assert_eq!(sink.suppressed(), 50);
        assert!(sink.has_errors());
        let report = sink.finish();
        assert_eq!(report.summary.suppressed, 50);
        assert_eq!(report.summary.errors, 205);
        assert_eq!(report.summary.warnings, 1);
        let notes: Vec<_> = report
            .diagnostics
            .iter()
            .filter(|d| d.code == Code::W9003)
            .collect();
        assert_eq!(notes.len(), 1);
        let note = notes[0];
        assert_eq!(note.file(), Some(A));
        assert_eq!(
            note.message,
            "50 further diagnostics in this file are suppressed after the first 200."
        );
        assert_eq!(report.diagnostics.len(), 206);
        // The kept diagnostics are the first 200 in report order.
        let kept_a: Vec<_> = starts(&report)
            .into_iter()
            .filter(|(f, _)| *f == 0)
            .collect();
        assert_eq!(kept_a.len(), 201);
        assert_eq!(kept_a[199], (0, 199));
        // The note sits right after the last kept diagnostic.
        assert_eq!(report.diagnostics[200].code, Code::W9003);
        assert_eq!(
            report.diagnostics[200].primary.as_ref().map(|l| l.span),
            Some(Span::at(A, 200))
        );
    }

    #[test]
    fn singular_message_and_exact_limit() {
        let mut exact = Diagnostics::with_limit(3);
        for i in 0..3 {
            exact.push(err(A, i));
        }
        assert_eq!(exact.suppressed(), 0);
        assert_eq!(exact.finish().diagnostics.len(), 3);

        let mut over = Diagnostics::with_limit(3);
        for i in 0..4 {
            over.push(err(A, i));
        }
        let report = over.finish();
        let note = report.diagnostics.last().unwrap();
        assert_eq!(note.code, Code::W9003);
        assert_eq!(
            note.message,
            "1 further diagnostic in this file is suppressed after the first 3."
        );
    }

    #[test]
    fn dropped_errors_still_count_for_has_errors() {
        let mut sink = Diagnostics::with_limit(2);
        for i in 0..2 {
            sink.push(Diagnostic::new(Code::W3081, "w").at(Span::new(A, i, i + 1)));
        }
        assert!(!sink.has_errors());
        // Sorts after both warnings, so the cap drops it.
        sink.push(err(A, 50));
        assert!(sink.has_errors());
        assert_eq!(sink.suppressed(), 1);
        let report = sink.finish();
        assert_eq!(report.summary.errors, 0);
        assert_eq!(report.summary.warnings, 3);
    }

    #[test]
    fn earlier_positions_displace_later_ones() {
        let mut sink = Diagnostics::with_limit(2);
        sink.push(err(A, 10));
        sink.push(err(A, 20));
        sink.push(err(A, 5));
        let report = sink.finish();
        assert_eq!(starts(&report), [(0, 5), (0, 10), (0, 10 + 1)]);
        assert_eq!(report.diagnostics[2].code, Code::W9003);
    }

    #[test]
    fn unlocated_diagnostics_are_not_capped() {
        let mut sink = Diagnostics::with_limit(1);
        for _ in 0..5 {
            sink.push(Diagnostic::new(Code::E9001, "p"));
        }
        assert_eq!(sink.suppressed(), 0);
        let report = sink.finish();
        assert_eq!(report.diagnostics.len(), 5);
        assert_eq!(report.summary.errors, 5);
    }

    #[test]
    fn summary_counts_severities() {
        let mut sink = Diagnostics::new();
        sink.push(err(A, 0));
        sink.push(Diagnostic::new(Code::W0007, "w").at(Span::new(A, 1, 2)));
        sink.push(Diagnostic::new(Code::W0030, "w").at(Span::new(A, 2, 3)));
        let report = sink.finish();
        assert_eq!(
            report.summary,
            Summary {
                errors: 1,
                warnings: 2,
                notes: 0,
                suppressed: 0
            }
        );
    }
}
