//! Constant evaluation (`spec/language.md` sections 6.3 and 8.1,
//! `spec/compiler-architecture.md` section 4.7).
//!
//! Folding is mandatory: **every** expression whose operands are all literals
//! and constants is evaluated, wherever it appears, with the exact semantics
//! of [`super::value`]; the folded value of each such expression node is
//! recorded ([`Typeck::value`](super::Typeck::value)). Overflow and division
//! by zero during folding are `E3040`, wherever they happen.
//!
//! Constants are evaluated dependencies first (an explicit depth-first search
//! over the uses of constants in initialisers, so the stack does not grow with
//! the length of a chain of constants), each with its declared or inferred
//! type. A constant that depends on itself is `E2020`, reported once per cycle
//! at the first constant of the cycle in source order, with every step as a
//! related span. The initialiser of a constant must be a constant
//! expression; the first form in it that is not is `E3090`. Other places that
//! demand constants (scene fields, mesh, body and collider descriptors) are
//! the schema checks'; for them the reason a root expression is not constant
//! is recorded ([`Typeck::non_constant`](super::Typeck::non_constant)).
//!
//! An expression that is not folded because of an error that was already
//! reported is simply unknown: it causes no further diagnostic.

use std::collections::BTreeMap;

use super::check::{CallKind, Checker, FieldKind};
use super::ty::{Ty, TyId};
use super::value::{
    self, ConstValue, EvalError, EvalResult, color_literal, construct_vector, convert,
    namespace_function, select_components,
};
use super::{ConstInfo, NonConstant, NonConstantKind};
use crate::diagnostics::{Code, Diagnostic};
use crate::resolve::{DefId, DefKind, Res};
use crate::source::Span;
use crate::syntax::ast::{DescField, Expr, ExprKind, FieldValue, UnaryOp};

/// The outcome of folding one expression.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Folded {
    Value(ConstValue),
    /// The expression is not constant; the first non-constant form in it.
    NotConstant(NonConstant),
    /// The expression could not be folded because of an error that has been
    /// reported (or a construct gated in this build).
    Unknown,
}

