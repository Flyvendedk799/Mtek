//! Shader lowering (`spec/compiler-architecture.md` sections 4.9 and 7, decision 0041):
//! a material of the typed IR — its fragment stage and the GPU-reachable functions it
//! calls — to the shader IR, completed by the standard stage of decision 0029.
//!
//! [`lower_material`] builds every WGSL statement and expression as a shader IR node from
//! an IR node, carrying that node's Mtek span (generated code carries the material's), so
//! no WGSL text is ever assembled from user strings or from templates of logic. The
//! rules:
//!
//! - **Names.** A user function is `u_fn_<hash8>_<name>`, module-qualified like the
//!   JavaScript `f_<hash8>_<name>` (two modules' functions of one name can both reach one
//!   material); parameters are `u_p_<name>`, locals and loop variables `u_l_<name>`
//!   (Mtek forbids shadowing, and sibling blocks that reuse a name are separate WGSL
//!   blocks); structs `S_<hash8>_<Name>`; the param block `MtekParams_<hash8>_<Name>`,
//!   read as `mtek_params.u_<param>`.
//! - **Functions.** Only the functions the fragment stage reaches, each once, callees
//!   before callers (found with a worklist and an explicit depth-first stack, so a call
//!   chain of any length needs no deep native stack, and Naga's own dependency search
//!   finds every callee declared already); then the generated helpers they use.
//! - **Types** ([`types`]): one Mtek type, one WGSL type everywhere; a `bool` inside a
//!   struct, array or block is stored as `u32` — reads decode it (`(x != 0u)`),
//!   constructions encode it (`select(0u, 1u, b)`, `1u`/`0u` for constants); padded array
//!   elements are wrapper structs read through `.value`.
//! - **Expressions.** Constants are their folded values as literals and constructors;
//!   operators, conversions, constructors and the intrinsics WGSL has are themselves
//!   (WGSL's integer `/` and `%`, `f32 %`, conversions and `round` already have the Mtek
//!   semantics); `quat` products, `quat.axis_angle`, `quat.euler`, `color.srgb` and the
//!   `mat4` constructors call [`helpers`]; `color.linear(rgb, a)` is `vec4<f32>(rgb, a)`,
//!   `.rgb`/`.a` are `.xyz`/`.w`. A constant index reads directly (`E3030` keeps it in
//!   range); any other index is clamped: `min(i, N - 1u)` for `u32`, `clamp(i, 0i, N -
//!   1i)` for `i32` (`spec/language.md` section 5.6).
//! - **Statements.** `let`, `var`, assignment (a compound assignment `p op= v` is `p = p
//!   op v`, `p` being a local or a component of one), `if`/`else if`/`else`, `for i in
//!   a..b` as `for (var u_l_i = a; u_l_i < b; u_l_i++)`, `for x in arr` as a block that
//!   binds the array once and counts over it, `break`, `continue`, `return`, blocks; a
//!   call statement is `f(..);` for a function without result and `_ = ..;` otherwise; a
//!   block constant emits nothing (its uses are folded).
//!
//! Places are built by [`ShaderLowering`]'s `field_place` and `index_place`, which give
//! the stored WGSL reference (before any `bool` decoding) of a field or clamped element;
//! reads decode it. Assignment targets are shader IR expressions, so a chain of field and
//! index steps (M2-13) lowers through the same two functions, encoding a stored `bool` on
//! write.
//!
//! A typed IR node this lowering cannot represent is a compiler defect: `E9999`.

mod helpers;
mod types;

use std::collections::{BTreeMap, BTreeSet};

use crate::diagnostics::{Code, Diagnostic};
use crate::emit_wgsl::member_wgsl_name;
use crate::ir::{self, LocalItem, LocalKind, MaterialItem, Place, Program, Value};
use crate::layout::{LayoutNode, hash8};
use crate::source::Span;

use helpers::Helper;
use types::{MtekType, TypeMapper, parse};

use super::shader_ir::{
    BinaryOp, Component, Expr, FiniteF32, Function, FunctionParam, FunctionResult, Intrinsic,
    Literal, Name, ShaderType, Statement, UnaryOp, UserNameKind,
};
use super::standard_stage::{
    FragmentBody, MaterialDescription, MaterialShader, SurfaceField, build_standard_stage,
    params_global,
};

/// What went wrong: a description of the compiler defect.
type Defect = String;

