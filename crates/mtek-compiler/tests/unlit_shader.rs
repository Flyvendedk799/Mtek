//! The temporary compiler-built `Unlit` shader (decision 0013, removed in M2-09).
//!
//! * Golden: `tests/codegen/wgsl/unlit.wgsl` is the emitted module. Rewrite it with
//!   `MTEK_BLESS=1 cargo test -p mtek-compiler --test unlit_shader` and review the diff
//!   like code.
//! * Naga accepts it (an artifact only exists after validation; this test validates the
//!   text again independently), it is byte-identical across builds and source-map
//!   layouts, every span-map entry points at the `material Unlit` declaration, and the
//!   vertex layout is `position` alone.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::emit_wgsl::{ShaderArtifact, validate_wgsl};
use mtek_compiler::lowering::builtin_unlit::{PRELUDE_PATH, prelude_text, unlit_shader};
use mtek_compiler::lowering::standard_stage::VertexAttribute;
use mtek_compiler::source::{ProjectPath, SourceMap, Span};

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/codegen/wgsl")
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

/// A source map with `before` other files, then the prelude.
fn sources(before: usize) -> SourceMap {
    let mut sources = SourceMap::new();
    for index in 0..before {
        sources
            .add(
                ProjectPath::new(&format!("src/m{index}.mtek")).unwrap(),
                b"scene S {}\n",
            )
            .unwrap();
    }
    sources
        .add(
            ProjectPath::new(PRELUDE_PATH).unwrap(),
            prelude_text().unwrap().as_bytes(),
        )
        .unwrap();
    sources
}

fn build(before: usize) -> (SourceMap, ShaderArtifact) {
    let sources = sources(before);
    let file = sources.files().last().unwrap();
    let artifact = unlit_shader(file).unwrap_or_else(|d| panic!("{d:#?}"));
    (sources, artifact)
}

/// The span of `export material Unlit { … }` in the prelude file.
fn declaration(sources: &SourceMap) -> Span {
    let file = sources.files().last().unwrap();
    let text = file.text();
    let start = text.find("export material Unlit").unwrap();
    let end = start + text[start..].find("\n}\n").unwrap() + 2;
    Span::new(file.id(), start as u32, end as u32)
}

#[test]
fn unlit_wgsl_equals_the_golden_file() {
    let (_, artifact) = build(1);
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
    let (_, artifact) = build(1);
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
    assert_eq!(artifact.material, "std/materials.mtek::Unlit");
    assert!(
        artifact.wgsl.contains(
            "@group(1) @binding(0) var<uniform> mtek_params: MtekParams_2b212d15_Unlit;\n"
        )
    );
}

#[test]
fn every_span_map_entry_points_at_the_material_declaration() {
    let (sources, artifact) = build(1);
    let declaration = declaration(&sources);
    let map = &artifact.span_map;
    assert_eq!(map.declaration, declaration);
    assert_eq!(map.symbol, "std/materials.mtek::Unlit");
    assert!(map.entries.len() > 20, "{}", map.entries.len());
    for entry in &map.entries {
        assert_eq!(entry.span, declaration, "{entry:?}");
        assert!(
            entry.symbol == "std/materials.mtek::Unlit"
                || entry.symbol == "std/materials.mtek::Unlit.fragment",
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
    // The fragment body's `return` is attributed to the fragment stage.
    let body = lines
        .iter()
        .position(|l| l.trim() == "return mtek_params.u_color;")
        .unwrap() as u32
        + 1;
    let found = map.find(body, 5).unwrap();
    assert_eq!(found.symbol, "std/materials.mtek::Unlit.fragment");
    // The written document names the shader and gives span ids.
    let document = artifact.span_map_document(|_| 7);
    assert_eq!(document.shader, artifact.sha256);
    let json: serde_json::Value = serde_json::from_str(&document.to_json().unwrap()).unwrap();
    assert_eq!(json["entries"][0]["span"], 7);
    assert_eq!(json["entries"][0]["wgsl"]["line"], 1);
    assert_eq!(json["entries"][0]["symbol"], "std/materials.mtek::Unlit");
}

#[test]
fn unlit_is_byte_identical_across_builds_and_source_maps() {
    let (_, first) = build(1);
    let (_, second) = build(1);
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
    assert_eq!(
        first.wgsl_path(),
        format!("shaders/{}.wgsl", &first.sha256[..16])
    );
}
