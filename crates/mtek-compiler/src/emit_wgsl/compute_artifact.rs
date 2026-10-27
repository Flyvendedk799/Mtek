//! Validated compute shader artifacts and the internal runtime resource contract.
//! Source builds remain gated until manifest/mounted lifecycle integration exists.

use serde::{Deserialize, Serialize};

use crate::diagnostics::{Code, Diagnostic};
use crate::ir::{ComputeBufferItem, ComputeItem, Program};
use crate::layout::{LayoutNode, LayoutRecord};
use crate::lowering::shader::{compute_dispatch_layout, lower_compute};

use super::artifact::sha256_hex;
use super::{SpanMap, SpanMapDocument, print_module, validate};

/// The internal definition consumed by the runtime resource owner. All offsets
/// and strides come from layout records, not a separately maintained host layout.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeDefinition {
    pub id: String,
    pub entry_point: String,
    pub workgroup_size: [u32; 3],
    pub dispatch: LayoutRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uniforms: Option<LayoutRecord>,
    pub inputs: Vec<ComputeResource>,
    pub output: ComputeResource,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ComputeResource {
    pub name: String,
    pub layout: LayoutNode,
}

impl From<&ComputeBufferItem> for ComputeResource {
    fn from(buffer: &ComputeBufferItem) -> Self {
        Self {
            name: buffer.name.clone(),
            layout: buffer.layout.clone(),
        }
    }
}

/// No artifact is returned until Naga accepts the generated WGSL.
#[derive(Clone, Debug, PartialEq)]
pub struct ComputeArtifact {
    pub definition: ComputeDefinition,
    pub wgsl: String,
    pub sha256: String,
    pub span_map: SpanMap,
}

impl ComputeArtifact {
    pub fn wgsl_path(&self) -> String {
        format!(
            "shaders/{}.wgsl",
            self.sha256.get(..16).unwrap_or(&self.sha256)
        )
    }
    pub fn span_map_document(
        &self,
        span_id: impl FnMut(crate::source::Span) -> u32,
    ) -> SpanMapDocument {
        self.span_map.document(&self.sha256, span_id)
    }

    /// A map has its own content address: identical kernel WGSL can come from
    /// different declarations, and interned span IDs can differ between builds.
    ///
    /// # Errors
    /// The JSON serializer's error if a future map field cannot be serialized.
    pub fn span_map_file(
        &self,
        span_id: impl FnMut(crate::source::Span) -> u32,
    ) -> Result<(String, String), serde_json::Error> {
        let text = format!(
            "{}\n",
            serde_json::to_string(&self.span_map_document(span_id))?
        );
        let hash = sha256_hex(text.as_bytes());
        Ok((
            format!("shaders/{}.mtek-map.json", hash.get(..16).unwrap_or(&hash)),
            text,
        ))
    }
}

/// Lower, print and validate a checked standalone compute declaration.
///
/// # Errors
/// E9999 for invalid typed IR/layouts; E6100 for a WGSL validation failure.
pub fn emit_compute(
    program: &Program,
    compute: &ComputeItem,
) -> Result<ComputeArtifact, Vec<Diagnostic>> {
    let module = lower_compute(program, compute)?;
    let printed = print_module(&module);
    validate(&printed.text, &printed.span_map)?;
    let dispatch = compute_dispatch_layout().map_err(|error| {
        vec![
            Diagnostic::new(
                Code::E9999,
                "The compute dispatch layout could not be generated; this is a compiler bug.",
            )
            .at(compute.span)
            .note(error.to_string()),
        ]
    })?;
    let sha256 = sha256_hex(printed.text.as_bytes());
    Ok(ComputeArtifact {
        definition: ComputeDefinition {
            id: compute.symbol.to_string(),
            entry_point: "mtek_cs".to_owned(),
            workgroup_size: compute.workgroup_size,
            dispatch,
            uniforms: compute.layout.clone(),
            inputs: compute.inputs.iter().map(ComputeResource::from).collect(),
            output: ComputeResource::from(&compute.output),
        },
        wgsl: printed.text,
        sha256,
        span_map: printed.span_map,
    })
}
