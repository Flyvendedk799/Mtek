//! Expressions (`spec/grammar.ebnf` section 7).

use crate::source::Span;
use crate::syntax::ast::{BinaryOp, DescField, Expr, ExprKind};

use super::decls::closing;
use super::doc::Doc;
use super::printer::{ListStyle, Printer, combine_leading};

/// The precedence level of a binary operator: operators of one level chain
/// (`a + b - c`) and are printed as one group.
fn level(op: BinaryOp) -> u8 {
    match op {
        BinaryOp::Or => 0,
        BinaryOp::And => 1,
        BinaryOp::Eq | BinaryOp::Ne => 2,
        BinaryOp::Lt | BinaryOp::Le | BinaryOp::Gt | BinaryOp::Ge => 3,
        BinaryOp::Add | BinaryOp::Sub => 4,
        BinaryOp::Mul | BinaryOp::Div | BinaryOp::Rem => 5,
    }
}

impl Printer<'_> {
    pub(super) fn expr(&mut self, expr: &Expr) -> Doc {
        let leading = self.leading_comments(expr.span.start);
        let doc = self.expr_kind(expr);
        combine_leading(leading, doc)
    }

    fn expr_kind(&mut self, expr: &Expr) -> Doc {
        match &expr.kind {
            // Literals are printed as written: they are canonical by the
            // lexical rules, and a re-spelling could change the type (`1.0`
            // is an `f32`, `1` an integer) or the value.
            ExprKind::Int { .. }
            | ExprKind::Float { .. }
            | ExprKind::Str { .. }
            | ExprKind::Bool(_)
            | ExprKind::Error => Doc::text(self.slice(expr.span)),
            ExprKind::Color { .. } => Doc::text(self.slice(expr.span).to_ascii_lowercase()),
            ExprKind::SelfValue => Doc::text("self"),
            ExprKind::Name(name) => Doc::text(name),
            ExprKind::Paren(inner) => {
                let inner = self.expr(inner);
                let trailing = self.trailing_comments(closing(expr.span));
                Doc::group(Doc::concat(vec![
                    Doc::text("("),
                    Doc::indent(Doc::concat(vec![Doc::SoftLine, inner, trailing])),
                    Doc::SoftLine,
                    Doc::text(")"),
                ]))
            }
            ExprKind::Array(items) => self.list(
                &ListStyle::BRACKETS,
                items,
                closing(expr.span),
                &mut |printer, item| printer.expr(item),
            ),
            ExprKind::Descriptor { name, fields } => {
                let fields = self.list(
                    &ListStyle::DESCRIPTOR,
                    fields,
                    closing(expr.span),
                    &mut |printer, field| printer.desc_field(field),
                );
                Doc::concat(vec![Doc::text(&name.name), Doc::Space, fields])
            }
            ExprKind::Unary { op, operand } => {
                let operand = self.expr(operand);
                Doc::concat(vec![Doc::text(op.symbol()), operand])
            }
            ExprKind::Binary { .. } => self.binary(expr),
            ExprKind::Call { callee, args } => {
                let callee = self.expr(callee);
                let args = self.list(
                    &ListStyle::PARENS,
                    args,
                    closing(expr.span),
                    &mut |printer, arg| printer.expr(arg),
                );
                Doc::concat(vec![callee, args])
            }
            ExprKind::Field { base, name } => {
                let base = self.expr(base);
                let name = self.ident(name);
                Doc::concat(vec![base, Doc::text("."), name])
            }
            ExprKind::Index { base, index } => {
                let base = self.expr(base);
                let index = self.expr(index);
                let trailing = self.trailing_comments(closing(expr.span));
                Doc::concat(vec![base, Doc::text("["), index, trailing, Doc::text("]")])
            }
            ExprKind::Match { scrutinee, arms } => self.match_doc(scrutinee, arms, expr.span.end),
        }
    }

    fn desc_field(&mut self, field: &DescField) -> Doc {
        let name = self.ident(&field.name);
        let value = self.field_value(&field.value);
        Doc::concat(vec![name, Doc::text(": "), value])
    }

    /// A chain of binary operators of one precedence level: the operands on
    /// one line if they fit, else each further operand on a line of its own,
    /// indented, led by its operator.
    fn binary(&mut self, expr: &Expr) -> Doc {
        // The left spine: `a + b - c` is `(a + b) - c`.
        let mut rest: Vec<(BinaryOp, Span, &Expr)> = Vec::new();
        let mut first = expr;
        while let ExprKind::Binary {
            op,
            op_span,
            lhs,
            rhs,
        } = &first.kind
        {
            rest.push((*op, *op_span, rhs));
            first = lhs;
            let chains = matches!(
                &first.kind,
                ExprKind::Binary { op: inner, .. } if level(*inner) == level(*op)
            );
            if !chains {
                break;
            }
        }
        rest.reverse();
        let mut parts = vec![self.expr(first)];
        let mut tail = Vec::new();
        for (op, op_span, operand) in rest {
            tail.push(self.trailing_comments(op_span.start));
            tail.push(Doc::Line);
            tail.push(Doc::text(op.symbol()));
            tail.push(Doc::Space);
            tail.push(self.expr(operand));
        }
        parts.push(Doc::indent(Doc::concat(tail)));
        Doc::group(Doc::concat(parts))
    }
}
