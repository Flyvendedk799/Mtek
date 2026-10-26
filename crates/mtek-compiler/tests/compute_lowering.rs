//! Development source-to-WGSL evidence. Only this test removes the explicit E4901
//! gate after asserting it is the sole source error. No public build can bypass it.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::{Code, Severity};
use mtek_compiler::emit_wgsl::{print_module, validate_wgsl};
use mtek_compiler::ir::{self, ExprKind, Program, Stmt};
use mtek_compiler::lowering::shader::lower_compute;
use mtek_compiler::lowering::shader_ir::{BinaryOp, Expr, ExprKind as ShaderExpr, Statement};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};

const SOURCE: &str = r#"
compute Scale {
    param gain: f32 = 2.0;
    input source: array<f32, 257>;
    output result: array<f32, 257>;
    workgroup_size: [8, 4, 2];
    kernel(input: ComputeInput) -> f32 {
        return ((source))[input.index] * gain;
    }
}
scene Demo { camera Main {} }
"#;

fn memory(source: &str) -> MemFs {
    let mut memory = MemFs::new();
    memory.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        b"[project]\nname = \"compute-lowering\"\nlanguage = \"0.1\"\n".to_vec(),
    );
    memory.insert(
        ProjectPath::new("src/main.mtek").unwrap(),
        source.as_bytes().to_vec(),
    );
    memory
}

fn development_ir(memory: &MemFs) -> Program {
    let mut analysis = mtek_compiler::analyze(&ProjectRoot::at_base(), memory);
    let errors: Vec<_> = analysis
        .report
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .map(|d| d.code)
        .collect();
    assert!(!errors.is_empty());
    assert!(
        errors.iter().all(|code| *code == Code::E4901),
        "{:?}",
        analysis.report
    );
    assert_eq!(ir::lower_to_ir(&analysis), Err(ir::LowerError::HasErrors));
    analysis
        .report
        .diagnostics
        .retain(|diagnostic| diagnostic.code != Code::E4901);
    analysis.report.summary.errors = 0;
    ir::lower_to_ir(&analysis).unwrap()
}

fn shader(source: &str) -> (Program, mtek_compiler::emit_wgsl::PrintedModule) {
    let program = development_ir(&memory(source));
    let item = program.computes().next().unwrap();
    let module = lower_compute(&program, item).unwrap();
    let printed = print_module(&module);
    validate_wgsl(&printed.text)
        .unwrap_or_else(|error| panic!("{}\n{}", error.rendered, printed.text));
    assert_eq!(
        printed,
        print_module(&lower_compute(&program, item).unwrap())
    );
    (program, printed)
}

#[test]
fn source_kernel_uniforms_storage_and_three_dimensional_entry_validate() {
    let (program, printed) = shader(SOURCE);
    let compute = program.computes().next().unwrap();
    assert_eq!(compute.workgroup_size, [8, 4, 2]);
    assert_eq!(compute.inputs[0].layout.size(), 257 * 4);
    assert_eq!(compute.output.layout.size(), 257 * 4);
    assert_eq!(compute.params[0].default, Some(ir::Value::F32(2.0)));
    let Stmt::Return {
        value: Some(value), ..
    } = &compute.kernel.body.stmts[0]
    else {
        panic!("return")
    };
    let ExprKind::Binary { lhs, .. } = &value.kind else {
        panic!("multiply")
    };
    assert!(
        matches!(&lhs.kind, ExprKind::StorageRead { input: 0, name, capacity: 257, .. } if name == "source")
    );
    assert!(printed.text.contains("@compute @workgroup_size(8, 4, 2)"));
    assert!(
        printed
            .text
            .contains("mtek_input_0[min(u_p_input.index, 256u)] * mtek_params.u_gain"),
        "{}",
        printed.text
    );
    assert!(
        printed
            .text
            .contains("var<storage, read> mtek_input_0: array<f32, 257>")
    );
    assert!(
        printed
            .text
            .contains("var<storage, read_write> mtek_output: array<f32, 257>")
    );
    assert!(
        mtek_compiler::plan::plan_program(&program)
            .unwrap_err()
            .contains("compute packaging")
    );
    let json = ir::to_json(&program);
    assert!(json.contains("\"kind\": \"compute\""));
    assert!(json.contains("\"kind\": \"storageRead\""));
}

#[test]
fn scalar_bool_and_composite_storage_keep_their_value_representation() {
    for element in [
        "bool",
        "i32",
        "u32",
        "f32",
        "vec2",
        "vec3",
        "vec4",
        "color",
        "quat",
        "mat4",
        "array<f32, 3>",
        "array<bool, 3>",
        "Record",
    ] {
        let source = format!(
            "struct Record {{ enabled: bool; values: array<f32, 3>; orientation: quat; }}\ncompute Copy {{ input source: array<{element}, 257>; output result: array<{element}, 257>; kernel(input: ComputeInput) -> {element} {{ return source[input.index]; }} }}\nscene Demo {{ camera Main {{}} }}"
        );
        let (_, printed) = shader(&source);
        if element == "bool" {
            assert!(printed.text.contains("!= 0u"));
            assert!(printed.text.contains("select(0u, 1u, mtek_kernel"));
        }
        if element == "array<f32, 3>" {
            assert!(printed.text.contains("MtekPad16_f32"));
        }
    }
}