impl Checker<'_> {
    /// Evaluate every constant the checker may refer to, dependencies first.
    ///
    /// The dependency graph has an edge for every name in an initialiser that
    /// denotes another constant (including names inside constructs that are
    /// gated in this build: a cycle is an error of its own). A depth-first
    /// search over it, in source order, with an explicit stack, reports each
    /// cycle once (`E2020`) and yields an order in which every constant comes
    /// after the constants it uses, so evaluating in that order never recurses
    /// from one constant into another: a chain of thousands of constants
    /// needs no deeper stack than one.
    pub(super) fn evaluate_constants(&mut self) {
        let mut roots: Vec<(u32, DefId)> = self
            .const_decls
            .iter()
            .map(|(def, decl)| (decl.span.start, *def))
            .collect();
        roots.sort_unstable();
        let mut edges: BTreeMap<DefId, Vec<(DefId, Span)>> = BTreeMap::new();
        for (def, decl) in &self.const_decls {
            let mut uses = Vec::new();
            self.constant_uses(&decl.value, &mut uses);
            edges.insert(*def, uses);
        }

        #[derive(Clone, Copy, PartialEq, Eq)]
        enum Mark {
            OnStack,
            Done,
        }
        let mut marks: BTreeMap<DefId, Mark> = BTreeMap::new();
        let mut order = Vec::with_capacity(roots.len());
        for (_, root) in roots {
            if marks.contains_key(&root) {
                continue;
            }
            // (constant, the reference it was reached through, next edge)
            let mut stack: Vec<(DefId, Option<Span>, usize)> = vec![(root, None, 0)];
            marks.insert(root, Mark::OnStack);
            while let Some(top) = stack.last_mut() {
                let (node, next) = (top.0, top.2);
                let edge = edges.get(&node).and_then(|uses| uses.get(next)).copied();
                top.2 += 1;
                match edge {
                    Some((target, span)) => match marks.get(&target) {
                        None => {
                            marks.insert(target, Mark::OnStack);
                            stack.push((target, Some(span), 0));
                        }
                        Some(Mark::OnStack) => {
                            if let Some(start) = stack.iter().position(|(d, _, _)| *d == target) {
                                let cycle: Vec<(DefId, Option<Span>)> = stack
                                    .get(start..)
                                    .unwrap_or(&[])
                                    .iter()
                                    .map(|(d, via, _)| (*d, *via))
                                    .collect();
                                self.report_cycle(&cycle, span);
                            }
                        }
                        Some(Mark::Done) => {}
                    },
                    None => {
                        marks.insert(node, Mark::Done);
                        order.push(node);
                        stack.pop();
                    }
                }
            }
        }
        for def in order {
            self.const_info(def, None);
        }
    }

    /// The names in `expr` that denote constants the checker may evaluate,
    /// with their spans, in source order.
    fn constant_uses(&self, expr: &Expr, uses: &mut Vec<(DefId, Span)>) {
        match &expr.kind {
            ExprKind::Name(_) => {
                if let Some(Res::Def(id)) = self.res.res(expr.id)
                    && self.const_decls.contains_key(&id)
                {
                    uses.push((id, expr.span));
                }
            }
            ExprKind::Paren(inner) | ExprKind::Unary { operand: inner, .. } => {
                self.constant_uses(inner, uses);
            }
            ExprKind::Binary { lhs, rhs, .. }
            | ExprKind::Index {
                base: lhs,
                index: rhs,
            } => {
                self.constant_uses(lhs, uses);
                self.constant_uses(rhs, uses);
            }
            ExprKind::Call { callee, args } => {
                self.constant_uses(callee, uses);
                for arg in args {
                    self.constant_uses(arg, uses);
                }
            }
            ExprKind::Field { base, .. } => self.constant_uses(base, uses),
            ExprKind::Array(items) => {
                for item in items {
                    self.constant_uses(item, uses);
                }
            }
            ExprKind::Descriptor { fields, .. } => {
                for field in fields {
                    match &field.value {
                        FieldValue::Expr(value) => self.constant_uses(value, uses),
                        FieldValue::Bind(bind) => self.constant_uses(&bind.source, uses),
                    }
                }
            }
            ExprKind::Int { .. }
            | ExprKind::Float { .. }
            | ExprKind::Str { .. }
            | ExprKind::Color { .. }
            | ExprKind::Bool(_)
            | ExprKind::SelfValue
            | ExprKind::Error => {}
        }
    }

    /// Type and evaluate the constant `def` (once), returning its type. `via`
    /// is the span of the reference that asks, `None` for the declaration
    /// itself. [`Self::evaluate_constants`] evaluates every constant before
    /// anything refers to it, so a reference finds it done; a constant on a
    /// cycle is `Error` wherever it is used.
    pub(super) fn const_info(&mut self, def: DefId, via: Option<Span>) -> TyId {
        if let Some(info) = self.out.consts.get(&def) {
            return info.ty;
        }
        if via.is_some() && self.cyclic.contains(&def) {
            return TyId::ERROR;
        }
        if self.in_progress.contains(&def) {
            // Unreachable when the dependency graph is complete; should a
            // reference escape it, the cycle is still reported here.
            let start = self.const_stack.iter().position(|(d, _)| *d == def);
            if let (Some(start), Some(span)) = (start, via) {
                let cycle = self.const_stack.get(start..).unwrap_or(&[]).to_vec();
                self.report_cycle(&cycle, span);
            }
            return TyId::ERROR;
        }
        let Some(decl) = self.const_decls.get(&def).copied() else {
            // A constant inside a construct this build does not check.
            return TyId::ERROR;
        };
        self.in_progress.insert(def);
        self.const_stack.push((def, via));

        let name = decl.name.name.clone();
        let declared = decl.ty.as_ref().map(|ty| self.annotation(ty));
        let actual = self.check(&decl.value, declared);
        let mut ty = actual;
        let mut type_ok = true;
        if let Some(declared) = declared {
            if !self.out.interner.assignable(actual, declared) {
                type_ok = false;
                let (declared_name, actual_name) = (self.display(declared), self.display(actual));
                self.sink.push(
                    Diagnostic::new(
                        Code::E3001,
                        format!(
                            "The constant '{name}' is declared as {declared_name}, but its value has type {actual_name}."
                        ),
                    )
                    .at(decl.value.span)
                    .expected(declared_name)
                    .actual(actual_name),
                );
            }
            ty = declared;
        }
        let mut value = match self.fold(&decl.value) {
            Folded::Value(value) if type_ok && !self.out.interner.is_error(ty) => Some(value),
            Folded::NotConstant(reason) => {
                self.sink.push(
                    Diagnostic::new(
                        Code::E3090,
                        format!(
                            "The value of the constant '{name}' is not a constant expression: {}.",
                            reason.reason
                        ),
                    )
                    .at(reason.span)
                    .related(decl.name.span, format!("the constant '{name}' is declared here"))
                    .note(
                        "a constant may use only literals, other constants, operators, conversions, constructors and const-eligible built-in functions",
                    ),
                );
                None
            }
            _ => None,
        };

        self.const_stack.pop();
        self.in_progress.remove(&def);
        if self.cyclic.contains(&def) {
            ty = TyId::ERROR;
            value = None;
        }
        self.out.consts.insert(def, ConstInfo { ty, value });
        ty
    }

    /// `E2020` for `cycle` (each constant with the reference it was reached
    /// through, the first one's ignored), closed by the reference `closing`
    /// back to its first constant.
    fn report_cycle(&mut self, cycle: &[(DefId, Option<Span>)], closing: Span) {
        let Some(&(first_def, _)) = cycle.first() else {
            return;
        };
        let name = |id: DefId| self.res.def(id).map_or("", |d| d.name.as_str()).to_owned();
        let first = name(first_def);
        let mut path: Vec<String> = cycle.iter().map(|(id, _)| name(*id)).collect();
        path.push(first.clone());
        let Some(primary) = self.res.def(first_def).map(|d| d.span) else {
            return;
        };
        let mut diagnostic = Diagnostic::new(
            Code::E2020,
            format!(
                "The constant '{first}' is defined in terms of itself: {}.",
                path.join(" → ")
            ),
        )
        .at(primary);
        for pair in cycle.windows(2) {
            if let [(from, _), (to, Some(span))] = pair {
                diagnostic = diagnostic.related(
                    *span,
                    format!("'{}' uses '{}' here", name(*from), name(*to)),
                );
            }
        }
        if let Some((last, _)) = cycle.last() {
            diagnostic =
                diagnostic.related(closing, format!("'{}' uses '{first}' here", name(*last)));
        }
        self.sink.push(diagnostic.help(
            "a constant cannot depend on itself; give one constant of the cycle a value that does not refer back",
        ));
        for (id, _) in cycle {
            self.cyclic.insert(*id);
        }
    }

    /// Fold the root of a value the schema checks may require to be constant,
    /// recording why it is not constant if it is not.
    pub(super) fn fold_root(&mut self, expr: &Expr) {
        if let Folded::NotConstant(reason) = self.fold(expr) {
            self.out.non_constant.insert(expr.id, reason);
        }
    }

    /// Fold `expr` and record its value.
    pub(super) fn fold(&mut self, expr: &Expr) -> Folded {
        let folded = self.fold_kind(expr);
        if let Folded::Value(value) = &folded
            && let Some(slot) = self.out.values.get_mut(expr.id.index())
        {
            *slot = Some(value.clone());
        }
        folded
    }

    /// The type of `expr` unless it is missing or `Error`.
    fn typed(&self, expr: &Expr) -> Option<TyId> {
        self.ty_of(expr.id)
            .filter(|t| !self.out.interner.is_error(*t))
    }

    fn fold_kind(&mut self, expr: &Expr) -> Folded {
        match &expr.kind {
            ExprKind::Int { value } => self.fold_int(expr, expr, *value, false),
            ExprKind::Float { value } => match self.typed(expr) {
                Some(TyId::F32) => {
                    Folded::Value(ConstValue::F32(self.float_literal_f32(expr, *value)))
                }
                _ => Folded::Unknown,
            },
            ExprKind::Bool(value) => Folded::Value(ConstValue::Bool(*value)),
            ExprKind::Color { rgba } => Folded::Value(color_literal(*rgba)),
            ExprKind::Paren(inner) => self.fold(inner),
            ExprKind::Name(_) => self.fold_name(expr),
            ExprKind::Unary {
                op: UnaryOp::Neg,
                operand,
            } => {
                if let ExprKind::Int { value } = &operand.kind {
                    // One negative literal (section 6.6).
                    return self.fold_int(expr, operand, *value, true);
                }
                let operand = self.fold(operand);
                self.combine(expr, vec![operand], |values| match values {
                    [v] => value::negate(v),
                    _ => Err(EvalError::Mismatch),
                })
            }
            ExprKind::Binary { op, lhs, rhs, .. } => {
                let (lhs, rhs) = (self.fold(lhs), self.fold(rhs));
                let Some(op) = super::check::arith_op(*op) else {
                    return Folded::Unknown;
                };
                self.combine(expr, vec![lhs, rhs], |values| match values {
                    [l, r] => value::arithmetic(op, l, r),
                    _ => Err(EvalError::Mismatch),
                })
            }
            ExprKind::Call { args, .. } => self.fold_call(expr, args),
            ExprKind::Field { base, .. } => self.fold_field(expr, base),
            ExprKind::Descriptor { fields, .. } => self.fold_descriptor(expr, fields),
            // `!`, string and array literals, indexing and `self` are gated in
            // this build; `Error` nodes were reported.
            ExprKind::Unary { .. }
            | ExprKind::Str { .. }
            | ExprKind::Array(_)
            | ExprKind::Index { .. }
            | ExprKind::SelfValue
            | ExprKind::Error => Folded::Unknown,
        }
    }

    /// The value of the integer literal `int` in the type of `literal` (the
    /// literal itself, or `-int`).
    fn fold_int(
        &mut self,
        literal: &Expr,
        int: &Expr,
        value: Option<u64>,
        negative: bool,
    ) -> Folded {
        let Some(ty) = self.typed(literal) else {
            return Folded::Unknown;
        };
        let magnitude = i64::try_from(value.unwrap_or(u64::MAX)).ok();
        let signed = magnitude.map(|m| if negative { -m } else { m });
        let folded = match self.out.interner.get(ty) {
            Ty::I32 => signed
                .and_then(|v| i32::try_from(v).ok())
                .map(ConstValue::I32),
            Ty::U32 => signed
                .and_then(|v| u32::try_from(v).ok())
                .map(ConstValue::U32),
            Ty::F32 => Some(ConstValue::F32(self.int_literal_f32(int, value, negative))),
            _ => None,
        };
        folded.map_or(Folded::Unknown, Folded::Value)
    }

    fn fold_name(&mut self, expr: &Expr) -> Folded {
        let Some(Res::Def(id)) = self.res.res(expr.id) else {
            return Folded::Unknown;
        };
        let Some(def) = self.res.def(id) else {
            return Folded::Unknown;
        };
        match def.kind {
            DefKind::Const => {
                let value = self.out.consts.get(&id).and_then(|info| info.value.clone());
                match (value, self.typed(expr)) {
                    (Some(value), Some(_)) => Folded::Value(value),
                    _ => Folded::Unknown,
                }
            }
            DefKind::State
            | DefKind::Param
            | DefKind::FnParam
            | DefKind::Local { .. }
            | DefKind::LoopVar
            | DefKind::Entity => Folded::NotConstant(NonConstant {
                span: expr.span,
                kind: NonConstantKind::Declaration,
                reason: format!("it refers to the {} '{}'", def.kind.noun(), def.name),
            }),
            // Imported constants (imports are gated in this build) and names
            // that are not values (reported by the checker).
            _ => Folded::Unknown,
        }
    }

    fn fold_call(&mut self, expr: &Expr, args: &[Expr]) -> Folded {
        let folded: Vec<Folded> = args.iter().map(|arg| self.fold(arg)).collect();
        let Some(kind) = self.calls.get(&expr.id).cloned() else {
            return Folded::Unknown;
        };
        match kind {
            CallKind::UserFunction(name) => Folded::NotConstant(NonConstant {
                span: expr.span,
                kind: NonConstantKind::Call,
                reason: format!(
                    "it calls the function '{name}', and calls of user functions are not constant in v0.1"
                ),
            }),
            CallKind::Namespace {
                namespace,
                member,
                const_eligible: false,
            } => Folded::NotConstant(NonConstant {
                span: expr.span,
                kind: NonConstantKind::Call,
                reason: format!("`{namespace}.{member}` is not a constant function"),
            }),
            CallKind::Intrinsic {
                name,
                const_eligible: false,
            } => Folded::NotConstant(NonConstant {
                span: expr.span,
                kind: NonConstantKind::Call,
                reason: format!("`{name}` is not a constant function"),
            }),
            CallKind::Vector(dim) => {
                self.combine(expr, folded, |values| construct_vector(dim, values))
            }
            CallKind::Conversion(scalar) => self.combine(expr, folded, |values| match values {
                [v] => convert(v, scalar),
                _ => Err(EvalError::Mismatch),
            }),
            CallKind::Namespace {
                namespace, member, ..
            } => self.combine(expr, folded, |values| {
                namespace_function(namespace, member, values).unwrap_or(Err(EvalError::Mismatch))
            }),
            // Global intrinsics are gated in this build, and with them their
            // folding (see the tests).
            CallKind::Intrinsic { .. } => Folded::Unknown,
        }
    }

    fn fold_field(&mut self, expr: &Expr, base: &Expr) -> Folded {
        let Some(kind) = self.fields.get(&expr.id).cloned() else {
            return Folded::Unknown;
        };
        match kind {
            FieldKind::Components(indices) => {
                let base = self.fold(base);
                self.combine(expr, vec![base], |values| match values {
                    [v] => select_components(v, &indices),
                    _ => Err(EvalError::Mismatch),
                })
            }
            FieldKind::ObjectField {
                noun,
                object,
                field,
            } => Folded::NotConstant(NonConstant {
                span: expr.span,
                kind: NonConstantKind::ObjectField,
                reason: format!("it reads the field '{field}' of the {noun} '{object}'"),
            }),
            FieldKind::NamespaceValue(name) => Folded::NotConstant(NonConstant {
                span: expr.span,
                kind: NonConstantKind::RunTimeValue,
                reason: format!("it reads `{name}`, which changes at run time"),
            }),
        }
    }

    /// A descriptor literal folds to the fields as written. The reason each
    /// field value is not constant is recorded, because the schema checks
    /// require constants field by field (the values of a mesh descriptor,
    /// not the parameters of a material).
    fn fold_descriptor(&mut self, expr: &Expr, fields: &[DescField]) -> Folded {
        let schema = match self.typed(expr).map(|t| self.out.interner.get(t)) {
            Some(Ty::Schema(schema)) => schema,
            _ => return Folded::Unknown,
        };
        let mut names = Vec::with_capacity(fields.len());
        let mut folded = Vec::with_capacity(fields.len());
        for field in fields {
            names.push(field.name.name.clone());
            folded.push(match &field.value {
                // A field the checker skipped (gated) has no type.
                FieldValue::Expr(value) if self.ty_of(value.id).is_some() => {
                    let value_folded = self.fold(value);
                    if let Folded::NotConstant(reason) = &value_folded {
                        self.out.non_constant.insert(value.id, reason.clone());
                    }
                    value_folded
                }
                _ => Folded::Unknown,
            });
        }
        self.combine(expr, folded, |values| {
            Ok(ConstValue::Struct {
                name: schema.to_owned(),
                fields: names.iter().cloned().zip(values.iter().cloned()).collect(),
            })
        })
    }

    /// Combine folded operands: the first non-constant operand makes the
    /// whole expression non-constant; an unknown operand, or an expression
    /// whose type is `Error`, makes it unknown; otherwise `op` computes the
    /// value, and an evaluation error is `E3040` at `expr`.
    fn combine(
        &mut self,
        expr: &Expr,
        operands: Vec<Folded>,
        op: impl FnOnce(&[ConstValue]) -> EvalResult,
    ) -> Folded {
        let mut values = Vec::with_capacity(operands.len());
        let mut unknown = false;
        for operand in operands {
            match operand {
                Folded::Value(value) => values.push(value),
                Folded::NotConstant(reason) => return Folded::NotConstant(reason),
                Folded::Unknown => unknown = true,
            }
        }
        if unknown || self.typed(expr).is_none() {
            return Folded::Unknown;
        }
        match op(&values) {
            Ok(value) => Folded::Value(value),
            Err(error) => {
                self.report_eval_error(expr.span, error);
                Folded::Unknown
            }
        }
    }

    fn report_eval_error(&mut self, span: Span, error: EvalError) {
        let (message, note) = match error {
            EvalError::Overflow(what) => (
                format!("Integer overflow in a constant expression: {what}."),
                "constant expressions are evaluated at compile time, where integer overflow is an error",
            ),
            EvalError::DivisionByZero(what) => (
                format!("Division by zero in a constant expression: {what}."),
                "constant expressions are evaluated at compile time, where division by zero is an error",
            ),
            EvalError::NotFinite(what) => (
                format!("A constant expression has no finite f32 value: {what}."),
                "a folded constant must be a finite f32 value",
            ),
            EvalError::Mismatch => return,
        };
        self.sink
            .push(Diagnostic::new(Code::E3040, message).at(span).note(note));
    }
}
