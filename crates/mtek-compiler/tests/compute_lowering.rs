//! Public source-to-WGSL, packaging and GPU acceptance fixture preparation.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::Code;
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

#[test]
fn independent_acceptance_reference_shaders_validate() {
    let mut source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/browser/support/compute-reference.ts"),
    )
    .unwrap();
    source.push_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/browser/support/compute-composite-reference.ts"),
        )
        .unwrap(),
    );
    for name in [
        "POSITION_WGSL",
        "INVOCATION_WGSL",
        "QUAD_WGSL",
        "COMPOSITE_WGSL",
    ] {
        let marker = format!("export const {name} = `");
        let shader = source
            .split_once(&marker)
            .unwrap()
            .1
            .split_once("`;")
            .unwrap()
            .0;
        assert!(
            !shader.contains("${") && !shader.contains('\\'),
            "reference strings must be literal WGSL"
        );
        validate_wgsl(shader).unwrap_or_else(|error| panic!("{name}: {}", error.rendered));
    }
    let broken = source
        .split_once("export const QUAD_WGSL = `")
        .unwrap()
        .1
        .split_once("`;")
        .unwrap()
        .0
        .replace("return frame.color;", "return false;");
    assert!(validate_wgsl(&broken).is_err());
}

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

fn checked_analysis(memory: &MemFs) -> mtek_compiler::Analysis {
    let analysis = mtek_compiler::analyze(&ProjectRoot::at_base(), memory);
    assert!(analysis.report.summary.errors == 0, "{:?}", analysis.report);
    analysis
}

fn checked_ir(memory: &MemFs) -> Program {
    ir::lower_to_ir(&checked_analysis(memory)).unwrap()
}

fn shader(source: &str) -> (Program, mtek_compiler::emit_wgsl::PrintedModule) {
    let program = checked_ir(&memory(source));
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
    assert!(mtek_compiler::plan::plan_program(&program).is_ok());
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
    let program = checked_ir(&memory(SOURCE));
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

#[test]
fn validated_artifact_matches_the_shared_runtime_layout_contract() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/codegen/compute-contract");
    let source = std::fs::read_to_string(root.join("kernel.mtek")).unwrap();
    let program = checked_ir(&memory(&source));
    let item = program.computes().next().unwrap();
    let artifact = mtek_compiler::emit_wgsl::emit_compute(&program, item).unwrap();
    assert_eq!(
        artifact,
        mtek_compiler::emit_wgsl::emit_compute(&program, item).unwrap()
    );
    assert_eq!(artifact.definition.inputs.len(), 4);
    assert_eq!(artifact.definition.inputs[0].layout.size(), 17 * 4);
    assert_eq!(artifact.definition.inputs[1].layout.size(), 17 * 4);
    assert_eq!(artifact.definition.dispatch.size, 12);
    assert_eq!(artifact.sha256.len(), 64);
    assert!(artifact.wgsl_path().starts_with("shaders/"));
    assert!(
        artifact
            .span_map_file(|span| span.start)
            .unwrap()
            .0
            .ends_with(".mtek-map.json")
    );
    let document = artifact.span_map_document(|span| span.start);
    assert!(
        serde_json::to_string(&document)
            .unwrap()
            .contains(&artifact.sha256)
    );
    for (file, text) in [
        (
            "expected.definition.json",
            format!(
                "{}\n",
                serde_json::to_string_pretty(&artifact.definition).unwrap()
            ),
        ),
        ("expected.wgsl", artifact.wgsl.clone()),
    ] {
        if std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1") {
            std::fs::write(root.join(file), &text).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(root.join(file)).unwrap(),
            text,
            "{file}"
        );
    }
}