#[test]
fn helper_graph_compute_record_and_mutable_composite_values_validate() {
    let source = r#"
struct Result { enabled: bool; value: f32; orientation: quat; }
fn index(input: ComputeInput) -> u32 { return input.global_x + input.local_x + input.group_x + input.group_count_x + input.local_index; }
fn adjust(value: Result, input: ComputeInput) -> Result {
    var result = value;
    result.enabled = !value.enabled;
    result.value = value.value + f32(index(input));
    result.orientation = quat.axis_angle(vec3(0.0, 1.0, 0.0), value.value);
    return result;
}
compute Transform {
    input source: array<Result, 128>;
    output result: array<Result, 128>;
    kernel(input: ComputeInput) -> Result { return adjust(source[input.index], input); }
}
scene Demo { camera Main {} }
"#;
    let (_, printed) = shader(source);
    let index = printed.text.find("_index(").unwrap();
    let adjust = printed.text.find("_adjust(").unwrap();
    let kernel = printed.text.find("fn mtek_kernel(").unwrap();
    assert!(index < adjust && adjust < kernel);
    assert!(printed.text.contains("MtekComputeInput"));
}

#[test]
fn signed_dynamic_reads_clamp_and_constant_reads_stay_direct() {
    let (_, printed) = shader(&SOURCE.replace("input.index", "i32(input.index) - 9"));
    assert!(
        printed
            .text
            .contains("clamp(bitcast<i32>(u_p_input.index) - 9i, 0i, 256i)"),
        "{}",
        printed.text
    );
    let (_, printed) = shader(&SOURCE.replace("input.index", "12"));
    assert!(
        printed.text.contains("mtek_input_0[12i]"),
        "{}",
        printed.text
    );
    assert!(!printed.text.contains("min("));
}

#[test]
fn input_reads_and_parameters_keep_source_spans() {
    let (_, printed) = shader(SOURCE);
    for (needle, source, symbol) in [
        (
            "mtek_input_0[min",
            "((source))[input.index]",
            "src/main.mtek::Scale.kernel",
        ),
        ("mtek_params.u_gain", "gain", "src/main.mtek::Scale.kernel"),
        (
            "var<storage, read>",
            "input source: array<f32, 257>;",
            "src/main.mtek::Scale",
        ),
    ] {
        let offset = printed.text.find(needle).unwrap();
        let (line, column) =
            mtek_compiler::emit_wgsl::span_map::wgsl_line_column(&printed.text, offset);
        let (span, actual_symbol) = printed.span_map.resolve(line, column);
        assert_eq!(&SOURCE[span.start as usize..span.end as usize], source);
        assert_eq!(actual_symbol, symbol);
    }
}

// Interpret the generated guard/index expressions over rounded workgroups. This
// tests the actual emitted IR, rather than reimplementing its flattening formula.
fn evaluate(expr: &Expr, global: [u32; 3], domain: [u32; 3]) -> u32 {
    match &expr.kind {
        ShaderExpr::Swizzle { components, .. } => {
            global[match components[0] {
                mtek_compiler::lowering::shader_ir::Component::X => 0,
                mtek_compiler::lowering::shader_ir::Component::Y => 1,
                _ => 2,
            }]
        }
        ShaderExpr::Field { member, .. } => {
            domain[match member.as_str() {
                "x" => 0,
                "y" => 1,
                "z" => 2,
                _ => panic!("field {member}"),
            }]
        }
        ShaderExpr::Binary { op, left, right } => {
            let left = evaluate(left, global, domain);
            let right = evaluate(right, global, domain);
            match op {
                BinaryOp::Add => left + right,
                BinaryOp::Multiply => left * right,
                BinaryOp::GreaterEqual => u32::from(left >= right),
                BinaryOp::LogicalOr => u32::from(left != 0 || right != 0),
                _ => panic!("operator {op:?}"),
            }
        }
        _ => panic!("unexpected entry expression {:?}", expr.kind),
    }
}

#[test]
fn rounded_three_dimensional_tails_cannot_alias_logical_slots() {
    let program = development_ir(&memory(SOURCE));
    let module = lower_compute(&program, program.computes().next().unwrap()).unwrap();
    let entry = module.functions.last().unwrap();
    let Statement::If { branches, .. } = &entry.body[0] else {
        panic!("guard before index")
    };
    let Statement::Let { value: linear, .. } = &entry.body[1] else {
        panic!("linear index")
    };
    for domain in [[1u32, 1, 1], [7, 3, 2], [9, 5, 3], [13, 1, 1], [1, 5, 7]] {
        let mut seen = std::collections::BTreeSet::new();
        let rounded =
            std::array::from_fn::<_, 3, _>(|i| domain[i].div_ceil([8, 4, 2][i]) * [8, 4, 2][i]);
        for z in 0..rounded[2] {
            for y in 0..rounded[1] {
                for x in 0..rounded[0] {
                    let global = [x, y, z];
                    let reject = evaluate(&branches[0].0, global, domain) != 0;
                    assert_eq!(reject, (0..3).any(|i| global[i] >= domain[i]));
                    if !reject {
                        assert!(seen.insert(evaluate(linear, global, domain)));
                    }
                }
            }
        }
        assert_eq!(
            seen.into_iter().collect::<Vec<_>>(),
            (0..domain.iter().product()).collect::<Vec<_>>()
        );
    }
}
