//! Lowering functions to the typed IR (decision 0038): parameters and
//! locals into one table, statements and expressions with their types,
//! every constant expression as its folded value. Like the rest of the
//! lowering it only reshapes what the checker computed; a node it cannot
//! represent is a compiler defect.

use std::collections::BTreeMap;

use super::lower::{Defect, Lowering};
use super::model::{
    Block, Branch, Expr, ExprKind, Function, LocalItem, LocalKind, NamedExpr, Place, Stmt, Symbol,
};
use crate::resolve::{DefId, DefKind, Res};
use crate::syntax::ast::{self, ElseBranch, ExprKind as AstExpr, FieldValue, ForIter};
use crate::types::{CallKind, EffectLevel, FieldKind, FnRef, Ty, TyId};

/// The state of one function's lowering: its locals so far.
struct FnLowering<'l, 'a> {
    lowering: &'l Lowering<'a>,
    /// The function's name, for defect messages.
    name: String,
    locals: Vec<LocalItem>,
    index: BTreeMap<DefId, u32>,
}

impl Lowering<'_> {
    /// The function `decl` with its typed body.
    pub(super) fn function(&self, decl: &ast::FnDecl, symbol: Symbol) -> Result<Function, Defect> {
        let name = decl.name.name.clone();
        let def = self
            .resolution
            .def_of(decl.id)
            .ok_or_else(|| format!("function '{name}' has no declaration"))?;
        let info = self
            .types
            .function(def)
            .ok_or_else(|| format!("function '{name}' was not checked"))?;
        let effect = self
            .effects
            .get(FnRef {
                module: self.module,
                def,
            })
            .ok_or_else(|| format!("function '{name}' has no effects"))?;
        let mut lowering = FnLowering {
            lowering: self,
            name: name.clone(),
            locals: Vec::new(),
            index: BTreeMap::new(),
        };
        if info.sig.params.len() != decl.params.len() {
            return Err(format!("function '{name}' has parameters with errors"));
        }
        for (param, (_, ty)) in decl.params.iter().zip(&info.sig.params) {
            let param_def = self
                .resolution
                .def_of(param.id)
                .ok_or_else(|| format!("a parameter of '{name}' has no declaration"))?;
            lowering.declare(param_def, &param.name, *ty, LocalKind::Param)?;
        }
        let body = lowering.block(&decl.body)?;
        Ok(Function {
            name,
            symbol,
            effect: match effect.level {
                EffectLevel::Pure => "pure",
                EffectLevel::Cpu => "cpu",
            },
            gpu_reachable: effect.gpu_reachable,
            cpu_reachable: effect.cpu_reachable,
            result: (info.sig.ret != TyId::UNIT).then(|| self.types.display(info.sig.ret)),
            locals: lowering.locals,
            body,
            span: decl.span,
        })
    }
}

impl FnLowering<'_, '_> {
    fn defect(&self, what: &str) -> Defect {
        format!("function '{}': {what}", self.name)
    }

    fn display(&self, ty: TyId) -> String {
        self.lowering.types.display(ty)
    }

    /// Add a local to the table.
    fn declare(
        &mut self,
        def: DefId,
        name: &ast::Ident,
        ty: TyId,
        kind: LocalKind,
    ) -> Result<u32, Defect> {
        if self.lowering.types.interner().is_error(ty) {
            return Err(self.defect(&format!("the local '{}' has no type", name.name)));
        }
        let index = u32::try_from(self.locals.len()).map_err(|_| self.defect("too many locals"))?;
        self.locals.push(LocalItem {
            index,
            name: name.name.clone(),
            ty: self.display(ty),
            kind,
            span: name.span,
        });
        self.index.insert(def, index);
        Ok(index)
    }

    /// Declare the local of the declaration node `node`.
    fn declare_node(
        &mut self,
        node: ast::NodeId,
        name: &ast::Ident,
        kind: LocalKind,
    ) -> Result<u32, Defect> {
        let def =
            self.lowering.resolution.def_of(node).ok_or_else(|| {
                self.defect(&format!("the local '{}' has no declaration", name.name))
            })?;
        let ty =
            self.lowering.types.local_ty(def).ok_or_else(|| {
                self.defect(&format!("the local '{}' was not checked", name.name))
            })?;
        self.declare(def, name, ty, kind)
    }