#[test]
fn identical_compute_wgsl_keeps_distinct_content_addressed_source_maps() {
    let source = "compute One { output result: array<f32, 8>; kernel(input: ComputeInput) -> f32 { return f32(input.index); } }\ncompute Two { output result: array<f32, 8>; kernel(input: ComputeInput) -> f32 { return f32(input.index); } }\nscene Demo { camera Main {} }";
    let program = checked_ir(&memory(source));
    let artifacts = program
        .computes()
        .map(|item| mtek_compiler::emit_wgsl::emit_compute(&program, item).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(artifacts[0].wgsl, artifacts[1].wgsl);
    assert_eq!(artifacts[0].wgsl_path(), artifacts[1].wgsl_path());
    let first = artifacts[0].span_map_file(|span| span.start).unwrap();
    let second = artifacts[1].span_map_file(|span| span.start).unwrap();
    assert_ne!(first.0, second.0);
    assert_ne!(first.1, second.1);
    assert_eq!(
        first,
        artifacts[0].span_map_file(|span| span.start).unwrap()
    );
    let reindexed = artifacts[0].span_map_file(|span| span.start + 1).unwrap();
    assert_ne!(first.0, reindexed.0);
    use sha2::Digest;
    let hash: String = sha2::Sha256::digest(first.1.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(first.0, format!("shaders/{}.mtek-map.json", &hash[..16]));
}

#[test]
fn compute_artifacts_are_not_returned_when_naga_rejects_the_kernel() {
    let program = checked_ir(&memory(SOURCE));
    let mut item = program.computes().next().unwrap().clone();
    let Stmt::Return {
        value: Some(value), ..
    } = &mut item.kernel.body.stmts[0]
    else {
        panic!("return")
    };
    // Deliberately corrupt typed IR: a bool literal in an f32-returning kernel.
    // The artifact boundary must validate the emitted module rather than trust it.
    value.kind = ExprKind::Const {
        value: ir::Value::Bool(true),
    };
    let errors = mtek_compiler::emit_wgsl::emit_compute(&program, &item).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|diagnostic| diagnostic.code == Code::E6100),
        "{errors:?}"
    );
}

#[test]
fn compute_packaging_keeps_shaders_maps_defaults_writers_and_manifest_together() {
    use mtek_compiler::package::{PackageInput, package};
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/codegen/compute-contract");
    let source = std::fs::read_to_string(root.join("kernel.mtek")).unwrap();
    let analysis = checked_analysis(&memory(&source));
    let program = ir::lower_to_ir(&analysis).unwrap();
    let packaged = package(
        analysis.project.as_ref().unwrap(),
        &program,
        &PackageInput {
            profile: Default::default(),
            mode: mtek_compiler::BuildMode::Test,
            runtime_bundle: b"export const stub = true;\n",
            runtime_declarations: b"// development fixture\n",
            physics_bundle: None,
            animation_bundle: None,
            force_physics_subsystem: false,
            loop_budget: None,
            assets: &analysis.assets,
        },
    )
    .unwrap();
    let computes = &packaged.manifest.compute_programs;
    assert_eq!(computes.len(), 8);
    let compute = computes
        .iter()
        .find(|compute| compute.definition.id.ends_with("::Transform"))
        .unwrap();
    assert_eq!(compute.api, 1);
    assert_eq!(
        compute.defaults.len(),
        compute.definition.uniforms.as_ref().unwrap().size as usize
    );
    assert_eq!(compute.params.len(), 6);
    assert!(compute.params.iter().all(|param| param.has_default));
    assert!(packaged.files.contains_key(&compute.shader.url));
    assert!(packaged.files.contains_key(&compute.shader.map));
    let wgsl = std::str::from_utf8(&packaged.files[&compute.shader.url]).unwrap();
    validate_wgsl(wgsl).unwrap();
    let map: serde_json::Value =
        serde_json::from_slice(&packaged.files[&compute.shader.map]).unwrap();
    assert_eq!(map["shader"], compute.shader.hash);
    assert!(
        packaged
            .manifest
            .symbols
            .iter()
            .any(|symbol| symbol.id == compute.definition.id)
    );
    let app = std::str::from_utf8(&packaged.files["app.js"]).unwrap();
    assert!(app.contains("compute:src/main.mtek::Transform:params"));
    let manifest = packaged.manifest.to_json();
    let views = mtek_compiler::compute_inspection_views(
        &program,
        &analysis.project.as_ref().unwrap().sources,
    )
    .unwrap();
    assert_eq!(views.len(), 8);
    let view = views
        .iter()
        .find(|view| view.bindings.definition.id.ends_with("::Transform"))
        .unwrap();
    assert_eq!(view.hash, compute.shader.hash);
    assert_eq!(view.bindings.definition, compute.definition);
    assert_eq!(
        view.bindings
            .slots
            .iter()
            .map(|slot| slot.binding)
            .collect::<Vec<_>>(),
        vec![0, 1, 2, 3, 4, 5, 6]
    );
    assert!(
        view.span_map
            .iter()
            .any(|entry| entry.symbol.ends_with("Transform.kernel"))
    );
    let fixture = root.join("../../abi/manifests/valid/compute.json");
    for (path, text) in [
        (fixture, manifest),
        (root.join("expected.app.js"), app.to_owned()),
    ] {
        if std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1") {
            std::fs::write(&path, &text).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            text,
            "{}",
            path.display()
        );
    }
    let out = root.join("packaged");
    let shaders = packaged
        .files
        .keys()
        .filter(|name| name.starts_with("shaders/"))
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    if std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1") {
        for entry in std::fs::read_dir(out.join("shaders")).unwrap() {
            let entry = entry.unwrap();
            let name = format!("shaders/{}", entry.file_name().to_str().unwrap());
            if entry.file_type().unwrap().is_file() && !shaders.contains(&name) {
                std::fs::remove_file(entry.path()).unwrap();
            }
        }
    }
    for (name, bytes) in &packaged.files {
        if name == "index.html"
            || name == "runtime.d.ts"
            || name.starts_with("runtime.")
            || name == "app.d.ts"
        {
            continue;
        }
        let path = out.join(name);
        if std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1") {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, bytes).unwrap();
        }
        assert_eq!(std::fs::read(&path).unwrap(), *bytes, "{name}");
    }
    let actual = std::fs::read_dir(out.join("shaders"))
        .unwrap()
        .map(|entry| format!("shaders/{}", entry.unwrap().file_name().to_str().unwrap()))
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        actual, shaders,
        "packaged fixture must not retain stale shader/maps"
    );
    export_acceptance(
        &analysis,
        &program,
        &source,
        None,
        "MTEK_COMPUTE_ACCEPTANCE_OUT",
    );
}

