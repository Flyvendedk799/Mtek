//! Error recovery: synchronisation points, skipping, the nesting limit for
//! items, members and statements, and the diagnostics that recovery shares
//! between the construct parsers (missing `;`, `E1050`).
//!
//! Skipping always makes progress: every loop here consumes a token per
//! iteration or returns, and the callers' loops check that an iteration of
//! theirs moved forward as well.

use crate::diagnostics::{Code, Diagnostic, SuggestedEdit};
use crate::source::Span;

use super::{CandidateEdit, MAX_NESTING_DEPTH, Parser};
use crate::syntax::ast::ErrorNode;
use crate::syntax::token::TokenKind;

/// Where skipping stops after a syntax error: the synchronisation points of
/// `spec/compiler-architecture.md` section 4.3.
///
/// All three stop after a `;` at nesting depth 0 (consuming it), at the end of
/// the file, and skip brackets inside the skipped text as units. Beyond that:
///
/// * [`Sync::Statement`] stops before the `}` that closes the enclosing block
///   (it does not consume it) and before a keyword that starts a statement;
/// * [`Sync::Member`] stops before the `}` of the enclosing body and before
///   the start of the next member: a member keyword (`state`, `param`,
///   `entity`, `on`, `const`, an item keyword) or the contextual forms `name
///   :`, `name (` and `kind name {`;
/// * [`Sync::Item`] stops before the next item keyword; a stray closing
///   bracket is skipped.
///
/// The token where skipping starts is always consumed unless it is a `}` of
/// an enclosing body or the end of the file, even if it looks like a start of
/// a construct: the caller found it wrong.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Sync {
    Statement,
    Member,
    Item,
}

/// What a nesting that went too deep was nesting, for the advice of `E1050`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Nest {
    Expression,
    Block,
    Entity,
    Type,
}

/// True for the keywords that start an item (`spec/grammar.ebnf` section 2).
pub(super) fn is_item_keyword(kind: TokenKind) -> bool {
    matches!(
        kind,
        TokenKind::KwImport
            | TokenKind::KwExport
            | TokenKind::KwConst
            | TokenKind::KwFn
            | TokenKind::KwCpu
            | TokenKind::KwStruct
            | TokenKind::KwMaterial
            | TokenKind::KwPrefab
            | TokenKind::KwScene
    )
}

/// True for a token that can start an expression (including the bitwise
/// operators and `bind`, which the expression parser reports with a message of
/// its own).
pub(super) fn starts_expression(kind: TokenKind) -> bool {
    matches!(
        kind,
        TokenKind::Int
            | TokenKind::Float
            | TokenKind::String
            | TokenKind::Color
            | TokenKind::KwTrue
            | TokenKind::KwFalse
            | TokenKind::KwSelf
            | TokenKind::KwBind
            | TokenKind::Ident
            | TokenKind::Underscore
            | TokenKind::LParen
            | TokenKind::LBracket
            | TokenKind::Minus
            | TokenKind::Bang
    ) || kind.is_bitwise()
}

/// True for the assignment operators of `SimpleStmt`.
pub(super) fn is_assign_op(kind: TokenKind) -> bool {
    matches!(
        kind,
        TokenKind::Eq
            | TokenKind::PlusEq
            | TokenKind::MinusEq
            | TokenKind::StarEq
            | TokenKind::SlashEq
    )
}