    fn block(&mut self, block: &ast::Block) -> Result<Block, Defect> {
        let mut stmts = Vec::with_capacity(block.stmts.len());
        for stmt in &block.stmts {
            stmts.push(self.stmt(stmt)?);
        }
        Ok(Block {
            stmts,
            span: block.span,
        })
    }

    fn stmt(&mut self, stmt: &ast::Stmt) -> Result<Stmt, Defect> {
        Ok(match stmt {
            ast::Stmt::Let(decl) | ast::Stmt::Var(decl) => {
                let value = self.expr(&decl.value)?;
                let mutable = matches!(stmt, ast::Stmt::Var(_));
                let kind = if mutable {
                    LocalKind::Var
                } else {
                    LocalKind::Let
                };
                let local = self.declare_node(decl.id, &decl.name, kind)?;
                if mutable {
                    Stmt::Var {
                        local,
                        value,
                        span: decl.span,
                    }
                } else {
                    Stmt::Let {
                        local,
                        value,
                        span: decl.span,
                    }
                }
            }
            ast::Stmt::Const(decl) => {
                let constant = self
                    .lowering
                    .constant(decl, Symbol::item("", &decl.name.name))?;
                Stmt::Const {
                    name: constant.name,
                    ty: constant.ty,
                    value: constant.value,
                    span: decl.span,
                }
            }
            ast::Stmt::If(stmt) => {
                // An `else if` chain is a loop here, not recursion.
                let mut branches = Vec::new();
                let mut otherwise = None;
                let mut current = stmt;
                loop {
                    branches.push(Branch {
                        cond: self.expr(&current.cond)?,
                        body: self.block(&current.then_block)?,
                    });
                    match &current.else_branch {
                        None => break,
                        Some(ElseBranch::Block(block)) => {
                            otherwise = Some(self.block(block)?);
                            break;
                        }
                        Some(ElseBranch::If(next)) => current = next,
                    }
                }
                Stmt::If {
                    branches,
                    otherwise,
                    span: stmt.span,
                }
            }
            ast::Stmt::For(stmt) => match &stmt.iter {
                ForIter::Range { start, end } => {
                    let start = self.expr(start)?;
                    let end = self.expr(end)?;
                    let local = self.declare_node(stmt.id, &stmt.var, LocalKind::Loop)?;
                    Stmt::ForRange {
                        local,
                        start,
                        end,
                        body: self.block(&stmt.body)?,
                        span: stmt.span,
                    }
                }
                ForIter::Each(array) => {
                    let array = self.expr(array)?;
                    let local = self.declare_node(stmt.id, &stmt.var, LocalKind::Loop)?;
                    Stmt::ForEach {
                        local,
                        array,
                        body: self.block(&stmt.body)?,
                        span: stmt.span,
                    }
                }
            },
            ast::Stmt::Return(ret) => Stmt::Return {
                value: ret.value.as_ref().map(|v| self.expr(v)).transpose()?,
                span: ret.span,
            },
            ast::Stmt::Break(jump) => Stmt::Break { span: jump.span },
            ast::Stmt::Continue(jump) => Stmt::Continue { span: jump.span },
            ast::Stmt::Block(block) => Stmt::Block {
                body: self.block(block)?,
            },
            ast::Stmt::Assign(assign) => Stmt::Assign {
                target: self.place(&assign.target)?,
                op: assign.op.symbol(),
                value: self.expr(&assign.value)?,
                span: assign.span,
            },
            ast::Stmt::Expr(stmt) => Stmt::Expr {
                expr: self.expr(&stmt.expr)?,
                span: stmt.span,
            },
            ast::Stmt::Error(_) => return Err(self.defect("a statement with a syntax error")),
        })
    }

