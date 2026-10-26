//! Compute kernels share the material expression/statement lowering and helper graph.
//! This produces typed shader IR only; public packaging is still blocked by E4901.

use super::*;
use crate::ir::{ComputeBufferItem, ComputeItem};
use crate::layout::{LayoutError, LayoutRecord, LayoutType, compute as compute_layout};
use crate::lowering::shader_ir::{
    BuiltinValue, GlobalDecl, GlobalKind, IoBinding, Scalar, ShaderModule, ShaderStage,
    StorageAccess, StructDecl, StructMember, VectorSize, type_decls_from_layout_node,
};

/// Lower a checked compute item to typed shader IR, including its guarded 3D entry.
/// Host dispatch must validate a nonzero domain whose product fits the output capacity.
/// This development backend does not enable compute packaging or runtime dispatch.
///
/// # Errors
/// E9999 when the supplied typed IR violates the compiler's invariants.
pub fn lower_compute(
    program: &Program,
    compute: &ComputeItem,
) -> Result<ShaderModule, Vec<Diagnostic>> {
    ShaderLowering::new(program, ShaderOwner::Compute(compute)).compute_module().map_err(|defect| {
        vec![Diagnostic::new(Code::E9999,
            format!("The shader of compute '{}' could not be generated; this is a compiler bug.", compute.symbol))
            .at(compute.span).note(defect).help("please report it with the program that caused it")]
    })
}

/// The authoritative host/shader layout of a validated logical dispatch domain.
/// Each axis is nonzero; their product must fit the output resource and u32.
pub fn compute_dispatch_layout() -> Result<LayoutRecord, LayoutError> {
    compute_layout(
        &LayoutType::new_struct(
            "MtekComputeDispatch",
            vec![
                ("x".into(), LayoutType::U32),
                ("y".into(), LayoutType::U32),
                ("z".into(), LayoutType::U32),
            ],
        ),
        "compute:dispatch",
        "MtekComputeDispatch",
    )
}

fn storage_global(buffer: &ComputeBufferItem, input: Option<u32>, binding: u32) -> GlobalDecl {
    GlobalDecl {
        name: Name::generated(input.map_or_else(|| "output".to_owned(), |i| format!("input_{i}"))),
        kind: GlobalKind::Storage {
            group: 0,
            binding,
            access: if input.is_some() {
                StorageAccess::Read
            } else {
                StorageAccess::ReadWrite
            },
            ty: ShaderType::from_layout_node(&buffer.layout),
        },
        span: buffer.span,
    }
}

