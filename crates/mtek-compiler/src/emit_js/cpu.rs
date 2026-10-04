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
//! - a constant index reads directly (it is in range, `E3030`), a run-time index goes through
//!   `rt.clampIndex(i, N, spanId, ctx)`, `spanId` being the index expression's entry in the
//!   manifest `spans` table;
//! - constants are the folded values, `f32` printed as the binary64 text of the binary32
//!   value ([`super::ast::Number`]).
//!
//! Every statement and expression carries its Mtek span into the source map.

use crate::ir::{self, Function, Item, LocalKind, Place, Program, Symbol};
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
                function,
                temps: 0,
                span_id: &mut *span_id,
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
    function: &'f Function,
    /// Temporaries used so far (`t_0`, `t_1`, …).
    temps: u32,
    span_id: &'s mut dyn FnMut(Span) -> Result<u32, String>,
}

impl FnLowering<'_, '_> {
    fn local(&self, index: u32) -> Result<&ir::LocalItem, String> {
        self.function
            .locals
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
                value: self.expr(value)?,
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
            ir::Stmt::Return { value, span } => Stmt::Return {
                value: value.as_ref().map(|v| self.expr(v)).transpose()?,
                span: Some(*span),
            },
            ir::Stmt::Break { span } => Stmt::Break { span: Some(*span) },
            ir::Stmt::Continue { span } => Stmt::Continue { span: Some(*span) },
            ir::Stmt::Block { body } => Stmt::Block {
                body: self.block(body)?,
            },
            ir::Stmt::Expr { expr, span } => Stmt::Expr {
                expr: self.expr(expr)?,
                span: Some(*span),
            },
        }))
    }

    /// `target op= value`: `place = place op value` with the place evaluated once (a place is
    /// a local or a component of one, so reading it twice evaluates nothing twice).
    fn assign(
        &mut self,
        target: &Place,
        op: &str,
        value: &ir::Expr,
        span: Span,
    ) -> Result<Stmt, String> {
        let place_ty = self.place_ty(target)?;
        let lowered = self.expr(value)?;
        let new_value = match op {
            "=" => lowered,
            "+=" | "-=" | "*=" | "/=" => {
                let binary: &'static str = match op {
                    "+=" => "+",
                    "-=" => "-",
                    "*=" => "*",
                    _ => "/",
                };
                let current = self.read_place(target)?;
                binary_op(binary, &place_ty, &value.ty, &place_ty, current, lowered)?.spanned(span)
            }
            other => return Err(format!("the assignment operator '{other}'")),
        };
        self.write_place(target, new_value, span)
    }

    fn place_ty(&self, place: &Place) -> Result<String, String> {
        match place {
            Place::Local { local, .. } => Ok(self.local(*local)?.ty.clone()),
            Place::Component { .. } => Ok("f32".to_owned()),
        }
    }

    fn read_place(&self, place: &Place) -> Result<Expr, String> {
        match place {
            Place::Local { local, .. } => Ok(Expr::Ident(self.local_ident(*local)?)),
            Place::Component { base, index } => {
                let base_ty = self.place_ty(base)?;
                let key = component_key(&base_ty, *index)?;
                Ok(self.read_place(base)?.member(key))
            }
        }
    }

    /// `place = value`; a component builds a new vector and assigns it to its base.
    fn write_place(&self, place: &Place, value: Expr, span: Span) -> Result<Stmt, String> {
        match place {
            Place::Local { local, .. } => Ok(Stmt::Assign {
                target: Expr::Ident(self.local_ident(*local)?),
                value,
                span: Some(span),
            }),
            Place::Component { base, index } => {
                let base_ty = self.place_ty(base)?;
                let helper = match base_ty.as_str() {
                    "vec2" => "v2with",
                    "vec3" => "v3with",
                    "vec4" => "v4with",
                    other => return Err(format!("a component assignment to a {other}")),
                };
                let key = component_key(&base_ty, *index)?;
                let rebuilt = rt(
                    helper,
                    vec![self.read_place(base)?, Expr::string(key), value],
                );
                self.write_place(base, rebuilt.spanned(span), span)
            }
        }
    }

    fn exprs(&mut self, items: &[ir::Expr]) -> Result<Vec<Expr>, String> {
        items.iter().map(|item| self.expr(item)).collect()
    }

    /// The JavaScript of `expr`, mapped to its span.
    fn expr(&mut self, expr: &ir::Expr) -> Result<Expr, String> {
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
            ir::ExprKind::Builtin { function, args } => {
                let types: Vec<&str> = args.iter().map(|a| a.ty.as_str()).collect();
                let arguments = self.exprs(args)?;
                rt_call(function, &types, ty, arguments)?
            }
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
                let inner = self.expr(base)?;
                swizzle(&base.ty, components, inner)?
            }
            ir::ExprKind::Field { base, field, .. } => self.expr(base)?.member(field),
            ir::ExprKind::Index { base, index } => {
                let length = indexed_length(&base.ty)
                    .ok_or_else(|| format!("an index into a value of type {}", base.ty))?;
                let object = self.expr(base)?;
                let constant = match &index.kind {
                    ir::ExprKind::Const {
                        value: ir::Value::I32(k),
                    } => u32::try_from(*k).ok(),
                    ir::ExprKind::Const {
                        value: ir::Value::U32(k),
                    } => Some(*k),
                    _ => None,
                };
                let is_matrix = base.ty == "mat4";
                match constant {
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
                        let span_id = (self.span_id)(expr.span)?;
                        let position = self.expr(index)?;
                        let clamped = rt(
                            "clampIndex",
                            vec![
                                position,
                                Expr::Num(Number::U32(length)),
                                Expr::Num(Number::U32(span_id)),
                                Expr::ident("ctx"),
                            ],
                        );
                        if is_matrix {
                            rt("m4col", vec![object, clamped])
                        } else {
                            Expr::Subscript(Box::new(object), Box::new(clamped))
                        }
                    }
                }
            }
            ir::ExprKind::Array { elements } => Expr::Array(self.exprs(elements)?),
            ir::ExprKind::Struct { fields } | ir::ExprKind::Descriptor { fields, .. } => {
                let mut properties = Vec::with_capacity(fields.len());
                for field in fields {
                    properties.push((field.name.clone(), self.expr(&field.value)?));
                }
                Expr::object(properties)
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
                ir::ExprKind::Const { .. } | ir::ExprKind::Local { .. } => {}
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
                ir::ExprKind::Struct { fields } | ir::ExprKind::Descriptor { fields, .. } => {
                    fields.iter().for_each(|f| expr(&f.value, out));
                }
            }
        }
        fn block(b: &ir::Block, out: &mut Vec<Span>) {
            for s in &b.stmts {
                match s {
                    ir::Stmt::Let { value, span, .. }
                    | ir::Stmt::Var { value, span, .. }
                    | ir::Stmt::Assign { value, span, .. } => {
                        out.push(*span);
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
