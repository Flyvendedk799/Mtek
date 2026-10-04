//! `mtek inspect --shaders` (`spec/tooling.md` section 1, decision 0044): the validated
//! WGSL of every material the entry scene uses, exactly as `build` writes it, with its
//! interface and its span map.
//!
//! JSON gives every span-map entry with its source location. The human form prints the
//! WGSL with line numbers and summarises the span map: a line is followed by the location
//! and symbol its code comes from (the line's widest entry) whenever that differs from the
//! previous annotated line.

use serde::Serialize;

use crate::emit_wgsl::{ShaderArtifact, WgslRange};
use crate::plan::ResourcePlan;
use crate::source::SourceMap;

use super::view::{SourceLocation, to_json};

/// The view.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadersView {
    /// The entry scene's symbol.
    pub scene: String,
    pub target_profile: String,
    pub shaders: Vec<Shader>,
}

/// The shader of one material.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shader {
    pub material: String,
    /// The material declaration.
    pub declaration: SourceLocation,
    /// SHA-256 of the WGSL bytes.
    pub hash: String,
    /// `shaders/<h16>.wgsl` in `dist/`.
    pub url: String,
    /// `shaders/<h16>.mtek-map.json` in `dist/`.
    pub map: String,
    pub vertex_entry: &'static str,
    pub fragment_entry: &'static str,
    pub vertex_attributes: Vec<&'static str>,
    pub surface_inputs: Vec<&'static str>,
    /// The parameter block's layout id (group 1, binding 0); `None` without params.
    pub layout: Option<String>,
    pub wgsl: String,
    pub span_map: Vec<SpanEntry>,
}

/// One span-map entry with its source location.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanEntry {
    pub wgsl: WgslRange,
    pub source: SourceLocation,
    pub symbol: String,
}

/// The view of the shaders `artifacts` of the materials of `plan` (in plan order), with
/// locations resolved through `sources`.
///
/// # Errors
/// A defect text for a span outside the source map or a shader without a planned material.
pub fn shaders_view(
    scene: &str,
    target_profile: &str,
    plan: &ResourcePlan,
    artifacts: &[ShaderArtifact],
    sources: &SourceMap,
) -> Result<ShadersView, String> {
    let mut shaders = Vec::with_capacity(artifacts.len());
    for (material, artifact) in plan.materials.iter().zip(artifacts) {
        if material.symbol.as_str() != artifact.material {
            return Err(format!(
                "the shader of '{}' is listed for the material '{}'",
                artifact.material, material.symbol
            ));
        }
        let mut span_map = Vec::with_capacity(artifact.span_map.entries.len());
        for entry in &artifact.span_map.entries {
            span_map.push(SpanEntry {
                wgsl: entry.wgsl,
                source: SourceLocation::of(entry.span, sources)?,
                symbol: entry.symbol.clone(),
            });
        }
        shaders.push(Shader {
            material: artifact.material.clone(),
            declaration: SourceLocation::of(artifact.span_map.declaration, sources)?,
            hash: artifact.sha256.clone(),
            url: artifact.wgsl_path(),
            map: artifact.map_path(),
            vertex_entry: artifact.vertex_entry,
            fragment_entry: artifact.fragment_entry,
            vertex_attributes: artifact
                .vertex_attributes
                .iter()
                .map(|a| a.name())
                .collect(),
            surface_inputs: artifact.surface_inputs.iter().map(|s| s.name()).collect(),
            layout: artifact.layout.as_ref().map(|l| l.id.clone()),
            wgsl: artifact.wgsl.clone(),
            span_map,
        });
    }
    if shaders.len() != plan.materials.len() {
        return Err("a planned material has no shader".to_owned());
    }
    Ok(ShadersView {
        scene: scene.to_owned(),
        target_profile: target_profile.to_owned(),
        shaders,
    })
}

impl ShadersView {
    /// `--format json`: pretty JSON, keys in declaration order.
    #[must_use]
    pub fn to_json(&self) -> String {
        to_json(self)
    }

    /// `--format human`: per material its interface, then the WGSL with the span-map
    /// summary.
    #[must_use]
    pub fn to_human(&self) -> String {
        let mut out = format!(
            "shaders of scene {} (target profile {})\n",
            self.scene, self.target_profile
        );
        for shader in &self.shaders {
            out.push('\n');
            out.push_str(&format!(
                "shader of material {} (declared at {})\n",
                shader.material,
                shader.declaration.human()
            ));
            out.push_str(&format!("  file {} (sha256 {})\n", shader.url, shader.hash));
            out.push_str(&format!(
                "  entry points {} (vertex), {} (fragment)\n",
                shader.vertex_entry, shader.fragment_entry
            ));
            out.push_str(&format!(
                "  vertex attributes {}\n",
                shader.vertex_attributes.join(", ")
            ));
            out.push_str(&format!(
                "  surface inputs {}\n",
                if shader.surface_inputs.is_empty() {
                    "none".to_owned()
                } else {
                    shader.surface_inputs.join(", ")
                }
            ));
            out.push_str(&format!(
                "  parameter block {}\n",
                shader.layout.as_ref().map_or_else(
                    || "none (empty group 1)".to_owned(),
                    |l| format!("{l} (group 1 binding 0)")
                )
            ));
            let lines: Vec<&str> = shader.wgsl.lines().collect();
            out.push_str(&format!(
                "  span map {} entries over {} lines; a line is followed by `// <source> <symbol>` where its origin changes\n",
                shader.span_map.len(),
                lines.len()
            ));
            let width = lines.len().to_string().len();
            let mut previous: Option<(String, &str)> = None;
            for (index, line) in lines.iter().enumerate() {
                let number = u32::try_from(index + 1).unwrap_or(u32::MAX);
                let widest = shader
                    .span_map
                    .iter()
                    .filter(|e| e.wgsl.line == number)
                    .fold(None::<&SpanEntry>, |best, entry| match best {
                        Some(b) if b.wgsl.width() >= entry.wgsl.width() => Some(b),
                        _ => Some(entry),
                    });
                let mut text = format!("  {:>width$} | {line}", index + 1);
                if let Some(entry) = widest {
                    let origin = (entry.source.human(), entry.symbol.as_str());
                    if previous.as_ref() != Some(&origin) {
                        text.push_str(&format!("  // {} {}", origin.0, origin.1));
                        previous = Some(origin);
                    }
                }
                out.push_str(text.trim_end());
                out.push('\n');
            }
        }
        out
    }
}
