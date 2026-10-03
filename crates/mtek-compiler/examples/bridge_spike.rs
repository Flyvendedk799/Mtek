//! The M0 CPU/GPU bridge spike generator: the shaders, writers and layout records the browser
//! bridge specs (`tests/browser/specs/bridge/`) run on real WebGPU.
//!
//! ```text
//! cargo run -p mtek-compiler --example bridge_spike -- <out_dir>
//! ```
//!
//! For each `tests/gpu-layout/<name>.type.json` this writes
//!
//! - `<name>.layout.json`: the layout record computed by the layout engine,
//! - `<name>.writers.js`: the generated JavaScript writers with the test-only `export` wrapper,
//! - `<name>.probe.wgsl`: the probe shader of `spec/gpu-layout.md` section 9.4,
//! - `<name>.probe.json`: the leaf list the probe shader reads (path, kind, byte offset), in
//!   the leaf order of the probe's output words,
//! - `mixed.color.wgsl` (the `mixed` fixture only): the colour shader of the rendered-output test.
//!
//! Every shader is parsed and validated with Naga (`validate_wgsl`) before it is written; an
//! invalid shader fails the run. This example is a disposable test generator (decision 0013): it
//! uses only public functions of the compiler and exports nothing. Output is deterministic:
//! fixtures are processed in sorted order and nothing depends on time, paths or hash-map order.

use std::env;
use std::error::Error;
use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;

use mtek_compiler::emit_js::{emit_test_module, writer_qualifier};
use mtek_compiler::emit_wgsl::{
    Leaf, LeafKind, emit_bindings, emit_block_structs, leaf_accessors, member_wgsl_name,
    validate_wgsl,
};
use mtek_compiler::layout::{LayoutMember, LayoutNode, LayoutRecord};
use serde_json::{Value, json};

#[path = "support/fixtures.rs"]
mod fixtures;

/// Bind group, binding and variable name of the block (`spec/gpu-layout.md` section 6).
const GROUP: u32 = 1;
const BINDING: u32 = 0;
const VAR_NAME: &str = "mtek_params";

/// The fixture the colour shader is generated for, and the members it reads.
const COLOUR_FIXTURE: &str = "mixed";

/// A full-viewport triangle without vertex buffers: vertices 0, 1 and 2 are
/// (-1, -1), (3, -1) and (-1, 3).
const FULL_VIEWPORT_VERTEX: &str = "\
struct ProbeVertex {
    @builtin(position) position: vec4<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> ProbeVertex {
    let x = f32(index & 1u) * 4.0 - 1.0;
    let y = f32(index >> 1u) * 4.0 - 1.0;
    return ProbeVertex(vec4<f32>(x, y, 0.0, 1.0));
}
";

/// One generated file.
struct Artifact {
    file_name: String,
    contents: String,
}

/// The block declarations of `record` followed by its uniform binding.
fn block_prelude(record: &LayoutRecord) -> String {
    format!(
        "{}\n{}",
        emit_block_structs(record),
        emit_bindings(GROUP, BINDING, VAR_NAME, &record.wgsl_struct)
    )
}

/// The expression of `leaf` as a `u32` bit pattern, read through its typed WGSL path: the
/// bits of an `f32` or `i32`, the value of a `u32`, `select(0u, 1u, ..)` of a bool.
fn leaf_word_expr(leaf: &Leaf) -> String {
    match leaf.kind {
        LeafKind::Bool32 => format!("select(0u, 1u, {})", leaf.typed_expr()),
        _ => leaf.raw_bits_expr(),
    }
}

/// The probe shader of `record` and the leaves it reads, in word order.
///
/// Pixel `p` of the target outputs the words `4p ..= 4p + 3`; `probe_word(i)` returns word `i`
/// (zero past the last leaf), so the target is `ceil(leaves / 4)` pixels wide.
fn probe_shader(record: &LayoutRecord) -> (String, Vec<Leaf>) {
    let leaves = leaf_accessors(record, VAR_NAME);
    let mut source = block_prelude(record);
    source.push_str("\nfn probe_word(i: u32) -> u32 {\n    switch i {\n");
    for (index, leaf) in leaves.iter().enumerate() {
        let _ = writeln!(
            source,
            "        case {index}u: {{ return {}; }}",
            leaf_word_expr(leaf)
        );
    }
    source.push_str("        default: { return 0u; }\n    }\n}\n\n");
    source.push_str(FULL_VIEWPORT_VERTEX);
    source.push_str(
        "\n@fragment\n\
         fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<u32> {\n\
         \x20   let first = u32(position.x) * 4u;\n\
         \x20   return vec4<u32>(\n\
         \x20       probe_word(first),\n\
         \x20       probe_word(first + 1u),\n\
         \x20       probe_word(first + 2u),\n\
         \x20       probe_word(first + 3u),\n\
         \x20   );\n\
         }\n",
    );
    (source, leaves)
}

