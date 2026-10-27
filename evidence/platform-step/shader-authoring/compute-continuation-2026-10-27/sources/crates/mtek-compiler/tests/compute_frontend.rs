//! Bounded public source-compute checking, effects and packaging.

#![allow(clippy::panic)]

use mtek_compiler::diagnostics::{Code, Diagnostics, Severity};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{FileId, MemFs, ProjectPath};
use mtek_compiler::syntax::{lex_str, parse_module, walk_module};
use mtek_compiler::{Analysis, analyze};

const PROGRAM: &str = r#"
const N: u32 = 128;
compute Scale {
    param gain: f32 = 2.0;
    input source: array<vec4, N>;
    output result: array<vec4, N>;
    workgroup_size: [8, 4, 2];
    kernel(input: ComputeInput) -> vec4 {
        return source[input.index] * gain;
    }
}
scene Demo { camera Main {} }
"#;

fn fs(source: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap_or_else(|e| panic!("{e}")),
        b"[project]\nname = \"compute-check\"\nlanguage = \"0.1\"\n".to_vec(),
    );
    fs.insert(
        ProjectPath::new("src/main.mtek").unwrap_or_else(|e| panic!("{e}")),
        source.as_bytes().to_vec(),
    );
    fs
}

fn checked(source: &str) -> Analysis {
    analyze(&ProjectRoot::at_base(), &fs(source))
}

fn codes(analysis: &Analysis) -> Vec<Code> {
    analysis
        .report
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .map(|d| d.code)
        .collect()
}

#[test]
fn source_resources_kernel_and_workgroup_are_checked() {
    let analysis = checked(PROGRAM);
    assert_eq!(
        codes(&analysis),
        Vec::<Code>::new(),
        "{:?}",
        analysis.report
    );
    let types = analysis
        .types
        .as_ref()
        .unwrap_or_else(|| panic!("typed module"));
    let (_, compute) = types
        .computes()
        .next()
        .unwrap_or_else(|| panic!("compute metadata"));
    assert_eq!(compute.name, "Scale");
    assert_eq!(compute.workgroup_size, [8, 4, 2]);
    assert_eq!(compute.inputs.len(), 1);
    assert_eq!(compute.inputs[0].capacity, 128);
    assert_eq!(compute.inputs[0].layout.size(), 2048);
    assert_eq!(compute.params.len(), 1);
    assert_eq!(
        compute.params[0].default,
        Some(mtek_compiler::types::ConstValue::F32(2.0))
    );
    assert!(compute.kernel.is_some());
    assert_eq!(compute.output.as_ref().map(|b| b.capacity), Some(128));
}

#[test]
fn invalid_entry_names_reach_the_compute_signature_diagnostic() {
    for name in ["_", "fragment", "vertex", "not_kernel"] {
        let source = PROGRAM.replace("kernel(", &format!("{name}("));
        let mut lexed = lex_str(FileId(0), &source);
        let mut syntax = Diagnostics::new();
        lexed.report_into(&mut syntax);
        let _ = parse_module(&source, &lexed.tokens, &lexed.trivia, &mut syntax);
        assert!(syntax.is_empty(), "{name}: {syntax:?}");
        let errors = codes(&checked(&source));
        assert!(errors.contains(&Code::E4050), "{name}: {errors:?}");
        assert!(!errors.contains(&Code::E1001), "{name}: {errors:?}");
    }
}

#[test]
fn compute_formatting_preserves_comments_tree_and_node_invariants() {
    let source = PROGRAM.replace("input source:", "// Keep this resource.\ninput source:");
    let formatted = mtek_compiler::format::format_text(FileId(0), &source)
        .unwrap_or_else(|e| panic!("format: {e:?}"));
    assert!(formatted.contains("// Keep this resource."));
    assert_eq!(
        mtek_compiler::format::format_text(FileId(0), &formatted)
            .unwrap_or_else(|e| panic!("format: {e:?}")),
        formatted
    );
    let lexed = lex_str(FileId(0), &formatted);
    let mut sink = Diagnostics::new();
    let parsed = parse_module(&formatted, &lexed.tokens, &lexed.trivia, &mut sink);
    assert!(sink.is_empty());
    let mut seen = std::collections::BTreeSet::new();
    walk_module(&parsed.module, &mut |node, parent| {
        assert!(seen.insert(node.id.0), "duplicate node {}", node.id.0);
        if let Some(parent) = parent {
            assert!(parent.id.0 > node.id.0);
            assert!(parent.span.start <= node.span.start && parent.span.end >= node.span.end);
        }
    });
    assert_eq!(seen.len(), parsed.module.node_count as usize);
}

