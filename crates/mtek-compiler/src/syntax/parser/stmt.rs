//! Blocks and statements (`spec/grammar.ebnf` section 6).
//!
//! Recovery: a statement that cannot be read is skipped to its `;` (consumed)
//! or to the `}` of the block (kept) or to the next keyword that starts a
//! statement ([`Sync::Statement`]) and becomes a [`Stmt::Error`]. A statement
//! that is only missing its `;` is `E1003`, and is otherwise read as usual.

use crate::diagnostics::{Code, Diagnostic};
use crate::source::Span;

use super::Parser;
use super::members::Place;
use super::recover::{Nest, Sync, is_assign_op, is_item_keyword, starts_expression};
use crate::syntax::ast::{
    AssignOp, AssignStmt, Block, ElseBranch, Expr, ExprKind, ExprStmt, ForIter, ForStmt, Ident,
    IfStmt, JumpStmt, LocalDecl, ReturnStmt, Stmt,
};
use crate::syntax::token::TokenKind;

impl Parser<'_> {
    /// The body of a function, handler, lifecycle function or stage: a block
    /// in which `break` and `continue` need a loop of their own (`E1030`).
    pub(super) fn fn_body(&mut self) -> Block {
        let outer_loops = std::mem::replace(&mut self.loop_depth, 0);
        let body = self.block();
        self.loop_depth = outer_loops;
        body
    }

    /// `Block ::= '{' Statement* '}'`. Every block is one level of nesting.
    /// Without the `{` this reports it and answers an empty block (nothing
    /// consumed).
    pub(super) fn block(&mut self) -> Block {
        let open = self.span();
        if self.kind() != TokenKind::LBrace {
            self.expected("`{` to start a block");
            let span = self.placeholder_span();
            return Block {
                id: self.id(),
                span,
                stmts: Vec::new(),
            };
        }
        if !self.enter() {
            return self.block_too_deep(open);
        }
        self.bump();
        let mut stmts = Vec::new();
        while !matches!(self.kind(), TokenKind::RBrace | TokenKind::Eof)
            && !self.at_unindented_item()
        {
            let before = self.pos;
            stmts.push(self.stmt());
            if self.pos == before {
                self.bump();
            }
        }
        self.expect_close(open, TokenKind::RBrace);
        self.leave();
        Block {
            id: self.id(),
            span: self.span_from(open.start),
            stmts,
        }
    }

    /// The nesting limit was hit by the block that starts at `open`: `E1050`,
    /// skip it without recursion, and answer with a block holding one `Error`.
    #[inline(never)]
    fn block_too_deep(&mut self, open: Span) -> Block {
        self.report_nesting(open, Nest::Block);
        self.skip_nested(true);
        self.skipped_block(open.start)
    }

    /// A block that stands for the text skipped since `start`.
    fn skipped_block(&mut self, start: u32) -> Block {
        let span = self.span_from(start);
        let error = Stmt::Error(self.error_node(start));
        Block {
            id: self.id(),
            span,
            stmts: vec![error],
        }
    }

    /// One statement. Always consumes a token unless the current one is `}`
    /// or the end of the file. Like the member parser, this only dispatches:
    /// each kind of statement is built by a function of its own, so that the
    /// frame of the functions on the recursion path stays small (see
    /// [`Parser::member`]).
    pub(super) fn stmt(&mut self) -> Stmt {
        self.start_construct();
        match self.kind() {
            TokenKind::KwLet => self.local_stmt(false),
            TokenKind::KwVar => self.local_stmt(true),
            TokenKind::KwConst => self.const_stmt(),
            TokenKind::KwIf => self.if_statement(),
            TokenKind::KwFor => self.for_stmt(),
            TokenKind::KwReturn => self.return_stmt(),
            TokenKind::KwBreak | TokenKind::KwContinue => self.jump_stmt(),
            TokenKind::LBrace => self.block_stmt(),
            TokenKind::KwState | TokenKind::KwParam | TokenKind::KwEntity | TokenKind::KwOn => {
                self.misplaced_in_block()
            }
            kind if is_item_keyword(kind) => self.misplaced_in_block(),
            kind if starts_expression(kind) => self.simple_stmt(),
            _ => self.not_a_statement(),
        }
    }

    fn const_stmt(&mut self) -> Stmt {
        let start = self.span().start;
        match self.const_decl(Sync::Statement) {
            Some(decl) => Stmt::Const(decl),
            None => Stmt::Error(self.error_node(start)),
        }
    }

    fn if_statement(&mut self) -> Stmt {
        Stmt::If(self.if_stmt())
    }

    fn block_stmt(&mut self) -> Stmt {
        Stmt::Block(self.block())
    }

    /// An `Error` statement for the text from `start` to the end of what has
    /// been consumed, after skipping to the end of the statement.
    fn error_stmt(&mut self, start: u32) -> Stmt {
        self.skip_to_sync(Sync::Statement);
        Stmt::Error(self.error_node(start))
    }

    /// A declaration or member that does not belong in a block: `E1040`; it
    /// is parsed (so that its own mistakes are found) and dropped.
    #[inline(never)]
    fn misplaced_in_block(&mut self) -> Stmt {
        let start = self.span().start;
        self.drop_misplaced(Place::Block);
        Stmt::Error(self.error_node(start))
    }

    /// A token that starts no statement: `E1001` and skip.
    #[inline(never)]
    fn not_a_statement(&mut self) -> Stmt {
        let start = self.span().start;
        let mut diagnostic = self.expected_diagnostic("a statement");
        if self.kind() == TokenKind::Semi {
            diagnostic = diagnostic.help("remove the stray `;`");
        }
        self.error(diagnostic);
        self.error_stmt(start)
    }

    // ----- declarations ------------------------------------------------------

    /// `let name: T = e;` and `var name: T = e;`.
    fn local_stmt(&mut self, mutable: bool) -> Stmt {
        let start = self.span().start;
        let word = if mutable { "var" } else { "let" };
        self.bump();
        let Some(name) = self.ident() else {
            self.expected(&format!("a name after `{word}`"));
            return self.error_stmt(start);
        };
        let ty = if self.kind() == TokenKind::Colon {
            self.bump();
            Some(self.ty())
        } else {
            None
        };
        let value = self.initialiser(&format!("`{word}`"));
        self.semi(Sync::Statement, "statement");
        let decl = LocalDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            ty,
            value,
        };
        if mutable {
            Stmt::Var(decl)
        } else {
            Stmt::Let(decl)
        }
    }

    /// `= Expr`, the initial value that a declaration needs. A declaration
    /// without `=` is `E1001`; an expression is still read if one follows, so
    /// that `let x 5;` is one mistake.
    pub(super) fn initialiser(&mut self, what: &str) -> Expr {
        if self.kind() == TokenKind::Eq {
            self.bump();
            return self.expr(true);
        }
        self.report_missing_initialiser(what);
        if starts_expression(self.kind()) {
            return self.expr(true);
        }
        self.missing_expr()
    }

    #[inline(never)]
    fn report_missing_initialiser(&mut self, what: &str) {
        let diagnostic = self
            .expected_diagnostic("`=` and an initial value")
            .help(format!("{what} must be initialised where it is declared"));
        self.error(diagnostic);
    }

    /// An empty `Error` expression at the current token.
    pub(super) fn missing_expr(&mut self) -> Expr {
        let hole = self.placeholder_span();
        *self.error_leaf(hole).expr
    }

    // ----- control flow ------------------------------------------------------

    /// `if cond { ... } else if cond { ... } else { ... }`. The condition is an
    /// `ExprNoDesc`: a descriptor literal there is `E1011`.
    pub(super) fn if_stmt(&mut self) -> IfStmt {
        let start = self.span().start;
        self.bump();
        let cond = self.expr(false);
        if self.kind() == TokenKind::Eq {
            self.assignment_in_condition();
        }
        let then_block = self.block();
        let else_branch = if self.kind() == TokenKind::KwElse {
            self.else_branch()
        } else {
            None
        };
        IfStmt {
            id: self.id(),
            span: self.span_from(start),
            cond,
            then_block,
            else_branch,
        }
    }

    /// `=` where the block of an `if` should start: the classic typo for
    /// `==`. `E1001` once, then the right-hand side is read and dropped so
    /// that the block that follows is still the block of the `if`.
    #[inline(never)]
    fn assignment_in_condition(&mut self) {
        let diagnostic = self
            .expected_diagnostic("`{` to start the block after the condition")
            .help("assignments are statements; to compare, write `==`");
        self.error(diagnostic);
        self.bump();
        drop(self.expr(false));
    }

    /// After `else`: `if` (a chain, one more level) or a block.
    fn else_branch(&mut self) -> Option<ElseBranch> {
        self.bump();
        match self.kind() {
            TokenKind::KwIf => {
                if !self.enter() {
                    return Some(self.else_if_too_deep());
                }
                let inner = self.if_stmt();
                self.leave();
                Some(ElseBranch::If(Box::new(inner)))
            }
            TokenKind::LBrace => Some(ElseBranch::Block(self.block())),
            _ => {
                self.expected("`if` or `{` after `else`");
                None
            }
        }
    }

    /// The `else if` chain is too long (the chain nests one `if` per branch in
    /// the tree): `E1050`, skip the rest of the chain without recursion.
    #[inline(never)]
    fn else_if_too_deep(&mut self) -> ElseBranch {
        let at = self.span();
        self.report_nesting(at, Nest::Block);
        self.skip_nested(true);
        ElseBranch::Block(self.skipped_block(at.start))
    }

    /// `for name in a..b { ... }` and `for name in array { ... }`.
    fn for_stmt(&mut self) -> Stmt {
        let start = self.span().start;
        self.bump();
        let Some((var, iter)) = self.for_header() else {
            return self.loop_header_failed(start);
        };
        let body = self.loop_body();
        Stmt::For(ForStmt {
            id: self.id(),
            span: self.span_from(start),
            var,
            iter,
            body,
        })
    }

    /// `name in a..b` or `name in array`, after the `for`; `None` if the
    /// header is broken (reported). A function of its own so that the
    /// expressions it holds are gone from the stack when the body is parsed.
    #[inline(never)]
    fn for_header(&mut self) -> Option<(Ident, ForIter)> {
        let Some(var) = self.ident() else {
            self.expected("a loop variable name after `for`");
            return None;
        };
        if self.kind() == TokenKind::KwIn {
            self.bump();
        } else {
            self.expected("`in` after the loop variable");
            return None;
        }
        let first = self.expr(false);
        let iter = if self.kind() == TokenKind::DotDot {
            self.bump();
            let end = self.expr(false);
            ForIter::Range { start: first, end }
        } else {
            ForIter::Each(first)
        };
        Some((var, iter))
    }

    /// The body of a `for`: `break` and `continue` are allowed inside.
    fn loop_body(&mut self) -> Block {
        self.loop_depth += 1;
        let body = self.block();
        self.loop_depth -= 1;
        body
    }

    /// The header of a `for` could not be read: skip to its body, which is
    /// still parsed (as the body of a loop) for its own mistakes, then drop
    /// the whole statement.
    #[inline(never)]
    fn loop_header_failed(&mut self, start: u32) -> Stmt {
        if self.skip_to_block() {
            drop(self.loop_body());
        } else if self.kind() == TokenKind::Semi {
            self.bump();
        }
        Stmt::Error(self.error_node(start))
    }

    /// `return expr;` and `return;`.
    fn return_stmt(&mut self) -> Stmt {
        let start = self.span().start;
        self.bump();
        let value = if matches!(
            self.kind(),
            TokenKind::Semi | TokenKind::RBrace | TokenKind::Eof
        ) {
            None
        } else {
            Some(self.expr(true))
        };
        self.semi(Sync::Statement, "`return` statement");
        Stmt::Return(ReturnStmt {
            id: self.id(),
            span: self.span_from(start),
            value,
        })
    }

    /// `break;` and `continue;`; outside a loop `E1030`.
    fn jump_stmt(&mut self) -> Stmt {
        let word = self.span();
        let is_break = self.kind() == TokenKind::KwBreak;
        self.bump();
        if self.loop_depth == 0 {
            self.report_jump_outside_loop(word, is_break);
        }
        self.semi(Sync::Statement, "statement");
        let jump = JumpStmt {
            id: self.id(),
            span: self.span_from(word.start),
        };
        if is_break {
            Stmt::Break(jump)
        } else {
            Stmt::Continue(jump)
        }
    }

    #[inline(never)]
    fn report_jump_outside_loop(&mut self, word: Span, is_break: bool) {
        let name = if is_break { "break" } else { "continue" };
        let diagnostic = Diagnostic::new(
            Code::E1030,
            format!("`{name}` can only be used inside a `for` loop."),
        )
        .at(word)
        .help(
            "`break` and `continue` apply to the innermost `for`; there is no other loop in v0.1",
        );
        self.report(diagnostic);
    }

    // ----- expression statements and assignments ----------------------------

    /// `Expr ;` and `Expr AssignOp Expr ;`. Without an assignment operator the
    /// expression must be a call (`E1020`).
    fn simple_stmt(&mut self) -> Stmt {
        let start = self.span().start;
        let target = self.expr(true);
        if let Some(op) = assign_op(self.kind()) {
            let op_span = self.span();
            self.bump();
            let value = self.expr(true);
            self.semi(Sync::Statement, "assignment");
            return Stmt::Assign(AssignStmt {
                id: self.id(),
                span: self.span_from(start),
                target,
                op,
                op_span,
                value,
            });
        }
        // An unused expression is a mistake in its own right only when the
        // statement is otherwise well formed.
        let well_formed = self.kind() == TokenKind::Semi;
        if well_formed && !matches!(target.kind, ExprKind::Call { .. } | ExprKind::Error) {
            self.report_unused_expression(target.span);
        }
        self.semi(Sync::Statement, "statement");
        Stmt::Expr(ExprStmt {
            id: self.id(),
            span: self.span_from(start),
            expr: target,
        })
    }

    #[inline(never)]
    fn report_unused_expression(&mut self, span: Span) {
        let diagnostic = Diagnostic::new(
            Code::E1020,
            "The value of this expression is not used; only calls can be used as statements.",
        )
        .at(span)
        .help("bind the value with `let name = ...;`, assign it to a place, or remove it");
        self.report(diagnostic);
    }
}

/// The assignment operator of `kind`, if it is one.
fn assign_op(kind: TokenKind) -> Option<AssignOp> {
    if !is_assign_op(kind) {
        return None;
    }
    Some(match kind {
        TokenKind::PlusEq => AssignOp::Add,
        TokenKind::MinusEq => AssignOp::Sub,
        TokenKind::StarEq => AssignOp::Mul,
        TokenKind::SlashEq => AssignOp::Div,
        _ => AssignOp::Assign,
    })
}