    /// An assignment target: a `var` local or one component of a vector
    /// place (the checker accepted nothing else).
    fn place(&self, target: &ast::Expr) -> Result<Place, Defect> {
        match &target.kind {
            AstExpr::Paren(inner) => self.place(inner),
            AstExpr::Name(_) => {
                let local = self.local_of(target)?;
                let ty = self
                    .locals
                    .get(local as usize)
                    .map(|l| l.ty.clone())
                    .unwrap_or_default();
                Ok(Place::Local { local, ty })
            }
            AstExpr::Field { base, .. } => match self.lowering.types.field_kind(target.id) {
                Some(FieldKind::Components(indices)) if indices.len() == 1 => {
                    let index = indices.first().copied().unwrap_or(0);
                    Ok(Place::Component {
                        base: Box::new(self.place(base)?),
                        index: u32::try_from(index).unwrap_or(0),
                    })
                }
                _ => Err(self.defect("an assignment to a place that is not assignable")),
            },
            _ => Err(self.defect("an assignment to a place that is not assignable")),
        }
    }

    /// The local a name refers to.
    fn local_of(&self, name: &ast::Expr) -> Result<u32, Defect> {
        match self.lowering.resolution.res(name.id) {
            Some(Res::Def(def)) => self
                .index
                .get(&def)
                .copied()
                .ok_or_else(|| self.defect("a name that is neither a local nor folded")),
            _ => Err(self.defect("an unresolved name")),
        }
    }