#[test]
fn invocation_fields_are_typed_u32() {
    for field in [
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
    ] {
        let source = PROGRAM.replace("input.index", &format!("input.{field}"));
        assert_eq!(codes(&checked(&source)), Vec::<Code>::new(), "{field}");
    }
    let source = PROGRAM.replace("input.index", "input.unknown");
    assert!(codes(&checked(&source)).contains(&Code::E3023));
}

#[test]
fn buffers_are_resources_and_inputs_are_immutable() {
    for (statement, code) in [
        ("let alias = source;", Code::E4052),
        ("let alias = result;", Code::E4052),
        ("let value = result[0];", Code::E4052),
        ("source[0] = vec4(1.0);", Code::E4052),
        ("result[0] = vec4(1.0);", Code::E4052),
        ("gain = 3.0;", Code::E3061),
    ] {
        let source = PROGRAM.replace(
            "return source[input.index]",
            &format!("{statement} return source[input.index]"),
        );
        let result = checked(&source);
        assert!(
            codes(&result).contains(&code),
            "{statement}: {:?}",
            result.report
        );
    }
    let source = PROGRAM.replace("source[input.index]", "((source))[input.index]");
    assert_eq!(codes(&checked(&source)), Vec::<Code>::new());
}

#[test]
fn storage_capacity_uses_its_byte_budget_instead_of_uniform_array_cap() {
    let source = PROGRAM.replace("128;", "1000000;").replace("vec4", "f32");
    let analysis = checked(&source);
    assert_eq!(
        codes(&analysis),
        Vec::<Code>::new(),
        "{:?}",
        analysis.report
    );
    let types = analysis
        .types
        .as_ref()
        .unwrap_or_else(|| panic!("typed module"));
    let (_, compute) = types
        .computes()
        .next()
        .unwrap_or_else(|| panic!("compute metadata"));
    assert_eq!(compute.inputs[0].layout.size(), 4_000_000);
    for capacity in ["0", "4194305", "4294967296"] {
        let source = source.replace("1000000;", &format!("{capacity};"));
        assert!(
            codes(&checked(&source)).contains(&Code::E4051),
            "{capacity}"
        );
    }
    let source = PROGRAM.replace("128;", "1048577;");
    assert!(codes(&checked(&source)).contains(&Code::E4051));
}

#[test]
fn workgroup_limits_and_nonconstant_values_are_rejected() {
    for size in [
        "[0, 1, 1]",
        "[1, 0, 1]",
        "[1, 1, 0]",
        "[257, 1, 1]",
        "[1, 257, 1]",
        "[1, 1, 65]",
        "[256, 2, 1]",
        "[4294967295, 4294967295, 2]",
        "[1, 2]",
        "[1, 2, 3, 4]",
        "[true, false, true]",
    ] {
        let source = PROGRAM.replace("[8, 4, 2]", size);
        assert!(codes(&checked(&source)).contains(&Code::E4053), "{size}");
    }
    let source = PROGRAM.replace("[8, 4, 2]", "[u32(gain), 1, 1]");
    assert!(codes(&checked(&source)).contains(&Code::E4053));
}

#[test]
fn signature_return_and_required_members_are_validated() {
    for (from, to, code) in [
        ("input: ComputeInput", "input: VertexInput", Code::E4021),
        ("input: ComputeInput", "", Code::E4021),
        ("-> vec4", "-> vec3", Code::E4021),
        ("-> vec4", "", Code::E4021),
        ("kernel(", "fragment(", Code::E4050),
        ("output result: array<vec4, N>;", "", Code::E4050),
        (
            "kernel(input: ComputeInput) -> vec4 {\n        return source[input.index] * gain;\n    }",
            "",
            Code::E4050,
        ),
    ] {
        let source = PROGRAM.replace(from, to);
        assert!(codes(&checked(&source)).contains(&code), "{from} -> {to}");
    }
}

#[test]
fn compute_kernels_are_gpu_roots_through_helpers() {
    let source = PROGRAM
        .replace(
            "compute Scale",
            "cpu fn host_value() -> f32 { return 1.0; }\ncompute Scale",
        )
        .replace(
            "source[input.index] * gain",
            "source[input.index] * host_value()",
        );
    let analysis = checked(&source);
    assert!(
        codes(&analysis).contains(&Code::E4040),
        "{:?}",
        analysis.report
    );
    let source = PROGRAM
        .replace(
            "compute Scale",
            "fn helper(x: f32) -> f32 { for i in 0..i32(x) {} return x; }\ncompute Scale",
        )
        .replace(
            "source[input.index] * gain",
            "source[input.index] * helper(gain)",
        );
    let analysis = checked(&source);
    assert!(
        codes(&analysis).contains(&Code::E4010),
        "{:?}",
        analysis.report
    );
}

