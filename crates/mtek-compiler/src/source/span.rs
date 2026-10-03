//! File identities and byte spans.

use std::fmt;
use std::ops::Range;

/// Stable identity of a source file inside one [`SourceMap`](super::SourceMap).
///
/// Ids are handed out in insertion order starting at 0.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct FileId(pub u32);

impl FileId {
    /// The id as an index into per-file tables.
    #[must_use]
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

impl fmt::Display for FileId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "file#{}", self.0)
    }
}

/// A half-open byte range `[start, end)` into the text of one file, exactly as
/// stored on disk (`spec/language.md` section 1.2).
///
/// The constructor keeps `start <= end`. A span built from foreign offsets may
/// point outside its file; [`SourceMap::slice`](super::SourceMap::slice)
/// answers such a span with `None` instead of panicking.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Span {
    pub file: FileId,
    pub start: u32,
    pub end: u32,
}

impl Span {
    /// A span covering `[start, end)`. If `end < start` the span is empty and
    /// sits at `start`.
    #[must_use]
    pub fn new(file: FileId, start: u32, end: u32) -> Self {
        Self {
            file,
            start,
            end: end.max(start),
        }
    }

    /// An empty span at `offset`.
    #[must_use]
    pub fn at(file: FileId, offset: u32) -> Self {
        Self::new(file, offset, offset)
    }

    /// Length in bytes.
    #[must_use]
    pub fn len(self) -> u32 {
        self.end.saturating_sub(self.start)
    }

    /// True if the span covers no bytes.
    #[must_use]
    pub fn is_empty(self) -> bool {
        self.end <= self.start
    }

    /// The smallest span covering both, or `None` if they are in different
    /// files.
    #[must_use]
    pub fn join(self, other: Span) -> Option<Span> {
        if self.file != other.file {
            return None;
        }
        Some(Span {
            file: self.file,
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        })
    }

    /// True if the byte at `offset` lies inside the span (`start <= offset < end`).
    #[must_use]
    pub fn contains(self, offset: u32) -> bool {
        self.start <= offset && offset < self.end
    }

    /// True if `other` lies entirely inside this span (same file required).
    /// An empty span is contained when its position is within `[start, end]`.
    #[must_use]
    pub fn contains_span(self, other: Span) -> bool {
        self.file == other.file && self.start <= other.start && other.end <= self.end
    }

    /// The span as a `usize` range for slicing text.
    #[must_use]
    pub fn range(self) -> Range<usize> {
        self.start as usize..self.end as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: FileId = FileId(0);
    const B: FileId = FileId(1);

    #[test]
    fn len_and_emptiness() {
        let s = Span::new(A, 4, 10);
        assert_eq!(s.len(), 6);
        assert!(!s.is_empty());
        assert!(Span::at(A, 7).is_empty());
        assert_eq!(Span::at(A, 7).len(), 0);
    }

    #[test]
    fn inverted_bounds_become_empty_at_start() {
        let s = Span::new(A, 9, 3);
        assert_eq!((s.start, s.end), (9, 9));
        assert!(s.is_empty());
    }

    #[test]
    fn contains_is_half_open() {
        let s = Span::new(A, 2, 5);
        assert!(!s.contains(1));
        assert!(s.contains(2));
        assert!(s.contains(4));
        assert!(!s.contains(5));
        assert!(!Span::at(A, 3).contains(3));
    }

    #[test]
    fn contains_span_requires_same_file_and_bounds() {
        let outer = Span::new(A, 2, 10);
        assert!(outer.contains_span(Span::new(A, 2, 10)));
        assert!(outer.contains_span(Span::new(A, 3, 4)));
        assert!(outer.contains_span(Span::at(A, 10)));
        assert!(!outer.contains_span(Span::new(A, 1, 4)));
        assert!(!outer.contains_span(Span::new(A, 9, 11)));
        assert!(!outer.contains_span(Span::new(B, 3, 4)));
    }

    #[test]
    fn join_covers_both_and_rejects_foreign_files() {
        let x = Span::new(A, 2, 5);
        let y = Span::new(A, 8, 12);
        assert_eq!(x.join(y), Some(Span::new(A, 2, 12)));
        assert_eq!(y.join(x), Some(Span::new(A, 2, 12)));
        assert_eq!(x.join(Span::new(A, 3, 4)), Some(x));
        assert_eq!(x.join(Span::new(B, 3, 4)), None);
    }

    #[test]
    fn range_slices_text() {
        let text = "hello world";
        let s = Span::new(A, 6, 11);
        assert_eq!(text.get(s.range()), Some("world"));
    }

    #[test]
    fn file_id_index_and_display() {
        assert_eq!(FileId(3).index(), 3);
        assert_eq!(FileId(3).to_string(), "file#3");
    }
}
