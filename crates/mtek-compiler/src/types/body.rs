//! Functions and statements (`spec/language.md` sections 7 and 8.2,
//! decision 0038).
//!
//! A function's signature is checked before any body, so calls type against
//! it in any order; then each body is checked statement by statement:
//!
//! * `let`/`var` with their declared or inferred type (`E3001` for a value
//!   of another type; `W2010` for a `var` never assigned), block `const`s
//!   (evaluated with the module's constants);
//! * assignments and compound assignments to assignable places — a `var`
//!   local or a single component of a vector `var` (`E3061` for anything
//!   else, `E3060` for a multi-component swizzle);
//! * `if` conditions of type `bool` (`E3070`), `for` over an `i32`/`u32`
//!   range or an array, with an immutable loop variable;
//! * `return` against the result type, `E3080` when control can reach the
//!   end of a function with a result type, `W3081` for statements after one
//!   that always leaves its block.
//!
//! Every expression of a body is folded (folding is mandatory wherever an
//! expression is constant, section 6.3), so overflow is `E3040` and a
//! constant index out of range `E3030` in a body too. What the body calls
//! and declares is recorded as [`BodyFacts`] for the program-wide passes
//! ([`super::effects`]).

use std::collections::BTreeSet;

use super::check::{Checker, FieldKind, arith_op, literal_kind};
use super::consteval::Folded;
use super::facts::{BodyFacts, CpuOnlySite};
use super::ty::{Ty, TyId};
use super::{FnInfo, FnSig};
use crate::diagnostics::{Code, Diagnostic};
use crate::resolve::{Def, DefId, DefKind, Res};
use crate::source::Span;
use crate::syntax::ast::{
    AssignOp, AssignStmt, Block, ElseBranch, Expr, ExprKind, FnDecl, ForIter, ForStmt, IfStmt,
    LocalDecl, Stmt,
};

/// The state of the body being checked.
pub(super) struct BodyState {
    /// The function's name, for messages.
    pub(super) name: String,
    /// The result type ([`TyId::UNIT`] without `->`).
    ret: TyId,
    pub(super) facts: BodyFacts,
    /// `var` locals assigned somewhere in the body.
    assigned: BTreeSet<DefId>,
    /// Every `var` local, with its name and the span of the name.
    vars: Vec<(DefId, String, Span)>,
}

/// How a statement leaves its block, when it always does.
#[derive(Clone, Copy, Debug)]
struct Exit {
    /// It returns from the function (`break` and `continue` do not).
    returns: bool,
    /// The statement that leaves.
    span: Span,
    /// The statement, for `W3081`: "a `return`".
    what: &'static str,
}

/// The span of a statement.
fn stmt_span(stmt: &Stmt) -> Span {
    match stmt {
        Stmt::Let(decl) | Stmt::Var(decl) => decl.span,
        Stmt::Const(decl) => decl.span,
        Stmt::If(stmt) => stmt.span,
        Stmt::For(stmt) => stmt.span,
        Stmt::Return(stmt) => stmt.span,
        Stmt::Break(stmt) | Stmt::Continue(stmt) => stmt.span,
        Stmt::Block(block) => block.span,
        Stmt::Assign(stmt) => stmt.span,
        Stmt::Expr(stmt) => stmt.span,
        Stmt::Error(node) => node.span,
    }
}

/// The span `a..b` of a range.
pub(super) fn range_span(start: &Expr, end: &Expr) -> Span {
    Span::new(start.span.file, start.span.start, end.span.end)
}

