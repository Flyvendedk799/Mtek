//! Comments as the printer sees them: the trivia side table of the lexer
//! (`spec/compiler-architecture.md` section 4.3), each comment with the one
//! fact about its surroundings the printer needs, and a cursor that hands them
//! out in source order.

use crate::syntax::{Token, Trivia, TriviaKind};

/// One comment, ready to be printed.
#[derive(Clone, Debug)]
pub(super) struct Comment {
    pub kind: TriviaKind,
    /// Where the comment starts and ends in the source (byte offsets).
    pub start: u32,
    pub end: u32,
    /// The text to print: the comment as written, with line breaks as `\n`
    /// and, for a `//` comment, without trailing spaces and tabs.
    pub text: String,
    /// There is a line break between the end of whatever precedes the comment
    /// (the previous token or comment) and the comment, or nothing precedes
    /// it: the comment starts its line.
    pub starts_line: bool,
}

impl Comment {
    /// A `//` or `///` comment: it ends at the end of its line.
    pub(super) fn is_line_comment(&self) -> bool {
        self.kind != TriviaKind::BlockComment
    }

    pub(super) fn is_doc(&self) -> bool {
        self.kind == TriviaKind::DocComment
    }
}

/// The text a comment is printed with: line terminators are `\n`, and a `//`
/// comment loses the spaces and tabs at its end.
pub(super) fn normalized_text(kind: TriviaKind, raw: &str) -> String {
    match kind {
        TriviaKind::BlockComment => raw.replace("\r\n", "\n"),
        TriviaKind::LineComment | TriviaKind::DocComment => {
            raw.trim_end_matches([' ', '\t']).to_owned()
        }
    }
}

/// All comments of a file in source order, with a cursor.
pub(super) struct Comments {
    items: Vec<Comment>,
    next: usize,
}

impl Comments {
    pub(super) fn new(text: &str, tokens: &[Token], trivia: &Trivia) -> Self {
        let mut items: Vec<Comment> = Vec::with_capacity(trivia.len());
        for item in trivia.items() {
            let start = item.span.start;
            let end = item.span.end;
            let previous_token_end = item
                .next_token
                .checked_sub(1)
                .and_then(|index| tokens.get(index))
                .map_or(0, |token| token.span.end);
            let previous_end = items
                .last()
                .map_or(previous_token_end, |last| last.end.max(previous_token_end));
            let before = text
                .get(previous_end as usize..start as usize)
                .unwrap_or_default();
            // Nothing precedes the first comment of a file but a byte-order mark.
            let nothing_before = items.is_empty() && item.next_token == 0;
            let raw = text.get(start as usize..end as usize).unwrap_or_default();
            items.push(Comment {
                kind: item.kind,
                start,
                end,
                text: normalized_text(item.kind, raw),
                starts_line: nothing_before || before.contains('\n'),
            });
        }
        Comments { items, next: 0 }
    }

    /// The next comment that has not been printed.
    pub(super) fn peek(&self) -> Option<&Comment> {
        self.items.get(self.next)
    }

    /// The next comment if it starts before `pos`.
    pub(super) fn peek_before(&self, pos: u32) -> Option<&Comment> {
        self.peek().filter(|comment| comment.start < pos)
    }

    /// Hand out the next comment if `wanted` says so.
    pub(super) fn take_if(&mut self, wanted: impl FnOnce(&Comment) -> bool) -> Option<Comment> {
        if self.peek().is_some_and(wanted) {
            self.take()
        } else {
            None
        }
    }

    /// Hand out the next comment.
    pub(super) fn take(&mut self) -> Option<Comment> {
        let comment = self.items.get(self.next)?.clone();
        self.next += 1;
        Some(comment)
    }

    /// Every comment that starts before `pos`, in source order.
    pub(super) fn take_before(&mut self, pos: u32) -> Vec<Comment> {
        let mut taken = Vec::new();
        while self.peek_before(pos).is_some() {
            taken.extend(self.take());
        }
        taken
    }

    /// Comments that were never handed out (a printer defect).
    pub(super) fn remaining(&self) -> usize {
        self.items.len().saturating_sub(self.next)
    }
}
