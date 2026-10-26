//! Backend evidence only: these modules are constructed from typed shader IR.
//! They do not prove that Mtek source can declare or dispatch a compute shader.

#![allow(clippy::panic)]

use mtek_compiler::emit_wgsl::{print_module, validate, validate_wgsl};
use mtek_compiler::layout::{LayoutType, compute, storage_array};
use mtek_compiler::lowering::shader_ir::{
    BinaryOp, BuiltinValue, Component, Expr, Function, FunctionParam, GlobalDecl, GlobalKind,
    IoBinding, Literal, Name, Scalar, ShaderModule, ShaderStage, ShaderType, Statement,
    StorageAccess, VectorSize,
};
use mtek_compiler::source::{FileId, Span};

fn at(start: u32) -> Span {
    Span::new(FileId(7), start, start + 1)
}

fn transform() -> ShaderModule {
    let mut module = ShaderModule::new("src/main.mtek::Scale", at(1));
    let layout = compute(
        &LayoutType::new_struct(
            "Dispatch",
            vec![
                ("count".into(), LayoutType::U32),
                ("gain".into(), LayoutType::F32),
            ],
        ),
        "compute:dispatch",
        "MtekDispatch",
    )
    .unwrap_or_else(|e| panic!("dispatch layout: {e}"));
    module.declare_block(&layout, at(2));
    let uniform = GlobalDecl {
        name: Name::generated("dispatch"),
        kind: GlobalKind::Uniform {
            group: 0,
            binding: 0,
            ty: ShaderType::named("MtekDispatch"),
        },
        span: at(2),
    };
    let node =
        storage_array(&LayoutType::F32, 257).unwrap_or_else(|e| panic!("storage layout: {e}"));
    let resource = |name: &str, binding, access, span| GlobalDecl {
        name: Name::generated(name),
        kind: GlobalKind::Storage {
            group: 0,
            binding,
            access,
            ty: ShaderType::from_layout_node(&node),
        },
        span,
    };
    let source = resource("source", 1, StorageAccess::Read, at(3));
    let output = resource("output", 2, StorageAccess::ReadWrite, at(4));
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
        span: at(5),
    })
    .collect();
    let index = Expr::local(params[0].name.clone(), uvec3, at(6)).swizzle(&[Component::X], at(7));
    let in_range = Expr::binary(
        BinaryOp::Less,
        index.clone(),
        Expr::global(&uniform, at(8)).field("u_count", ShaderType::U32, at(9)),
        ShaderType::BOOL,
        at(10),
    );
    let target = Expr::global(&output, at(11)).index(index.clone(), ShaderType::F32, at(12));
    let value = Expr::binary(
        BinaryOp::Multiply,
        Expr::global(&source, at(13)).index(index, ShaderType::F32, at(14)),
        Expr::global(&uniform, at(15)).field("u_gain", ShaderType::F32, at(16)),
        ShaderType::F32,
        at(17),
    );
    module.globals = vec![uniform, source, output];
    module.functions.push(Function {
        name: Name::generated("cs"),
        stage: Some(ShaderStage::Compute {
            workgroup_size: [64, 1, 1],
        }),
        params,
        result: None,
        body: vec![Statement::If {
            branches: vec![(
                in_range,
                vec![Statement::Assign {
                    target,
                    value,
                    span: at(18),
                }],
            )],
            otherwise: None,
            span: at(19),
        }],
        symbol: "src/main.mtek::Scale.kernel".into(),
        span: at(20),
    });
    module
}

