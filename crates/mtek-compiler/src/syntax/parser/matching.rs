//! `match` (decision 0129): the statement form, whose arms are blocks, and
//! the expression form, whose arms are expressions separated by commas.
//!
//! ```text
//! MatchStmt     ::= 'match' ExprNoDesc '{' MatchStmtArm+ '}'
//! MatchStmtArm  ::= Patterns '=>' Block ','?
//! MatchExpr     ::= 'match' ExprNoDesc '{' MatchExprArm ( ',' MatchExprArm )* ','? '}'
//! MatchExprArm  ::= Patterns '=>' Expr
//! Patterns      ::= Pattern ( '|' Pattern )*
//! Pattern       ::= '_' | Ident '.' Ident
//! ```
//!
//! A `match` at the start of a statement is the statement form. The parser
//! reads any postfix expression as a pattern (so that `Menu` or `3` are one
//! mistake, reported by the checker as `E3204`, not a cascade of syntax
//! errors); the grammar names only the two forms the checker accepts.
//!
//! Recovery: an arm that cannot be read is skipped to the next `,` or the `}`
//! of the `match`; a missing `=>` is reported and the body is read if one
//! follows.

use crate::diagnostics::{Code, Diagnostic};
use crate::source::Span;

use super::Parser;
use super::expr::Sub;
use crate::syntax::ast::{ArmBody, ExprKind, MatchArm, MatchStmt, Pattern, PatternKind, Stmt};
use crate::syntax::token::TokenKind;

