//! Compute inspection shares validated artifacts with packaging.
use super::shaders::SpanEntry;
use super::view::SourceLocation;
use crate::diagnostics::Diagnostic;
use crate::emit_wgsl::{ComputeDefinition, emit_compute};
use crate::ir::Program;
use crate::source::SourceMap;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ComputeBindingSlot {
    pub group: u32,
    pub binding: u32,
    pub kind: &'static str,
    pub name: String,
    pub bytes: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ComputeBindings {
    pub definition: ComputeDefinition,
    pub declaration: SourceLocation,
    pub slots: Vec<ComputeBindingSlot>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeShader {
    pub bindings: ComputeBindings,
    pub hash: String,
    pub url: String,
    pub wgsl: String,
    pub span_map: Vec<SpanEntry>,
}

/// Validated compute shaders and binding layouts, with source locations.
/// # Errors
/// The artifact diagnostic, or E9999 for an invalid source location.
pub fn views(
    program: &Program,
    sources: &SourceMap,
) -> Result<Vec<ComputeShader>, Vec<Diagnostic>> {
    let mut computes = program.computes().collect::<Vec<_>>();
    computes.sort_by(|left, right| left.symbol.cmp(&right.symbol));
    let mut result = Vec::new();
    for compute in computes {
        let artifact = emit_compute(program, compute)?;
        let mut slots = vec![ComputeBindingSlot {
            group: 0,
            binding: 0,
            kind: "uniform",
            name: "dispatch".into(),
            bytes: artifact.definition.dispatch.size,
        }];
        if let Some(layout) = &compute.layout {
            slots.push(ComputeBindingSlot {
                group: 0,
                binding: 1,
                kind: "uniform",
                name: "params".into(),
                bytes: layout.size,
            });
        }
        for (index, input) in compute.inputs.iter().enumerate() {
            slots.push(ComputeBindingSlot {
                group: 0,
                binding: index as u32 + 2,
                kind: "storage-read",
                name: input.name.clone(),
                bytes: input.layout.size(),
            });
        }
        slots.push(ComputeBindingSlot {
            group: 0,
            binding: compute.inputs.len() as u32 + 2,
            kind: "storage-read-write",
            name: compute.output.name.clone(),
            bytes: compute.output.layout.size(),
        });
        let mut span_map = Vec::new();
        for entry in &artifact.span_map.entries {
            span_map.push(SpanEntry {
                wgsl: entry.wgsl,
                source: SourceLocation::of(entry.span, sources)
                    .map_err(|error| vec![super::view_error(&error)])?,
                symbol: entry.symbol.clone(),
            });
        }
        result.push(ComputeShader {
            bindings: ComputeBindings {
                definition: artifact.definition.clone(),
                declaration: SourceLocation::of(compute.span, sources)
                    .map_err(|error| vec![super::view_error(&error)])?,
                slots,
            },
            hash: artifact.sha256.clone(),
            url: artifact.wgsl_path(),
            wgsl: artifact.wgsl,
            span_map,
        });
    }
    Ok(result)
}

pub(super) fn human_bindings(view: &ComputeBindings) -> String {
    let mut text = format!(
        "\ncompute {} (declared at {}) entry {} workgroup {:?}\n",
        view.definition.id,
        view.declaration.human(),
        view.definition.entry_point,
        view.definition.workgroup_size
    );
    for slot in &view.slots {
        text.push_str(&format!(
            "  group {} binding {} {} {} ({} bytes, visibility compute)\n",
            slot.group, slot.binding, slot.kind, slot.name, slot.bytes
        ));
    }
    text
}
