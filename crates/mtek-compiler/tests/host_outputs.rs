//! Compiler-to-host output contract, independently of the application's debug API.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod common;

use mtek_compiler::diagnostics::Code;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{BuildMode, CompileOptions, build, check};
use serde_json::Value;

fn project(outputs: &str, source: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        format!("[project]\nname = \"outputs\"\nlanguage = \"0.1\"\n[host.outputs]\n{outputs}\n"),
    );
    fs.insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    fs
}

#[test]
fn every_output_type_has_a_manifest_source_and_precise_typescript_type() {
    let declarations = [
        ("count", "i32", "3", "number"),
        ("index", "u32", "7", "number"),
        ("enabled", "bool", "true", "boolean"),
        ("speed", "f32", "1.0", "number"),
        (
            "offset",
            "vec2",
            "vec2(0.0, 0.5)",
            "readonly [number, number]",
        ),
        (
            "position",
            "vec3",
            "vec3(0.0, 0.5, 0.0)",
            "readonly [number, number, number]",
        ),
        (
            "rotation",
            "vec4",
            "vec4(0.0, 0.0, 0.0, 1.0)",
            "readonly [number, number, number, number]",
        ),
        (
            "tint",
            "color",
            "#6b5cff",
            "readonly [number, number, number, number]",
        ),
        ("label", "string", "\"chair\"", "string"),
    ];
    let mut source = "scene Demo {\n camera Main {}\n".to_owned();
    let mut outputs = String::new();
    for (name, ty, value, _) in declarations {
        source.push_str(&format!("state {name}: {ty} = {value};\n"));
        outputs.push_str(&format!("{name} = \"Demo.{name}\"\n"));
    }
    source.push_str("}\n");
    let fs = project(&outputs, &source);
    let result = build(
        &ProjectRoot::at_base(),
        &fs,
        &CompileOptions::with_stub_runtime(BuildMode::Release),
    );
    assert!(!result.has_errors(), "{:#?}", result.report.diagnostics);
    let manifest: Value = serde_json::from_slice(&result.files["program.manifest.json"]).unwrap();
    common::manifest_schema::assert_valid(
        &common::manifest_schema::validator(),
        "host outputs",
        &manifest.to_string(),
    );
    let ports = manifest["scene"]["hostOutputs"].as_array().unwrap();
    assert_eq!(ports.len(), declarations.len());
    let dts = std::str::from_utf8(&result.files["app.d.ts"]).unwrap();
    assert!(dts.contains("MtekProgram<Inputs, Outputs>"));
    for (name, ty, _, ts_type) in declarations {
        let port = ports.iter().find(|port| port["name"] == name).unwrap();
        assert_eq!(port["source"]["kind"], "state");
        assert_eq!(port["source"]["name"], name);
        assert_eq!(port["type"], ty);
        assert!(dts.contains(&format!("  {name}: {ts_type};")), "{dts}");
    }
    // No debug bridge or extra GPU state is needed for production exports.
    assert!(manifest.get("preview").is_none());
}

#[test]
fn invalid_output_sources_are_rejected_during_check() {
    for (target, code) in [
        ("missing", Code::E9021),
        ("Other.value", Code::E9021),
        ("Demo.missing", Code::E9021),
        ("Demo.Item", Code::E9020),
        ("Demo.q", Code::E9020),
        ("Demo.Item.value", Code::E9020),
    ] {
        let fs = project(
            &format!("value = \"{target}\""),
            "scene Demo { state value: f32 = 1.0; state q: quat = quat.identity(); camera Main {} entity Item {} }",
        );
        let result = check(&ProjectRoot::at_base(), &fs);
        assert_eq!(
            result.report.diagnostics.len(),
            1,
            "{target}: {:#?}",
            result.report.diagnostics
        );
        assert!(
            result
                .report
                .diagnostics
                .iter()
                .any(|d| d.code == code && d.notes.iter().any(|n| n == "host.outputs.value")),
            "{target}: {:#?}",
            result.report.diagnostics
        );
    }
}

#[test]
fn entity_output_sources_explain_the_scene_state_boundary() {
    let source = "prefab Chair { state tint: color = #ffffff; entity Seat { state value: f32 = 1.0; } }\n\
        scene Demo { camera Main {} entity Item { state value: f32 = 1.0; } entity Product: Chair {} }";
    for target in [
        "Demo.Item",
        "Demo.Item.value",
        "Demo.Product.tint",
        "Demo.Product.Seat.value",
    ] {
        let fs = project(&format!("value = \"{target}\""), source);
        let result = check(&ProjectRoot::at_base(), &fs);
        assert_eq!(
            result.report.diagnostics.len(),
            1,
            "{target}: {:#?}",
            result.report.diagnostics
        );
        let diagnostic = &result.report.diagnostics[0];
        assert_eq!(diagnostic.code, Code::E9020);
        assert!(diagnostic.message.contains("only scene state"));
        assert!(
            diagnostic
                .notes
                .iter()
                .any(|note| note == "host.outputs.value")
        );
        assert!(
            diagnostic
                .notes
                .iter()
                .any(|note| note.contains("copy the needed value into scene state"))
        );
        assert_eq!(diagnostic.related.len(), 1);
    }
}

#[test]
fn output_tables_validate_types_and_allow_quoted_host_keys() {
    let bad = project("value = 42", "scene Demo { camera Main {} }");
    let result = check(&ProjectRoot::at_base(), &bad);
    assert!(
        result
            .report
            .diagnostics
            .iter()
            .any(|d| d.code == Code::E9001 && d.message.contains("host.outputs.value"))
    );
    let fs = project(
        "\"unit-price\" = \"Demo.price\"\n\"constructor\" = \"Demo.price\"",
        "scene Demo { state price: f32 = 99.0; camera Main {} }",
    );
    let result = build(
        &ProjectRoot::at_base(),
        &fs,
        &CompileOptions::with_stub_runtime(BuildMode::Release),
    );
    assert!(!result.has_errors(), "{:#?}", result.report.diagnostics);
    let dts = std::str::from_utf8(&result.files["app.d.ts"]).unwrap();
    assert!(dts.contains("\"unit-price\": number;"));
    assert!(dts.contains("constructor: number;"));
}

#[test]
fn empty_output_names_are_rejected_before_manifest_generation() {
    let fs = project(
        "\"\" = \"Demo.value\"",
        "scene Demo { state value: f32 = 1.0; camera Main {} }",
    );
    let result = check(&ProjectRoot::at_base(), &fs);
    assert!(
        result
            .report
            .diagnostics
            .iter()
            .any(|d| d.code == Code::E9001 && d.message.contains("host.outputs names"))
    );
}