impl<'a> Checker<'a> {
    /// The block constants of a function body, so that they are evaluated
    /// with the module's constants (blocks nest no deeper than the parser
    /// allows).
    pub(super) fn collect_block_constants(&mut self, block: &'a Block) {
        for stmt in &block.stmts {
            match stmt {
                Stmt::Const(decl) => {
                    if let Some(def) = self.res.def_of(decl.id) {
                        self.const_decls.insert(def, decl);
                    }
                }
                Stmt::Block(inner) => self.collect_block_constants(inner),
                Stmt::For(stmt) => self.collect_block_constants(&stmt.body),
                Stmt::If(stmt) => {
                    let mut current = stmt;
                    loop {
                        self.collect_block_constants(&current.then_block);
                        match &current.else_branch {
                            None => break,
                            Some(ElseBranch::Block(block)) => {
                                self.collect_block_constants(block);
                                break;
                            }
                            Some(ElseBranch::If(next)) => current = next,
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// The signature of `decl`: its parameter types (mandatory in the
    /// grammar) and its result type, unit without `->`.
    pub(super) fn function_signature(&mut self, decl: &FnDecl) {
        let Some(def) = self.res.def_of(decl.id) else {
            return;
        };
        let params = decl
            .params
            .iter()
            .map(|param| (param.name.name.clone(), self.annotation(&param.ty)))
            .collect();
        let ret = decl
            .ret
            .as_ref()
            .map_or(TyId::UNIT, |ty| self.annotation(ty));
        self.out.functions.insert(
            def,
            FnInfo {
                name: decl.name.name.clone(),
                name_span: decl.name.span,
                span: decl.span,
                sig: FnSig {
                    params,
                    ret,
                    cpu: decl.cpu,
                },
                facts: BodyFacts::default(),
            },
        );
    }

    /// Check the body of `decl` (its signature was checked first).
    pub(super) fn function_body(&mut self, decl: &FnDecl) {
        let Some(def) = self.res.def_of(decl.id) else {
            return;
        };
        let Some(sig) = self.out.functions.get(&def).map(|info| info.sig.clone()) else {
            return;
        };
        self.body = Some(BodyState {
            name: decl.name.name.clone(),
            ret: sig.ret,
            facts: BodyFacts::default(),
            assigned: BTreeSet::new(),
            vars: Vec::new(),
        });
        for (param, (name, ty)) in decl.params.iter().zip(&sig.params) {
            if let Some(param_def) = self.res.def_of(param.id) {
                self.out.locals.insert(param_def, *ty);
            }
            self.cpu_only_site(param.ty.span, format!("the parameter '{name}'"), *ty);
        }
        if let Some(ret) = &decl.ret {
            let what = format!("the result of '{}'", decl.name.name);
            self.cpu_only_site(ret.span, what, sig.ret);
        }
        let exit = self.block(&decl.body);
        if sig.ret != TyId::UNIT && !exit.is_some_and(|e| e.returns) {
            let end = decl.body.span.end;
            let close = Span::new(decl.body.span.file, end.saturating_sub(1), end);
            let ret_name = self.display(sig.ret);
            let mut diagnostic = Diagnostic::new(
                Code::E3080,
                format!(
                    "The function '{}' does not return a value on every path: control can reach the end of its body.",
                    decl.name.name
                ),
            )
            .at(close)
            .help("end every path of the body with `return …;`");
            if let Some(ret) = &decl.ret {
                diagnostic = diagnostic
                    .related(ret.span, format!("'{}' returns {ret_name}", decl.name.name));
            }
            self.report_diagnostic(diagnostic);
        }
        let Some(state) = self.body.take() else {
            return;
        };
        for (var, name, span) in &state.vars {
            if !state.assigned.contains(var) {
                self.report_diagnostic(
                    Diagnostic::new(
                        Code::W2010,
                        format!(
                            "The variable '{name}' is never reassigned; declare it with `let`."
                        ),
                    )
                    .at(*span)
                    .help("`var` is for locals that are assigned after their declaration"),
                );
            }
        }
        if let Some(info) = self.out.functions.get_mut(&def) {
            info.facts = state.facts;
        }
    }

    fn report_diagnostic(&mut self, diagnostic: Diagnostic) {
        self.sink.push(diagnostic);
    }

    /// Record a declaration of a type that has no GPU representation.
    fn cpu_only_site(&mut self, span: Span, what: String, ty: TyId) {
        if self.gpu_representable(ty) {
            return;
        }
        let ty = self.display(ty);
        if let Some(body) = &mut self.body {
            body.facts.cpu_only.push(CpuOnlySite { span, what, ty });
        }
    }

    /// Whether values of `ty` can exist in GPU code (`spec/language.md` 5.1):
    /// scalars, vectors, `mat4`, `quat`, `color`, GPU records, and arrays and
    /// structs of those. `Error` and unit count as representable (nothing
    /// more to report). Structs are visited with a worklist.
    pub(super) fn gpu_representable(&self, ty: TyId) -> bool {
        let interner = &self.out.interner;
        let mut pending = vec![ty];
        let mut seen = BTreeSet::new();
        while let Some(ty) = pending.pop() {
            if !seen.insert(ty) {
                continue;
            }
            match interner.get(ty) {
                Ty::Error
                | Ty::Unit
                | Ty::Bool
                | Ty::I32
                | Ty::U32
                | Ty::F32
                | Ty::Vec2
                | Ty::Vec3
                | Ty::Vec4
                | Ty::Mat4
                | Ty::Quat
                | Ty::Color => {}
                Ty::Array { element, .. } => pending.push(element),
                Ty::Struct(_) => {
                    if let Some(def) = interner.struct_def(ty) {
                        pending.extend(def.fields.iter().map(|(_, field)| *field));
                    }
                }
                Ty::Record(name) => {
                    if !self.registry.type_def(name).is_some_and(|t| t.gpu) {
                        return false;
                    }
                }
                Ty::String
                | Ty::Mesh
                | Ty::Material
                | Ty::Texture
                | Ty::Sampler
                | Ty::EntityRef
                | Ty::GlbAsset
                | Ty::Enum(_)
                | Ty::Schema(_)
                | Ty::Descriptor(_)
                | Ty::PrefabDescriptor => return false,
            }
        }
        true
    }

    // ----- statements ------------------------------------------------------

    /// Check a block; how it always leaves, if it does. Statements after one
    /// that always leaves are `W3081` (once per block) and still checked.
    fn block(&mut self, block: &Block) -> Option<Exit> {
        let mut exit: Option<Exit> = None;
        let mut reported = false;
        for stmt in &block.stmts {
            if let (Some(leaving), false) = (exit, reported) {
                reported = true;
                let first = stmt_span(stmt);
                let last = block.stmts.last().map_or(first, stmt_span);
                self.report_diagnostic(
                    Diagnostic::new(
                        Code::W3081,
                        format!(
                            "Unreachable code: it follows {}, which always leaves the block.",
                            leaving.what
                        ),
                    )
                    .at(Span::new(first.file, first.start, last.end.max(first.end)))
                    .related(leaving.span, "control leaves the block here"),
                );
            }
            let this = self.stmt(stmt);
            if exit.is_none() {
                exit = this;
            }
        }
        exit
    }

    fn stmt(&mut self, stmt: &Stmt) -> Option<Exit> {
        match stmt {
            Stmt::Let(decl) => {
                self.local(decl, false);
                None
            }
            Stmt::Var(decl) => {
                self.local(decl, true);
                None
            }
            Stmt::Const(decl) => {
                if let Some(def) = self.res.def_of(decl.id) {
                    let ty = self.const_info(def, None);
                    let what = format!("the constant '{}'", decl.name.name);
                    let span = decl.ty.as_ref().map_or(decl.name.span, |t| t.span);
                    self.cpu_only_site(span, what, ty);
                }
                None
            }
            Stmt::If(stmt) => self.if_stmt(stmt),
            Stmt::For(stmt) => {
                self.for_stmt(stmt);
                None
            }
            Stmt::Return(ret) => {
                self.return_stmt(ret.span, ret.value.as_ref());
                Some(Exit {
                    returns: true,
                    span: ret.span,
                    what: "a `return`",
                })
            }
            Stmt::Break(jump) => Some(Exit {
                returns: false,
                span: jump.span,
                what: "a `break`",
            }),
            Stmt::Continue(jump) => Some(Exit {
                returns: false,
                span: jump.span,
                what: "a `continue`",
            }),
            Stmt::Block(block) => self.block(block),
            Stmt::Assign(assign) => {
                self.assign(assign);
                None
            }
            Stmt::Expr(stmt) => {
                // Only calls are statements (`E1020` is the parser's); a
                // call's result may be discarded.
                self.check(&stmt.expr, None);
                self.fold_in_body(&stmt.expr);
                None
            }
            Stmt::Error(_) => None,
        }
    }

    /// Fold an expression of a body: its constant parts get their values
    /// (and their evaluation errors); that it is not constant as a whole is
    /// fine.
    fn fold_in_body(&mut self, expr: &Expr) -> Folded {
        self.fold(expr)
    }

    /// The type of `expr` used as a value: a call of a function without a
    /// result has none (`E3001`).
    fn value(&mut self, expr: &Expr, expected: Option<TyId>) -> TyId {
        let ty = self.check(expr, expected);
        if ty == TyId::UNIT {
            self.report_diagnostic(
                Diagnostic::new(
                    Code::E3001,
                    "This call gives no value: the function it calls has no result type.",
                )
                .at(expr.span)
                .expected("a value")
                .actual("()"),
            );
            return TyId::ERROR;
        }
        ty
    }

    /// `let name[: T] = value;` and `var …`.
    fn local(&mut self, decl: &LocalDecl, mutable: bool) {
        let declared = decl.ty.as_ref().map(|ty| self.annotation(ty));
        let actual = self.value(&decl.value, declared);
        let mut ty = actual;
        let noun = if mutable { "variable" } else { "local" };
        if let Some(declared) = declared {
            if !self.out.interner.assignable(actual, declared) {
                let (declared_name, actual_name) = (self.display(declared), self.display(actual));
                self.report_diagnostic(
                    Diagnostic::new(
                        Code::E3001,
                        format!(
                            "The {noun} '{}' is declared as {declared_name}, but its value has type {actual_name}.",
                            decl.name.name
                        ),
                    )
                    .at(decl.value.span)
                    .expected(declared_name)
                    .actual(actual_name),
                );
            }
            ty = declared;
        }
        self.fold_in_body(&decl.value);
        let Some(def) = self.res.def_of(decl.id) else {
            return;
        };
        self.out.locals.insert(def, ty);
        let span = decl.ty.as_ref().map_or(decl.name.span, |t| t.span);
        self.cpu_only_site(span, format!("the {noun} '{}'", decl.name.name), ty);
        if mutable && let Some(body) = &mut self.body {
            body.vars
                .push((def, decl.name.name.clone(), decl.name.span));
        }
    }

    /// An `if` with its `else if` chain (a loop, not recursion); it always
    /// leaves when it has an `else` and every branch does.
    fn if_stmt(&mut self, stmt: &IfStmt) -> Option<Exit> {
        let mut every_branch_leaves = true;
        let mut every_branch_returns = true;
        let mut has_else = false;
        let mut current = stmt;
        let mut branch = |exit: Option<Exit>| {
            every_branch_leaves &= exit.is_some();
            every_branch_returns &= exit.is_some_and(|e| e.returns);
        };
        loop {
            self.condition(&current.cond);
            branch(self.block(&current.then_block));
            match &current.else_branch {
                None => break,
                Some(ElseBranch::Block(block)) => {
                    has_else = true;
                    branch(self.block(block));
                    break;
                }
                Some(ElseBranch::If(next)) => current = next,
            }
        }
        (has_else && every_branch_leaves).then_some(Exit {
            returns: every_branch_returns,
            span: stmt.span,
            what: "an `if` whose every branch leaves the block",
        })
    }

    /// The condition of an `if`: `bool`, no truthiness (`E3070`).
    fn condition(&mut self, cond: &Expr) {
        let ty = self.value(cond, Some(TyId::BOOL));
        if ty != TyId::BOOL && !self.out.interner.is_error(ty) {
            let name = self.display(ty);
            self.report_diagnostic(
                Diagnostic::new(
                    Code::E3070,
                    format!("The condition of `if` must be bool, but it has type {name}."),
                )
                .at(cond.span)
                .expected("bool")
                .actual(name)
                .note("there is no truthiness in v0.1; compare explicitly, for example `x != 0`"),
            );
        }
        self.fold_in_body(cond);
    }

    /// `for x in a..b { … }` and `for x in array { … }`.
    fn for_stmt(&mut self, stmt: &ForStmt) {
        let var_ty = match &stmt.iter {
            ForIter::Range { start, end } => {
                let (start_ty, end_ty) = self.same_typed_operands(start, end);
                let (s, e) = (
                    self.out.interner.get(start_ty),
                    self.out.interner.get(end_ty),
                );
                let span = range_span(start, end);
                let ty = match (s, e) {
                    (Ty::Error, _) | (_, Ty::Error) => TyId::ERROR,
                    (Ty::I32, Ty::I32) | (Ty::U32, Ty::U32) => start_ty,
                    _ => {
                        let (a, b) = (self.display(start_ty), self.display(end_ty));
                        self.report_diagnostic(
                            Diagnostic::new(
                                Code::E3001,
                                format!(
                                    "The bounds of a `for` range must both be i32 or both be u32, but they are {a} and {b}."
                                ),
                            )
                            .at(span)
                            .expected("i32 or u32")
                            .actual(if a == b { a } else { format!("{a} and {b}") }),
                        );
                        TyId::ERROR
                    }
                };
                let start_folded = self.fold_in_body(start);
                let end_folded = self.fold_in_body(end);
                let unbounded = [&start_folded, &end_folded]
                    .iter()
                    .any(|f| matches!(f, Folded::NotConstant(_)));
                if unbounded
                    && !self.out.interner.is_error(ty)
                    && let Some(body) = &mut self.body
                {
                    body.facts.unbounded_loops.push(span);
                }
                ty
            }
            ForIter::Each(array) => {
                let ty = self.value(array, None);
                let element = match self.out.interner.get(ty) {
                    Ty::Error => TyId::ERROR,
                    Ty::Array { element, .. } => element,
                    _ => {
                        let name = self.display(ty);
                        self.report_diagnostic(
                            Diagnostic::new(
                                Code::E3001,
                                format!(
                                    "A `for` loop runs over a range `a..b` or an array, but this expression has type {name}."
                                ),
                            )
                            .at(array.span)
                            .expected("an array or a range")
                            .actual(name),
                        );
                        TyId::ERROR
                    }
                };
                self.fold_in_body(array);
                element
            }
        };
        if let Some(def) = self.res.def_of(stmt.id) {
            self.out.locals.insert(def, var_ty);
            let what = format!("the loop variable '{}'", stmt.var.name);
            self.cpu_only_site(stmt.var.span, what, var_ty);
        }
        // How the body leaves concerns the loop only.
        self.block(&stmt.body);
    }

    /// `return;` or `return value;` against the function's result type.
    fn return_stmt(&mut self, span: Span, value: Option<&Expr>) {
        let Some((name, ret)) = self.body.as_ref().map(|b| (b.name.clone(), b.ret)) else {
            if let Some(value) = value {
                self.check(value, None);
            }
            return;
        };
        let ret_name = self.display(ret);
        match value {
            None if ret != TyId::UNIT && !self.out.interner.is_error(ret) => {
                self.report_diagnostic(
                    Diagnostic::new(
                        Code::E3001,
                        format!("The function '{name}' returns {ret_name}, but this `return` gives no value."),
                    )
                    .at(span)
                    .expected(ret_name)
                    .actual("()"),
                );
            }
            None => {}
            Some(value) if ret == TyId::UNIT => {
                let ty = self.check(value, None);
                self.fold_in_body(value);
                let actual = self.display(ty);
                self.report_diagnostic(
                    Diagnostic::new(
                        Code::E3001,
                        format!("The function '{name}' has no result type, so its `return` takes no value."),
                    )
                    .at(value.span)
                    .expected("()")
                    .actual(actual)
                    .help(format!("declare the result type: `fn {name}(…) -> T`, or write `return;`")),
                );
            }
            Some(value) => {
                let ty = self.value(value, Some(ret));
                if !self.out.interner.assignable(ty, ret) {
                    let actual = self.display(ty);
                    self.report_diagnostic(
                        Diagnostic::new(
                            Code::E3001,
                            format!(
                                "The function '{name}' returns {ret_name}, but this value has type {actual}."
                            ),
                        )
                        .at(value.span)
                        .expected(ret_name)
                        .actual(actual),
                    );
                }
                self.fold_in_body(value);
            }
        }
    }

    // ----- assignments -----------------------------------------------------

    /// `place = value;` and `place op= value;` (section 7.2).
    fn assign(&mut self, stmt: &AssignStmt) {
        let place_ty = self.check(&stmt.target, None);
        let root = self.place(&stmt.target);
        if let (Some(var), Some(body)) = (root, &mut self.body) {
            body.assigned.insert(var);
        }
        let Some(arith) = (match stmt.op {
            AssignOp::Assign => None,
            AssignOp::Add => arith_op(crate::syntax::ast::BinaryOp::Add),
            AssignOp::Sub => arith_op(crate::syntax::ast::BinaryOp::Sub),
            AssignOp::Mul => arith_op(crate::syntax::ast::BinaryOp::Mul),
            AssignOp::Div => arith_op(crate::syntax::ast::BinaryOp::Div),
        }) else {
            let ty = self.value(&stmt.value, Some(place_ty));
            if !self.out.interner.assignable(ty, place_ty) {
                let (place_name, actual) = (self.display(place_ty), self.display(ty));
                self.report_diagnostic(
                    Diagnostic::new(
                        Code::E3001,
                        format!("Cannot assign a value of type {actual} to a place of type {place_name}."),
                    )
                    .at(stmt.value.span)
                    .expected(place_name)
                    .actual(actual),
                );
            }
            self.fold_in_body(&stmt.value);
            return;
        };
        let value_ty = if let Some(kind) = literal_kind(&stmt.value) {
            let target = self.operand_literal_target(arith, place_ty, kind, true);
            self.assign_literal(&stmt.value, target);
            target
        } else {
            let expected = matches!(
                arith,
                super::value::ArithOp::Add | super::value::ArithOp::Sub
            )
            .then_some(place_ty);
            self.value(&stmt.value, expected)
        };
        let result = self.arithmetic_type(stmt.op_span, arith, place_ty, value_ty);
        if result != place_ty && !self.out.interner.is_error(result) {
            let (place_name, value_name, result_name) = (
                self.display(place_ty),
                self.display(value_ty),
                self.display(result),
            );
            self.report_diagnostic(
                Diagnostic::new(
                    Code::E3001,
                    format!(
                        "`{}` on {place_name} and {value_name} gives {result_name}, which cannot be assigned to a place of type {place_name}.",
                        stmt.op.symbol()
                    ),
                )
                .at(stmt.span)
                .expected(place_name)
                .actual(result_name),
            );
        }
        self.fold_in_body(&stmt.value);
    }

    /// Check that `target` is an assignable place (section 7.2): a `var`
    /// local, or a single component of a vector that is one. Reports `E3061`
    /// or `E3060` otherwise. Returns the `var` local the place belongs to,
    /// if there is one (also when the place has an error, so that it does
    /// not count as never assigned).
    fn place(&mut self, target: &Expr) -> Option<DefId> {
        match &target.kind {
            ExprKind::Paren(inner) => self.place(inner),
            ExprKind::Name(_) => match self.res.res(target.id) {
                Some(Res::Def(id)) => {
                    let def = self.res.def(id)?.clone();
                    match def.kind {
                        DefKind::Local { mutable: true } => Some(id),
                        DefKind::Local { mutable: false }
                        | DefKind::FnParam
                        | DefKind::LoopVar
                        | DefKind::Const
                        | DefKind::State
                        | DefKind::Param => {
                            self.report_immutable(target.span, &def);
                            None
                        }
                        DefKind::Import => {
                            if self
                                .res
                                .import_target(id)
                                .is_some_and(|t| t.kind == DefKind::Const)
                            {
                                self.report_immutable(target.span, &def);
                            }
                            None
                        }
                        // Not values: reported as `E3001` when the target was
                        // typed.
                        _ => None,
                    }
                }
                _ => None,
            },
            ExprKind::Field { base, name } => match self.fields.get(&target.id).cloned() {
                Some(FieldKind::Components(indices)) => {
                    let base_ty = self.ty_of(base.id).unwrap_or(TyId::ERROR);
                    if indices.len() > 1 {
                        let root = self.place_root(base);
                        self.report_diagnostic(
                            Diagnostic::new(
                                Code::E3060,
                                format!(
                                    "Assigning to the swizzle '.{}' is not supported in v0.1.",
                                    name.name
                                ),
                            )
                            .at(target.span)
                            .help("assign the components one at a time: `v.x = …; v.y = …;`"),
                        );
                        return root;
                    }
                    if self.out.interner.vector_dim(base_ty).is_some() {
                        return self.place(base);
                    }
                    let type_name = self.display(base_ty);
                    let root = self.place_root(base);
                    self.report_not_a_place(
                        target.span,
                        format!(
                            "Cannot assign to a component of a {type_name} value: only single components of vectors are assignable."
                        ),
                        None,
                    );
                    root
                }
                Some(FieldKind::StructField(field)) => {
                    let root = self.place_root(base);
                    self.report_not_a_place(
                        target.span,
                        format!(
                            "Cannot assign to the field '{field}': struct fields are not assignable places in v0.1."
                        ),
                        Some("assign a whole new struct value to the variable instead"),
                    );
                    root
                }
                Some(_) => {
                    self.report_not_a_place(
                        target.span,
                        "This field is not an assignable place.".to_owned(),
                        None,
                    );
                    None
                }
                // The field access has an error, reported when it was typed.
                None => self.place_root(base),
            },
            ExprKind::Index { base, .. } => {
                let root = self.place_root(base);
                let base_ty = self.ty_of(base.id).unwrap_or(TyId::ERROR);
                if !self.out.interner.is_error(base_ty) {
                    let what = if self.out.interner.get(base_ty) == Ty::Mat4 {
                        "a column of a mat4"
                    } else {
                        "an element of an array"
                    };
                    self.report_not_a_place(
                        target.span,
                        format!(
                            "Cannot assign to {what}: indexed places are not assignable in v0.1."
                        ),
                        Some("assign a whole new value to the variable instead"),
                    );
                }
                root
            }
            ExprKind::Error => None,
            _ => {
                let ty = self.ty_of(target.id).unwrap_or(TyId::ERROR);
                if !self.out.interner.is_error(ty) {
                    self.report_not_a_place(
                        target.span,
                        "This expression is not an assignable place.".to_owned(),
                        None,
                    );
                }
                None
            }
        }
    }

    /// The `var` local an expression is rooted in, without reporting.
    fn place_root(&self, expr: &Expr) -> Option<DefId> {
        let mut current = expr;
        loop {
            match &current.kind {
                ExprKind::Paren(inner) => current = inner,
                ExprKind::Field { base, .. } | ExprKind::Index { base, .. } => current = base,
                ExprKind::Name(_) => {
                    return match self.res.res(current.id) {
                        Some(Res::Def(id))
                            if self
                                .res
                                .def(id)
                                .is_some_and(|d| d.kind == DefKind::Local { mutable: true }) =>
                        {
                            Some(id)
                        }
                        _ => None,
                    };
                }
                _ => return None,
            }
        }
    }

    /// `E3061` for an assignment to the immutable declaration `def`.
    fn report_immutable(&mut self, span: Span, def: &Def) {
        let name = &def.name;
        let (message, help) = match def.kind {
            DefKind::Local { mutable: false } => (
                format!("Cannot assign to the local '{name}': it is declared with `let`."),
                Some("declare it with `var` to assign to it"),
            ),
            DefKind::FnParam => (
                format!("Cannot assign to the parameter '{name}': parameters are immutable."),
                Some("copy it into a `var` local and assign to that"),
            ),
            DefKind::LoopVar => (
                format!(
                    "Cannot assign to the loop variable '{name}': loop variables are immutable."
                ),
                None,
            ),
            DefKind::Const | DefKind::Import => {
                (format!("Cannot assign to the constant '{name}'."), None)
            }
            kind => (
                format!("Cannot assign to the {} '{name}'.", kind.noun()),
                None,
            ),
        };
        let noun = match def.kind {
            DefKind::Import => "constant",
            kind => kind.noun(),
        };
        let mut diagnostic = Diagnostic::new(Code::E3061, message)
            .at(span)
            .related(def.span, format!("the {noun} '{name}' is declared here"));
        if let Some(help) = help {
            diagnostic = diagnostic.help(help);
        }
        self.report_diagnostic(diagnostic);
    }

    /// `E3061` for a target that is not an assignable place at all.
    fn report_not_a_place(&mut self, span: Span, message: String, help: Option<&str>) {
        let mut diagnostic = Diagnostic::new(Code::E3061, message).at(span).note(
            "assignable places are `var` locals and single components of vector `var` locals",
        );
        if let Some(help) = help {
            diagnostic = diagnostic.help(help);
        }
        self.report_diagnostic(diagnostic);
    }
}
