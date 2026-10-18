//! The printer: the syntax tree and the comments in, a [`Doc`] out.
//!
//! This file holds what every construct shares: the placement of comments and
//! blank lines, brace-delimited bodies, and comma- or semicolon-separated
//! lists. The constructs themselves are in `decls.rs`, `stmts.rs` and
//! `exprs.rs`.
//!
//! # Where a comment goes
//!
//! Comments are attached by position (their span against the spans of the
//! nodes), in one pass over the tree in source order, so that none can be
//! printed twice or out of order.
//!
//! * In a body (module, braces of an item, a block) and in the member lists a
//!   body consists of, a comment before a member is printed on its own line
//!   before it, a comment on the line of a member's end after it, a comment
//!   after the last member before the closing brace on its own line, and a
//!   comment on the line of the opening brace after the brace.
//! * Inside a construct that is printed on one line when it fits (an
//!   expression, a parameter list), a comment before a node is printed before
//!   it (`/* c */ x`; a `//` comment on its own line keeps its line, one after
//!   a token goes to the end of the line), and a comment after the last node
//!   before the closing delimiter after it.
//! * What is left of a member's comments when its end is reached (a comment
//!   between two tokens that no node starts at) is printed after the member.
//!
//! The decisions, with the cases they leave open, are decision 0070.

use crate::source::Span;
use crate::syntax::ast::Node;
use crate::syntax::{Token, TokenKind, Trivia};

use super::comments::{Comment, Comments};
use super::doc::Doc;

pub(super) struct Printer<'a> {
    pub(super) text: &'a str,
    tokens: &'a [Token],
    comments: Comments,
}

/// What opens and closes a list, and what separates its items.
pub(super) struct ListStyle {
    pub open: &'static str,
    pub close: &'static str,
    /// Printed after every item but the last, and after the last one when the
    /// list is broken.
    pub separator: &'static str,
    /// A space inside the delimiters when the list is on one line (`{ A, B }`).
    pub padded: bool,
}

impl ListStyle {
    pub(super) const PARENS: ListStyle = ListStyle {
        open: "(",
        close: ")",
        separator: ",",
        padded: false,
    };
    pub(super) const BRACKETS: ListStyle = ListStyle {
        open: "[",
        close: "]",
        separator: ",",
        padded: false,
    };
    pub(super) const IMPORT_BRACES: ListStyle = ListStyle {
        open: "{",
        close: "}",
        separator: ",",
        padded: true,
    };
    pub(super) const DESCRIPTOR: ListStyle = ListStyle {
        open: "{",
        close: "}",
        separator: ";",
        padded: true,
    };
}

/// The blank-line facts that decide whether a blank line precedes a piece of
/// a body (a comment or a member).
struct BlankContext {
    /// A module (items are separated by a blank line) and not a braced body.
    top_level: bool,
    /// Nothing has been printed in the body yet.
    first: bool,
    /// The previous piece was a documentation comment.
    after_doc: bool,
    /// The piece is the first of a member's own lines: its leading comments
    /// or the member itself.
    starts_member: bool,
    /// The previous member was an import.
    after_import: bool,
    /// Whether the member the piece belongs to is an import (`None` for a
    /// comment after the last member).
    member_is_import: Option<bool>,
    /// The source has a blank line between this piece and the one before it.
    blank_in_source: bool,
}

impl BlankContext {
    fn blank_line(&self) -> bool {
        if self.first || self.after_doc {
            return false;
        }
        if self.top_level
            && self.starts_member
            && let Some(is_import) = self.member_is_import
        {
            // Items are one blank line apart; imports stay as grouped.
            return !(self.after_import && is_import) || self.blank_in_source;
        }
        self.blank_in_source
    }
}

impl<'a> Printer<'a> {
    pub(super) fn new(text: &'a str, tokens: &'a [Token], trivia: &Trivia) -> Self {
        Printer {
            text,
            tokens,
            comments: Comments::new(text, tokens, trivia),
        }
    }

    /// How many comments were never printed (a defect if not zero).
    pub(super) fn unprinted_comments(&self) -> usize {
        self.comments.remaining()
    }

