//! The built-in `Unlit` material, compiled from the embedded prelude `std/materials.mtek`
//! through the front end and the shader lowering like a user material (decision 0044).
//!
//! * Golden: `tests/codegen/wgsl/unlit.wgsl` is the emitted module. Rewrite it with
//!   `MTEK_BLESS=1 cargo test -p mtek-compiler --test unlit_shader` and review the diff
//!   like code.
//! * Naga accepts it (an artifact only exists after validation; this test validates the
//!   text again independently), it is byte-identical across builds and source-map
//!   layouts, every span-map entry points into the prelude's `material Unlit` declaration
//!   (the fragment body's `return` at `return color;`), and the vertex layout is `position`
//!   alone.
//! * The prelude's `Unlit` agrees with the registry's `Unlit` schema (params, types,
//!   defaults), and a program that uses no built-in material does not compile the prelude.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::emit_wgsl::{ShaderArtifact, emit_shader, validate_wgsl};
use mtek_compiler::ir::{MaterialItem, Program, lower_to_ir};
use mtek_compiler::lowering::shader::lower_material;
use mtek_compiler::lowering::standard_stage::VertexAttribute;
use mtek_compiler::prelude::{MATERIALS_PATH, materials_text};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath, SourceMap, Span};
use mtek_compiler::stdlib::registry;
use mtek_compiler::types::value::from_registry;
use mtek_compiler::{Analysis, analyze};

const UNLIT: &str = "std/materials.mtek::Unlit";

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/codegen/wgsl")
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

/// A project whose entity uses `Unlit` (the default material of an entity with a mesh),
/// with `before` imported modules, so the prelude's file id is `before + 1`.
fn project(before: usize) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        b"[project]\nname = \"unlit\"\nlanguage = \"0.1\"\n".to_vec(),
    );
    let mut main = String::new();
    for index in 0..before {
        main.push_str(&format!(
            "import {{ K{index} }} from \"./m{index}.mtek\";\n"
        ));
        fs.insert(
            ProjectPath::new(&format!("src/m{index}.mtek")).unwrap(),
            format!("export const K{index} = {index}.0;\n").into_bytes(),
        );
    }
    main.push_str("scene Demo {\n    camera Main {}\n    entity Crate { mesh: Box {}; }\n}\n");
    fs.insert(
        ProjectPath::new("src/main.mtek").unwrap(),
        main.into_bytes(),
    );
    fs
}

fn analysed(before: usize) -> (Analysis, Program) {
    let analysis = analyze(&ProjectRoot::at_base(), &project(before));
    assert!(
        analysis.report.diagnostics.is_empty(),
        "{:#?}",
        analysis.report
    );
    let program = lower_to_ir(&analysis).unwrap();
    (analysis, program)
}

fn unlit(program: &Program) -> &MaterialItem {
    program
        .materials()
        .find(|m| m.symbol.as_str() == UNLIT)
        .expect("the prelude's Unlit is in the IR")
}

fn build(before: usize) -> (SourceMap, ShaderArtifact) {
    let (analysis, program) = analysed(before);
    let shader = lower_material(&program, unlit(&program)).unwrap_or_else(|d| panic!("{d:#?}"));
    let artifact = emit_shader(&shader).unwrap_or_else(|d| panic!("{d:#?}"));
    (analysis.project.unwrap().sources, artifact)
}

/// The span of `material Unlit { … }` in the prelude file.
fn declaration(sources: &SourceMap) -> Span {
    let file = sources
        .files()
        .find(|f| f.path().as_str() == MATERIALS_PATH)
        .unwrap();
    let text = file.text();
    // The declaration a material item spans: `material Unlit { … }`, without `export`.
    let start = text.find("export material Unlit").unwrap() + "export ".len();
    let end = start + text[start..].find("\n}\n").unwrap() + 2;
    Span::new(file.id(), start as u32, end as u32)
}

