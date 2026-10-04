//! The emitted shader of one material: Naga-validated WGSL with everything the packager
//! (M1-17) and the runtime (M1-18) need about it.
//!
//! [`emit_shader`] prints a [`MaterialShader`], validates the text with
//! [`super::validate()`] and only then returns a [`ShaderArtifact`]: no artifact exists
//! for WGSL that Naga rejects.

use sha2::{Digest, Sha256};

use crate::diagnostics::Diagnostic;
use crate::layout::LayoutRecord;
use crate::lowering::standard_stage::{
    FRAGMENT_ENTRY, MaterialShader, SurfaceField, VERTEX_ENTRY, VertexAttribute,
};
use crate::source::Span;

use super::printer::print_module;
use super::span_map::{SpanMap, SpanMapDocument};
use super::validate::validate;

/// A material's validated WGSL module.
///
/// For the packager: the file is `shaders/<h16>.wgsl` ([`ShaderArtifact::wgsl_path`])
/// with the bytes of `wgsl`; its span map is `shaders/<h16>.mtek-map.json`
/// ([`ShaderArtifact::map_path`], contents from [`ShaderArtifact::span_map_document`]);
/// the manifest's shader entry is `{ hash: sha256, url, map, material, vertexEntry,
/// fragmentEntry, vertexAttributes, surfaceInputs }` and the material's `layout` record
/// goes into the manifest's `layouts`.
///
/// For the runtime: the pipeline's vertex state uses `vertex_entry` and one vertex
/// buffer per entry of `vertex_attributes`, in that order
/// ([`VertexAttribute::location`], [`VertexAttribute::format`],
/// [`VertexAttribute::array_stride`], `stepMode: "vertex"`); the fragment state uses
/// `fragment_entry` with one colour target; bind groups are 0 = `MtekFrame`,
/// 1 = the param block (an empty layout when `layout` is `None`), 2 = `MtekObject` with
/// a dynamic offset (`spec/gpu-layout.md` section 6).
#[derive(Debug, Clone, PartialEq)]
pub struct ShaderArtifact {
    /// The material symbol (`std/materials.mtek::Unlit`), the manifest shader's `material`.
    pub material: String,
    /// The WGSL text; deterministic, `\n` line ends, final line break.
    pub wgsl: String,
    /// SHA-256 of the bytes of `wgsl`, 64 lowercase hex digits.
    pub sha256: String,
    /// Where each WGSL range comes from in Mtek source.
    pub span_map: SpanMap,
    /// `mtek_vs`.
    pub vertex_entry: &'static str,
    /// `mtek_fs`.
    pub fragment_entry: &'static str,
    /// Present vertex attributes in vertex-buffer slot order (`spec/materials.md` 3.3).
    pub vertex_attributes: Vec<VertexAttribute>,
    /// The `SurfaceInput` fields the fragment stage reads, in varying order.
    pub surface_inputs: Vec<SurfaceField>,
    /// The param block's layout record (bound at group 1 binding 0); `None` for a material
    /// without value params (decision 0029).
    pub layout: Option<LayoutRecord>,
}

impl ShaderArtifact {
    /// The first 16 hex digits of [`ShaderArtifact::sha256`].
    pub fn h16(&self) -> &str {
        self.sha256.get(..16).unwrap_or(&self.sha256)
    }

    /// `shaders/<h16>.wgsl`.
    pub fn wgsl_path(&self) -> String {
        format!("shaders/{}.wgsl", self.h16())
    }

    /// `shaders/<h16>.mtek-map.json`.
    pub fn map_path(&self) -> String {
        format!("shaders/{}.mtek-map.json", self.h16())
    }

    /// The span map file's contents; `span_id` gives a span's index in the manifest's
    /// `spans` table.
    pub fn span_map_document(&self, span_id: impl FnMut(Span) -> u32) -> SpanMapDocument {
        self.span_map.document(&self.sha256, span_id)
    }
}

