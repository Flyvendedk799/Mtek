//! CPU lowering: the typed IR's functions to the JavaScript AST
//! (`spec/compiler-architecture.md` section 6, `spec/runtime-abi.md` sections 3 and 4.1,
//! decision 0040).
//!
//! Every function the IR marks `cpuReachable` becomes a module-private
//! `function f_<hash8>_<name>(ctx, a_<param>, …)`, registered in `functions` by its symbol.
//! Parameters are `a_<name>`, locals and loop variables `l_<name>` (Mtek forbids shadowing, so
//! a name means one local wherever it is visible; sibling blocks that reuse a name get
//! separate JavaScript block scopes), compiler temporaries `t_<n>`.
//!
//! Numeric discipline (`spec/language.md` sections 6.2–6.5, decision 0037):
//!
//! - `f32` `+ - * / %` are `fr(a op b)` (`const fr = Math.fround;`), unary minus `-a` (exact);
//! - `i32` `+ -` are `(a op b) | 0`, `*` is `Math.imul(a, b)`, `/ %` are `rt.idiv`/`rt.irem`,
//!   unary minus `-a | 0`; `u32` the same with `>>> 0` and `rt.udiv`/`rt.urem`;
//! - conversions: `f32(x)` of an integer `fr(x)`, `i32(x)`/`u32(x)` of an `f32`
//!   `rt.f2i`/`rt.f2u`, between `i32` and `u32` `x >>> 0` / `x | 0`, same type the value;
//! - comparisons are JavaScript's (`==` is `===`, so `-0 == 0` and `NaN != NaN`), `&&`/`||`
//!   short-circuit;
//! - every other operation calls the `rt` helper of [`super::rt_ops`];
//! - swizzles construct new values (`rt.swizzle3(v, "z", "y", "x")`, `rt.crgb(c)`); a
//!   component assignment builds a new vector (`l_v = rt.v3with(l_v, "y", value)`);
//! - struct fields and array elements of a `var` are written in place (decision 0045): such a
//!   variable owns its storage, so a value stored into it is copied (`rt.copy`) unless it is
//!   fresh, and an array or struct read out of it is copied before it is used elsewhere; every
//!   other value is never changed once built and is shared freely;
//! - a constant index reads directly (it is in range, `E3030`), a run-time index goes through
//!   `rt.clampIndex(i, N, spanId, ctx)`, `spanId` being the index expression's entry in the
//!   manifest `spans` table;
//! - constants are the folded values, `f32` printed as the binary64 text of the binary32
//!   value ([`super::ast::Number`]).
//!
//! Every statement and expression carries its Mtek span into the source map.

use std::collections::BTreeSet;

use crate::ir::{self, Item, LocalKind, Place, Program, Symbol};
use crate::layout::naming::hash8;
use crate::source::Span;

use super::ast::{Expr, Number, Stmt};
use super::printer::identifier_part;
use super::program::value_expr;
use super::rt_ops;

/// The emitted functions of a program.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EmittedFunctions {
    /// Per function: a comment naming it and its `function` statement, in program order
    /// (modules in load order, items in source order).
    pub stmts: Vec<Stmt>,
    /// `(symbol, JavaScript name)` of every emitted function, in the same order: the entries
    /// of `functions`.
    pub table: Vec<(Symbol, String)>,
}

/// The JavaScript name of the function `symbol` (`path::name`): `f_<hash8>_<name>`, module
/// qualified like the writers (`spec/gpu-layout.md` section 5), so equal names in two modules
/// never collide.
///
/// # Errors
/// A text describing the defect when `symbol` is not a module item's symbol.
pub fn function_name(symbol: &Symbol) -> Result<String, String> {
    let (path, name) = symbol
        .as_str()
        .rsplit_once("::")
        .filter(|(path, name)| !path.is_empty() && !name.is_empty())
        .ok_or_else(|| format!("'{symbol}' is not the symbol of a module item"))?;
    Ok(format!("f_{}_{}", hash8(path), identifier_part(name)))
}

/// Lowers every `cpuReachable` function of `program`. `span_id` gives the manifest span id of
/// a source span (index clamping reports its call site by span id).
///
/// # Errors
/// A text describing a compiler defect: an IR node the CPU emitter does not know.
pub fn emit_functions(
    program: &Program,
    span_id: &mut dyn FnMut(Span) -> Result<u32, String>,
) -> Result<EmittedFunctions, String> {
    let mut emitted = EmittedFunctions::default();
    for module in &program.modules {
        for item in &module.items {
            let Item::Function(function) = item else {
                continue;
            };
            if !function.cpu_reachable {
                continue;
            }
            let name = function_name(&function.symbol)?;
            let mut lowering = FnLowering {
                locals: &function.locals,
                owner: None,
                release: false,
                temps: 0,
                span_id: &mut *span_id,
                owned: owned_vars(&function.body),
            };
            let body = lowering
                .block(&function.body)
                .map_err(|e| format!("function '{}': {e}", function.symbol))?;
            let mut params = vec!["ctx".to_owned()];
            params.extend(function.params().map(local_name));
            let signature = function
                .params()
                .map(|p| format!("{}: {}", p.name, p.ty))
                .collect::<Vec<_>>()
                .join(", ");
            let keyword = if function.effect == "cpu" {
                "cpu fn"
            } else {
                "fn"
            };
            let result = function
                .result
                .as_ref()
                .map(|r| format!(" -> {r}"))
                .unwrap_or_default();
            emitted.stmts.push(Stmt::Blank);
            emitted.stmts.push(Stmt::Comment(format!(
                "{keyword} {}({signature}){result} ({})",
                function.name, function.symbol
            )));
            emitted.stmts.push(Stmt::Function {
                name: name.clone(),
                params,
                body,
                span: Some(function.span),
            });
            emitted.table.push((function.symbol.clone(), name));
        }
    }
    Ok(emitted)
}

/// The JavaScript binding of a parameter (`a_`) or local (`l_`).
fn local_name(local: &ir::LocalItem) -> String {
    let prefix = if local.kind == LocalKind::Param {
        "a_"
    } else {
        "l_"
    };
    format!("{prefix}{}", identifier_part(&local.name))
}

/// `rt.name(arguments)`.
fn rt(name: &str, arguments: Vec<Expr>) -> Expr {
    Expr::ident("rt").member(name).call(arguments)
}

/// `fr(value)`: the binary32 rounding of an `f32` result.
fn fround(value: Expr) -> Expr {
    Expr::ident("fr").call(vec![value])
}

fn int(value: i32) -> Expr {
    Expr::Num(Number::I32(value))
}