/// `E9999` for a defect of the shader lowering of `material`.
fn internal(material: &str, defect: Defect) -> Vec<Diagnostic> {
    vec![
        Diagnostic::new(
            Code::E9999,
            format!("The shader of material '{material}' could not be generated; this is a compiler bug."),
        )
        .note(defect)
        .help("please report it with the program that caused it"),
    ]
}

/// The shader of `material`, a material item of `program` (or, from M2-09, of the
/// prelude): its fragment stage and every function it reaches, lowered to the shader IR
/// and completed by the standard stage. The result is printed and validated by
/// [`crate::emit_wgsl::emit_shader`].
///
/// # Errors
/// `E9999` for an IR node this lowering cannot represent (a compiler defect).
pub fn lower_material(
    program: &Program,
    material: &MaterialItem,
) -> Result<MaterialShader, Vec<Diagnostic>> {
    let symbol = material.symbol.as_str();
    let description = ShaderLowering::new(program, material)
        .description()
        .map_err(|defect| internal(symbol, defect))?;
    build_standard_stage(&description)
        .map_err(|e| internal(symbol, format!("a built-in block has no layout: {e}")))
}

/// The lowering of one material.
struct ShaderLowering<'p> {
    material: &'p MaterialItem,
    functions: BTreeMap<&'p str, &'p ir::Function>,
    types: TypeMapper<'p>,
    helpers: BTreeSet<Helper>,
}

/// What one function body needs: its locals and the calls it makes.
struct Body<'p> {
    locals: &'p [LocalItem],
    /// Callee symbols in order of their first call.
    calls: Vec<String>,
}