impl Parser<'_> {
    /// `match value { Pattern => { ... } ... }` at the start of a statement.
    pub(super) fn match_stmt(&mut self) -> Stmt {
        let start = self.span().start;
        self.bump();
        let scrutinee = self.expr(false);
        let mut height = 0;
        let arms = self.match_arms(true, &mut height);
        Stmt::Match(MatchStmt {
            id: self.id(),
            span: self.span_from(start),
            scrutinee,
            arms,
        })
    }

    /// `match value { Pattern => value, ... }` where an expression is
    /// expected. The current token is `match`.
    pub(super) fn match_expr(&mut self) -> Sub {
        let start = self.span().start;
        self.bump();
        let scrutinee = self.match_operand(false);
        let mut height = scrutinee.height;
        let arms = self.match_arms(false, &mut height);
        self.mk(
            start,
            ExprKind::Match {
                scrutinee: scrutinee.expr,
                arms,
            },
            height,
        )
    }

    /// An expression nested in a `match` expression (its scrutinee, or the
    /// value of an arm): one level of nesting.
    fn match_operand(&mut self, allow_descriptor: bool) -> Sub {
        self.expr_bp(0, allow_descriptor)
    }

    /// `{ arm ... }` of either form; `height` is raised to the tallest arm
    /// value (expression form). Without the `{` this reports it and answers
    /// no arms.
    fn match_arms(&mut self, statement: bool, height: &mut u32) -> Vec<MatchArm> {
        let mut arms = Vec::new();
        if self.kind() != TokenKind::LBrace {
            self.expected("`{` and the arms of the `match`");
            return arms;
        }
        let open = self.span();
        self.bump();
        let mut broken = false;
        while !matches!(self.kind(), TokenKind::RBrace | TokenKind::Eof)
            && !self.at_unindented_item()
        {
            let before = self.pos;
            match self.match_arm(statement, height) {
                Some(arm) => arms.push(arm),
                None => {
                    broken = true;
                    self.skip_until(&[TokenKind::Comma]);
                }
            }
            if self.kind() == TokenKind::Comma {
                self.bump();
            } else if !statement && !matches!(self.kind(), TokenKind::RBrace | TokenKind::Eof) {
                // Expression arms are separated by commas.
                self.expected("`,` or `}` after the arm of the `match`");
                broken = true;
                self.skip_until(&[TokenKind::Comma]);
                if self.kind() == TokenKind::Comma {
                    self.bump();
                }
            }
            if self.pos == before {
                self.bump();
            }
        }
        self.expect_close(open, TokenKind::RBrace);
        if arms.is_empty() && !broken {
            self.report_empty_match(open);
        }
        arms
    }

    #[inline(never)]
    fn report_empty_match(&mut self, open: Span) {
        let diagnostic = Diagnostic::new(Code::E1001, "A `match` needs at least one arm.")
            .at(self.span_from(open.start))
            .help("write one arm per variant, `Enum.Variant => ...`, or `_ => ...` for the rest");
        self.error(diagnostic);
    }

    /// The body of a statement arm is not a block: `match x { A.B => f(), }`
    /// at the start of a statement, where the expression form was meant.
    #[inline(never)]
    fn report_arm_not_a_block(&mut self) {
        let diagnostic = self
            .expected_diagnostic("`{` to start the block of the arm")
            .note("a `match` at the start of a statement is the statement form, whose arms are blocks")
            .help("write `=> { … }`, or use the value: `let x = match … { … };`");
        self.error(diagnostic);
    }

    /// One arm: patterns, `=>`, and a block (statement) or an expression.
    /// `None` (reported) when no pattern starts here.
    fn match_arm(&mut self, statement: bool, height: &mut u32) -> Option<MatchArm> {
        let start = self.span().start;
        let mut patterns = Vec::new();
        loop {
            let Some(pattern) = self.pattern() else {
                self.expected("a pattern: `Enum.Variant` or `_`");
                return None;
            };
            patterns.push(pattern);
            if self.kind() == TokenKind::Pipe {
                self.bump();
                continue;
            }
            break;
        }
        if self.kind() == TokenKind::FatArrow {
            self.bump();
        } else {
            self.expected("`=>` after the pattern");
            if statement && self.kind() != TokenKind::LBrace {
                return None;
            }
            if !statement && !super::recover::starts_expression(self.kind()) {
                return None;
            }
        }
        if statement && self.kind() != TokenKind::LBrace {
            self.report_arm_not_a_block();
            self.skip_until(&[TokenKind::Comma]);
            if self.kind() == TokenKind::Semi {
                self.bump();
            }
            return None;
        }
        let body = if statement {
            ArmBody::Block(self.block())
        } else {
            let value = self.match_operand(true);
            *height = (*height).max(value.height);
            ArmBody::Expr(value.expr)
        };
        Some(MatchArm {
            id: self.id(),
            span: self.span_from(start),
            patterns,
            body,
        })
    }

    /// `_`, or a postfix expression (`Enum.Variant`; see the module
    /// documentation). `None`, nothing consumed, at a token that starts no
    /// expression.
    fn pattern(&mut self) -> Option<Pattern> {
        let start = self.span();
        if self.kind() == TokenKind::Underscore && self.kind_at(1) != TokenKind::Dot {
            self.bump();
            return Some(Pattern {
                id: self.id(),
                span: start,
                kind: PatternKind::Wildcard,
            });
        }
        if !matches!(
            self.kind(),
            TokenKind::Ident
                | TokenKind::Underscore
                | TokenKind::Int
                | TokenKind::Float
                | TokenKind::String
                | TokenKind::Color
                | TokenKind::KwTrue
                | TokenKind::KwFalse
                | TokenKind::KwSelf
                | TokenKind::LParen
        ) {
            return None;
        }
        if !self.enter() {
            self.report_too_deep(start);
            self.skip_until(&[TokenKind::FatArrow, TokenKind::Comma]);
            let hole = self.placeholder_span();
            let error = self.error_leaf(hole);
            return Some(Pattern {
                id: self.id(),
                span: self.span_from(start.start),
                kind: PatternKind::Value(error.expr),
            });
        }
        let primary = self.primary(false);
        let value = self.postfix(primary);
        self.leave();
        Some(Pattern {
            id: self.id(),
            span: self.span_from(start.start),
            kind: PatternKind::Value(value.expr),
        })
    }
}