#[test]
fn unlit_wgsl_equals_the_golden_file() {
    let (_, artifact) = build(0);
    let path = golden_dir().join("unlit.wgsl");
    if blessing() {
        fs::create_dir_all(golden_dir()).unwrap();
        fs::write(&path, &artifact.wgsl).unwrap();
        return;
    }
    let expected = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e} (bless with MTEK_BLESS=1)", path.display()))
        .replace("\r\n", "\n");
    assert_eq!(
        artifact.wgsl,
        expected,
        "the emitted Unlit WGSL differs from {}",
        path.display()
    );
}

#[test]
fn the_golden_directory_holds_only_the_unlit_module() {
    let mut names: Vec<String> = fs::read_dir(golden_dir())
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    assert_eq!(names, ["unlit.wgsl"]);
}

#[test]
fn unlit_validates_with_naga_and_has_the_fixed_interface() {
    let (_, artifact) = build(0);
    let module = validate_wgsl(&artifact.wgsl).unwrap_or_else(|e| panic!("{e}"));
    let entries: Vec<(&str, naga::ShaderStage)> = module
        .entry_points
        .iter()
        .map(|e| (e.name.as_str(), e.stage))
        .collect();
    assert_eq!(
        entries,
        [
            ("mtek_vs", naga::ShaderStage::Vertex),
            ("mtek_fs", naga::ShaderStage::Fragment)
        ]
    );
    assert_eq!(
        (artifact.vertex_entry, artifact.fragment_entry),
        ("mtek_vs", "mtek_fs")
    );
    // Unlit reads no SurfaceInput field: position is the only vertex attribute.
    assert_eq!(artifact.vertex_attributes, [VertexAttribute::Position]);
    assert!(artifact.surface_inputs.is_empty());
    let vs = &module.entry_points[0];
    assert_eq!(vs.function.arguments.len(), 1);
    assert!(matches!(
        vs.function.arguments[0].binding,
        Some(naga::Binding::Location { location: 0, .. })
    ));
    let layout = artifact.layout.as_ref().unwrap();
    assert_eq!(layout.id, "material:std/materials.mtek::Unlit");
    assert_eq!(layout.wgsl_struct, "MtekParams_2b212d15_Unlit");
    assert_eq!(artifact.material, UNLIT);
    assert!(
        artifact.wgsl.contains(
            "@group(1) @binding(0) var<uniform> mtek_params: MtekParams_2b212d15_Unlit;\n"
        )
    );
}

#[test]
fn every_span_map_entry_points_into_the_material_declaration() {
    let (sources, artifact) = build(0);
    let declaration = declaration(&sources);
    let map = &artifact.span_map;
    assert_eq!(map.declaration, declaration);
    assert_eq!(map.symbol, UNLIT);
    assert!(map.entries.len() > 20, "{}", map.entries.len());
    for entry in &map.entries {
        assert_eq!(entry.span.file, declaration.file, "{entry:?}");
        assert!(
            declaration.start <= entry.span.start && entry.span.end <= declaration.end,
            "{entry:?}"
        );
        assert!(
            entry.symbol == UNLIT || entry.symbol == format!("{UNLIT}.fragment"),
            "{entry:?}"
        );
    }
    // Every line with code has an entry, and every entry lies inside its line.
    let lines: Vec<&str> = artifact.wgsl.lines().collect();
    for (index, line) in lines.iter().enumerate() {
        let number = index as u32 + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed == "}" {
            continue;
        }
        assert!(
            map.entries.iter().any(|e| e.wgsl.line == number),
            "line {number} `{line}` has no entry"
        );
    }
    for entry in &map.entries {
        let line = lines[entry.wgsl.line as usize - 1];
        assert!(entry.wgsl.col_start >= 1);
        assert!(entry.wgsl.col_end as usize <= line.len() + 1, "{entry:?}");
    }
    // The fragment body's `return` is the prelude's `return color;`, and the param read
    // the prelude's `color`.
    let body = lines
        .iter()
        .position(|l| l.trim() == "return mtek_params.u_color;")
        .unwrap() as u32
        + 1;
    let found = map.find(body, 5).unwrap();
    assert_eq!(found.symbol, format!("{UNLIT}.fragment"));
    assert_eq!(sources.slice(found.span), Some("return color;"));
    let column = lines[body as usize - 1].find("mtek_params").unwrap() as u32 + 1;
    assert_eq!(sources.slice(map.resolve(body, column).0), Some("color"));
    // The written document names the shader and gives span ids.
    let document = artifact.span_map_document(|_| 7);
    assert_eq!(document.shader, artifact.sha256);
    let json: serde_json::Value = serde_json::from_str(&document.to_json().unwrap()).unwrap();
    assert_eq!(json["entries"][0]["span"], 7);
    assert_eq!(json["entries"][0]["wgsl"]["line"], 1);
    assert_eq!(json["entries"][0]["symbol"], UNLIT);
}