fn kind_name(kind: LeafKind) -> &'static str {
    match kind {
        LeafKind::F32 => "f32",
        LeafKind::I32 => "i32",
        LeafKind::U32 => "u32",
        LeafKind::Bool32 => "bool32",
    }
}

/// The leaf list of the probe shader: how many words it produces, how wide the target is, and
/// every leaf in word order.
fn probe_manifest(record: &LayoutRecord, leaves: &[Leaf]) -> Value {
    let entries: Vec<Value> = leaves
        .iter()
        .map(|leaf| {
            json!({
                "path": leaf.path,
                "kind": kind_name(leaf.kind),
                "byteOffset": leaf.byte_offset,
            })
        })
        .collect();
    json!({
        "id": record.id,
        "leafWords": leaves.len(),
        "width": leaves.len().div_ceil(4),
        "leaves": entries,
    })
}

fn root_members(record: &LayoutRecord) -> &[LayoutMember] {
    match &record.root {
        LayoutNode::Struct { members, .. } => members,
        _ => &[],
    }
}

fn root_name(record: &LayoutRecord) -> &str {
    match &record.root {
        LayoutNode::Struct { name, .. } => name,
        _ => "",
    }
}

/// The colour shader: `vec4<f32>(f.rgb * a, 1.0)` for a block with an `f32` member `a` and a
/// `color` member `f`, read through their typed WGSL members.
fn colour_shader(record: &LayoutRecord) -> Result<String, Box<dyn Error>> {
    let members = root_members(record);
    let find = |name: &str, mtek_type: &str| {
        members
            .iter()
            .find(|m| m.name == name && m.mtek_type == mtek_type)
            .map(|m| member_wgsl_name(root_name(record), &m.name))
            .ok_or_else(|| {
                format!(
                    "{}: the colour shader needs a member `{name}: {mtek_type}`",
                    record.id
                )
            })
    };
    let scale = find("a", "f32")?;
    let colour = find("f", "color")?;
    let mut source = block_prelude(record);
    source.push('\n');
    source.push_str(FULL_VIEWPORT_VERTEX);
    let _ = write!(
        source,
        "\n@fragment\n\
         fn fs_main() -> @location(0) vec4<f32> {{\n\
         \x20   return vec4<f32>({VAR_NAME}.{colour}.rgb * {VAR_NAME}.{scale}, 1.0);\n\
         }}\n"
    );
    Ok(source)
}

/// Fails loudly when Naga rejects `source`.
fn validated(file_name: &str, source: String) -> Result<String, Box<dyn Error>> {
    match validate_wgsl(&source) {
        Ok(_) => Ok(source),
        Err(e) => Err(format!(
            "{file_name}: Naga rejected the generated WGSL: {e}\n{}\n--- source\n{source}",
            e.rendered
        )
        .into()),
    }
}

/// Every file of the fixture `name`, in the order they are written.
fn generate(name: &str, record: &LayoutRecord) -> Result<Vec<Artifact>, Box<dyn Error>> {
    let mut layout = serde_json::to_string_pretty(record)?;
    layout.push('\n');
    let (probe, leaves) = probe_shader(record);
    let mut manifest = serde_json::to_string_pretty(&probe_manifest(record, &leaves))?;
    manifest.push('\n');

    let mut artifacts = vec![
        Artifact {
            file_name: format!("{name}.layout.json"),
            contents: layout,
        },
        Artifact {
            file_name: format!("{name}.writers.js"),
            contents: emit_test_module(record, &writer_qualifier(record)),
        },
        Artifact {
            file_name: format!("{name}.probe.wgsl"),
            contents: validated(&format!("{name}.probe.wgsl"), probe)?,
        },
        Artifact {
            file_name: format!("{name}.probe.json"),
            contents: manifest,
        },
    ];
    if name == COLOUR_FIXTURE {
        let file_name = format!("{name}.color.wgsl");
        let contents = validated(&file_name, colour_shader(record)?)?;
        artifacts.push(Artifact {
            file_name,
            contents,
        });
    }
    Ok(artifacts)
}