/// The component names of a vector, `quat` or `color` type.
fn component_names(ty: &str) -> Option<&'static [&'static str]> {
    match ty {
        "vec2" => Some(&["x", "y"]),
        "vec3" => Some(&["x", "y", "z"]),
        "vec4" | "quat" => Some(&["x", "y", "z", "w"]),
        "color" => Some(&["r", "g", "b", "a"]),
        _ => None,
    }
}

/// The length `N` of `array<T, N>`, or 4 for the columns of a `mat4`.
fn indexed_length(ty: &str) -> Option<u32> {
    if ty == "mat4" {
        return Some(4);
    }
    let inner = ty.strip_prefix("array<")?.strip_suffix('>')?;
    let (_, length) = inner.rsplit_once(", ")?;
    length.parse().ok()
}

struct FnLowering<'f, 's> {
    /// The parameters and locals of the body: a function's, or a lifecycle function's or
    /// handler's.
    locals: &'f [ir::LocalItem],
    /// The scene or entity whose behaviour this is: `self` inside an entity's own body.
    owner: Option<ir::Owner>,
    /// A release build: `print` is compiled out.
    release: bool,
    /// Temporaries used so far (`t_0`, `t_1`, …).
    temps: u32,
    span_id: &'s mut dyn FnMut(Span) -> Result<u32, String>,
    /// The `var` locals written through a field or element ([`owned_vars`]).
    owned: BTreeSet<u32>,
}

/// Whether values of the IR type `ty` are JavaScript arrays or objects that an element or
/// field write changes in place: arrays and structs (spelled by their symbol, decision 0041).
fn is_aggregate(ty: &str) -> bool {
    ty.starts_with("array<") || ty.contains("::")
}

/// The value of an index that folded to a constant (a negative one is never in range).
fn constant_index(index: &ir::Expr) -> Option<u32> {
    match &index.kind {
        ir::ExprKind::Const {
            value: ir::Value::I32(k),
        } => Some(u32::try_from(*k).unwrap_or(u32::MAX)),
        ir::ExprKind::Const {
            value: ir::Value::U32(k),
        } => Some(*k),
        _ => None,
    }
}

/// The `var` locals of `body` that some assignment writes through a field or an element
/// (decision 0045). Each owns its storage: it is written in place, so whatever is stored into
/// it is a value no other binding refers to (a copy unless it is fresh), and an array or
/// struct read out of it is copied before it goes anywhere else. Every other value is never
/// changed once built, so it is shared freely. Blocks nest no deeper than the parser allows.
fn owned_vars(body: &ir::Block) -> BTreeSet<u32> {
    fn visit(block: &ir::Block, out: &mut BTreeSet<u32>) {
        for stmt in &block.stmts {
            match stmt {
                ir::Stmt::Assign { target, .. } => {
                    let partial = target.steps.iter().any(|step| {
                        matches!(
                            step,
                            ir::PlaceStep::Field { .. } | ir::PlaceStep::Index { .. }
                        )
                    });
                    if let ir::PlaceRoot::Local { local, .. } = &target.root
                        && partial
                    {
                        out.insert(*local);
                    }
                }
                ir::Stmt::If {
                    branches,
                    otherwise,
                    ..
                } => {
                    for branch in branches {
                        visit(&branch.body, out);
                    }
                    if let Some(block) = otherwise {
                        visit(block, out);
                    }
                }
                ir::Stmt::ForRange { body, .. } | ir::Stmt::ForEach { body, .. } => {
                    visit(body, out);
                }
                ir::Stmt::Block { body } => visit(body, out),
                _ => {}
            }
        }
    }
    let mut out = BTreeSet::new();
    visit(body, &mut out);
    out
}

impl FnLowering<'_, '_> {
    fn local(&self, index: u32) -> Result<&ir::LocalItem, String> {
        self.locals
            .get(index as usize)
            .ok_or_else(|| format!("the local #{index} is not declared"))
    }

    fn local_ident(&self, index: u32) -> Result<String, String> {
        self.local(index).map(local_name)
    }

    fn temp(&mut self) -> String {
        let name = format!("t_{}", self.temps);
        self.temps += 1;
        name
    }

    fn block(&mut self, block: &ir::Block) -> Result<Vec<Stmt>, String> {
        let mut out = Vec::with_capacity(block.stmts.len());
        for stmt in &block.stmts {
            if let Some(lowered) = self.stmt(stmt)? {
                out.push(lowered);
            }
        }
        Ok(out)
    }

    fn stmt(&mut self, stmt: &ir::Stmt) -> Result<Option<Stmt>, String> {
        Ok(Some(match stmt {
            ir::Stmt::Let { local, value, span } => Stmt::Const {
                name: self.local_ident(*local)?,
                value: self.expr(value)?,
                span: Some(*span),
            },
            ir::Stmt::Var { local, value, span } => Stmt::Let {
                name: self.local_ident(*local)?,
                value: if self.owned.contains(local) {
                    self.stored(value)?
                } else {
                    self.expr(value)?
                },
                span: Some(*span),
            },
            // Its uses are folded; nothing to emit.
            ir::Stmt::Const { .. } => return Ok(None),
            ir::Stmt::Assign {
                target,
                op,
                value,
                span,
            } => self.assign(target, op, value, *span)?,
            ir::Stmt::If {
                branches,
                otherwise,
                span,
            } => {
                let mut lowered = Vec::with_capacity(branches.len());
                for branch in branches {
                    lowered.push((self.expr(&branch.cond)?, self.block(&branch.body)?));
                }
                Stmt::If {
                    branches: lowered,
                    otherwise: otherwise.as_ref().map(|b| self.block(b)).transpose()?,
                    span: Some(*span),
                }
            }
            ir::Stmt::ForRange {
                local,
                start,
                end,
                body,
                span,
            } => {
                let var = self.local_ident(*local)?;
                let start = self.expr(start)?;
                // A bound that is not a constant is evaluated once, before the first test.
                let limit = match end.kind {
                    ir::ExprKind::Const { .. } => None,
                    _ => Some(self.temp()),
                };
                let end = self.expr(end)?;
                Stmt::ForRange {
                    var,
                    start,
                    limit,
                    end,
                    body: self.block(body)?,
                    span: Some(*span),
                }
            }
            ir::Stmt::ForEach {
                local,
                array,
                body,
                span,
            } => Stmt::ForOf {
                var: self.local_ident(*local)?,
                iterable: self.expr(array)?,
                body: self.block(body)?,
                span: Some(*span),
            },
            // The function's variables end here: returned owned storage needs no copy.
            ir::Stmt::Return { value, span } => Stmt::Return {
                value: value.as_ref().map(|v| self.value(v)).transpose()?,
                span: Some(*span),
            },
            ir::Stmt::Break { span } => Stmt::Break { span: Some(*span) },
            ir::Stmt::Continue { span } => Stmt::Continue { span: Some(*span) },
            ir::Stmt::Block { body } => Stmt::Block {
                body: self.block(body)?,
            },
            ir::Stmt::Expr { expr, .. }
                if self.release
                    && matches!(&expr.kind, ir::ExprKind::Builtin { function, .. } if function == "print") =>
            {
                return Ok(None);
            }
            ir::Stmt::Expr { expr, span } => Stmt::Expr {
                expr: self.expr(expr)?,
                span: Some(*span),
            },
        }))
    }