    /// The source text of `span`.
    pub(super) fn slice(&self, span: Span) -> &'a str {
        self.text.get(span.range()).unwrap_or_default()
    }

    /// The first token of `kind` that starts at or after `from`.
    pub(super) fn token_from(&self, kind: TokenKind, from: u32) -> Option<&'a Token> {
        let first = self.tokens.partition_point(|t| t.span.start < from);
        self.tokens
            .get(first..)?
            .iter()
            .find(|token| token.kind == kind)
    }

    /// Where the `kind` token at or after `from` starts; `fallback` if there
    /// is none (only in a tree with errors, which the printer never sees).
    pub(super) fn token_start(&self, kind: TokenKind, from: u32, fallback: u32) -> u32 {
        self.token_from(kind, from)
            .map_or(fallback, |token| token.span.start)
    }

    /// Whether the source has a blank line between the offsets `a` and `b`.
    fn blank_between(&self, a: u32, b: u32) -> bool {
        self.text
            .get(a as usize..b as usize)
            .is_some_and(|gap| gap.matches('\n').count() >= 2)
    }

    // ----- comments inside a construct -------------------------------------

    /// The comments before `pos`, printed before the node that starts there.
    /// Returns `None` if there are none.
    pub(super) fn leading_comments(&mut self, pos: u32) -> Option<(Doc, bool)> {
        let comments = self.comments.take_before(pos);
        if comments.is_empty() {
            return None;
        }
        let mut hard = false;
        let mut parts = Vec::new();
        for comment in &comments {
            if comment.is_line_comment() {
                // The comment ends its line, wherever that is.
                hard = true;
                parts.push(if comment.starts_line {
                    Doc::EnsureLine
                } else {
                    Doc::Space
                });
                parts.push(Doc::text(&comment.text));
                parts.push(Doc::HardLine);
            } else {
                parts.push(verbatim_or_text(&comment.text));
                parts.push(Doc::Space);
            }
        }
        Some((Doc::concat(parts), hard))
    }

    /// `body` preceded by the comments that come before `pos` (the start of
    /// the node `body` prints).
    pub(super) fn with_leading(&mut self, pos: u32, body: Doc) -> Doc {
        let leading = self.leading_comments(pos);
        combine_leading(leading, body)
    }

    /// Comments before `pos` printed after the node that was just printed.
    pub(super) fn trailing_comments(&mut self, pos: u32) -> Doc {
        let comments = self.comments.take_before(pos);
        Doc::concat(comments.iter().map(trailing_comment).collect())
    }

    /// The `;` that ends the construct which ends at `end`, after the
    /// comments that stand before it.
    pub(super) fn semicolon(&mut self, end: u32) -> Doc {
        let before = self.trailing_comments(end.saturating_sub(1));
        Doc::concat(vec![before, Doc::text(";")])
    }

    /// The comments before `limit` that start on the line of the node that was
    /// just printed.
    fn trailing_comments_on_the_line(&mut self, limit: u32) -> Doc {
        let mut parts = Vec::new();
        // A `//` comment ends the line: a comment after it starts the next one,
        // and belongs to what follows.
        let mut line_ended = false;
        while !line_ended
            && let Some(comment) = self
                .comments
                .take_if(|comment| comment.start < limit && !comment.starts_line)
        {
            line_ended = comment.is_line_comment();
            parts.push(trailing_comment(&comment));
        }
        Doc::concat(parts)
    }

    // ----- lists ------------------------------------------------------------

    /// `items` between the delimiters of `style`: on one line if it fits,
    /// else one item per line, indented, each followed by the separator.
    /// `close` is where the closing delimiter starts.
    pub(super) fn list<T: Node>(
        &mut self,
        style: &ListStyle,
        items: &[T],
        close: u32,
        print: &mut dyn FnMut(&mut Self, &T) -> Doc,
    ) -> Doc {
        let edge = if style.padded {
            Doc::Line
        } else {
            Doc::SoftLine
        };
        if items.is_empty() {
            return self.empty_list(style, close, edge);
        }
        let mut inside = vec![edge.clone()];
        for (index, item) in items.iter().enumerate() {
            let leading = self.leading_comments(item.span().start);
            let doc = print(self, item);
            inside.push(match leading {
                None => doc,
                Some((comments, _)) => Doc::concat(vec![comments, doc]),
            });
            match items.get(index + 1) {
                Some(next) => {
                    inside.push(Doc::text(style.separator));
                    inside.push(self.trailing_comments_on_the_line(next.span().start));
                    inside.push(Doc::Line);
                }
                None => {
                    inside.push(Doc::if_break(Doc::text(style.separator)));
                    inside.push(self.trailing_comments(close));
                }
            }
        }
        Doc::group(Doc::concat(vec![
            Doc::text(style.open),
            Doc::indent(Doc::concat(inside)),
            edge,
            Doc::text(style.close),
        ]))
    }

    /// `()` or `{}`, with the comments between the delimiters, if any.
    fn empty_list(&mut self, style: &ListStyle, close: u32, edge: Doc) -> Doc {
        let comments = self.comments.take_before(close);
        if comments.is_empty() {
            return Doc::text(format!("{}{}", style.open, style.close));
        }
        let mut inside = vec![edge.clone()];
        for (index, comment) in comments.iter().enumerate() {
            if index > 0 {
                inside.push(Doc::Line);
            }
            inside.push(verbatim_or_text(&comment.text));
            if comment.is_line_comment() {
                inside.push(Doc::HardLine);
            }
        }
        Doc::group(Doc::concat(vec![
            Doc::text(style.open),
            Doc::indent(Doc::concat(inside)),
            edge,
            Doc::text(style.close),
        ]))
    }

    // ----- bodies -----------------------------------------------------------

    /// A body: `{`, the members one per line indented, `}`. `open` and
    /// `close` are where the braces are.
    pub(super) fn braced<T: Node>(
        &mut self,
        open: u32,
        close: u32,
        items: &[T],
        print: &mut dyn FnMut(&mut Self, &T) -> Doc,
    ) -> Doc {
        let first_start = items.first().map_or(close, |item| item.span().start);
        // Comments between the header and the brace stay before it (after it
        // they would be taken for comments of the first member, and a
        // documentation comment would document it); comments after the brace
        // on its line stay on that line, up to the first `//` comment, which
        // ends it.
        let mut before_brace = Vec::new();
        let mut head = Vec::new();
        let mut line_ended = false;
        while let Some(comment) = self.comments.take_if(|c| {
            c.start < first_start && (c.start < open || (!c.starts_line && !line_ended))
        }) {
            if comment.start < open {
                before_brace.push(Doc::Space);
                before_brace.push(verbatim_or_text(&comment.text));
                before_brace.push(if comment.is_line_comment() {
                    Doc::HardLine
                } else {
                    Doc::Space
                });
            } else {
                line_ended = comment.is_line_comment();
                head.push(after_brace_comment(&comment));
            }
        }
        let pieces = self.members(items, &|_| false, print, open + 1, close, false);
        let mut parts = before_brace;
        parts.push(Doc::text("{"));
        parts.push(Doc::concat(head.clone()));
        if pieces.is_empty() {
            if !head.is_empty() {
                parts.push(Doc::HardLine);
            }
            parts.push(Doc::text("}"));
        } else {
            parts.push(Doc::indent(Doc::concat(
                std::iter::once(Doc::HardLine).chain(pieces).collect(),
            )));
            parts.push(Doc::HardLine);
            parts.push(Doc::text("}"));
        }
        Doc::concat(parts)
    }

    /// The pieces of a body: its members and its comments, one per line, with
    /// the line breaks between them. `start` is where the body's text starts
    /// (after the brace) and `end` where it ends (the closing brace, or the
    /// end of the file).
    pub(super) fn members<T: Node>(
        &mut self,
        items: &[T],
        is_import: &dyn Fn(&T) -> bool,
        print: &mut dyn FnMut(&mut Self, &T) -> Doc,
        start: u32,
        end: u32,
        top_level: bool,
    ) -> Vec<Doc> {
        let mut out: Vec<Doc> = Vec::new();
        let mut state = BodyState {
            prev_end: start,
            first: true,
            after_doc: false,
            after_import: false,
        };
        for (index, item) in items.iter().enumerate() {
            let span = item.span();
            let member_is_import = is_import(item);
            let mut starts_member = true;
            for comment in self.comments.take_before(span.start) {
                self.push_comment_line(
                    &mut out,
                    &mut state,
                    &comment,
                    top_level,
                    starts_member,
                    Some(member_is_import),
                );
                starts_member = false;
            }
            let blank = BlankContext {
                top_level,
                first: state.first,
                after_doc: state.after_doc,
                starts_member,
                after_import: state.after_import,
                member_is_import: Some(member_is_import),
                blank_in_source: self.blank_between(state.prev_end, span.start),
            }
            .blank_line();
            push_separator(&mut out, state.first, blank);
            out.push(print(self, item));
            state.first = false;
            state.after_doc = false;
            state.after_import = member_is_import;
            state.prev_end = span.end;
            // What is left of the member's comments, and the comments on the
            // line of its end, go after it.
            let limit = items.get(index + 1).map_or(end, |next| next.span().start);
            let mut line_ended = false;
            while let Some(comment) = self.comments.take_if(|c| {
                c.start < span.end || (c.start < limit && !c.starts_line && !line_ended)
            }) {
                line_ended = comment.is_line_comment();
                out.push(after_brace_comment(&comment));
                state.prev_end = state.prev_end.max(comment.end);
            }
        }
        // Comments after the last member.
        for comment in self.comments.take_before(end) {
            self.push_comment_line(&mut out, &mut state, &comment, top_level, true, None);
        }
        out
    }

    /// A comment on a line of its own in a body.
    fn push_comment_line(
        &self,
        out: &mut Vec<Doc>,
        state: &mut BodyState,
        comment: &Comment,
        top_level: bool,
        starts_member: bool,
        member_is_import: Option<bool>,
    ) {
        let blank = BlankContext {
            top_level,
            first: state.first,
            after_doc: state.after_doc,
            starts_member,
            after_import: state.after_import,
            member_is_import,
            blank_in_source: self.blank_between(state.prev_end, comment.start),
        }
        .blank_line();
        push_separator(out, state.first, blank);
        out.push(verbatim_or_text(&comment.text));
        state.first = false;
        state.after_doc = comment.is_doc();
        state.prev_end = comment.end;
    }
}

