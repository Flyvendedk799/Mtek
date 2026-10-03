//! The Pratt expression parser (`spec/language.md` 6.1,
//! `spec/grammar.ebnf` section 7).
//!
//! Binding powers, loosest to tightest, with `level` the number of the table
//! in `spec/language.md` 6.1 (a left operator binds with `2 * level`, its
//! right operand is parsed with `2 * level + 1`, which makes it left
//! associative):
//!
//! | level | operators | |
//! |---|---|---|
//! | 1 | `\|\|` | left |
//! | 2 | `&&` | left |
//! | 3 | `==` `!=` | non-associative |
//! | 4 | `<` `<=` `>` `>=` | non-associative |
//! | 5 | `+` `-` | left |
//! | 6 | `*` `/` `%` | left |
//! | 7 | prefix `-` `!` | right |
//! | 8 | call, field, index | left (postfix) |
//!
//! Prefix and postfix operators are not in the binding power loop: a unary
//! operand is again a unary expression, so `-a.b` is `-(a.b)`, and postfix
//! operators are applied directly to a primary.
//!
//! Non-associativity: after `a < b`, another `<`, `<=`, `>` or `>=` is
//! `E1010`, reported once per chain, and parsing continues left-associatively.
//! The same holds for `==` and `!=`. `a < b == c < d` is fine: the levels
//! differ.
//!
//! Bitwise operators (`E1901`) are reported where they occur. In a prefix
//! position the operator is ignored (`~a` parses as `a`); in an infix
//! position the operator and its right operand are parsed and dropped
//! (`a & b` parses as `a`), so that one mistake gives one diagnostic.
//!
//! Every recursive call of the expression parser goes through
//! [`Parser::enter`], and every node built goes through [`Parser::mk`], which
//! bounds the height of the tree (see the module documentation of the
//! parser).

use crate::diagnostics::{Code, Diagnostic, SuggestedEdit};
use crate::source::Span;

use super::{CandidateEdit, MAX_TREE_HEIGHT, Parser};
use crate::syntax::ast::{BinaryOp, Bind, DescField, Expr, ExprKind, FieldValue, Ident, UnaryOp};
use crate::syntax::token::{TokenKind, TokenValue};

/// An expression together with the height of its tree: 0 for a leaf, 1 more
/// than the tallest child otherwise.
pub(super) struct Sub {
    pub expr: Box<Expr>,
    pub height: u32,
}

/// A binary operator at its place in the precedence table.
#[derive(Clone, Copy)]
struct Infix {
    op: BinaryOp,
    level: u8,
    non_associative: bool,
}

fn infix(kind: TokenKind) -> Option<Infix> {
    let (op, level, non_associative) = match kind {
        TokenKind::OrOr => (BinaryOp::Or, 1, false),
        TokenKind::AndAnd => (BinaryOp::And, 2, false),
        TokenKind::EqEq => (BinaryOp::Eq, 3, true),
        TokenKind::BangEq => (BinaryOp::Ne, 3, true),
        TokenKind::Lt => (BinaryOp::Lt, 4, true),
        TokenKind::Le => (BinaryOp::Le, 4, true),
        TokenKind::Gt => (BinaryOp::Gt, 4, true),
        TokenKind::Ge => (BinaryOp::Ge, 4, true),
        TokenKind::Plus => (BinaryOp::Add, 5, false),
        TokenKind::Minus => (BinaryOp::Sub, 5, false),
        TokenKind::Star => (BinaryOp::Mul, 6, false),
        TokenKind::Slash => (BinaryOp::Div, 6, false),
        TokenKind::Percent => (BinaryOp::Rem, 6, false),
        _ => return None,
    };
    Some(Infix {
        op,
        level,
        non_associative,
    })
}

/// The non-associative operator that produced the left operand of the loop
/// in [`Parser::expr_bp`].
#[derive(Clone, Copy)]
struct Chain {
    level: u8,
    op: BinaryOp,
    op_span: Span,
    /// `E1010` was already reported for this chain.
    reported: bool,
}

