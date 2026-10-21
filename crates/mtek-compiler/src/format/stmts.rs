//! Blocks and statements (`spec/grammar.ebnf` section 6).

use crate::syntax::ast::{
    ArmBody, AssignStmt, Block, ElseBranch, ForIter, ForStmt, IfStmt, LocalDecl, MatchArm,
    MatchStmt, Pattern, PatternKind, ReturnStmt, Stmt,
};

use super::decls::closing;
use super::doc::Doc;
use super::printer::Printer;
use crate::syntax::TokenKind;
use crate::syntax::ast::Expr;

impl Printer<'_> {
    /// `{`, the statements one per line indented, `}`.
    pub(super) fn block(&mut self, block: &Block) -> Doc {
        self.braced(
            block.span.start,
            closing(block.span),
            &block.stmts,
            &mut |printer, stmt| printer.stmt(stmt),
        )
    }

    fn stmt(&mut self, stmt: &Stmt) -> Doc {
        match stmt {
            Stmt::Let(decl) => self.local("let ", decl),
            Stmt::Var(decl) => self.local("var ", decl),
            Stmt::Const(decl) => self.const_decl(decl),
            Stmt::If(stmt) => self.if_stmt(stmt),
            Stmt::For(stmt) => self.for_stmt(stmt),
            Stmt::Return(stmt) => self.return_stmt(stmt),
            Stmt::Break(jump) => {
                let semicolon = self.semicolon(jump.span.end);
                Doc::concat(vec![Doc::text("break"), semicolon])
            }
            Stmt::Continue(jump) => {
                let semicolon = self.semicolon(jump.span.end);
                Doc::concat(vec![Doc::text("continue"), semicolon])
            }
            Stmt::Block(block) => self.block(block),
            Stmt::Match(stmt) => self.match_stmt(stmt),
            Stmt::Assign(stmt) => self.assign(stmt),
            Stmt::Expr(stmt) => {
                let expr = self.expr(&stmt.expr);
                let semicolon = self.semicolon(stmt.span.end);
                Doc::concat(vec![expr, semicolon])
            }
            Stmt::Error(node) => Doc::text(self.slice(node.span)),
        }
    }

    fn local(&mut self, keyword: &'static str, decl: &LocalDecl) -> Doc {
        let name = self.ident(&decl.name);
        let ty = self.annotation(decl.ty.as_ref());
        let value = self.expr(&decl.value);
        let semicolon = self.semicolon(decl.span.end);
        Doc::concat(vec![
            Doc::text(keyword),
            name,
            ty,
            Doc::text(" = "),
            value,
            semicolon,
        ])
    }

    fn if_stmt(&mut self, stmt: &IfStmt) -> Doc {
        let condition = self.expr(&stmt.cond);
        let then_block = self.block(&stmt.then_block);
        let mut parts = vec![Doc::text("if "), condition, Doc::Space, then_block];
        match &stmt.else_branch {
            None => {}
            Some(ElseBranch::Block(block)) => {
                parts.push(Doc::text(" else "));
                parts.push(self.block(block));
            }
            Some(ElseBranch::If(chained)) => {
                parts.push(Doc::text(" else "));
                let leading = self.leading_comments(chained.span.start);
                let chained_doc = self.if_stmt(chained);
                parts.push(super::printer::combine_leading(leading, chained_doc));
            }
        }
        Doc::concat(parts)
    }

    fn for_stmt(&mut self, stmt: &ForStmt) -> Doc {
        let variable = self.ident(&stmt.var);
        let iterable = match &stmt.iter {
            ForIter::Range { start, end } => {
                let start = self.expr(start);
                let end = self.expr(end);
                Doc::concat(vec![start, Doc::text(".."), end])
            }
            ForIter::Each(iterable) => self.expr(iterable),
        };
        let body = self.block(&stmt.body);
        Doc::concat(vec![
            Doc::text("for "),
            variable,
            Doc::text(" in "),
            iterable,
            Doc::Space,
            body,
        ])
    }

    fn return_stmt(&mut self, stmt: &ReturnStmt) -> Doc {
        match &stmt.value {
            Some(value) => {
                let value = self.expr(value);
                let semicolon = self.semicolon(stmt.span.end);
                Doc::concat(vec![Doc::text("return "), value, semicolon])
            }
            None => {
                let semicolon = self.semicolon(stmt.span.end);
                Doc::concat(vec![Doc::text("return"), semicolon])
            }
        }
    }

    fn assign(&mut self, stmt: &AssignStmt) -> Doc {
        let target = self.expr(&stmt.target);
        let before_operator = self.trailing_comments(stmt.op_span.start);
        let value = self.expr(&stmt.value);
        let semicolon = self.semicolon(stmt.span.end);
        Doc::concat(vec![
            target,
            before_operator,
            Doc::Space,
            Doc::text(stmt.op.symbol()),
            Doc::Space,
            value,
            semicolon,
        ])
    }

    fn match_stmt(&mut self, stmt: &MatchStmt) -> Doc {
        self.match_doc(&stmt.scrutinee, &stmt.arms, stmt.span.end)
    }

    /// `match value {`, one arm per line, `}`: the canonical form of both the
    /// statement and the expression. Expression arms end with `,`; statement
    /// arms, whose bodies are blocks, with nothing.
    pub(super) fn match_doc(&mut self, scrutinee: &Expr, arms: &[MatchArm], end: u32) -> Doc {
        let value = self.expr(scrutinee);
        let open = self.token_start(TokenKind::LBrace, scrutinee.span.end, scrutinee.span.end);
        let close = end.saturating_sub(1);
        let body = self.braced(open, close, arms, &mut |p, arm| p.match_arm(arm));
        Doc::concat(vec![Doc::text("match "), value, Doc::Space, body])
    }

    fn match_arm(&mut self, arm: &MatchArm) -> Doc {
        let mut parts = Vec::new();
        for (index, pattern) in arm.patterns.iter().enumerate() {
            if index > 0 {
                parts.push(Doc::text(" | "));
            }
            parts.push(self.pattern(pattern));
        }
        parts.push(Doc::text(" => "));
        match &arm.body {
            ArmBody::Block(block) => parts.push(self.block(block)),
            ArmBody::Expr(value) => {
                parts.push(self.expr(value));
                parts.push(Doc::text(","));
            }
        }
        Doc::concat(parts)
    }

    fn pattern(&mut self, pattern: &Pattern) -> Doc {
        match &pattern.kind {
            PatternKind::Wildcard => Doc::text("_"),
            PatternKind::Value(value) => self.expr(value),
        }
    }
}
