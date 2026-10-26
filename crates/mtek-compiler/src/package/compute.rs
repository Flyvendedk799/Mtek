//! Compute package metadata and default bytes, derived from the same layout
//! records as WGSL and generated JavaScript field writers.
use super::manifest::{ComputeParam, ComputeProgram, ComputeShader};
use super::spans::SpanTable;
use crate::diagnostics::{Code, Diagnostic};
use crate::emit_wgsl::emit_compute;
use crate::ir::{ComputeItem, Program, Value};
use crate::layout::{LayoutNode, LayoutRecord, ScalarKind};

fn defect(message: impl Into<String>) -> Vec<Diagnostic> {
    vec![
        Diagnostic::new(
            Code::E9999,
            "Compute packaging failed; this is a compiler bug.",
        )
        .note(message.into()),
    ]
}

pub(super) fn assemble(
    program: &Program,
    spans: &mut SpanTable<'_>,
    layouts: &mut Vec<LayoutRecord>,
    files: &mut Vec<(String, Vec<u8>)>,
) -> Result<Vec<ComputeProgram>, Vec<Diagnostic>> {
    let mut computes = program.computes().collect::<Vec<_>>();
    computes.sort_by(|left, right| left.symbol.cmp(&right.symbol));
    let mut result = Vec::with_capacity(computes.len());
    for compute in computes {
        let artifact = emit_compute(program, compute)?;
        let span = spans.intern(compute.span).map_err(defect)?;
        for entry in &artifact.span_map.entries {
            spans.intern(entry.span).map_err(defect)?;
        }
        let mut params = Vec::new();
        for param in &compute.params {
            params.push(ComputeParam {
                name: param.name.clone(),
                ty: param.ty.clone(),
                has_default: param.default.is_some(),
                span: spans.intern(param.span).map_err(defect)?,
            });
        }
        // All entries (including the declaration fallback) have already been interned.
        let (map, text) = artifact
            .span_map_file(|source| spans.intern(source).unwrap_or(0))
            .map_err(|error| defect(error.to_string()))?;
        files.push((artifact.wgsl_path(), artifact.wgsl.as_bytes().to_vec()));
        files.push((map.clone(), text.into_bytes()));
        if let Some(layout) = &compute.layout {
            layouts.push(layout.clone());
        }
        result.push(ComputeProgram {
            api: 1,
            shader: ComputeShader {
                hash: artifact.sha256.clone(),
                url: artifact.wgsl_path(),
                map,
            },
            definition: artifact.definition,
            params,
            defaults: defaults(compute).map_err(defect)?,
            span,
        });
    }
    Ok(result)
}

fn defaults(compute: &ComputeItem) -> Result<Vec<u8>, String> {
    let Some(layout) = &compute.layout else {
        return Ok(Vec::new());
    };
    if layout.size > 65_536 {
        return Err("compute uniform defaults exceed the source profile".into());
    }
    let LayoutNode::Struct { members, .. } = &layout.root else {
        return Err("compute uniforms have no struct root".into());
    };
    let mut bytes = vec![0; layout.size as usize];
    for param in &compute.params {
        if let Some(value) = &param.default {
            let member = members
                .iter()
                .find(|member| member.name == param.name)
                .ok_or("compute default has no layout member")?;
            write_value(&member.node, value, 0, &mut bytes)?;
        }
    }
    Ok(bytes)
}

fn put(bytes: &mut [u8], offset: usize, value: [u8; 4]) -> Result<(), String> {
    bytes
        .get_mut(offset..offset + 4)
        .ok_or("compute default exceeds its layout")?
        .copy_from_slice(&value);
    Ok(())
}

fn write_value(
    node: &LayoutNode,
    value: &Value,
    base: usize,
    bytes: &mut [u8],
) -> Result<(), String> {
    let at = base + node.offset() as usize;
    match (node, value) {
        (
            LayoutNode::Scalar {
                scalar: ScalarKind::Bool32,
                ..
            },
            Value::Bool(value),
        ) => put(bytes, at, u32::from(*value).to_le_bytes()),
        (
            LayoutNode::Scalar {
                scalar: ScalarKind::I32,
                ..
            },
            Value::I32(value),
        ) => put(bytes, at, value.to_le_bytes()),
        (
            LayoutNode::Scalar {
                scalar: ScalarKind::U32,
                ..
            },
            Value::U32(value),
        ) => put(bytes, at, value.to_le_bytes()),
        (
            LayoutNode::Scalar {
                scalar: ScalarKind::F32,
                ..
            },
            Value::F32(value),
        ) if value.is_finite() => put(bytes, at, value.to_le_bytes()),
        (LayoutNode::Vector { components, .. }, value) => {
            let values: &[f32] = match value {
                Value::Vec2(value) => value,
                Value::Vec3(value) => value,
                Value::Vec4(value) | Value::Color(value) | Value::Quat(value) => value,
                _ => return Err("non-vector compute default".into()),
            };
            if values.len() != *components as usize || values.iter().any(|value| !value.is_finite())
            {
                return Err("invalid compute vector default".into());
            }
            for (index, value) in values.iter().enumerate() {
                put(bytes, at + index * 4, value.to_le_bytes())?;
            }
            Ok(())
        }
        (LayoutNode::Matrix { column_stride, .. }, Value::Mat4(columns)) => {
            for (column, values) in columns.iter().enumerate() {
                for (row, value) in values.iter().enumerate() {
                    if !value.is_finite() {
                        return Err("non-finite compute matrix default".into());
                    }
                    put(
                        bytes,
                        at + column * *column_stride as usize + row * 4,
                        value.to_le_bytes(),
                    )?;
                }
            }
            Ok(())
        }
        (LayoutNode::Struct { members, .. }, Value::Struct { fields, .. }) => {
            if fields.len() != members.len() {
                return Err("compute struct default has wrong fields".into());
            }
            for member in members {
                let field = fields
                    .iter()
                    .find(|field| field.name == member.name)
                    .ok_or("compute default is missing a struct field")?;
                // Struct member offsets are absolute in their enclosing block.
                write_value(&member.node, &field.value, base, bytes)?;
            }
            Ok(())
        }
        (
            LayoutNode::Array {
                length,
                stride,
                element,
                ..
            },
            Value::Array(values),
        ) => {
            if values.len() != *length as usize {
                return Err("compute array default has wrong length".into());
            }
            for (index, value) in values.iter().enumerate() {
                write_value(element, value, at + index * *stride as usize, bytes)?;
            }
            Ok(())
        }
        _ => Err("compute default disagrees with its GPU layout".into()),
    }
}