#[test]
fn unlit_is_byte_identical_across_builds_and_source_maps() {
    let (_, first) = build(0);
    let (_, second) = build(0);
    let (_, elsewhere) = build(3);
    assert_eq!(first, second);
    assert_eq!(first.wgsl, elsewhere.wgsl);
    assert_eq!(first.sha256, elsewhere.sha256);
    assert_eq!(
        first.span_map.entries.len(),
        elsewhere.span_map.entries.len()
    );
    for (a, b) in first
        .span_map
        .entries
        .iter()
        .zip(&elsewhere.span_map.entries)
    {
        assert_eq!(a.wgsl, b.wgsl);
        assert_eq!((a.span.start, a.span.end), (b.span.start, b.span.end));
    }
    assert_ne!(
        first.span_map.declaration.file,
        elsewhere.span_map.declaration.file
    );
    assert_eq!(
        first.wgsl_path(),
        format!("shaders/{}.wgsl", &first.sha256[..16])
    );
}

#[test]
fn the_prelude_is_the_last_module_and_source_after_the_project() {
    let (analysis, program) = analysed(2);
    let paths: Vec<&str> = program.modules.iter().map(|m| m.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            "src/main.mtek",
            "src/m0.mtek",
            "src/m1.mtek",
            MATERIALS_PATH
        ]
    );
    let sources = &analysis.project.as_ref().unwrap().sources;
    let files: Vec<&str> = sources.files().map(|f| f.path().as_str()).collect();
    assert_eq!(files.last(), Some(&MATERIALS_PATH));
    let prelude = sources.files().last().unwrap();
    assert_eq!(prelude.text(), materials_text().unwrap());
    assert_eq!(program.modules[3].file, prelude.id().0);
    // Only the built-ins this build implements: `Pbr` (M4) is left out.
    let materials: Vec<&str> = program.materials().map(|m| m.symbol.as_str()).collect();
    assert_eq!(materials, [UNLIT]);
    // The entity's instance names the prelude's material item.
    let crate_entity = &program.entry().unwrap().entities[0];
    let instance = crate_entity.material.as_ref().unwrap();
    assert_eq!(instance.material.as_str(), UNLIT);
}

#[test]
fn the_prelude_unlit_agrees_with_the_registry_schema() {
    let (_, program) = analysed(0);
    let item = unlit(&program);
    let schema = registry().schema("Unlit").unwrap();
    assert_eq!(item.params.len(), schema.fields.len());
    for (param, field) in item.params.iter().zip(&schema.fields) {
        assert_eq!(param.name, field.name);
        assert_eq!(param.ty, field.ty.spelling());
        let default = field.default.as_ref().and_then(from_registry).unwrap();
        assert_eq!(param.default, Some((&default).into()), "{}", param.name);
    }
}

#[test]
fn a_program_without_builtin_materials_does_not_compile_the_prelude() {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        b"[project]\nname = \"plain\"\nlanguage = \"0.1\"\n".to_vec(),
    );
    fs.insert(
        ProjectPath::new("src/main.mtek").unwrap(),
        b"scene Demo {\n    camera Main {}\n    entity Empty {}\n}\n".to_vec(),
    );
    let analysis = analyze(&ProjectRoot::at_base(), &fs);
    assert!(analysis.report.diagnostics.is_empty());
    let program = lower_to_ir(&analysis).unwrap();
    assert_eq!(program.modules.len(), 1);
    assert_eq!(analysis.project.unwrap().sources.files().count(), 1);
}