#[test]
fn repeated_and_duplicate_members_are_reported() {
    for (from, addition, code) in [
        (
            "input source: array<vec4, N>;",
            "input source: array<vec4, N>;",
            Code::E2002,
        ),
        (
            "output result: array<vec4, N>;",
            "output second: array<vec4, N>;",
            Code::E4050,
        ),
        (
            "workgroup_size: [8, 4, 2];",
            "workgroup_size: [1, 1, 1];",
            Code::E4050,
        ),
    ] {
        let source = PROGRAM.replace(from, &format!("{from}\n{addition}"));
        assert!(codes(&checked(&source)).contains(&code), "{addition}");
    }
}

#[test]
fn checked_compute_cannot_silently_disappear_from_a_package() {
    let built = mtek_compiler::build(
        &ProjectRoot::at_base(),
        &fs(PROGRAM),
        &mtek_compiler::CompileOptions::with_stub_runtime(mtek_compiler::BuildMode::Test),
    );
    assert!(built.report.summary.errors == 0, "{:?}", built.report);
    assert!(built.files.contains_key("app.js"));
    assert!(built.build_id.is_some());
    let manifest: serde_json::Value = serde_json::from_slice(&built.files["program.manifest.json"])
        .unwrap_or_else(|error| panic!("{error}"));
    let programs = manifest["computePrograms"]
        .as_array()
        .unwrap_or_else(|| panic!("missing compute programs"));
    assert_eq!(programs.len(), 1);
    let shader = programs[0]["shader"]["url"]
        .as_str()
        .unwrap_or_else(|| panic!("missing shader URL"));
    assert!(built.files.contains_key(shader));
}

#[test]
fn constant_storage_index_outside_capacity_is_reported() {
    for index in ["128", "-1"] {
        let source = PROGRAM.replace("input.index", index);
        assert!(codes(&checked(&source)).contains(&Code::E3030), "{index}");
    }
}

#[test]
fn source_layout_expansion_is_bounded_for_repeated_structs() {
    let mut declarations = "struct S0 { value: f32; }\n".to_owned();
    for n in 1..=16 {
        declarations.push_str(&format!(
            "struct S{n} {{ a: S{}; b: S{}; }}\n",
            n - 1,
            n - 1
        ));
    }
    let source = declarations + &PROGRAM.replace("vec4", "S16").replace(" * gain", "");
    let result = checked(&source);
    assert!(codes(&result).contains(&Code::E4051), "{:?}", result.report);
}

#[test]
fn storage_and_uniform_resource_count_and_byte_budgets_are_checked() {
    let mut inputs = "input source: array<vec4, N>;".to_owned();
    for n in 1..=4 {
        inputs.push_str(&format!(" input source{n}: array<vec4, N>;"));
    }
    assert!(
        codes(&checked(
            &PROGRAM.replace("input source: array<vec4, N>;", &inputs)
        ))
        .contains(&Code::E4051)
    );
    let mut params = "param gain: f32 = 2.0;".to_owned();
    for n in 0..64 {
        params.push_str(&format!(" param p{n}: f32 = 0.0;"));
    }
    assert!(
        codes(&checked(
            &PROGRAM.replace("param gain: f32 = 2.0;", &params)
        ))
        .contains(&Code::E4051)
    );
    let source = PROGRAM.replace(
        "param gain: f32 = 2.0;",
        "param gain: f32 = 2.0; param table: array<vec4, 5000>;",
    );
    assert!(codes(&checked(&source)).contains(&Code::E4051));
}

#[test]
fn compute_colour_output_has_no_opaque_material_alpha_warning() {
    let source = PROGRAM
        .replace("vec4", "color")
        .replace("source[input.index] * gain", "color.linear(vec3(1.0), 0.0)");
    let result = checked(&source);
    assert_eq!(codes(&result), Vec::<Code>::new());
    assert!(
        !result
            .report
            .diagnostics
            .iter()
            .any(|d| d.code == Code::W5101)
    );
}

#[test]
fn default_workgroup_and_imported_compute_declarations_are_checked() {
    let source = PROGRAM.replace("    workgroup_size: [8, 4, 2];\n", "");
    let result = checked(&source);
    let types = result
        .types
        .as_ref()
        .unwrap_or_else(|| panic!("typed module"));
    assert_eq!(
        types.computes().next().map(|(_, c)| c.workgroup_size),
        Some([64, 1, 1])
    );
    let mut files = fs("import { Scale } from \"./kernel.mtek\";\nscene Demo { camera Main {} }");
    let library = PROGRAM
        .replace("compute Scale", "export compute Scale")
        .replace("scene Demo { camera Main {} }", "");
    files.insert(
        ProjectPath::new("src/kernel.mtek").unwrap_or_else(|e| panic!("{e}")),
        library.into_bytes(),
    );
    let result = analyze(&ProjectRoot::at_base(), &files);
    assert_eq!(codes(&result), Vec::<Code>::new(), "{:?}", result.report);
    assert!(
        result
            .dependencies
            .iter()
            .any(|unit| unit.types.computes().count() == 1)
    );
}