impl<'p> ShaderLowering<'p> {
    fn new(program: &'p Program, material: &'p MaterialItem) -> ShaderLowering<'p> {
        let functions = program
            .modules
            .iter()
            .flat_map(|module| module.items.iter())
            .filter_map(|item| match item {
                ir::Item::Function(function) => Some((function.symbol.as_str(), function)),
                _ => None,
            })
            .collect();
        ShaderLowering {
            material,
            functions,
            types: TypeMapper::new(program, material.span),
            helpers: BTreeSet::new(),
        }
    }

    fn span(&self) -> Span {
        self.material.span
    }

    fn description(mut self) -> Result<MaterialDescription, Defect> {
        let material = self.material;
        let stage = &material.fragment;
        let mut body = Body {
            locals: &stage.locals,
            calls: Vec::new(),
        };
        let surface = stage
            .locals
            .first()
            .ok_or_else(|| "the fragment stage has no SurfaceInput parameter".to_owned())?;
        let statements = self.block(&mut body, &stage.body)?;
        let mut surface_inputs = BTreeSet::new();
        for name in &stage.surface_inputs {
            let field = SurfaceField::ALL
                .iter()
                .copied()
                .find(|f| f.name() == *name)
                .ok_or_else(|| format!("the SurfaceInput field '{name}' is unknown"))?;
            surface_inputs.insert(field);
        }

        // Every function the stage reaches, lowered once.
        let mut lowered: BTreeMap<String, (Function, Vec<String>)> = BTreeMap::new();
        let mut pending: Vec<String> = body.calls.iter().rev().cloned().collect();
        while let Some(symbol) = pending.pop() {
            if lowered.contains_key(&symbol) {
                continue;
            }
            let (function, calls) = self.function(&symbol)?;
            pending.extend(calls.iter().rev().cloned());
            lowered.insert(symbol, (function, calls));
        }
        // Callees before callers: a depth-first post-order over the calls, with an
        // explicit stack.
        let mut order = Vec::with_capacity(lowered.len());
        let mut visited = BTreeSet::new();
        for root in &body.calls {
            if !visited.insert(root.clone()) {
                continue;
            }
            let mut stack: Vec<(&str, usize)> = vec![(root.as_str(), 0)];
            while let Some((symbol, next)) = stack.pop() {
                let calls = lowered
                    .get(symbol)
                    .map(|(_, calls)| calls.as_slice())
                    .unwrap_or(&[]);
                match calls.get(next) {
                    Some(callee) => {
                        stack.push((symbol, next + 1));
                        if visited.insert(callee.clone()) {
                            stack.push((callee.as_str(), 0));
                        }
                    }
                    None => order.push(symbol.to_owned()),
                }
            }
        }
        let mut functions: Vec<Function> = self
            .helpers
            .iter()
            .map(|helper| helper.function(material.span, material.symbol.as_str()))
            .collect();
        for symbol in order {
            if let Some((function, _)) = lowered.remove(&symbol) {
                functions.push(function);
            }
        }

        Ok(MaterialDescription {
            symbol: material.symbol.to_string(),
            declaration: material.span,
            surface_inputs,
            params: material.layout.clone(),
            fragment: FragmentBody {
                surface_param: Name::user(UserNameKind::Param, surface.name.clone()),
                body: statements,
                symbol: stage.symbol.to_string(),
                span: stage.span,
            },
            structs: std::mem::take(&mut self.types.decls),
            functions,
        })
    }

    /// The GPU function `symbol` with the symbols it calls.
    fn function(&mut self, symbol: &str) -> Result<(Function, Vec<String>), Defect> {
        let function = *self
            .functions
            .get(symbol)
            .ok_or_else(|| format!("the function '{symbol}' is not in the IR"))?;
        if !function.gpu_reachable {
            return Err(format!(
                "the function '{symbol}' is called from a stage but not GPU-reachable"
            ));
        }
        let mut body = Body {
            locals: &function.locals,
            calls: Vec::new(),
        };
        let mut params = Vec::new();
        for param in function.params() {
            params.push(FunctionParam {
                name: Name::user(UserNameKind::Param, param.name.clone()),
                ty: self.types.value_type(&param.ty)?,
                binding: None,
                span: param.span,
            });
        }
        let result = match &function.result {
            Some(ty) => Some(FunctionResult {
                ty: self.types.value_type(ty)?,
                binding: None,
            }),
            None => None,
        };
        let statements = self
            .block(&mut body, &function.body)
            .map_err(|e| format!("function '{symbol}': {e}"))?;
        Ok((
            Function {
                name: function_name(symbol)?,
                stage: None,
                params,
                result,
                body: statements,
                symbol: symbol.to_owned(),
                span: function.span,
            },
            body.calls,
        ))
    }

    fn use_helper(&mut self, helper: Helper) {
        for dependency in helper.dependencies() {
            self.helpers.insert(*dependency);
        }
        self.helpers.insert(helper);
    }

    // Statements.

    fn block(&mut self, body: &mut Body<'p>, block: &ir::Block) -> Result<Vec<Statement>, Defect> {
        let mut out = Vec::with_capacity(block.stmts.len());
        for stmt in &block.stmts {
            if let Some(statement) = self.stmt(body, stmt)? {
                out.push(statement);
            }
        }
        Ok(out)
    }

    fn stmt(&mut self, body: &mut Body<'p>, stmt: &ir::Stmt) -> Result<Option<Statement>, Defect> {
        Ok(Some(match stmt {
            ir::Stmt::Let { local, value, span } => Statement::Let {
                name: local_name(local_item(body, *local)?),
                value: self.expr(body, value)?,
                span: *span,
            },
            ir::Stmt::Var { local, value, span } => Statement::Var {
                name: local_name(local_item(body, *local)?),
                value: self.expr(body, value)?,
                span: *span,
            },
            ir::Stmt::Const { .. } => return Ok(None),
            ir::Stmt::Assign {
                target,
                op,
                value,
                span,
            } => {
                let (place, place_ty) = self.place(body, target, *span)?;
                let lowered = self.expr(body, value)?;
                let value = match *op {
                    "=" => lowered,
                    "+=" | "-=" | "*=" | "/=" => {
                        let operator = op.trim_end_matches('=');
                        self.binary(
                            operator,
                            &place_ty,
                            &value.ty,
                            &place_ty,
                            place.clone(),
                            lowered,
                            *span,
                        )?
                    }
                    other => return Err(format!("the assignment operator '{other}'")),
                };
                Statement::Assign {
                    target: place,
                    value,
                    span: *span,
                }
            }
            ir::Stmt::If {
                branches,
                otherwise,
                span,
            } => {
                let mut lowered = Vec::with_capacity(branches.len());
                for branch in branches {
                    lowered.push((
                        self.expr(body, &branch.cond)?,
                        self.block(body, &branch.body)?,
                    ));
                }
                let otherwise = match otherwise {
                    Some(block) => Some(self.block(body, block)?),
                    None => None,
                };
                Statement::If {
                    branches: lowered,
                    otherwise,
                    span: *span,
                }
            }
            ir::Stmt::ForRange {
                local,
                start,
                end,
                body: loop_body,
                span,
            } => Statement::For {
                name: local_name(local_item(body, *local)?),
                start: self.expr(body, start)?,
                end: self.expr(body, end)?,
                body: self.block(body, loop_body)?,
                span: *span,
            },
            ir::Stmt::ForEach {
                local,
                array,
                body: loop_body,
                span,
            } => self.for_each(body, *local, array, loop_body, *span)?,
            ir::Stmt::Return { value, span } => Statement::Return {
                value: match value {
                    Some(value) => Some(self.expr(body, value)?),
                    None => None,
                },
                span: *span,
            },
            ir::Stmt::Break { span } => Statement::Break { span: *span },
            ir::Stmt::Continue { span } => Statement::Continue { span: *span },
            ir::Stmt::Block { body: block } => Statement::Block {
                body: self.block(body, block)?,
                span: block.span,
            },
            ir::Stmt::Expr { expr, span } => match &expr.kind {
                ir::ExprKind::Call { function, args } => {
                    let (name, args, result) = self.call(body, function.as_str(), args)?;
                    match result {
                        Some(ty) => Statement::Discard {
                            value: Expr::call(name, args, ty, expr.span),
                            span: *span,
                        },
                        None => Statement::Call {
                            function: name,
                            args,
                            span: *span,
                        },
                    }
                }
                _ => Statement::Discard {
                    value: self.expr(body, expr)?,
                    span: *span,
                },
            },
        }))
    }

    /// `for x in arr { body }`: the array is evaluated once into `mtek_each_x`, a `u32`
    /// counter `mtek_at_x` runs over its indices (always in range), and `x` binds each
    /// element.
    fn for_each(
        &mut self,
        body: &mut Body<'p>,
        local: u32,
        array: &ir::Expr,
        loop_body: &ir::Block,
        span: Span,
    ) -> Result<Statement, Defect> {
        let item = local_item(body, local)?;
        let each = Name::generated(format!("each_{}", item.name));
        let counter = Name::generated(format!("at_{}", item.name));
        let array_value = self.expr(body, array)?;
        let element = self.types.array_element(&array.ty)?;
        let array_ref = Expr::local(each.clone(), array_value.ty.clone(), array.span);
        let index = Expr::local(counter.clone(), ShaderType::U32, span);
        let read = self.element_read(array_ref, index, &element, array.span);
        let mut statements = vec![Statement::Let {
            name: local_name(item),
            value: read,
            span: item.span,
        }];
        statements.extend(self.block(body, loop_body)?);
        Ok(Statement::Block {
            body: vec![
                Statement::Let {
                    name: each,
                    value: array_value,
                    span: array.span,
                },
                Statement::For {
                    name: counter,
                    start: Expr::literal(Literal::U32(0), span),
                    end: Expr::literal(Literal::U32(element.length), span),
                    body: statements,
                    span,
                },
            ],
            span,
        })
    }

    /// An assignment target as a WGSL reference, with its IR type.
    fn place(
        &mut self,
        body: &Body<'p>,
        place: &Place,
        span: Span,
    ) -> Result<(Expr, String), Defect> {
        match place {
            Place::Local { local, .. } => {
                let item = local_item(body, *local)?;
                let ty = self.types.value_type(&item.ty)?;
                Ok((Expr::local(local_name(item), ty, span), item.ty.clone()))
            }
            Place::Component { base, index } => {
                let (base, _) = self.place(body, base, span)?;
                let component = component(*index)?;
                Ok((base.swizzle(&[component], span), "f32".to_owned()))
            }
        }
    }

    // Expressions.

    fn exprs(&mut self, body: &mut Body<'p>, items: &[ir::Expr]) -> Result<Vec<Expr>, Defect> {
        items.iter().map(|item| self.expr(body, item)).collect()
    }

    /// The shader IR of `expr`, every node carrying `expr`'s span.
    fn expr(&mut self, body: &mut Body<'p>, expr: &ir::Expr) -> Result<Expr, Defect> {
        let span = expr.span;
        let ty = expr.ty.as_str();
        Ok(match &expr.kind {
            ir::ExprKind::Const { value } => self.value(value, ty, span)?,
            ir::ExprKind::Local { local, .. } => {
                let item = local_item(body, *local)?;
                Expr::local(local_name(item), self.types.value_type(&item.ty)?, span)
            }
            ir::ExprKind::Unary { op, operand } => {
                let operand = self.expr(body, operand)?;
                match *op {
                    "-" => operand.unary(UnaryOp::Negate, span),
                    "!" => operand.unary(UnaryOp::Not, span),
                    other => return Err(format!("the unary operator '{other}'")),
                }
            }
            ir::ExprKind::Binary { op, lhs, rhs } => {
                let left = self.expr(body, lhs)?;
                let right = self.expr(body, rhs)?;
                self.binary(op, &lhs.ty, &rhs.ty, ty, left, right, span)?
            }
            ir::ExprKind::Call { function, args } => {
                let (name, args, result) = self.call(body, function.as_str(), args)?;
                let result =
                    result.ok_or_else(|| format!("the call of '{function}' as a value"))?;
                Expr::call(name, args, result, span)
            }
            ir::ExprKind::Builtin { function, args } => {
                let args = self.exprs(body, args)?;
                let result = self.types.value_type(ty)?;
                self.builtin(function, args, result, span)?
            }
            ir::ExprKind::Construct { args } => {
                let args = self.exprs(body, args)?;
                Expr::construct(self.types.value_type(ty)?, args, span)
            }
            ir::ExprKind::Convert { arg } => {
                let from = arg.ty.as_str();
                let value = self.expr(body, arg)?;
                let to = self.types.value_type(ty)?;
                match (from, ty) {
                    _ if from == ty => value,
                    ("i32", "u32") | ("u32", "i32") => value.bitcast(to, span),
                    ("i32" | "u32", "f32") | ("f32", "i32" | "u32") => {
                        Expr::construct(to, vec![value], span)
                    }
                    _ => return Err(format!("the conversion from {from} to {ty}")),
                }
            }
            ir::ExprKind::Components { base, components } => {
                let base = self.expr(body, base)?;
                let letters = components
                    .iter()
                    .map(|index| component(*index))
                    .collect::<Result<Vec<_>, _>>()?;
                base.swizzle(&letters, span)
            }
            ir::ExprKind::Field { base, field, .. } => {
                let base_ty = base.ty.clone();
                let base = self.expr(body, base)?;
                let place = self.field_place(base, &base_ty, field, ty, span)?;
                decode_if_bool(place, ty, span)
            }
            ir::ExprKind::Index { base, index } => {
                let base_ty = base.ty.clone();
                let base = self.expr(body, base)?;
                let index_value = self.expr(body, index)?;
                let constant = matches!(index.kind, ir::ExprKind::Const { .. });
                let (place, element_ty) =
                    self.index_place(base, &base_ty, index_value, &index.ty, constant, span)?;
                decode_if_bool(place, &element_ty, span)
            }
            ir::ExprKind::Array { elements } => {
                let array = self.types.value_type(ty)?;
                let element = self.types.array_element(ty)?;
                let mut lowered = Vec::with_capacity(elements.len());
                for item in elements {
                    let value = self.expr(body, item)?;
                    lowered.push(store_element(value, &element, item.span));
                }
                Expr::construct(array, lowered, span)
            }
            ir::ExprKind::Struct { fields } => {
                let wgsl = self.types.value_type(ty)?;
                let item = self.types.struct_item(ty)?;
                let mut lowered = Vec::with_capacity(fields.len());
                for (field, declared) in fields.iter().zip(&item.fields) {
                    let value = self.expr(body, &field.value)?;
                    lowered.push(if declared.ty == "bool" {
                        value.bool32_encode(field.value.span)
                    } else {
                        value
                    });
                }
                if lowered.len() != item.fields.len() {
                    return Err(format!("a literal of '{ty}' without every field"));
                }
                Expr::construct(wgsl, lowered, span)
            }
            ir::ExprKind::Param { param, name } => self.param(*param, name, ty, span)?,
            ir::ExprKind::Descriptor { schema, .. } => {
                return Err(format!("the descriptor '{schema}' in GPU code"));
            }
            ir::ExprKind::Material { material, .. } => {
                return Err(format!("an instance of '{material}' in GPU code"));
            }
        })
    }

    /// A call of the user function `symbol`: its WGSL name, the lowered arguments and
    /// its result type (`None` for a function without result). Records the call.
    fn call(
        &mut self,
        body: &mut Body<'p>,
        symbol: &str,
        args: &[ir::Expr],
    ) -> Result<(Name, Vec<Expr>, Option<ShaderType>), Defect> {
        if !body.calls.iter().any(|c| c == symbol) {
            body.calls.push(symbol.to_owned());
        }
        let args = self.exprs(body, args)?;
        let function = *self
            .functions
            .get(symbol)
            .ok_or_else(|| format!("the function '{symbol}' is not in the IR"))?;
        let result = match &function.result {
            Some(result) => Some(self.types.value_type(result)?),
            None => None,
        };
        Ok((function_name(symbol)?, args, result))
    }

    /// The material param `index` (`name`, of IR type `ty`): `mtek_params.u_<name>`.
    fn param(&mut self, index: u32, name: &str, ty: &str, span: Span) -> Result<Expr, Defect> {
        let record = self
            .material
            .layout
            .as_ref()
            .ok_or_else(|| format!("the param '{name}' of a material without a block"))?;
        let LayoutNode::Struct {
            name: block_name,
            members,
            ..
        } = &record.root
        else {
            return Err("the parameter block is not a struct".to_owned());
        };
        let member = members
            .get(index as usize)
            .filter(|m| m.name == name)
            .ok_or_else(|| format!("the param '{name}' is not member {index} of the block"))?;
        let stored = ShaderType::from_layout_node(&member.node);
        // Make sure the structs of the param's type are declared like any other use.
        if ty != "bool" {
            self.types.value_type(ty)?;
        }
        let read = Expr::global(&params_global(record, self.span()), span).field(
            member_wgsl_name(block_name, &member.name),
            stored,
            span,
        );
        Ok(decode_if_bool(read, ty, span))
    }

    /// The field `field` (of IR type `ty`) of `base` (of IR type `base_ty`) as a
    /// reference to its stored form: a `bool` field is the `u32` it is stored as.
    fn field_place(
        &mut self,
        base: Expr,
        base_ty: &str,
        field: &str,
        ty: &str,
        span: Span,
    ) -> Result<Expr, Defect> {
        match parse(base_ty) {
            // `MtekSurfaceInput` members are named like the Mtek fields.
            Some(MtekType::SurfaceInput) => {
                let field_ty = self.types.value_type(ty)?;
                Ok(base.field(field, field_ty, span))
            }
            Some(MtekType::Struct(symbol)) => {
                let stored = self.types.stored_type(ty)?;
                let member = member_wgsl_name(&TypeMapper::struct_name(&symbol), field);
                Ok(base.field(member, stored, span))
            }
            _ => Err(format!("a field read of a value of type {base_ty}")),
        }
    }

    /// The element `index` (of IR type `index_ty`) of `base` (an array or `mat4` of IR
    /// type `base_ty`) as a reference to its stored form, with the element's IR type. A
    /// `constant` index is used as it is (`E3030` keeps it in range); any other is
    /// clamped to `[0, N - 1]`.
    fn index_place(
        &mut self,
        base: Expr,
        base_ty: &str,
        index: Expr,
        index_ty: &str,
        constant: bool,
        span: Span,
    ) -> Result<(Expr, String), Defect> {
        if base_ty == "mat4" {
            let index = if constant {
                index
            } else {
                clamped_index(index, index_ty, 4, span)?
            };
            return Ok((base.index(index, ShaderType::VEC4, span), "vec4".to_owned()));
        }
        let element = self.types.array_element(base_ty)?;
        let index = if constant {
            index
        } else {
            clamped_index(index, index_ty, element.length, span)?
        };
        let read = self.element_ref(base, index, &element, span);
        Ok((read, element.mtek))
    }

    /// `base[index]` (with `.value` when elements are padded): the stored element.
    fn element_ref(
        &self,
        base: Expr,
        index: Expr,
        element: &types::ArrayElement,
        span: Span,
    ) -> Expr {
        match &element.wrapper {
            Some(wrapper) => base.index(index, wrapper.clone(), span).field(
                "value",
                element.stored.clone(),
                span,
            ),
            None => base.index(index, element.stored.clone(), span),
        }
    }

    /// An element read as a value: [`ShaderLowering::element_ref`], decoded for `bool`.
    fn element_read(
        &self,
        base: Expr,
        index: Expr,
        element: &types::ArrayElement,
        span: Span,
    ) -> Expr {
        decode_if_bool(
            self.element_ref(base, index, element, span),
            &element.mtek,
            span,
        )
    }

    /// `left op right` with IR operand types `lt`, `rt` and result type `ty`.
    #[allow(clippy::too_many_arguments)]
    fn binary(
        &mut self,
        op: &str,
        lt: &str,
        rt: &str,
        ty: &str,
        left: Expr,
        right: Expr,
        span: Span,
    ) -> Result<Expr, Defect> {
        let helper = match (op, lt, rt) {
            ("*", "quat", "quat") => Some(Helper::QuatMul),
            ("*", "quat", "vec3") => Some(Helper::QuatRotate),
            _ => None,
        };
        if let Some(helper) = helper {
            self.use_helper(helper);
            return Ok(helper.call(vec![left, right], span));
        }
        let operator = BinaryOp::from_mtek(op).ok_or_else(|| format!("the operator '{op}'"))?;
        let result = self.types.value_type(ty)?;
        Ok(Expr::binary(operator, left, right, result, span))
    }

    /// The built-in function `function` (`sin`, `quat.axis_angle`) applied to `args`.
    fn builtin(
        &mut self,
        function: &str,
        args: Vec<Expr>,
        result: ShaderType,
        span: Span,
    ) -> Result<Expr, Defect> {
        let literal =
            |value: f32| Expr::f32(FiniteF32::new(value).unwrap_or(FiniteF32::ZERO), span);
        let vec4 = |values: [f32; 4]| {
            Expr::construct(
                ShaderType::VEC4,
                values.iter().map(|v| literal(*v)).collect(),
                span,
            )
        };
        let helper = match function {
            "quat.identity" => return Ok(vec4([0.0, 0.0, 0.0, 1.0])),
            "mat4.identity" => {
                return Ok(Expr::construct(
                    ShaderType::Mat4,
                    vec![
                        vec4([1.0, 0.0, 0.0, 0.0]),
                        vec4([0.0, 1.0, 0.0, 0.0]),
                        vec4([0.0, 0.0, 1.0, 0.0]),
                        vec4([0.0, 0.0, 0.0, 1.0]),
                    ],
                    span,
                ));
            }
            "mat4.columns" => return Ok(Expr::construct(ShaderType::Mat4, args, span)),
            "color.linear" => return Ok(Expr::construct(ShaderType::VEC4, args, span)),
            "color.srgb" => Helper::ColorSrgb,
            "quat.axis_angle" => Helper::QuatAxisAngle,
            "quat.euler" => Helper::QuatEuler,
            "mat4.translation" => Helper::Mat4Translation,
            "mat4.scale" => Helper::Mat4Scale,
            "mat4.rotation" => Helper::Mat4Rotation,
            name => {
                let intrinsic = Intrinsic::from_mtek(name)
                    .ok_or_else(|| format!("the built-in function '{name}' has no GPU form"))?;
                return Ok(Expr::intrinsic(intrinsic, args, result, span));
            }
        };
        self.use_helper(helper);
        Ok(helper.call(args, span))
    }

    /// The folded constant `value` of IR type `ty` as literals and constructors.
    /// Values nest as their types do, at most 256 levels (`E3032`).
    fn value(&mut self, value: &Value, ty: &str, span: Span) -> Result<Expr, Defect> {
        let f = |v: f32| {
            FiniteF32::new(v)
                .map(|v| Expr::f32(v, span))
                .ok_or_else(|| format!("the constant {v} is not finite"))
        };
        let floats = |values: &[f32], ty: ShaderType| -> Result<Expr, Defect> {
            let args = values
                .iter()
                .map(|v| f(*v))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Expr::construct(ty, args, span))
        };
        Ok(match value {
            Value::Bool(v) => Expr::literal(Literal::Bool(*v), span),
            Value::I32(v) => Expr::literal(Literal::I32(*v), span),
            Value::U32(v) => Expr::literal(Literal::U32(*v), span),
            Value::F32(v) => f(*v)?,
            Value::Vec2(v) => floats(v, ShaderType::VEC2)?,
            Value::Vec3(v) => floats(v, ShaderType::VEC3)?,
            Value::Vec4(v) | Value::Quat(v) | Value::Color(v) => floats(v, ShaderType::VEC4)?,
            Value::Mat4(columns) => {
                let columns = columns
                    .iter()
                    .map(|column| floats(column, ShaderType::VEC4))
                    .collect::<Result<Vec<_>, _>>()?;
                Expr::construct(ShaderType::Mat4, columns, span)
            }
            Value::Struct { fields, .. } => {
                let wgsl = self.types.value_type(ty)?;
                let item = self.types.struct_item(ty)?;
                if fields.len() != item.fields.len() {
                    return Err(format!("a constant of '{ty}' without every field"));
                }
                let mut lowered = Vec::with_capacity(fields.len());
                for (field, declared) in fields.iter().zip(&item.fields) {
                    lowered.push(self.stored_value(&field.value, &declared.ty, span)?);
                }
                Expr::construct(wgsl, lowered, span)
            }
            Value::Array(items) => {
                let array = self.types.value_type(ty)?;
                let element = self.types.array_element(ty)?;
                let mut lowered = Vec::with_capacity(items.len());
                for item in items {
                    let stored = self.stored_value(item, &element.mtek, span)?;
                    lowered.push(match &element.wrapper {
                        Some(wrapper) => Expr::construct(wrapper.clone(), vec![stored], span),
                        None => stored,
                    });
                }
                Expr::construct(array, lowered, span)
            }
            Value::String(_) => return Err("a string constant in GPU code".to_owned()),
        })
    }

    /// A constant as stored in a struct field or array element: a `bool` is `1u`/`0u`.
    fn stored_value(&mut self, value: &Value, ty: &str, span: Span) -> Result<Expr, Defect> {
        match value {
            Value::Bool(v) => Ok(Expr::literal(Literal::U32(u32::from(*v)), span)),
            _ => self.value(value, ty, span),
        }
    }
}