    /// `target op= value` (decision 0045). The place is evaluated once, before the value: the
    /// containers on its path (fields and elements, a run-time index clamped with
    /// `rt.clampIndex` and the step's span) are written in place — the root is an owned `var`
    /// ([`owned_vars`]) — and a final vector component builds a new vector
    /// (`rt.v3with`). Where the place is read as well as written (a compound assignment or a
    /// component), each run-time index is computed once into a temporary first.
    fn assign(
        &mut self,
        target: &Place,
        op: &str,
        value: &ir::Expr,
        span: Span,
    ) -> Result<Stmt, String> {
        let (containers, component) = match target.steps.split_last() {
            Some((
                ir::PlaceStep::Component {
                    component, span, ..
                },
                rest,
            )) => (rest, Some((*component, *span))),
            _ => (target.steps.as_slice(), None),
        };
        let reads_place = op != "=" || component.is_some();
        let mut prelude = Vec::new();
        let (mut path, owned, root_ty) = match &target.root {
            ir::PlaceRoot::Local {
                local,
                ty,
                span: root_span,
                ..
            } => (
                Expr::Ident(self.local_ident(*local)?).spanned(*root_span),
                self.owned.contains(local),
                ty.as_str(),
            ),
            // State is the runtime's object: containers on the path are written in place.
            ir::PlaceRoot::State {
                owner,
                name,
                ty,
                span,
            } => (
                self.state_path(*owner, name).spanned(*span),
                true,
                ty.as_str(),
            ),
            // Entity and camera fields and material params are written through the context's
            // setters; with containers on the path the setter receives a copy of the value
            // with the write applied.
            root @ (ir::PlaceRoot::EntityField { ty, span, .. }
            | ir::PlaceRoot::CameraField { ty, span, .. }
            | ir::PlaceRoot::InstanceParam { ty, span, .. }) => {
                let current = self.root_read(root)?.spanned(*span);
                if containers.is_empty() {
                    (current, false, ty.as_str())
                } else {
                    let name = self.temp();
                    prelude.push(Stmt::Const {
                        name: name.clone(),
                        value: rt("copy", vec![current]).spanned(*span),
                        span: Some(*span),
                    });
                    (Expr::Ident(name), true, ty.as_str())
                }
            }
        };
        let mut path_ty = root_ty;
        for step in containers {
            path = match step {
                ir::PlaceStep::Field { field, .. } => path.member(field),
                ir::PlaceStep::Index { index, span, .. } => {
                    let length = indexed_length(path_ty)
                        .filter(|_| path_ty != "mat4")
                        .ok_or_else(|| {
                            format!("an element write into a value of type {path_ty}")
                        })?;
                    let position = match constant_index(index) {
                        Some(k) if k < length => Expr::Num(Number::U32(k)).spanned(index.span),
                        Some(k) => {
                            return Err(format!(
                                "the constant index {k} into {path_ty} is out of range"
                            ));
                        }
                        None => {
                            let clamped = self.clamped(index, length, *span)?;
                            if reads_place {
                                let name = self.temp();
                                prelude.push(Stmt::Const {
                                    name: name.clone(),
                                    value: clamped,
                                    span: Some(*span),
                                });
                                Expr::Ident(name)
                            } else {
                                clamped
                            }
                        }
                    };
                    Expr::Subscript(Box::new(path), Box::new(position))
                }
                ir::PlaceStep::Component { .. } => {
                    return Err("a vector component before the last step of a place".to_owned());
                }
            }
            .spanned(step.span());
            path_ty = step.ty();
        }
        let current = match component {
            Some((index, component_span)) => path
                .clone()
                .member(component_key(path_ty, index)?)
                .spanned(component_span),
            None => path.clone(),
        };
        let new_value = match op {
            "=" if owned && is_aggregate(&value.ty) => self.stored(value)?,
            "=" => self.expr(value)?,
            "+=" | "-=" | "*=" | "/=" => {
                let binary: &'static str = match op {
                    "+=" => "+",
                    "-=" => "-",
                    "*=" => "*",
                    _ => "/",
                };
                let lowered = self.expr(value)?;
                binary_op(binary, &target.ty, &value.ty, &target.ty, current, lowered)?
                    .spanned(span)
            }
            other => return Err(format!("the assignment operator '{other}'")),
        };
        let new_value = match component {
            Some((index, component_span)) => {
                let helper = match path_ty {
                    "vec2" => "v2with",
                    "vec3" => "v3with",
                    "vec4" => "v4with",
                    other => return Err(format!("a component assignment to a {other}")),
                };
                let key = component_key(path_ty, index)?;
                rt(helper, vec![path.clone(), Expr::string(key), new_value]).spanned(component_span)
            }
            None => new_value,
        };
        let setter_root = match &target.root {
            root @ (ir::PlaceRoot::EntityField { .. }
            | ir::PlaceRoot::CameraField { .. }
            | ir::PlaceRoot::InstanceParam { .. }) => Some(root),
            _ => None,
        };
        let finish = match setter_root {
            // No containers: the whole field is written through its setter.
            Some(root) if containers.is_empty() => self.setter(root, new_value, span)?,
            // Containers: the copy was changed in place; hand it to the setter.
            Some(root) => {
                let temp = match &path_root(&path) {
                    Some(name) => name.clone(),
                    None => return Err("a setter write without its copy".to_owned()),
                };
                prelude.push(Stmt::Assign {
                    target: path,
                    value: new_value,
                    span: Some(span),
                });
                self.setter(root, Expr::Ident(temp), span)?
            }
            None => Stmt::Assign {
                target: path,
                value: new_value,
                span: Some(span),
            },
        };
        if prelude.is_empty() {
            return Ok(finish);
        }
        prelude.push(finish);
        Ok(Stmt::Block { body: prelude })
    }

    /// `ctx.s.name` for scene state; `self.state.name` for an entity's own state inside its
    /// bodies, `ctx.e[i].state.name` elsewhere.
    fn state_path(&self, owner: ir::Owner, name: &str) -> Expr {
        match owner {
            ir::Owner::Scene => Expr::ident("ctx").member("s").member(name),
            ir::Owner::Entity { index } => self.entity(index).member("state").member(name),
        }
    }

    /// The entity record `index`: `self` inside its own bodies, `ctx.e[index]` elsewhere.
    fn entity(&self, index: u32) -> Expr {
        if self.owner == Some(ir::Owner::Entity { index }) {
            Expr::ident("self")
        } else {
            Expr::ident("ctx").member("e").index(index)
        }
    }

    /// The current value of a field or param root (`spec/runtime-abi.md` section 4.2: the
    /// records are read directly).
    fn root_read(&self, root: &ir::PlaceRoot) -> Result<Expr, String> {
        Ok(match root {
            ir::PlaceRoot::State { owner, name, .. } => self.state_path(*owner, name),
            ir::PlaceRoot::EntityField { entity, field, .. } => self.entity(*entity).member(field),
            ir::PlaceRoot::CameraField { field, .. } => {
                Expr::ident("ctx").member("cam").member(field)
            }
            ir::PlaceRoot::InstanceParam { entity, param, .. } => {
                self.entity(*entity).member("mat").member("p").member(param)
            }
            ir::PlaceRoot::Local { .. } => return Err("a local read as a root".to_owned()),
        })
    }

    /// `ctx.setTransform(e, "position", v)`, `ctx.setVisible(e, v)`, `ctx.setCamera("position", v)`
    /// or `ctx.setParam(e, "name", v)`: the context validates the value (`E8090`, `E8100`).
    fn setter(&self, root: &ir::PlaceRoot, value: Expr, span: Span) -> Result<Stmt, String> {
        let call = match root {
            ir::PlaceRoot::EntityField { entity, field, .. } => match field.as_str() {
                "position" | "rotation" | "scale" => Expr::ident("ctx")
                    .member("setTransform")
                    .call(vec![self.entity(*entity), Expr::string(field), value]),
                "visible" => Expr::ident("ctx")
                    .member("setVisible")
                    .call(vec![self.entity(*entity), value]),
                other => return Err(format!("a write to the entity field '{other}'")),
            },
            ir::PlaceRoot::CameraField { field, .. } => Expr::ident("ctx")
                .member("setCamera")
                .call(vec![Expr::string(field), value]),
            ir::PlaceRoot::InstanceParam { entity, param, .. } => Expr::ident("ctx")
                .member("setParam")
                .call(vec![self.entity(*entity), Expr::string(param), value]),
            _ => return Err("a setter for a root that has none".to_owned()),
        };
        Ok(Stmt::Expr {
            expr: call,
            span: Some(span),
        })
    }

    /// `rt.clampIndex(index, length, spanId, ctx)`, `spanId` naming the indexing `site`.
    fn clamped(&mut self, index: &ir::Expr, length: u32, site: Span) -> Result<Expr, String> {
        let span_id = (self.span_id)(site)?;
        let position = self.expr(index)?;
        Ok(rt(
            "clampIndex",
            vec![
                position,
                Expr::Num(Number::U32(length)),
                Expr::Num(Number::U32(span_id)),
                Expr::ident("ctx"),
            ],
        ))
    }

    /// Whether `expr` reads (part of) an owned `var` ([`owned_vars`]) through fields and
    /// elements only, so that its value is that variable's storage.
    fn reads_owned(&self, expr: &ir::Expr) -> bool {
        let mut current = expr;
        loop {
            match &current.kind {
                ir::ExprKind::Field { base, .. } | ir::ExprKind::Index { base, .. } => {
                    current = base;
                }
                ir::ExprKind::Local { local, .. } => return self.owned.contains(local),
                // State and material params live in the runtime's objects: an aggregate read
                // out of them is copied like one read out of an owned `var`.
                ir::ExprKind::State { .. } | ir::ExprKind::InstanceParam { .. } => return true,
                _ => return false,
            }
        }
    }

    /// Whether the value of `expr` is an array or struct that shares storage with an owned
    /// `var`, so that it must be copied before it is used anywhere else (decision 0045).
    fn escapes_owned(&self, expr: &ir::Expr) -> bool {
        is_aggregate(&expr.ty) && self.reads_owned(expr)
    }

    /// Whether the JavaScript of `expr` is a new value no other binding refers to: a constant
    /// (emitted as a literal, so each evaluation builds a new one), a copy of an owned
    /// variable's storage, or a literal whose array and struct parts all are.
    fn fresh(&self, expr: &ir::Expr) -> bool {
        match &expr.kind {
            ir::ExprKind::Const { .. } => true,
            ir::ExprKind::Array { elements } => elements
                .iter()
                .all(|e| !is_aggregate(&e.ty) || self.fresh(e)),
            ir::ExprKind::Struct { fields } => fields
                .iter()
                .all(|f| !is_aggregate(&f.value.ty) || self.fresh(&f.value)),
            _ => self.escapes_owned(expr),
        }
    }

    /// A value about to be stored into an owned `var` (its initialiser, a whole assignment or
    /// an element or field of it): copied with `rt.copy` unless it is fresh.
    fn stored(&mut self, value: &ir::Expr) -> Result<Expr, String> {
        let lowered = self.expr(value)?;
        if !is_aggregate(&value.ty) || self.fresh(value) {
            return Ok(lowered);
        }
        Ok(rt("copy", vec![lowered]).spanned(value.span))
    }

    fn exprs(&mut self, items: &[ir::Expr]) -> Result<Vec<Expr>, String> {
        items.iter().map(|item| self.expr(item)).collect()
    }

    /// The JavaScript of `expr`, mapped to its span; an array or struct read out of an owned
    /// `var` is copied (`rt.copy`), so that the variable's later in-place writes never reach
    /// it (decision 0045).
    fn expr(&mut self, expr: &ir::Expr) -> Result<Expr, String> {
        let lowered = self.value(expr)?;
        if self.escapes_owned(expr) {
            return Ok(rt("copy", vec![lowered]).spanned(expr.span));
        }
        Ok(lowered)
    }

    /// The JavaScript of `expr` without the copy of [`Self::expr`]: for the base of a field,
    /// element or component read, and for a returned value (the function's variables end
    /// with it).
    fn value(&mut self, expr: &ir::Expr) -> Result<Expr, String> {
        let ty = expr.ty.as_str();
        let lowered = match &expr.kind {
            ir::ExprKind::Const { value } => value_expr(value)?,
            ir::ExprKind::Local { local, .. } => Expr::Ident(self.local_ident(*local)?),
            ir::ExprKind::Unary { op, operand } => {
                let inner = self.expr(operand)?;
                match (*op, ty) {
                    ("!", "bool") => Expr::unary("!", inner),
                    // Negating a binary32 value is exact.
                    ("-", "f32") => Expr::unary("-", inner),
                    ("-", "i32") => Expr::binary("|", Expr::unary("-", inner), int(0)),
                    ("-", _) => rt_call("neg", &[ty], ty, vec![inner])?,
                    (other, _) => return Err(format!("the unary operator '{other}' on {ty}")),
                }
            }
            ir::ExprKind::Binary { op, lhs, rhs } => {
                let left = self.expr(lhs)?;
                let right = self.expr(rhs)?;
                binary_op(op, &lhs.ty, &rhs.ty, ty, left, right)?
            }
            ir::ExprKind::Call { function, args } => {
                let mut arguments = vec![Expr::ident("ctx")];
                arguments.extend(self.exprs(args)?);
                Expr::Ident(function_name(function)?).call(arguments)
            }
            ir::ExprKind::Builtin { function, args } if function == "random" => {
                let _ = args;
                Expr::ident("ctx").member("random").call(Vec::new())
            }
            ir::ExprKind::Builtin { function, args } if function == "is_key_down" => {
                let arguments = self.exprs(args)?;
                Expr::ident("ctx").member("isKeyDown").call(arguments)
            }
            ir::ExprKind::Builtin { function, args } if function == "print" => {
                let mut arguments = self.exprs(args)?;
                let span_id = (self.span_id)(expr.span)?;
                arguments.push(Expr::Num(Number::U32(span_id)));
                Expr::ident("ctx").member("print").call(arguments)
            }
            ir::ExprKind::Builtin { function, args } => {
                let types: Vec<&str> = args.iter().map(|a| a.ty.as_str()).collect();
                let arguments = self.exprs(args)?;
                rt_call(function, &types, ty, arguments)?
            }
            ir::ExprKind::State { owner, name } => self.state_path(*owner, name),
            ir::ExprKind::EntityField { entity, field } => self.entity(*entity).member(field),
            ir::ExprKind::CameraField { field, .. } => {
                Expr::ident("ctx").member("cam").member(field)
            }
            ir::ExprKind::InstanceParam { entity, param } => {
                self.entity(*entity).member("mat").member("p").member(param)
            }
            ir::ExprKind::Frame { member } => Expr::ident("ctx").member("frame").member(member),
            ir::ExprKind::EnumMember { code, .. } => Expr::string(code),
            ir::ExprKind::Construct { args } => {
                let types: Vec<&str> = args.iter().map(|a| a.ty.as_str()).collect();
                let arguments = self.exprs(args)?;
                rt_call(ty, &types, ty, arguments)?
            }
            ir::ExprKind::Convert { arg } => {
                let inner = self.expr(arg)?;
                convert(&arg.ty, ty, inner)?
            }
            ir::ExprKind::Components { base, components } => {
                let inner = self.value(base)?;
                swizzle(&base.ty, components, inner)?
            }
            ir::ExprKind::Field { base, field, .. } => self.value(base)?.member(field),
            ir::ExprKind::Index { base, index } => {
                let length = indexed_length(&base.ty)
                    .ok_or_else(|| format!("an index into a value of type {}", base.ty))?;
                let object = self.value(base)?;
                let is_matrix = base.ty == "mat4";
                match constant_index(index) {
                    Some(k) if k < length => {
                        let position = Expr::Num(Number::U32(k)).spanned(index.span);
                        if is_matrix {
                            rt("m4col", vec![object, position])
                        } else {
                            Expr::Subscript(Box::new(object), Box::new(position))
                        }
                    }
                    Some(k) => {
                        return Err(format!(
                            "the constant index {k} into {} is out of range",
                            base.ty
                        ));
                    }
                    None => {
                        let clamped = self.clamped(index, length, expr.span)?;
                        if is_matrix {
                            rt("m4col", vec![object, clamped])
                        } else {
                            Expr::Subscript(Box::new(object), Box::new(clamped))
                        }
                    }
                }
            }
            ir::ExprKind::Array { elements } => Expr::Array(self.exprs(elements)?),
            // A material instance built by CPU code is a plain object of its params, like a
            // descriptor (decision 0039); nothing consumes one before M3.
            ir::ExprKind::Struct { fields }
            | ir::ExprKind::Descriptor { fields, .. }
            | ir::ExprKind::Material { params: fields, .. } => {
                let mut properties = Vec::with_capacity(fields.len());
                for field in fields {
                    properties.push((field.name.clone(), self.expr(&field.value)?));
                }
                Expr::object(properties)
            }
            // Material params exist only in stage bodies, which are never CPU code.
            ir::ExprKind::Param { name, .. } => {
                return Err(format!("the material param '{name}' in CPU code"));
            }
        };
        Ok(lowered.spanned(expr.span))
    }
}