impl Parser<'_> {
    /// Parse one `Expr`, or, with `allow_descriptor` false, one `ExprNoDesc`.
    /// The entry point for the outermost expression of a construct.
    pub(super) fn expr(&mut self, allow_descriptor: bool) -> Expr {
        if self.depth == 0 {
            self.depth_reported = false;
        }
        *self.expr_bp(0, allow_descriptor).expr
    }

    /// The Pratt loop: a unary expression followed by every binary operator
    /// whose left binding power is at least `min_bp`. Every call is one level
    /// of nesting, counted against [`MAX_NESTING_DEPTH`](super::MAX_NESTING_DEPTH): the operand of a
    /// parenthesis, bracket, argument or field value is parsed by a call of
    /// its own, and so is the right operand of a binary operator.
    fn expr_bp(&mut self, min_bp: u8, allow_descriptor: bool) -> Sub {
        if !self.enter() {
            return self.too_deep(allow_descriptor);
        }
        let mut lhs = self.unary(allow_descriptor);
        let mut chain: Option<Chain> = None;
        loop {
            let kind = self.kind();
            if kind.is_bitwise() {
                self.drop_bitwise_infix(allow_descriptor);
                continue;
            }
            let Some(info) = infix(kind) else { break };
            if info.level * 2 < min_bp {
                break;
            }
            let op_span = self.span();
            let mut next_chain = None;
            if info.non_associative {
                next_chain = Some(match chain {
                    Some(previous) if previous.level == info.level => {
                        if !previous.reported {
                            self.report_chained(previous, info.op, op_span);
                        }
                        Chain {
                            reported: true,
                            ..previous
                        }
                    }
                    _ => Chain {
                        level: info.level,
                        op: info.op,
                        op_span,
                        reported: false,
                    },
                });
            }
            self.bump();
            let rhs = self.expr_bp(info.level * 2 + 1, allow_descriptor);
            lhs = self.binary(lhs, info.op, op_span, rhs);
            chain = next_chain;
        }
        self.leave();
        lhs
    }

    /// `E1010`: `op` at `op_span` follows `previous` of the same level.
    fn report_chained(&mut self, previous: Chain, op: BinaryOp, op_span: Span) {
        let (what, first, second) = (
            if previous.level == 4 {
                "Comparison"
            } else {
                "Equality"
            },
            previous.op.symbol(),
            op.symbol(),
        );
        let diagnostic = Diagnostic::new(
            Code::E1010,
            format!(
                "{what} operators cannot be chained: `{second}` follows `{first}` without parentheses."
            ),
        )
        .at(op_span)
        .related(previous.op_span, "the first operator")
        .help("compare with `&&` (`a < b && b < c`), or add parentheses to state the grouping");
        self.report(diagnostic);
    }

    /// A bitwise operator where a binary operator could be: `E1901`; the
    /// operator and its right operand are consumed and dropped.
    fn drop_bitwise_infix(&mut self, allow_descriptor: bool) {
        self.report_bitwise();
        self.bump();
        let mark = self.next_id;
        // Parse the operand so that its own errors are found and its tokens
        // are consumed, then forget it: the nodes it numbered are the last
        // ones, so the ids can be handed out again.
        drop(self.operand(allow_descriptor));
        self.next_id = mark;
    }

    /// `E1901` for the current token.
    fn report_bitwise(&mut self) {
        let text = self.text_of(self.span());
        let mut diagnostic = Diagnostic::new(
            Code::E1901,
            format!("The bitwise operator `{text}` is not supported in v0.1."),
        )
        .at(self.span());
        if matches!(self.kind(), TokenKind::Amp | TokenKind::Pipe) {
            diagnostic = diagnostic.help("for boolean logic use `&&` and `||`");
        }
        self.report(diagnostic);
    }

    /// The operand of a prefix operator: a unary expression one level
    /// deeper.
    fn operand(&mut self, allow_descriptor: bool) -> Sub {
        if !self.enter() {
            return self.too_deep(allow_descriptor);
        }
        let sub = self.unary(allow_descriptor);
        self.leave();
        sub
    }

    fn unary(&mut self, allow_descriptor: bool) -> Sub {
        // A bitwise operator where an operand should start: ignore it.
        while self.kind().is_bitwise() {
            self.report_bitwise();
            self.bump();
        }
        let op = match self.kind() {
            TokenKind::Minus => UnaryOp::Neg,
            TokenKind::Bang => UnaryOp::Not,
            _ => {
                let primary = self.primary(allow_descriptor);
                return self.postfix(primary);
            }
        };
        let start = self.span().start;
        self.bump();
        let operand = self.operand(allow_descriptor);
        self.mk(
            start,
            ExprKind::Unary {
                op,
                operand: operand.expr,
            },
            operand.height,
        )
    }

    // ----- primary expressions ----------------------------------------------

    fn primary(&mut self, allow_descriptor: bool) -> Sub {
        match self.kind() {
            TokenKind::Int
            | TokenKind::Float
            | TokenKind::String
            | TokenKind::Color
            | TokenKind::KwTrue
            | TokenKind::KwFalse => self.literal(),
            TokenKind::KwSelf => {
                let span = self.span();
                self.bump();
                self.leaf(span, ExprKind::SelfValue)
            }
            TokenKind::Ident | TokenKind::Underscore => self.name_or_descriptor(allow_descriptor),
            TokenKind::LParen => self.paren(),
            TokenKind::LBracket => self.array(),
            _ => self.unexpected_expression(),
        }
    }

    fn literal(&mut self) -> Sub {
        let token = self.tok();
        let span = token.span;
        let kind = if token.is_malformed() {
            // The lexer reported it; nothing more to say.
            ExprKind::Error
        } else {
            match (token.kind, &token.value) {
                (TokenKind::Int, TokenValue::Int { value }) => ExprKind::Int { value: *value },
                (TokenKind::Float, TokenValue::Float { value }) => {
                    ExprKind::Float { value: *value }
                }
                (TokenKind::String, TokenValue::String(value)) => ExprKind::Str {
                    value: value.clone(),
                },
                (TokenKind::Color, TokenValue::Color { rgba }) => ExprKind::Color { rgba: *rgba },
                (TokenKind::KwTrue, _) => ExprKind::Bool(true),
                (TokenKind::KwFalse, _) => ExprKind::Bool(false),
                // A literal token without its value never comes out of the
                // lexer; hand-built token streams may contain one.
                _ => ExprKind::Error,
            }
        };
        self.bump();
        self.leaf(span, kind)
    }

    /// `Ident`, or `Ident { ... }` where a descriptor literal is allowed.
    fn name_or_descriptor(&mut self, allow_descriptor: bool) -> Sub {
        if self.kind() == TokenKind::Ident && self.kind_at(1) == TokenKind::LBrace {
            if allow_descriptor {
                return self.descriptor();
            }
            if self.kind_at(2) == TokenKind::Ident && self.kind_at(3) == TokenKind::Colon {
                // `if Box { size: 1.0 } { ... }`: where a block must follow
                // the condition, `{ name:` can only be a descriptor literal.
                let descriptor = self.descriptor();
                self.report_descriptor_in_condition(descriptor.expr.span);
                return descriptor;
            }
        }
        let (name, span) = self.name_text();
        self.leaf(span, ExprKind::Name(name))
    }

    /// `E1011` for the descriptor literal at `span`; the parenthesising edit
    /// is recorded as a candidate for the driver to validate.
    fn report_descriptor_in_condition(&mut self, span: Span) {
        let diagnostic = Diagnostic::new(
            Code::E1011,
            "A descriptor literal cannot be used directly as the condition of `if` or the iterable of `for`; wrap it in parentheses.",
        )
        .at(span)
        .help("write `(Name { ... })`");
        self.report(diagnostic);
        let edit = SuggestedEdit::new("parenthesise the descriptor literal")
            .replace(Span::at(span.file, span.start), "(")
            .replace(Span::at(span.file, span.end), ")");
        self.candidate_edits.push(CandidateEdit {
            code: Code::E1011,
            at: span,
            edit,
        });
    }

    /// `( expr )`.
    fn paren(&mut self) -> Sub {
        let open = self.span();
        self.bump();
        let inner = self.expr_bp(0, true);
        self.expect_close(open, TokenKind::RParen);
        self.mk(open.start, ExprKind::Paren(inner.expr), inner.height)
    }

    /// `[ expr, ... ]`; at least one element.
    fn array(&mut self) -> Sub {
        let open = self.span();
        self.bump();
        if self.kind() == TokenKind::RBracket {
            self.bump();
            self.report_empty_array(open.start);
            return self.mk(open.start, ExprKind::Array(Vec::new()), 0);
        }
        let mut elements = Vec::new();
        let mut height = 0;
        while self.list_has_item(TokenKind::RBracket) {
            let element = self.expr_bp(0, true);
            height = height.max(element.height);
            elements.push(*element.expr);
            if !self.list_continues(TokenKind::Comma, TokenKind::RBracket, true) {
                break;
            }
        }
        self.expect_close(open, TokenKind::RBracket);
        self.mk(open.start, ExprKind::Array(elements), height)
    }

    /// `Name { field: value; ... }`; the current token is the name and the
    /// next one the `{`.
    fn descriptor(&mut self) -> Sub {
        let start = self.span().start;
        let name = self.name_here();
        let open = self.span();
        self.bump();
        let mut fields = Vec::new();
        let mut height = 0;
        while self.list_has_item(TokenKind::RBrace) {
            let parsed = self.desc_field(&mut fields, &mut height);
            if !self.list_continues(TokenKind::Semi, TokenKind::RBrace, parsed) {
                break;
            }
        }
        self.expect_close(open, TokenKind::RBrace);
        self.mk(start, ExprKind::Descriptor { name, fields }, height)
    }

    /// `name: value` inside a descriptor literal, appended to `fields`;
    /// `height` is raised to the height of the value. False (nothing
    /// consumed) if there is no name.
    fn desc_field(&mut self, fields: &mut Vec<DescField>, height: &mut u32) -> bool {
        let start = self.span().start;
        if !self.at_field_name() {
            self.expected("a field name or `}`");
            return false;
        }
        let name = self.name_here();
        let value = if self.kind() == TokenKind::Colon {
            self.bump();
            self.field_value(height)
        } else {
            self.expected_colon_after(&name.name);
            self.missing_value()
        };
        let id = self.id();
        fields.push(DescField {
            id,
            span: self.span_from(start),
            name,
            value,
        });
        true
    }

    /// `FieldValue`: `bind(expr)` or an expression. `height` is raised to the
    /// height of the value's tree.
    pub(super) fn field_value(&mut self, height: &mut u32) -> FieldValue {
        if self.kind() == TokenKind::KwBind {
            return FieldValue::Bind(self.bind(height));
        }
        let value = self.expr_bp(0, true);
        *height = (*height).max(value.height);
        FieldValue::Expr(value.expr)
    }

    /// `bind(expr)`.
    fn bind(&mut self, height: &mut u32) -> Bind {
        let start = self.span().start;
        self.bump();
        let open = self.span();
        let source = if self.kind() == TokenKind::LParen {
            self.bump();
            let source = self.expr_bp(0, true);
            self.expect_close(open, TokenKind::RParen);
            source
        } else {
            self.expected("`(` after `bind`");
            let hole = self.placeholder_span();
            self.error_leaf(hole)
        };
        *height = (*height).max(source.height);
        Bind {
            id: self.id(),
            span: self.span_from(start),
            source: source.expr,
        }
    }

    /// An empty `Error` expression at the current token, as a field value.
    fn missing_value(&mut self) -> FieldValue {
        let hole = self.placeholder_span();
        FieldValue::Expr(self.error_leaf(hole).expr)
    }

    pub(super) fn expected_colon_after(&mut self, field: &str) {
        self.expected(&format!("`:` after the field name `{field}`"));
    }

    fn report_empty_array(&mut self, start: u32) {
        let diagnostic =
            Diagnostic::new(Code::E1001, "An array literal needs at least one element.")
                .at(self.span_from(start));
        self.error(diagnostic);
    }

    /// Nothing that can start an expression: report it and leave the token
    /// to whoever knows what may follow.
    fn unexpected_expression(&mut self) -> Sub {
        let at = self.span();
        let diagnostic = match self.kind() {
            TokenKind::Eof => Diagnostic::new(
                Code::E1004,
                "Unexpected end of file; expected an expression.",
            ),
            TokenKind::KwBind => Diagnostic::new(
                Code::E1001,
                "`bind(...)` is only allowed as the value of a field.",
            ),
            _ => {
                let found = self.found();
                Diagnostic::new(
                    Code::E1001,
                    format!("Expected an expression, found {found}."),
                )
                .expected("an expression")
                .actual(found)
            }
        };
        self.error(diagnostic.at(at));
        let hole = self.placeholder_span();
        self.error_leaf(hole)
    }

    // ----- postfix operators --------------------------------------------------

    fn postfix(&mut self, mut lhs: Sub) -> Sub {
        loop {
            lhs = match self.kind() {
                TokenKind::LParen => self.call(lhs),
                TokenKind::Dot => self.field_access(lhs),
                TokenKind::LBracket => self.index(lhs),
                _ => return lhs,
            };
        }
    }

    /// `callee(args)`.
    fn call(&mut self, callee: Sub) -> Sub {
        let start = callee.expr.span.start;
        let open = self.span();
        self.bump();
        let mut height = callee.height;
        let mut args = Vec::new();
        while self.list_has_item(TokenKind::RParen) {
            let arg = self.expr_bp(0, true);
            height = height.max(arg.height);
            args.push(*arg.expr);
            if !self.list_continues(TokenKind::Comma, TokenKind::RParen, true) {
                break;
            }
        }
        self.expect_close(open, TokenKind::RParen);
        self.mk(
            start,
            ExprKind::Call {
                callee: callee.expr,
                args,
            },
            height,
        )
    }

    /// `base.name`. Without a name after the dot the dot is dropped.
    fn field_access(&mut self, base: Sub) -> Sub {
        let start = base.expr.span.start;
        self.bump();
        let Some(name) = self.field_name() else {
            self.expected("a field name after `.`");
            return base;
        };
        let height = base.height;
        self.mk(
            start,
            ExprKind::Field {
                base: base.expr,
                name,
            },
            height,
        )
    }

    /// `base[index]`.
    fn index(&mut self, base: Sub) -> Sub {
        let start = base.expr.span.start;
        let open = self.span();
        self.bump();
        let index = self.expr_bp(0, true);
        self.expect_close(open, TokenKind::RBracket);
        let height = base.height.max(index.height);
        self.mk(
            start,
            ExprKind::Index {
                base: base.expr,
                index: index.expr,
            },
            height,
        )
    }

    // ----- names -------------------------------------------------------------

    /// A name: an identifier (reserved words are reported with `E0013`) or
    /// `_` (the resolver's to reject). `None`, nothing consumed, for any
    /// other token.
    pub(super) fn ident(&mut self) -> Option<Ident> {
        if !matches!(self.kind(), TokenKind::Ident | TokenKind::Underscore) {
            return None;
        }
        Some(self.name_here())
    }

    /// A field name: a name, or the keyword `material`, which is also the name
    /// of an entity field (`material: Unlit { ... };`, `Cube.material.color`;
    /// decision 0023). `None`, nothing consumed, for any other token.
    pub(super) fn field_name(&mut self) -> Option<Ident> {
        if !self.at_field_name() {
            return None;
        }
        Some(self.name_here())
    }

    /// True at a token that [`Self::field_name`] accepts.
    pub(super) fn at_field_name(&self) -> bool {
        matches!(
            self.kind(),
            TokenKind::Ident | TokenKind::Underscore | TokenKind::KwMaterial
        )
    }

    /// Consume the current token as a name; the caller has checked that it
    /// is an identifier or `_`.
    fn name_here(&mut self) -> Ident {
        let (name, span) = self.name_text();
        Ident {
            id: self.id(),
            span,
            name,
        }
    }

    /// Like [`Self::name_here`], for a name that becomes part of an
    /// expression node and so gets no node of its own.
    pub(super) fn name_text(&mut self) -> (String, Span) {
        let span = self.span();
        let name = self.text_of(span).to_owned();
        self.report_if_reserved(span);
        self.bump();
        (name, span)
    }

    /// `E0013` if the current identifier token is a reserved word.
    fn report_if_reserved(&mut self, span: Span) {
        if !self.tok().is_reserved_word() {
            return;
        }
        let word = self.text_of(span);
        let diagnostic = Diagnostic::new(
            Code::E0013,
            format!(
                "`{word}` is reserved for a future version of Mtek and cannot be used as a name."
            ),
        )
        .at(span)
        .help("choose another name");
        self.report(diagnostic);
    }

    // ----- building nodes -------------------------------------------------------

    fn leaf(&mut self, span: Span, kind: ExprKind) -> Sub {
        Sub {
            expr: Box::new(Expr {
                id: self.id(),
                span,
                kind,
            }),
            height: 0,
        }
    }

    pub(super) fn error_leaf(&mut self, span: Span) -> Sub {
        self.leaf(span, ExprKind::Error)
    }

    /// Build the node of `kind` from the text between `start` and the end of
    /// the last consumed token, whose children are at most `child_height`
    /// tall. A node that would make the tree too tall is `E1050` and an
    /// `Error` node takes its place (the children are dropped).
    fn mk(&mut self, start: u32, kind: ExprKind, child_height: u32) -> Sub {
        let span = self.span_from(start);
        let height = child_height.saturating_add(1);
        if height > MAX_TREE_HEIGHT {
            self.report_too_deep(span);
            return self.error_leaf(span);
        }
        Sub {
            expr: Box::new(Expr {
                id: self.id(),
                span,
                kind,
            }),
            height,
        }
    }

    fn binary(&mut self, lhs: Sub, op: BinaryOp, op_span: Span, rhs: Sub) -> Sub {
        let start = lhs.expr.span.start;
        let height = lhs.height.max(rhs.height);
        self.mk(
            start,
            ExprKind::Binary {
                op,
                op_span,
                lhs: lhs.expr,
                rhs: rhs.expr,
            },
            height,
        )
    }

    /// The recursion bound was hit at the current token: `E1050`, skip the
    /// rest of the nested expression without recursion, and answer with an
    /// `Error` node.
    fn too_deep(&mut self, allow_descriptor: bool) -> Sub {
        let start = self.span();
        self.report_too_deep(start);
        self.skip_expression(allow_descriptor);
        let end = self.prev_end.max(start.start);
        self.error_leaf(Span::new(start.file, start.start, end))
    }

    /// Skip to the end of the expression that starts at the current token:
    /// a closing bracket, a separator, `..`, an assignment operator or the end
    /// of input at bracket depth 0 (and a `{` at depth 0 where no descriptor
    /// literal is allowed, which then starts the block that follows the
    /// expression). Brackets inside are skipped as a unit.
    fn skip_expression(&mut self, allow_descriptor: bool) {
        let mut depth = 0u32;
        loop {
            match self.kind() {
                TokenKind::Eof => return,
                TokenKind::LParen | TokenKind::LBracket => depth += 1,
                TokenKind::LBrace => {
                    if depth == 0 && !allow_descriptor {
                        return;
                    }
                    depth += 1;
                }
                TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => {
                    if depth == 0 {
                        return;
                    }
                    depth -= 1;
                }
                TokenKind::Comma
                | TokenKind::Semi
                | TokenKind::DotDot
                | TokenKind::Eq
                | TokenKind::PlusEq
                | TokenKind::MinusEq
                | TokenKind::StarEq
                | TokenKind::SlashEq
                    if depth == 0 =>
                {
                    return;
                }
                _ => {}
            }
            self.bump();
        }
    }
}