/// An element value as stored in an array: `bool` encoded, wrapped when padded.
fn store_element(value: Expr, element: &types::ArrayElement, span: Span) -> Expr {
    let stored = if element.mtek == "bool" {
        value.bool32_encode(span)
    } else {
        value
    };
    match &element.wrapper {
        Some(wrapper) => Expr::construct(wrapper.clone(), vec![stored], span),
        None => stored,
    }
}

/// `(stored != 0u)` when the IR type `ty` is `bool`, else `stored`.
fn decode_if_bool(stored: Expr, ty: &str, span: Span) -> Expr {
    if ty == "bool" {
        stored.bool32_decode(span)
    } else {
        stored
    }
}

/// The index `index` (of IR type `index_ty`) clamped to `[0, length - 1]`: `min(i,
/// length - 1u)` for `u32`, `clamp(i, 0i, length - 1i)` for `i32`.
fn clamped_index(index: Expr, index_ty: &str, length: u32, span: Span) -> Result<Expr, Defect> {
    let last = length.saturating_sub(1);
    match index_ty {
        "u32" => Ok(Expr::intrinsic(
            Intrinsic::Min,
            vec![index, Expr::literal(Literal::U32(last), span)],
            ShaderType::U32,
            span,
        )),
        "i32" => {
            let last = i32::try_from(last).map_err(|_| format!("the array length {length}"))?;
            Ok(Expr::intrinsic(
                Intrinsic::Clamp,
                vec![
                    index,
                    Expr::literal(Literal::I32(0), span),
                    Expr::literal(Literal::I32(last), span),
                ],
                ShaderType::I32,
                span,
            ))
        }
        other => Err(format!("an index of type {other}")),
    }
}

