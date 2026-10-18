//! Blocks and statements (`spec/grammar.ebnf` section 6).

use crate::syntax::ast::{
    AssignStmt, Block, ElseBranch, ForIter, ForStmt, IfStmt, LocalDecl, ReturnStmt, Stmt,
};

use super::decls::closing;
use super::doc::Doc;
use super::printer::Printer;

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
}