#[test]
fn compute_entry_storage_access_uniforms_and_builtins_validate() {
    let printed = print_module(&transform());
    let parsed =
        validate_wgsl(&printed.text).unwrap_or_else(|e| panic!("{}\n{}", e.rendered, printed.text));
    assert_eq!(parsed.entry_points.len(), 1);
    let entry = &parsed.entry_points[0];
    assert_eq!(entry.name, "mtek_cs");
    assert_eq!(entry.stage, naga::ShaderStage::Compute);
    assert_eq!(entry.workgroup_size, [64, 1, 1]);
    let bindings: Vec<_> = entry
        .function
        .arguments
        .iter()
        .map(|arg| arg.binding.clone())
        .collect();
    assert_eq!(
        bindings,
        vec![
            Some(naga::Binding::BuiltIn(naga::BuiltIn::GlobalInvocationId)),
            Some(naga::Binding::BuiltIn(naga::BuiltIn::LocalInvocationId)),
            Some(naga::Binding::BuiltIn(naga::BuiltIn::WorkGroupId)),
            Some(naga::Binding::BuiltIn(naga::BuiltIn::NumWorkGroups)),
            Some(naga::Binding::BuiltIn(naga::BuiltIn::LocalInvocationIndex)),
        ]
    );
    let globals: Vec<_> = parsed
        .global_variables
        .iter()
        .map(|(_, value)| value)
        .collect();
    assert_eq!(globals[0].space, naga::AddressSpace::Uniform);
    assert_eq!(
        globals[1].space,
        naga::AddressSpace::Storage {
            access: naga::StorageAccess::LOAD
        }
    );
    assert_eq!(
        globals[2].space,
        naga::AddressSpace::Storage {
            access: naga::StorageAccess::LOAD | naga::StorageAccess::STORE,
        }
    );
    for (binding, global) in globals.iter().enumerate() {
        let resource = global
            .binding
            .as_ref()
            .unwrap_or_else(|| panic!("resource binding"));
        assert_eq!(resource.group, 0);
        assert_eq!(resource.binding, binding as u32);
    }
    assert!(
        printed
            .text
            .contains("mtek_global.x < mtek_dispatch.u_count")
    );
    assert!(printed.text.contains(
        "mtek_output[mtek_global.x] = mtek_source[mtek_global.x] * mtek_dispatch.u_gain;"
    ));
    assert_eq!(printed, print_module(&transform()));
}

#[test]
fn compute_declarations_and_expressions_keep_source_locations() {
    let printed = print_module(&transform());
    for (needle, expected, symbol) in [
        ("var<storage, read>", at(3), "src/main.mtek::Scale"),
        (
            "@compute @workgroup_size",
            at(20),
            "src/main.mtek::Scale.kernel",
        ),
        (
            "@builtin(global_invocation_id)",
            at(5),
            "src/main.mtek::Scale.kernel",
        ),
        (
            "mtek_source[mtek_global.x]",
            at(13),
            "src/main.mtek::Scale.kernel",
        ),
        (
            "mtek_dispatch.u_gain",
            at(15),
            "src/main.mtek::Scale.kernel",
        ),
    ] {
        let start = printed
            .text
            .find(needle)
            .unwrap_or_else(|| panic!("missing {needle}"));
        let (line, column) =
            mtek_compiler::emit_wgsl::span_map::wgsl_line_column(&printed.text, start);
        assert_eq!(
            printed.span_map.resolve(line, column),
            (expected, symbol),
            "{needle}"
        );
    }
}

#[test]
fn writing_a_read_only_resource_is_a_mapped_backend_error() {
    let mut module = transform();
    let GlobalKind::Storage { access, .. } = &mut module.globals[2].kind else {
        panic!("output storage")
    };
    *access = StorageAccess::Read;
    let printed = print_module(&module);
    let errors = validate(&printed.text, &printed.span_map).expect_err("read-only store must fail");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].code, mtek_compiler::diagnostics::Code::E6100);
    assert_eq!(
        errors[0].primary.as_ref().map(|label| label.span.file),
        Some(FileId(7))
    );
}

#[test]
fn compute_rejects_derivatives_and_zero_workgroups() {
    let mut module = transform();
    let function = &mut module.functions[0];
    function.body.insert(
        0,
        Statement::Discard {
            value: Expr::intrinsic(
                mtek_compiler::lowering::shader_ir::Intrinsic::Dpdx,
                vec![Expr::literal(
                    Literal::F32(mtek_compiler::lowering::shader_ir::FiniteF32::ONE),
                    at(21),
                )],
                ShaderType::F32,
                at(22),
            ),
            span: at(23),
        },
    );
    assert!(validate_wgsl(&print_module(&module).text).is_err());
    for workgroup_size in [[0, 1, 1], [1, 0, 1], [1, 1, 0]] {
        let mut module = transform();
        module.functions[0].stage = Some(ShaderStage::Compute { workgroup_size });
        assert!(validate_wgsl(&print_module(&module).text).is_err());
    }
}

#[test]
fn all_three_static_workgroup_dimensions_are_preserved() {
    let mut module = transform();
    module.functions[0].stage = Some(ShaderStage::Compute {
        workgroup_size: [8, 4, 2],
    });
    let printed = print_module(&module);
    assert!(printed.text.contains("@compute @workgroup_size(8, 4, 2)\n"));
    let parsed = validate_wgsl(&printed.text).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(parsed.entry_points[0].workgroup_size, [8, 4, 2]);
}