#[test]
fn compute_shadow_example_packages_with_bounded_xyz_and_scene_lighting() {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/compute-geometry/scene/src/main.mtek"),
    )
    .unwrap();
    let config = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/compute-geometry/scene/mtek.toml"),
    )
    .unwrap();
    let mut project = memory(&source);
    project.insert(ProjectPath::new("mtek.toml").unwrap(), config.clone());
    let analysis = checked_analysis(&project);
    let program = ir::lower_to_ir(&analysis).unwrap();
    let compute = program.computes().next().unwrap();
    assert_eq!(compute.inputs[0].layout.size(), 72 * 4);
    assert_eq!(compute.output.layout.size(), 72 * 4);
    assert!(matches!(
        compute.output.layout,
        mtek_compiler::layout::LayoutNode::Array { stride: 4, .. }
    ));
    let artifact = mtek_compiler::emit_wgsl::emit_compute(&program, compute).unwrap();
    validate_wgsl(&artifact.wgsl).unwrap();
    export_acceptance(
        &analysis,
        &program,
        &source,
        Some(&config),
        "MTEK_COMPUTE_SHADOW_OUT",
    );
}

fn export_acceptance(
    analysis: &mtek_compiler::Analysis,
    program: &Program,
    source: &str,
    config: Option<&[u8]>,
    variable: &str,
) {
    use mtek_compiler::package::{PackageInput, package};
    // Explicit test-only export for browser acceptance. Use the real runtime
    // bytes so all package filenames and identities remain content addressed.
    if let Ok(directory) = std::env::var(variable) {
        let runtime_path = std::env::var_os("MTEK_COMPUTE_ACCEPTANCE_RUNTIME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../packages/runtime-web/dist")
            });
        let runtime = std::fs::read(runtime_path.join("core.dev.js")).unwrap();
        let declarations = std::fs::read(runtime_path.join("runtime.d.ts")).unwrap();
        let exported = package(
            analysis.project.as_ref().unwrap(),
            program,
            &PackageInput {
                profile: Default::default(),
                mode: mtek_compiler::BuildMode::Test,
                runtime_bundle: &runtime,
                runtime_declarations: &declarations,
                physics_bundle: None,
                animation_bundle: None,
                force_physics_subsystem: false,
                loop_budget: None,
                assets: &analysis.assets,
            },
        )
        .unwrap();
        let directory = std::path::PathBuf::from(directory);
        let mut files = Vec::new();
        for (name, bytes) in &exported.files {
            assert!(
                std::path::Path::new(name)
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_)))
            );
            let path = directory.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
            files.push(serde_json::json!({"path":name,"sha256":mtek_compiler::package::identity::sha256_hex(bytes)}));
        }
        let provenance = serde_json::json!({
            "format":"mtek-compute-acceptance-package/1", "developmentSourceGateBypass":"none: ordinary public analysis",
            "sourceSha256":mtek_compiler::package::identity::sha256_hex(source.as_bytes()),
            "projectConfigSha256":config.map(mtek_compiler::package::identity::sha256_hex),
            "runtimeSha256":mtek_compiler::package::identity::sha256_hex(&runtime), "files":files
        });
        std::fs::write(
            directory.join("acceptance-build.json"),
            format!("{}\n", serde_json::to_string_pretty(&provenance).unwrap()),
        )
        .unwrap();
    }
}