fn main() -> Result<(), Box<dyn Error>> {
    let out_dir: PathBuf = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: bridge_spike <out_dir>")?;
    let fixture_dir = fixtures::fixture_dir();
    fs::create_dir_all(&out_dir)?;

    let names = fixtures::fixture_names(&fixture_dir)?;
    if names.is_empty() {
        return Err(format!("no fixtures found in {}", fixture_dir.display()).into());
    }
    for name in &names {
        let record = fixtures::record_of(&fixture_dir, name)?;
        for artifact in generate(name, &record)? {
            fs::write(out_dir.join(&artifact.file_name), artifact.contents)?;
        }
    }
    println!("wrote {} fixtures to {}", names.len(), out_dir.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mtek_compiler::layout::ScalarKind;

    fn record(name: &str) -> LayoutRecord {
        fixtures::record_of(&fixtures::fixture_dir(), name)
            .unwrap_or_else(|e| panic!("fixture {name}: {e}"))
    }

    fn artifact(name: &str, suffix: &str) -> String {
        let wanted = format!("{name}.{suffix}");
        generate(name, &record(name))
            .unwrap_or_else(|e| panic!("generate {name}: {e}"))
            .into_iter()
            .find(|a| a.file_name == wanted)
            .map(|a| a.contents)
            .unwrap_or_else(|| panic!("no artifact {wanted}"))
    }

    #[test]
    fn mixed_probe_reads_every_leaf_through_its_typed_path_in_word_order() {
        let (source, leaves) = probe_shader(&record("mixed"));
        assert_eq!(leaves.len(), 12);
        let expected = "\
fn probe_word(i: u32) -> u32 {
    switch i {
        case 0u: { return bitcast<u32>(mtek_params.u_a); }
        case 1u: { return bitcast<u32>(mtek_params.u_b.x); }
        case 2u: { return bitcast<u32>(mtek_params.u_b.y); }
        case 3u: { return bitcast<u32>(mtek_params.u_b.z); }
        case 4u: { return mtek_params.u_c; }
        case 5u: { return bitcast<u32>(mtek_params.u_d.x); }
        case 6u: { return bitcast<u32>(mtek_params.u_d.y); }
        case 7u: { return select(0u, 1u, (mtek_params.u_e != 0u)); }
        case 8u: { return bitcast<u32>(mtek_params.u_f.x); }
        case 9u: { return bitcast<u32>(mtek_params.u_f.y); }
        case 10u: { return bitcast<u32>(mtek_params.u_f.z); }
        case 11u: { return bitcast<u32>(mtek_params.u_f.w); }
        default: { return 0u; }
    }
}
";
        assert!(source.contains(expected), "{source}");
        assert!(
            source.contains("@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_mixed;")
        );
        assert!(source.contains("-> @location(0) vec4<u32>"));
        assert!(source.contains("let first = u32(position.x) * 4u;"));
    }

    #[test]
    fn padded_array_leaves_are_read_through_the_wrapper_value() {
        let (source, _) = probe_shader(&record("array_f32"));
        assert!(
            source.contains("case 2u: { return bitcast<u32>(mtek_params.u_weights[2].value); }"),
            "{source}"
        );
        assert!(!source.contains("array<u32"), "no raw word view: {source}");
    }

    #[test]
    fn probe_shaders_never_read_raw_buffer_words() {
        for name in ["scalar_f32", "mat4_and_quat", "all_types", "builtin_frame"] {
            let source = artifact(name, "probe.wgsl");
            assert!(!source.contains("var<storage"), "{name}");
            assert!(!source.contains("array<u32"), "{name}");
            assert!(!source.contains("array<vec4<u32"), "{name}");
        }
    }

    #[test]
    fn every_fixture_generates_a_probe_that_naga_accepts() {
        let names = fixtures::fixture_names(&fixtures::fixture_dir())
            .unwrap_or_else(|e| panic!("list fixtures: {e}"));
        assert_eq!(names.len(), 14);
        for name in &names {
            let files = generate(name, &record(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
            let wgsl: Vec<&Artifact> = files
                .iter()
                .filter(|a| a.file_name.ends_with(".wgsl"))
                .collect();
            let expected_wgsl = if name == COLOUR_FIXTURE { 2 } else { 1 };
            assert_eq!(wgsl.len(), expected_wgsl, "{name}");
            for shader in wgsl {
                validate_wgsl(&shader.contents)
                    .unwrap_or_else(|e| panic!("{}: {e}\n{}", shader.file_name, e.rendered));
            }
        }
    }

    #[test]
    fn only_the_mixed_fixture_has_a_colour_shader() {
        let names = fixtures::fixture_names(&fixtures::fixture_dir())
            .unwrap_or_else(|e| panic!("list fixtures: {e}"));
        for name in &names {
            let files = generate(name, &record(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
            let has_colour = files.iter().any(|a| a.file_name.ends_with(".color.wgsl"));
            assert_eq!(has_colour, name == "mixed", "{name}");
        }
    }

    #[test]
    fn colour_shader_multiplies_the_colour_by_the_scale_through_typed_members() {
        let source = artifact("mixed", "color.wgsl");
        assert!(
            source.contains("return vec4<f32>(mtek_params.u_f.rgb * mtek_params.u_a, 1.0);"),
            "{source}"
        );
        assert!(source.contains("@vertex"));
        assert!(source.contains("-> @location(0) vec4<f32>"));
    }

    #[test]
    fn colour_shader_needs_the_members_it_reads() {
        let error = colour_shader(&record("scalar_f32")).expect_err("no members a and f");
        assert!(error.to_string().contains("member `a: f32`"), "{error}");
        let error = colour_shader(&record("vec3")).expect_err("no members a and f");
        assert!(error.to_string().contains("fixture:vec3"), "{error}");
    }

    #[test]
    fn invalid_wgsl_fails_the_run() {
        let error = validated("broken.wgsl", "fn broken( {".to_owned()).expect_err("invalid");
        let text = error.to_string();
        assert!(text.contains("broken.wgsl"), "{text}");
        assert!(text.contains("Naga rejected"), "{text}");
    }

    #[test]
    fn probe_manifest_lists_the_leaves_in_word_order() {
        let record = record("mixed");
        let (_, leaves) = probe_shader(&record);
        let manifest = probe_manifest(&record, &leaves);
        assert_eq!(manifest["id"], "fixture:mixed");
        assert_eq!(manifest["leafWords"], 12);
        assert_eq!(manifest["width"], 3);
        assert_eq!(
            manifest["leaves"][7],
            json!({ "path": "e", "kind": "bool32", "byteOffset": 40 })
        );
        assert_eq!(
            manifest["leaves"][1],
            json!({ "path": "b.x", "kind": "f32", "byteOffset": 16 })
        );
    }

    #[test]
    fn target_width_rounds_up_to_whole_pixels() {
        let record = record("scalar_f32");
        let (_, leaves) = probe_shader(&record);
        let manifest = probe_manifest(&record, &leaves);
        assert_eq!(manifest["leafWords"], 1);
        assert_eq!(manifest["width"], 1);
    }

    #[test]
    fn writers_are_the_generated_test_module() {
        let source = artifact("mixed", "writers.js");
        assert!(source.contains("function w_fixture_mixed_a(m, base, v)"));
        assert!(source.contains("export {"));
    }

    #[test]
    fn generation_is_deterministic() {
        let first: Vec<(String, String)> = generate("all_types", &record("all_types"))
            .unwrap_or_else(|e| panic!("{e}"))
            .into_iter()
            .map(|a| (a.file_name, a.contents))
            .collect();
        let second: Vec<(String, String)> = generate("all_types", &record("all_types"))
            .unwrap_or_else(|e| panic!("{e}"))
            .into_iter()
            .map(|a| (a.file_name, a.contents))
            .collect();
        assert_eq!(first, second);
    }

    #[test]
    fn scalar_kinds_name_themselves_like_the_layout_record() {
        for (kind, name) in [
            (ScalarKind::F32, "f32"),
            (ScalarKind::I32, "i32"),
            (ScalarKind::U32, "u32"),
            (ScalarKind::Bool32, "bool32"),
        ] {
            assert_eq!(kind_name(kind.into()), name);
        }
    }
}