fn component(index: u32) -> Result<Component, Defect> {
    Ok(match index {
        0 => Component::X,
        1 => Component::Y,
        2 => Component::Z,
        3 => Component::W,
        _ => return Err(format!("the component {index}")),
    })
}

fn local_item<'p>(body: &Body<'p>, index: u32) -> Result<&'p LocalItem, Defect> {
    body.locals
        .get(index as usize)
        .ok_or_else(|| format!("the local #{index} is not declared"))
}

/// `u_p_<name>` for a parameter, `u_l_<name>` for a local or loop variable.
fn local_name(item: &LocalItem) -> Name {
    let kind = if item.kind == LocalKind::Param {
        UserNameKind::Param
    } else {
        UserNameKind::Local
    };
    Name::user(kind, item.name.clone())
}

/// `u_fn_<hash8>_<name>` for the function `symbol` (`path::name`).
fn function_name(symbol: &str) -> Result<Name, Defect> {
    let (path, name) = symbol
        .rsplit_once("::")
        .filter(|(path, name)| !path.is_empty() && !name.is_empty())
        .ok_or_else(|| format!("'{symbol}' is not the symbol of a module item"))?;
    Ok(Name::user(
        UserNameKind::Function,
        format!("{}_{name}", hash8(path)),
    ))
}

#[cfg(test)]
mod tests;