impl Parser<'_> {
    /// True for an identifier-like token: a name (`_` and reserved words
    /// included; those are reported where they are used as names).
    pub(super) fn at_name(&self) -> bool {
        matches!(self.kind(), TokenKind::Ident | TokenKind::Underscore)
    }

    /// Skip tokens until one of `stops` or a closing delimiter or `;` that
    /// belongs to an enclosing construct, at bracket depth 0 of the skipped
    /// text, or the end of input. Brackets inside the skipped text are
    /// skipped as a unit. Does not consume the stopping token.
    pub(super) fn skip_until(&mut self, stops: &[TokenKind]) {
        let mut depth = 0u32;
        loop {
            let kind = self.kind();
            if kind == TokenKind::Eof {
                return;
            }
            if depth == 0
                && (stops.contains(&kind)
                    || matches!(
                        kind,
                        TokenKind::Semi
                            | TokenKind::RBrace
                            | TokenKind::RParen
                            | TokenKind::RBracket
                    ))
            {
                return;
            }
            match kind {
                TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
                TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => {
                    depth = depth.saturating_sub(1);
                }
                _ => {}
            }
            self.bump();
        }
    }

    /// The span of a node that stands for something missing: empty, at the
    /// current token. The nodes being built around it reach to it
    /// ([`Parser::span_from`]), so every node contains its placeholders.
    pub(super) fn placeholder_span(&mut self) -> Span {
        let at = self.span();
        self.reach = self.reach.max(at.start);
        Span::at(at.file, at.start)
    }

    /// An `Error` node for the text from `start` to the end of what has been
    /// consumed.
    pub(super) fn error_node(&mut self, start: u32) -> ErrorNode {
        ErrorNode {
            id: self.id(),
            span: self.span_from(start),
        }
    }

    /// Skip the broken header of a construct to the `{` of its body, which
    /// is not consumed; true if there is one. Stops (false) before a `;`, a
    /// closing bracket, the end of the file and a keyword that starts a
    /// declaration or statement, none of which belong to a header.
    pub(super) fn skip_to_block(&mut self) -> bool {
        let start = self.pos;
        let mut depth = 0u32;
        loop {
            let kind = self.kind();
            match kind {
                TokenKind::Eof => return false,
                TokenKind::LBrace if depth == 0 => return true,
                TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
                TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => {
                    if depth == 0 {
                        return false;
                    }
                    depth -= 1;
                }
                TokenKind::Semi if depth == 0 => return false,
                _ => {
                    if depth == 0
                        && self.pos > start
                        && (self.starts_construct(Sync::Statement)
                            || self.starts_construct(Sync::Item))
                    {
                        return false;
                    }
                }
            }
            self.bump();
        }
    }

    /// Skip to the synchronisation point `sync` (see [`Sync`]).
    pub(super) fn skip_to_sync(&mut self, sync: Sync) {
        let start = self.pos;
        let mut depth = 0u32;
        loop {
            let kind = self.kind();
            match kind {
                TokenKind::Eof => return,
                TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
                TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => {
                    if depth == 0 {
                        if kind == TokenKind::RBrace && sync != Sync::Item {
                            return;
                        }
                        // A stray closing bracket: part of the skipped text.
                    } else {
                        depth -= 1;
                    }
                }
                TokenKind::Semi if depth == 0 => {
                    self.bump();
                    return;
                }
                _ => {
                    if depth == 0 && self.pos > start && self.starts_construct(sync) {
                        return;
                    }
                }
            }
            self.bump();
        }
    }

    /// True if the current token starts a construct that `sync` stops at.
    fn starts_construct(&self, sync: Sync) -> bool {
        let kind = self.kind();
        match sync {
            Sync::Item => is_item_keyword(kind),
            Sync::Statement => {
                matches!(
                    kind,
                    TokenKind::KwLet
                        | TokenKind::KwVar
                        | TokenKind::KwIf
                        | TokenKind::KwFor
                        | TokenKind::KwReturn
                        | TokenKind::KwBreak
                        | TokenKind::KwContinue
                ) || is_item_keyword(kind)
            }
            Sync::Member => {
                matches!(
                    kind,
                    TokenKind::KwState | TokenKind::KwParam | TokenKind::KwEntity | TokenKind::KwOn
                ) || is_item_keyword(kind)
                    || (self.at_field_name()
                        && (matches!(self.kind_at(1), TokenKind::Colon | TokenKind::LParen)
                            || (self.kind_at(1) == TokenKind::Ident
                                && self.kind_at(2) == TokenKind::LBrace)))
            }
        }
    }

    /// Skip the construct that starts at the current token without recursion:
    /// the rest of a nesting that went too deep. With `block_like`, a
    /// construct ends at the `}` that closes its first braced part, unless an
    /// `else` follows (an `if` chain goes on); otherwise at the next `;` at
    /// nesting depth 0. It never goes past a closing bracket of an enclosing
    /// construct or the end of the file.
    pub(super) fn skip_nested(&mut self, block_like: bool) {
        let mut depth = 0u32;
        loop {
            match self.kind() {
                TokenKind::Eof => return,
                TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
                TokenKind::RParen | TokenKind::RBracket => {
                    if depth == 0 {
                        return;
                    }
                    depth -= 1;
                }
                TokenKind::RBrace => {
                    if depth == 0 {
                        return;
                    }
                    depth -= 1;
                    if depth == 0 && block_like {
                        self.bump();
                        if self.kind() == TokenKind::KwElse {
                            continue;
                        }
                        return;
                    }
                }
                TokenKind::Semi if depth == 0 => {
                    self.bump();
                    return;
                }
                _ => {}
            }
            self.bump();
        }
    }

    // ----- the nesting limit -----------------------------------------------

    /// `E1050` at `at`, once per statement, member or item (once per
    /// outermost expression when parsing a lone expression).
    #[inline(never)]
    pub(super) fn report_nesting(&mut self, at: Span, nest: Nest) {
        if self.depth_reported {
            return;
        }
        self.depth_reported = true;
        let help = match nest {
            Nest::Expression => "split the expression into several `let` statements",
            Nest::Block => "move the inner code into a function of its own",
            Nest::Entity => {
                "flatten the entity tree: declare the inner entities beside the outer ones"
            }
            Nest::Type => "declare a `struct` for the inner type",
        };
        let diagnostic = Diagnostic::new(
            Code::E1050,
            format!("Nesting is deeper than the limit of {MAX_NESTING_DEPTH} levels."),
        )
        .at(at)
        .help(help);
        self.report(diagnostic);
    }

    // ----- terminators -----------------------------------------------------

    /// The `;` that ends a statement, declaration or field (`what` names it
    /// for the message), with recovery per `sync`.
    ///
    /// * The `;` is there: consumed.
    /// * It was forgotten, which is what it looks like when the next token is
    ///   a `}`, the end of the file, on a later line than the end of the
    ///   statement, or the start of the next construct (see [`Sync`]):
    ///   `E1003` with the insertion recorded as a candidate edit, nothing
    ///   consumed (the next token starts the next construct).
    /// * Something else follows on the same line: `E1001`, and the rest of the
    ///   construct is skipped.
    pub(super) fn semi(&mut self, sync: Sync, what: &str) {
        if self.kind() == TokenKind::Semi {
            self.bump();
            return;
        }
        let forgotten = matches!(self.kind(), TokenKind::RBrace | TokenKind::Eof)
            || self.line_break_before_current()
            || self.starts_construct(sync);
        if forgotten {
            self.report_missing_semi(what);
        } else {
            self.report_expected_semi(what);
            self.skip_to_sync(sync);
        }
    }

    #[inline(never)]
    fn report_missing_semi(&mut self, what: &str) {
        let at = Span::at(self.file, self.prev_end);
        let found = self.found();
        let diagnostic = Diagnostic::new(
            Code::E1003,
            format!("Missing `;` at the end of the {what}, found {found}."),
        )
        .at(at)
        .expected("`;`")
        .actual(found)
        .help("end every statement, field and declaration with `;`");
        if self.error(diagnostic) {
            let edit = SuggestedEdit::new("insert the missing `;`").replace(at, ";");
            self.candidate_edits.push(CandidateEdit {
                code: Code::E1003,
                at,
                edit,
            });
        }
    }

    #[inline(never)]
    fn report_expected_semi(&mut self, what: &str) {
        let diagnostic = self.expected_diagnostic(&format!("`;` after the {what}"));
        self.error(diagnostic);
    }
}