/// The name of component `index` of a value of type `ty` (`x` or `r` for 0).
fn component_key(ty: &str, index: u32) -> Result<&'static str, String> {
    component_names(ty)
        .and_then(|names| names.get(index as usize).copied())
        .ok_or_else(|| format!("the component {index} of a {ty}"))
}

/// `rt.<helper>(arguments)` for the operation `callee` with the given signature.
fn rt_call(
    callee: &str,
    params: &[&str],
    result: &str,
    arguments: Vec<Expr>,
) -> Result<Expr, String> {
    let helper = rt_ops::helper(callee, params, result).ok_or_else(|| {
        format!(
            "no rt helper implements {callee} {}",
            rt_ops::signature(params, result)
        )
    })?;
    Ok(rt(helper, arguments))
}

/// `left op right` with operand types `lt`, `rt_ty` and result type `ty`.
fn binary_op(
    op: &str,
    lt: &str,
    rt_ty: &str,
    ty: &str,
    left: Expr,
    right: Expr,
) -> Result<Expr, String> {
    let scalar = |t: &str| matches!(t, "f32" | "i32" | "u32" | "bool");
    Ok(match op {
        "&&" => Expr::binary("&&", left, right),
        "||" => Expr::binary("||", left, right),
        "==" | "!=" if lt == rt_ty && scalar(lt) => {
            Expr::binary(if op == "==" { "===" } else { "!==" }, left, right)
        }
        "<" | "<=" | ">" | ">=" if lt == rt_ty && matches!(lt, "f32" | "i32" | "u32") => {
            let op: &'static str = match op {
                "<" => "<",
                "<=" => "<=",
                ">" => ">",
                _ => ">=",
            };
            Expr::binary(op, left, right)
        }
        "+" | "-" | "*" | "/" | "%" if lt == rt_ty && lt == ty => {
            let js: &'static str = match op {
                "+" => "+",
                "-" => "-",
                "*" => "*",
                "/" => "/",
                _ => "%",
            };
            match (ty, js) {
                ("f32", _) => fround(Expr::binary(js, left, right)),
                ("i32", "+" | "-") => Expr::binary("|", Expr::binary(js, left, right), int(0)),
                ("i32", "*") => Expr::ident("Math").member("imul").call(vec![left, right]),
                ("u32", "+" | "-") => Expr::binary(">>>", Expr::binary(js, left, right), int(0)),
                ("u32", "*") => Expr::binary(
                    ">>>",
                    Expr::ident("Math").member("imul").call(vec![left, right]),
                    int(0),
                ),
                _ => rt_call(op, &[lt, rt_ty], ty, vec![left, right])?,
            }
        }
        "+" | "-" | "*" | "/" | "%" => rt_call(op, &[lt, rt_ty], ty, vec![left, right])?,
        other => return Err(format!("the operator '{other}' on ({lt}, {rt_ty})")),
    })
}