/// SHA-256 of `bytes` as 64 lowercase hex digits.
fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Prints and validates `shader`.
///
/// # Errors
/// `E6100` (from [`super::validate()`]) when Naga rejects the printed module.
pub fn emit_shader(shader: &MaterialShader) -> Result<ShaderArtifact, Vec<Diagnostic>> {
    let printed = print_module(&shader.module);
    validate(&printed.text, &printed.span_map)?;
    Ok(ShaderArtifact {
        material: shader.module.symbol.clone(),
        sha256: sha256_hex(printed.text.as_bytes()),
        wgsl: printed.text,
        span_map: printed.span_map,
        vertex_entry: VERTEX_ENTRY,
        fragment_entry: FRAGMENT_ENTRY,
        vertex_attributes: shader.vertex_attributes.clone(),
        surface_inputs: shader.surface_inputs.clone(),
        layout: shader.layout.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Code;
    use crate::lowering::shader_ir::{Component, Expr, FiniteF32, Name, ShaderType, Statement};
    use crate::lowering::standard_stage::{
        FragmentBody, MaterialDescription, build_standard_stage,
    };
    use crate::source::FileId;

    fn declaration() -> Span {
        Span::new(FileId(3), 5, 40)
    }

    fn fragment() -> Span {
        Span::new(FileId(3), 10, 35)
    }

    fn body(value: Expr) -> MaterialDescription {
        MaterialDescription {
            symbol: "src/main.mtek::M".to_owned(),
            declaration: declaration(),
            surface_inputs: Default::default(),
            params: None,
            fragment: FragmentBody {
                surface_param: Name::generated("s"),
                body: vec![Statement::Return {
                    value: Some(value),
                    span: Span::new(FileId(3), 20, 30),
                }],
                symbol: "src/main.mtek::M.fragment".to_owned(),
                span: fragment(),
            },
        }
    }

    #[test]
    fn sha256_hex_matches_a_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_valid_module_becomes_an_artifact_with_its_hash_and_paths() {
        let one = || Expr::f32(FiniteF32::ONE, declaration());
        let value = Expr::construct(
            ShaderType::VEC4,
            vec![one(), one(), one(), one()],
            declaration(),
        );
        let shader = build_standard_stage(&body(value)).expect("built");
        let artifact = emit_shader(&shader).expect("valid");
        assert_eq!(artifact.sha256, sha256_hex(artifact.wgsl.as_bytes()));
        assert_eq!(artifact.sha256.len(), 64);
        assert_eq!(
            artifact.wgsl_path(),
            format!("shaders/{}.wgsl", &artifact.sha256[..16])
        );
        assert_eq!(
            artifact.map_path(),
            format!("shaders/{}.mtek-map.json", &artifact.sha256[..16])
        );
        assert_eq!(
            (artifact.vertex_entry, artifact.fragment_entry),
            ("mtek_vs", "mtek_fs")
        );
        assert_eq!(artifact.material, "src/main.mtek::M");
        let document = artifact.span_map_document(|_| 0);
        assert_eq!(document.shader, artifact.sha256);
        assert_eq!(document.entries.len(), artifact.span_map.entries.len());
    }

    #[test]
    fn a_module_naga_rejects_is_e6100_at_the_offending_function() {
        // A defective lowering: the fragment body returns a `vec3`.
        let one = Expr::f32(FiniteF32::ONE, declaration());
        let value = Expr::construct(ShaderType::VEC4, vec![one], declaration())
            .swizzle(&[Component::X, Component::Y, Component::Z], declaration());
        let shader = build_standard_stage(&body(value)).expect("built");
        let diagnostics = emit_shader(&shader).expect_err("Naga rejects it");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].code, Code::E6100);
        let span = diagnostics[0].primary.as_ref().map(|l| l.span);
        // Naga blames the function `mtek_fragment`: its header line maps to the fragment
        // stage, not to the material declaration.
        assert_eq!(span, Some(fragment()), "{diagnostics:?}");
        assert!(
            diagnostics[0].notes[1].ends_with("in code generated for 'src/main.mtek::M.fragment'"),
            "{diagnostics:?}"
        );
    }
}