/// `body` after the comments that were taken before it.
pub(super) fn combine_leading(leading: Option<(Doc, bool)>, body: Doc) -> Doc {
    match leading {
        None => body,
        Some((comments, true)) => Doc::hang(Doc::concat(vec![comments, body])),
        Some((comments, false)) => Doc::concat(vec![comments, body]),
    }
}

/// Where the previous piece of a body ended, and what it was.
struct BodyState {
    prev_end: u32,
    first: bool,
    after_doc: bool,
    after_import: bool,
}

/// The line break before a piece of a body (none before the first).
fn push_separator(out: &mut Vec<Doc>, first: bool, blank_line: bool) {
    if first {
        return;
    }
    out.push(Doc::HardLine);
    if blank_line {
        out.push(Doc::HardLine);
    }
}

/// A comment as text; a comment that spans lines is printed as it is.
fn verbatim_or_text(text: &str) -> Doc {
    if text.contains('\n') {
        Doc::Verbatim(text.to_owned())
    } else {
        Doc::text(text)
    }
}

/// A comment printed after the node before it: on a line of its own if it
/// was, else after a space. A `//` comment ends its line.
fn trailing_comment(comment: &Comment) -> Doc {
    let start = if comment.starts_line {
        Doc::EnsureLine
    } else {
        Doc::Space
    };
    let mut parts = vec![start, verbatim_or_text(&comment.text)];
    if comment.is_line_comment() {
        parts.push(Doc::HardLine);
    }
    Doc::concat(parts)
}

/// A comment printed after the `{` it follows, or after a member.
fn after_brace_comment(comment: &Comment) -> Doc {
    Doc::concat(vec![Doc::Space, verbatim_or_text(&comment.text)])
}