impl<'p> ShaderLowering<'p> {
    fn compute_module(mut self) -> Result<ShaderModule, Defect> {
        let ShaderOwner::Compute(compute) = self.owner else {
            return Err("compute lowering of material".into());
        };
        let span = compute.span;
        let size = compute.workgroup_size;
        if size.contains(&0)
            || size[0] > 256
            || size[1] > 256
            || size[2] > 64
            || size
                .iter()
                .try_fold(1u32, |n, axis| n.checked_mul(*axis))
                .is_none_or(|n| n > 256)
        {
            return Err("invalid compute workgroup size".into());
        }
        if compute.inputs.len() > 4 {
            return Err("too many compute inputs".into());
        }
        for buffer in compute
            .inputs
            .iter()
            .chain(std::iter::once(&compute.output))
        {
            validate_storage(buffer)?;
        }
        let mut module = ShaderModule::new(compute.symbol.to_string(), span);
        let mut body = Body {
            locals: &compute.kernel.locals,
            calls: Vec::new(),
        };
        let param = compute
            .kernel
            .locals
            .first()
            .filter(|param| param.kind == LocalKind::Param && param.ty == "ComputeInput")
            .ok_or("compute kernel has no invocation parameter")?;
        if compute
            .kernel
            .locals
            .iter()
            .filter(|local| local.kind == LocalKind::Param)
            .count()
            != 1
            || compute.kernel.result != compute.output.element
        {
            return Err("invalid compute kernel signature".into());
        }
        let result_ty = self.types.value_type(&compute.kernel.result)?;
        let statements = self.block(&mut body, &compute.kernel.body)?;
        module.functions = self.reachable_functions(&body.calls)?;
        module.functions.push(Function {
            name: Name::generated("kernel"),
            stage: None,
            params: vec![FunctionParam {
                name: local_name(param),
                ty: ShaderType::named("MtekComputeInput"),
                binding: None,
                span: param.span,
            }],
            result: Some(FunctionResult {
                ty: result_ty.clone(),
                binding: None,
            }),
            body: statements,
            symbol: compute.kernel.symbol.to_string(),
            span: compute.kernel.span,
        });
        let fields = [
            "index",
            "global_x",
            "global_y",
            "global_z",
            "local_x",
            "local_y",
            "local_z",
            "group_x",
            "group_y",
            "group_z",
            "group_count_x",
            "group_count_y",
            "group_count_z",
            "local_index",
        ];
        module.structs.push(StructDecl {
            name: "MtekComputeInput".into(),
            members: fields
                .iter()
                .map(|field| StructMember {
                    name: (*field).into(),
                    ty: ShaderType::U32,
                    align: None,
                    size: None,
                    binding: None,
                    span,
                })
                .collect(),
            span,
        });
        // Collect the value declarations before blocks to keep every dependency before use.
        module.structs.append(&mut self.types.decls);
        let dispatch_layout = compute_dispatch_layout()
            .map_err(|error| format!("dispatch block has no layout: {error}"))?;
        module.declare_block(&dispatch_layout, span);
        let dispatch = GlobalDecl {
            name: Name::generated("dispatch"),
            kind: GlobalKind::Uniform {
                group: 0,
                binding: 0,
                ty: ShaderType::named("MtekComputeDispatch"),
            },
            span,
        };
        module.globals.push(dispatch.clone());
        if let Some(layout) = &compute.layout {
            module.declare_block(layout, span);
            module.globals.push(GlobalDecl {
                name: Name::generated("params"),
                kind: GlobalKind::Uniform {
                    group: 0,
                    binding: 1,
                    ty: ShaderType::named(&layout.wgsl_struct),
                },
                span,
            });
        }
        for (index, input) in compute.inputs.iter().enumerate() {
            declare_storage(&mut module, input)?;
            module
                .globals
                .push(storage_global(input, Some(index as u32), index as u32 + 2));
        }
        declare_storage(&mut module, &compute.output)?;
        let output = storage_global(&compute.output, None, compute.inputs.len() as u32 + 2);
        module.globals.push(output.clone());
        module
            .functions
            .push(compute_entry(compute, &dispatch, &output, result_ty)?);
        Ok(module)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn storage_read(
        &mut self,
        body: &mut Body<'p>,
        input: u32,
        name: &str,
        capacity: u32,
        index: &ir::Expr,
        ty: &str,
        span: Span,
    ) -> Result<Expr, Defect> {
        let ShaderOwner::Compute(compute) = self.owner else {
            return Err("compute storage read in a material".into());
        };
        let buffer = compute
            .inputs
            .get(input as usize)
            .filter(|buffer| {
                buffer.name == name && buffer.capacity == capacity && buffer.element == ty
            })
            .ok_or("storage read disagrees with its input declaration")?;
        let value = self.expr(body, index)?;
        let value = if matches!(index.kind, ir::ExprKind::Const { .. }) {
            value
        } else {
            clamped_index(value, &index.ty, capacity, span)?
        };
        let stored = self.types.stored_type(ty)?;
        let read = Expr::global(&storage_global(buffer, Some(input), input + 2), span)
            .index(value, stored, span);
        Ok(decode_if_bool(read, ty, span))
    }
}

fn validate_storage(buffer: &ComputeBufferItem) -> Result<(), Defect> {
    if !matches!(buffer.layout, LayoutNode::Array { length, padded: false, .. } if length == buffer.capacity && length > 0)
        || buffer.layout.size() > 16 * 1024 * 1024
    {
        return Err("invalid compute storage layout".into());
    }
    Ok(())
}

fn declare_storage(module: &mut ShaderModule, buffer: &ComputeBufferItem) -> Result<(), Defect> {
    validate_storage(buffer)?;
    for declaration in type_decls_from_layout_node(&buffer.layout, buffer.span) {
        if !module
            .structs
            .iter()
            .any(|existing| existing.name == declaration.name)
        {
            module.structs.push(declaration);
        }
    }
    Ok(())
}

fn compute_entry(
    compute: &ComputeItem,
    dispatch: &GlobalDecl,
    output: &GlobalDecl,
    result_ty: ShaderType,
) -> Result<Function, Defect> {
    let span = compute.span;
    let uvec3 = ShaderType::Vector {
        size: VectorSize::Three,
        scalar: Scalar::U32,
    };
    let params: Vec<_> = [
        ("global", BuiltinValue::GlobalInvocationId, uvec3.clone()),
        ("local", BuiltinValue::LocalInvocationId, uvec3.clone()),
        ("group", BuiltinValue::WorkgroupId, uvec3.clone()),
        ("groups", BuiltinValue::NumWorkgroups, uvec3.clone()),
        (
            "local_index",
            BuiltinValue::LocalInvocationIndex,
            ShaderType::U32,
        ),
    ]
    .into_iter()
    .map(|(name, builtin, ty)| FunctionParam {
        name: Name::generated(name),
        ty,
        binding: Some(IoBinding::Builtin(builtin)),
        span,
    })
    .collect();
    let component = |param: usize, component| {
        Expr::local(params[param].name.clone(), uvec3.clone(), span).swizzle(&[component], span)
    };
    let axis = |name| {
        Expr::global(dispatch, span).field(
            member_wgsl_name("MtekComputeDispatch", name),
            ShaderType::U32,
            span,
        )
    };
    let op = |kind, lhs, rhs, ty| Expr::binary(kind, lhs, rhs, ty, span);
    let mut outside = op(
        BinaryOp::GreaterEqual,
        component(0, Component::X),
        axis("x"),
        ShaderType::BOOL,
    );
    for (component_name, name) in [(Component::Y, "y"), (Component::Z, "z")] {
        let check = op(
            BinaryOp::GreaterEqual,
            component(0, component_name),
            axis(name),
            ShaderType::BOOL,
        );
        outside = op(BinaryOp::LogicalOr, outside, check, ShaderType::BOOL);
    }
    // Guard every coordinate before forming x + width * (y + height * z).
    // Host validation guarantees the domain product fits the output capacity and u32.
    let linear = op(
        BinaryOp::Add,
        component(0, Component::X),
        op(
            BinaryOp::Multiply,
            axis("x"),
            op(
                BinaryOp::Add,
                component(0, Component::Y),
                op(
                    BinaryOp::Multiply,
                    axis("y"),
                    component(0, Component::Z),
                    ShaderType::U32,
                ),
                ShaderType::U32,
            ),
            ShaderType::U32,
        ),
        ShaderType::U32,
    );
    let index_name = Name::generated("index");
    let index = Expr::local(index_name.clone(), ShaderType::U32, span);
    let mut values = vec![index.clone()];
    for param in 0..4 {
        for field in [Component::X, Component::Y, Component::Z] {
            values.push(component(param, field));
        }
    }
    values.push(Expr::local(params[4].name.clone(), ShaderType::U32, span));
    let input = Expr::construct(ShaderType::named("MtekComputeInput"), values, span);
    let result = Expr::call(
        Name::generated("kernel"),
        vec![input],
        result_ty,
        compute.kernel.span,
    );
    let result = if compute.output.element == "bool" {
        result.bool32_encode(compute.kernel.span)
    } else {
        result
    };
    let stored = match &compute.output.layout {
        LayoutNode::Array { element, .. } => ShaderType::from_layout_node(element),
        _ => return Err("output layout is not an array".into()),
    };
    Ok(Function {
        name: Name::generated("cs"),
        stage: Some(ShaderStage::Compute {
            workgroup_size: compute.workgroup_size,
        }),
        params,
        result: None,
        body: vec![
            Statement::If {
                branches: vec![(outside, vec![Statement::Return { value: None, span }])],
                otherwise: None,
                span,
            },
            Statement::Let {
                name: index_name,
                value: linear,
                span,
            },
            Statement::Assign {
                target: Expr::global(output, span).index(index, stored, span),
                value: result,
                span: compute.kernel.span,
            },
        ],
        symbol: compute.kernel.symbol.to_string(),
        span,
    })
}