/// The conversion `to(value)` of a value of type `from`.
fn convert(from: &str, to: &str, value: Expr) -> Result<Expr, String> {
    // The rt index must know the conversion even where an inline form is emitted.
    if from != to && rt_ops::helper(to, &[from], to).is_none() {
        return Err(format!("no conversion from {from} to {to}"));
    }
    Ok(match (from, to) {
        _ if from == to => value,
        ("i32" | "u32", "f32") => fround(value),
        ("i32", "u32") => Expr::binary(">>>", value, int(0)),
        ("u32", "i32") => Expr::binary("|", value, int(0)),
        ("f32", "i32") => rt("f2i", vec![value]),
        ("f32", "u32") => rt("f2u", vec![value]),
        _ => return Err(format!("no conversion from {from} to {to}")),
    })
}

/// Components `components` of `value` (of type `ty`): a member for one, a new value for
/// several.
fn swizzle(ty: &str, components: &[u32], value: Expr) -> Result<Expr, String> {
    match components {
        [index] => Ok(value.member(component_key(ty, *index)?)),
        [0, 1, 2] if ty == "color" => Ok(rt("crgb", vec![value])),
        _ if ty == "color" || ty == "quat" => Err(format!(
            "the swizzle of {} components of a {ty}",
            components.len()
        )),
        _ => {
            let helper = match components.len() {
                2 => "swizzle2",
                3 => "swizzle3",
                4 => "swizzle4",
                n => return Err(format!("a swizzle of {n} components")),
            };
            let mut arguments = vec![value];
            for index in components {
                arguments.push(Expr::string(component_key(ty, *index)?));
            }
            Ok(rt(helper, arguments))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::emit_js::ast::inline;
    use crate::ir::Function;

    #[test]
    fn function_names_are_module_qualified() {
        let symbol = Symbol::item("src/main.mtek", "pulse");
        assert_eq!(function_name(&symbol).expect("named"), "f_e2cab98b_pulse");
        assert_ne!(
            function_name(&Symbol::item("src/other.mtek", "pulse")).expect("named"),
            "f_e2cab98b_pulse"
        );
        assert!(function_name(&Symbol::item("", "pulse")).is_err());
    }

    /// The spans of a function: its declaration, its statements and its expressions.
    fn spans_of(function: &Function, out: &mut Vec<Span>) {
        fn expr(e: &ir::Expr, out: &mut Vec<Span>) {
            out.push(e.span);
            match &e.kind {
                ir::ExprKind::Const { .. }
                | ir::ExprKind::Local { .. }
                | ir::ExprKind::State { .. }
                | ir::ExprKind::EntityField { .. }
                | ir::ExprKind::CameraField { .. }
                | ir::ExprKind::InstanceParam { .. }
                | ir::ExprKind::Frame { .. }
                | ir::ExprKind::EnumMember { .. } => {}
                ir::ExprKind::Unary { operand, .. } => expr(operand, out),
                ir::ExprKind::Binary { lhs, rhs, .. } => {
                    expr(lhs, out);
                    expr(rhs, out);
                }
                ir::ExprKind::Call { args, .. }
                | ir::ExprKind::Builtin { args, .. }
                | ir::ExprKind::Construct { args } => args.iter().for_each(|a| expr(a, out)),
                ir::ExprKind::Convert { arg } => expr(arg, out),
                ir::ExprKind::Components { base, .. } | ir::ExprKind::Field { base, .. } => {
                    expr(base, out);
                }
                ir::ExprKind::Index { base, index } => {
                    expr(base, out);
                    expr(index, out);
                }
                ir::ExprKind::Array { elements } => elements.iter().for_each(|a| expr(a, out)),
                ir::ExprKind::Param { .. } => {}
                ir::ExprKind::Struct { fields }
                | ir::ExprKind::Descriptor { fields, .. }
                | ir::ExprKind::Material { params: fields, .. } => {
                    fields.iter().for_each(|f| expr(&f.value, out));
                }
            }
        }
        fn block(b: &ir::Block, out: &mut Vec<Span>) {
            for s in &b.stmts {
                match s {
                    ir::Stmt::Let { value, span, .. } | ir::Stmt::Var { value, span, .. } => {
                        out.push(*span);
                        expr(value, out);
                    }
                    ir::Stmt::Assign {
                        target,
                        value,
                        span,
                        ..
                    } => {
                        out.push(*span);
                        if let ir::PlaceRoot::Local { span: root, .. } = &target.root {
                            out.push(*root);
                        }
                        for step in &target.steps {
                            out.push(step.span());
                            if let ir::PlaceStep::Index { index, .. } = step {
                                expr(index, out);
                            }
                        }
                        expr(value, out);
                    }
                    ir::Stmt::Const { .. } => {}
                    ir::Stmt::If {
                        branches,
                        otherwise,
                        span,
                    } => {
                        out.push(*span);
                        for branch in branches {
                            expr(&branch.cond, out);
                            block(&branch.body, out);
                        }
                        if let Some(b) = otherwise {
                            block(b, out);
                        }
                    }
                    ir::Stmt::ForRange {
                        start,
                        end,
                        body,
                        span,
                        ..
                    } => {
                        out.push(*span);
                        expr(start, out);
                        expr(end, out);
                        block(body, out);
                    }
                    ir::Stmt::ForEach {
                        array, body, span, ..
                    } => {
                        out.push(*span);
                        expr(array, out);
                        block(body, out);
                    }
                    ir::Stmt::Return { value, span } => {
                        out.push(*span);
                        if let Some(v) = value {
                            expr(v, out);
                        }
                    }
                    ir::Stmt::Break { span } | ir::Stmt::Continue { span } => out.push(*span),
                    ir::Stmt::Block { body } => block(body, out),
                    ir::Stmt::Expr { expr: e, span } => {
                        out.push(*span);
                        expr(e, out);
                    }
                }
            }
        }
        out.push(function.span);
        block(&function.body, out);
    }

    fn program_of(files: &[(&str, &str)]) -> Program {
        let mut fs = crate::source::MemFs::new();
        fs.insert(
            crate::source::ProjectPath::new("mtek.toml").expect("path"),
            "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n",
        );
        for (path, text) in files {
            fs.insert(crate::source::ProjectPath::new(path).expect("path"), *text);
        }
        let analysis = crate::analyze(&crate::project::ProjectRoot::at_base(), &fs);
        assert_eq!(
            analysis.report.summary.errors, 0,
            "{:#?}",
            analysis.report.diagnostics
        );
        crate::ir::lower_to_ir(&analysis).expect("lowered")
    }

    /// Every emitted function, statement and expression gets a mapping to its span; one is only
    /// dropped from the source map where an enclosing node starts at the same generated
    /// position.
    #[test]
    fn every_function_statement_and_expression_is_mapped() {
        let programs = [
            program_of(&[
                (
                    "src/main.mtek",
                    include_str!("../../../../tests/codegen/cpu_functions/src/main.mtek"),
                ),
                (
                    "src/util.mtek",
                    include_str!("../../../../tests/codegen/cpu_functions/src/util.mtek"),
                ),
            ]),
            program_of(&[(
                "src/main.mtek",
                include_str!("../../../../tests/codegen/numeric_cpu_table/src/main.mtek"),
            )]),
            program_of(&[(
                "src/main.mtek",
                include_str!(
                    "../../../../tests/semantics/pass/functions_statements_and_calls/src/main.mtek"
                ),
            )]),
            program_of(&[(
                "src/main.mtek",
                include_str!("../../../../tests/codegen/assignable_places/src/main.mtek"),
            )]),
        ];
        let mut checked = 0;
        for program in &programs {
            let emitted = emit_functions(program, &mut |_| Ok(0)).expect("emitted");
            let module = super::super::ast::Module {
                items: emitted
                    .stmts
                    .into_iter()
                    .map(super::super::ast::Item::Stmt)
                    .collect(),
            };
            let every = super::super::ast::print_every_mapping(&module);
            let kept = super::super::ast::print(&module);
            assert_eq!(every.text, kept.text);
            let mut expected = Vec::new();
            for module in &program.modules {
                for item in &module.items {
                    if let Item::Function(function) = item
                        && function.cpu_reachable
                    {
                        spans_of(function, &mut expected);
                    }
                }
            }
            let marked: Vec<Span> = every.mappings.iter().map(|m| m.span).collect();
            for span in &expected {
                assert!(marked.contains(span), "{span:?} has no mapping");
            }
            for mapping in &every.mappings {
                assert!(
                    expected.contains(&mapping.span),
                    "{mapping:?} maps no IR node"
                );
                if kept.mappings.contains(mapping) {
                    continue;
                }
                let winner = kept
                    .mappings
                    .iter()
                    .find(|m| (m.line, m.column) == (mapping.line, mapping.column))
                    .expect("a kept mapping at the same position");
                assert!(
                    winner.span.file == mapping.span.file
                        && winner.span.start <= mapping.span.start
                        && mapping.span.end <= winner.span.end,
                    "{mapping:?} was dropped for {winner:?}, which does not enclose it"
                );
            }
            checked += expected.len();
        }
        assert!(checked > 2000, "{checked}");
    }

    #[test]
    fn indexed_lengths_come_from_the_type() {
        assert_eq!(indexed_length("array<f32, 3>"), Some(3));
        assert_eq!(indexed_length("array<array<f32, 4>, 2>"), Some(2));
        assert_eq!(indexed_length("mat4"), Some(4));
        assert_eq!(indexed_length("vec4"), None);
    }

    fn text(result: Result<Expr, String>) -> String {
        inline(&result.expect("lowered"))
    }

    #[test]
    fn scalar_operators_use_the_inline_forms() {
        let a = || Expr::ident("a");
        let b = || Expr::ident("b");
        let bin = |op, t| text(binary_op(op, t, t, t, a(), b()));
        assert_eq!(bin("+", "f32"), "fr(a + b)");
        assert_eq!(bin("%", "f32"), "fr(a % b)");
        assert_eq!(bin("+", "i32"), "(a + b) | 0");
        assert_eq!(bin("-", "i32"), "(a - b) | 0");
        assert_eq!(bin("*", "i32"), "Math.imul(a, b)");
        assert_eq!(bin("/", "i32"), "rt.idiv(a, b)");
        assert_eq!(bin("%", "i32"), "rt.irem(a, b)");
        assert_eq!(bin("+", "u32"), "(a + b) >>> 0");
        assert_eq!(bin("*", "u32"), "Math.imul(a, b) >>> 0");
        assert_eq!(bin("/", "u32"), "rt.udiv(a, b)");
        assert_eq!(bin("%", "u32"), "rt.urem(a, b)");
        assert_eq!(bin("+", "vec3"), "rt.v3add(a, b)");
        assert_eq!(
            text(binary_op("*", "f32", "vec2", "vec2", a(), b())),
            "rt.v2smul(a, b)"
        );
        assert_eq!(
            text(binary_op("*", "quat", "vec3", "vec3", a(), b())),
            "rt.qrotate(a, b)"
        );
        assert_eq!(
            text(binary_op("==", "f32", "f32", "bool", a(), b())),
            "a === b"
        );
        assert_eq!(
            text(binary_op("!=", "bool", "bool", "bool", a(), b())),
            "a !== b"
        );
        assert_eq!(
            text(binary_op("<=", "u32", "u32", "bool", a(), b())),
            "a <= b"
        );
        assert!(binary_op("==", "vec3", "vec3", "bool", a(), b()).is_err());
        assert!(binary_op("+", "color", "color", "color", a(), b()).is_err());
    }

    #[test]
    fn conversions_and_swizzles() {
        let v = || Expr::ident("v");
        assert_eq!(text(convert("i32", "f32", v())), "fr(v)");
        assert_eq!(text(convert("u32", "f32", v())), "fr(v)");
        assert_eq!(text(convert("f32", "i32", v())), "rt.f2i(v)");
        assert_eq!(text(convert("f32", "u32", v())), "rt.f2u(v)");
        assert_eq!(text(convert("i32", "u32", v())), "v >>> 0");
        assert_eq!(text(convert("u32", "i32", v())), "v | 0");
        assert_eq!(text(convert("f32", "f32", v())), "v");
        assert!(convert("bool", "f32", v()).is_err());
        assert_eq!(text(swizzle("vec3", &[1], v())), "v.y");
        assert_eq!(text(swizzle("color", &[3], v())), "v.a");
        assert_eq!(text(swizzle("color", &[0, 1, 2], v())), "rt.crgb(v)");
        assert_eq!(
            text(swizzle("vec4", &[2, 0, 0], v())),
            r#"rt.swizzle3(v, "z", "x", "x")"#
        );
        assert_eq!(
            text(swizzle("vec2", &[1, 0, 1, 0], v())),
            r#"rt.swizzle4(v, "y", "x", "y", "x")"#
        );
        assert!(swizzle("color", &[0, 1], v()).is_err());
        assert!(swizzle("vec2", &[2], v()).is_err());
    }

    #[test]
    fn every_structural_helper_the_emitter_names_is_listed() {
        for helper in [
            "swizzle2", "swizzle3", "swizzle4", "v2with", "v3with", "v4with",
        ] {
            assert!(rt_ops::STRUCTURAL_HELPERS.contains(&helper));
        }
        for helper in ["crgb", "m4col", "clampIndex"] {
            assert!(rt_ops::STRUCTURAL_HELPERS.contains(&helper));
        }
    }
}

/// The name of the temporary a place path starts at (`t_0` in `t_0.items[1]`).
fn path_root(path: &Expr) -> Option<String> {
    let mut current = path;
    loop {
        match current {
            Expr::Ident(name) => return Some(name.clone()),
            Expr::Member(base, _) | Expr::Subscript(base, _) => current = base,
            Expr::Spanned(inner, _) => current = inner,
            _ => return None,
        }
    }
}

/// The lowered initialiser of `state` (an expression without locals), for `init`.
///
/// # Errors
/// A text describing a compiler defect.
pub fn emit_state_init(
    state: &ir::State,
    span_id: &mut dyn FnMut(Span) -> Result<u32, String>,
) -> Result<Expr, String> {
    let mut lowering = FnLowering {
        locals: &[],
        owner: None,
        release: false,
        temps: 0,
        span_id,
        owned: BTreeSet::new(),
    };
    lowering
        .expr(&state.init)
        .map_err(|e| format!("the initialiser of '{}': {e}", state.symbol))
}

/// The lifecycle functions and handlers of a scene as JavaScript functions, and where the
/// `scenes` table finds them (`spec/runtime-abi.md` section 3).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EmittedBehaviors {
    /// A comment and a `function` statement per behaviour, in IR order.
    pub stmts: Vec<Stmt>,
    /// The scene's `update`: `(ctx, dt)`.
    pub update: Option<String>,
    /// The scene's `fixed_update`.
    pub fixed_update: Option<String>,
    /// By static entity index: `(ctx, self, dt)`.
    pub entity_update: Vec<Option<String>>,
    pub entity_fixed_update: Vec<Option<String>>,
    /// `(event, DOM code or none, owner index or -1 for the scene, function)`, in IR order.
    pub events: Vec<EmittedEvent>,
    /// The function of each binding, by binding id: `(ctx) => value`.
    pub bindings: Vec<String>,
}

/// One entry of the `events` table.
#[derive(Clone, Debug, PartialEq)]
pub struct EmittedEvent {
    pub event: String,
    pub key: Option<String>,
    /// The static entity index, or `None` for a scene handler.
    pub owner: Option<u32>,
    pub function: String,
}

/// Lowers every behaviour of `scene`. `release` compiles `print` out.
///
/// # Errors
/// A text describing a compiler defect: an IR node the CPU emitter does not know.
pub fn emit_behaviors(
    scene: &ir::Scene,
    release: bool,
    span_id: &mut dyn FnMut(Span) -> Result<u32, String>,
) -> Result<EmittedBehaviors, String> {
    let mut emitted = EmittedBehaviors {
        entity_update: vec![None; scene.entities.len()],
        entity_fixed_update: vec![None; scene.entities.len()],
        ..EmittedBehaviors::default()
    };
    for (position, behavior) in scene.behaviors.iter().enumerate() {
        let label = match &behavior.kind {
            ir::BehaviorKind::Update => "update".to_owned(),
            ir::BehaviorKind::FixedUpdate => "fixed_update".to_owned(),
            ir::BehaviorKind::Event { event, .. } => format!("on {event}"),
        };
        let base = match &behavior.kind {
            ir::BehaviorKind::Update => "update".to_owned(),
            ir::BehaviorKind::FixedUpdate => "fixed_update".to_owned(),
            ir::BehaviorKind::Event { event, .. } => format!("on_{event}"),
        };
        let name = format!("b_{position}_{}", identifier_part(&base));
        let mut lowering = FnLowering {
            locals: &behavior.locals,
            owner: Some(behavior.owner),
            release,
            temps: 0,
            span_id: &mut *span_id,
            owned: owned_vars(&behavior.body),
        };
        let body = lowering
            .block(&behavior.body)
            .map_err(|e| format!("behaviour '{}': {e}", behavior.symbol))?;
        let owner_index = match behavior.owner {
            ir::Owner::Scene => None,
            ir::Owner::Entity { index } => Some(index),
        };
        let mut params = vec!["ctx".to_owned()];
        // Scene lifecycle functions are `(ctx, dt)`; everything else starts with `self`.
        let is_lifecycle = !matches!(behavior.kind, ir::BehaviorKind::Event { .. });
        if owner_index.is_some() || !is_lifecycle {
            params.push("self".to_owned());
        }
        params.extend(
            behavior
                .locals
                .iter()
                .filter(|l| l.kind == LocalKind::Param)
                .map(local_name),
        );
        emitted.stmts.push(Stmt::Blank);
        emitted
            .stmts
            .push(Stmt::Comment(format!("{label} ({})", behavior.symbol)));
        emitted.stmts.push(Stmt::Function {
            name: name.clone(),
            params,
            body,
            span: Some(behavior.span),
        });
        match (&behavior.kind, owner_index) {
            (ir::BehaviorKind::Update, None) => emitted.update = Some(name),
            (ir::BehaviorKind::FixedUpdate, None) => emitted.fixed_update = Some(name),
            (ir::BehaviorKind::Update, Some(index)) => {
                if let Some(slot) = emitted.entity_update.get_mut(index as usize) {
                    *slot = Some(name);
                }
            }
            (ir::BehaviorKind::FixedUpdate, Some(index)) => {
                if let Some(slot) = emitted.entity_fixed_update.get_mut(index as usize) {
                    *slot = Some(name);
                }
            }
            (ir::BehaviorKind::Event { event, filter }, owner) => {
                emitted.events.push(EmittedEvent {
                    event: event.clone(),
                    key: filter.clone(),
                    owner,
                    function: name,
                });
            }
        }
    }
    for binding in &scene.bindings {
        let name = format!("bd_{}", binding.id);
        let mut lowering = FnLowering {
            locals: &[],
            owner: None,
            release,
            temps: 0,
            span_id: &mut *span_id,
            owned: BTreeSet::new(),
        };
        let value = lowering
            .expr(&binding.expr)
            .map_err(|e| format!("binding '{}': {e}", binding.symbol))?;
        emitted.stmts.push(Stmt::Blank);
        emitted.stmts.push(Stmt::Comment(format!(
            "bind ({}): evaluated every frame in the order of the manifest",
            binding.symbol
        )));
        emitted.stmts.push(Stmt::Function {
            name: name.clone(),
            params: vec!["ctx".to_owned()],
            body: vec![Stmt::Return {
                value: Some(value),
                span: Some(binding.span),
            }],
            span: Some(binding.span),
        });
        emitted.bindings.push(name);
    }
    Ok(emitted)
}