    fn expr(&self, expr: &ast::Expr) -> Result<Expr, Defect> {
        let types = self.lowering.types;
        let ty = types
            .ty(expr.id)
            .filter(|t| !types.interner().is_error(*t))
            .ok_or_else(|| self.defect("an expression without a type"))?;
        let make = |kind: ExprKind| Expr {
            kind,
            ty: self.display(ty),
            span: expr.span,
        };
        if let Some(value) = types.value(expr.id) {
            return Ok(make(ExprKind::Const {
                value: value.into(),
            }));
        }
        let boxed = |e: &ast::Expr| self.expr(e).map(Box::new);
        let list = |items: &[ast::Expr]| -> Result<Vec<Expr>, Defect> {
            items.iter().map(|item| self.expr(item)).collect()
        };
        Ok(match &expr.kind {
            AstExpr::Paren(inner) => return self.expr(inner),
            AstExpr::Name(_) => make(ExprKind::Local {
                local: self.local_of(expr)?,
                name: self.lowering.text_name(expr),
            }),
            AstExpr::Unary { op, operand } => make(ExprKind::Unary {
                op: op.symbol(),
                operand: boxed(operand)?,
            }),
            AstExpr::Binary { op, lhs, rhs, .. } => make(ExprKind::Binary {
                op: op.symbol(),
                lhs: boxed(lhs)?,
                rhs: boxed(rhs)?,
            }),
            AstExpr::Call { args, .. } => match types.call_kind(expr.id) {
                Some(CallKind::UserFunction { def, .. }) => make(ExprKind::Call {
                    function: self.lowering.function_symbol(*def)?,
                    args: list(args)?,
                }),
                Some(CallKind::Intrinsic { name, .. }) => make(ExprKind::Builtin {
                    function: (*name).to_owned(),
                    args: list(args)?,
                }),
                Some(CallKind::Namespace {
                    namespace, member, ..
                }) => make(ExprKind::Builtin {
                    function: format!("{namespace}.{member}"),
                    args: list(args)?,
                }),
                Some(CallKind::Vector(_)) => make(ExprKind::Construct { args: list(args)? }),
                Some(CallKind::Conversion(_)) => match args.as_slice() {
                    [arg] => make(ExprKind::Convert { arg: boxed(arg)? }),
                    _ => return Err(self.defect("a conversion without one argument")),
                },
                None => return Err(self.defect("a call that was not resolved")),
            },
            AstExpr::Field { base, name } => match types.field_kind(expr.id) {
                Some(FieldKind::Components(indices)) => make(ExprKind::Components {
                    base: boxed(base)?,
                    components: indices
                        .iter()
                        .map(|i| u32::try_from(*i).unwrap_or(0))
                        .collect(),
                }),
                Some(FieldKind::StructField(field)) => {
                    let base_ty = types.ty(base.id).unwrap_or(TyId::ERROR);
                    let index = types
                        .interner()
                        .struct_def(base_ty)
                        .and_then(|def| def.fields.iter().position(|(f, _)| f == field))
                        .and_then(|i| u32::try_from(i).ok())
                        .ok_or_else(|| self.defect(&format!("an unknown field '{}'", name.name)))?;
                    make(ExprKind::Field {
                        base: boxed(base)?,
                        field: field.clone(),
                        index,
                    })
                }
                _ => return Err(self.defect("a field read this build does not lower")),
            },
            AstExpr::Index { base, index } => make(ExprKind::Index {
                base: boxed(base)?,
                index: boxed(index)?,
            }),
            AstExpr::Array(items) => make(ExprKind::Array {
                elements: list(items)?,
            }),
            AstExpr::Descriptor { name, fields } => {
                let written: Vec<(&str, &ast::Expr)> = fields
                    .iter()
                    .filter_map(|field| match &field.value {
                        FieldValue::Expr(value) => Some((field.name.name.as_str(), &**value)),
                        FieldValue::Bind(_) => None,
                    })
                    .collect();
                match types.interner().get(ty) {
                    Ty::Struct(_) => {
                        let declared = types
                            .interner()
                            .struct_def(ty)
                            .ok_or_else(|| self.defect("a struct literal of an unknown struct"))?;
                        let mut out = Vec::with_capacity(declared.fields.len());
                        for (field, _) in &declared.fields {
                            let value = written
                                .iter()
                                .find(|(n, _)| n == field)
                                .map(|(_, v)| *v)
                                .ok_or_else(|| {
                                self.defect("a struct literal with a missing field")
                            })?;
                            out.push(NamedExpr {
                                name: field.clone(),
                                value: self.expr(value)?,
                            });
                        }
                        make(ExprKind::Struct { fields: out })
                    }
                    Ty::Schema(schema) => {
                        let mut out = Vec::with_capacity(written.len());
                        for (field, value) in written {
                            out.push(NamedExpr {
                                name: field.to_owned(),
                                value: self.expr(value)?,
                            });
                        }
                        make(ExprKind::Descriptor {
                            schema: schema.to_owned(),
                            fields: out,
                        })
                    }
                    _ => {
                        return Err(self.defect(&format!(
                            "a descriptor literal '{}' of a type this build does not lower",
                            name.name
                        )));
                    }
                }
            }
            AstExpr::Int { .. }
            | AstExpr::Float { .. }
            | AstExpr::Str { .. }
            | AstExpr::Color { .. }
            | AstExpr::Bool(_) => return Err(self.defect("a literal that was not folded")),
            AstExpr::SelfValue | AstExpr::Error => {
                return Err(self.defect("an expression this build does not lower"));
            }
        })
    }
}

impl Lowering<'_> {
    /// The symbol of the function a call resolved to: a `fn` of this module
    /// or an imported one (named after the module that declares it).
    pub(super) fn function_symbol(&self, def: DefId) -> Result<Symbol, Defect> {
        let decl = self
            .resolution
            .def(def)
            .ok_or("a call of an unknown declaration")?;
        match decl.kind {
            DefKind::Fn => Ok(Symbol::item(self.path, &decl.name)),
            DefKind::Import => {
                let target = self
                    .resolution
                    .import_target(def)
                    .ok_or("a call of an unbound import")?;
                let path = self
                    .paths
                    .get(&target.module)
                    .ok_or("a call into a module without a path")?;
                Ok(Symbol::item(path, &decl.name))
            }
            _ => Err("a call of something that is not a function".to_owned()),
        }
    }

    /// The name a name expression refers to, as declared.
    fn text_name(&self, expr: &ast::Expr) -> String {
        match &expr.kind {
            AstExpr::Name(name) => name.clone(),
            _ => String::new(),
        }
    }
}
