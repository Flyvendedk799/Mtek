//! `mtek inspect --bindings` (`spec/gpu-layout.md` section 10, decision 0044): every block
//! the entry scene binds and every material instance, from the resource plan.
//!
//! For each block — `builtin:frame`, `builtin:object`, then the material blocks by id, the
//! order of the manifest's `layouts` — the layout record of section 5 plus its logical slot
//! (`group`, `binding`, dynamic offset), stage visibility, owner and the flattened fields
//! with their WGSL representation, offset, size and the padding after them. For each
//! material instance: its entity, block and slot, whether its storage may be shared, and per
//! param the declaration, the instance, the update class with its dependencies (none before
//! `bind`, M3) and the field it is written to.

use serde::Serialize;

use crate::emit_wgsl::blocks::type_expr;
use crate::layout::{LayoutMember, LayoutNode, LayoutRecord, builtin_blocks, compute};
use crate::plan::ResourcePlan;
use crate::source::SourceMap;

use super::view::{Align, SourceLocation, table, to_json};

/// The bind group of the frame block, the material blocks and the object block
/// (`spec/gpu-layout.md` section 6).
const FRAME_GROUP: u32 = 0;
const MATERIAL_GROUP: u32 = 1;
const OBJECT_GROUP: u32 = 2;

/// The view.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingsView {
    /// The entry scene's symbol.
    pub scene: String,
    pub target_profile: String,
    pub blocks: Vec<Block>,
    pub instances: Vec<Instance>,
}

/// A bound block.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    /// The layout record (`spec/gpu-layout.md` section 5).
    #[serde(flatten)]
    pub record: LayoutRecord,
    pub group: u32,
    pub binding: u32,
    pub dynamic_offset: bool,
    /// `vertex`, `fragment`.
    pub visibility: Vec<&'static str>,
    /// Who owns and writes it: `runtime` (once per frame), `object` (per drawn object),
    /// `material instance`.
    pub owner: &'static str,
    /// The material whose parameter block it is.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    pub fields: Vec<FieldRow>,
}

/// A field of a block, flattened: struct members recursively (`lights`, `inner.x`), an
/// array as one field with its length and stride.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldRow {
    pub path: String,
    pub mtek_type: String,
    pub wgsl_type: String,
    pub offset: u32,
    pub size: u32,
    /// Bytes between the end of the field and the next field (or the end of its struct).
    pub padding: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stride: Option<u32>,
    /// Whether each element is wrapped to a 16-byte stride (`spec/gpu-layout.md` 4.4).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padded: Option<bool>,
    /// The `param` declaration, for the top-level fields of a material block.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub declaration: Option<SourceLocation>,
}

/// A material instance.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub index: u32,
    pub material: String,
    /// The owning entity's symbol and static index.
    pub entity: String,
    pub entity_index: u32,
    /// The block's layout id; `None` for a material without params (an empty group 1).
    pub layout: Option<String>,
    pub group: u32,
    pub binding: Option<u32>,
    /// Whether the instance may share its parameter slot with byte-identical instances
    /// (every param `initial`, `spec/gpu-layout.md` section 8.2).
    pub shareable: bool,
    pub params: Vec<InstanceParam>,
}

/// A param of a material instance.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceParam {
    pub name: String,
    /// The type as written in source.
    #[serde(rename = "type")]
    pub ty: String,
    /// The `param` declaration in the material.
    pub declaration: SourceLocation,
    /// The material instance (`material: …;`, or the entity for its default material).
    pub instance: SourceLocation,
    /// `initial | imperative | bound | resource`.
    pub update: &'static str,
    /// What a `bound` param's binding reads (empty before `bind`, M3).
    pub dependencies: Vec<String>,
    /// The field the param is written to.
    pub field: String,
    pub offset: u32,
    pub size: u32,
}

/// The view of `plan` (the entry scene `scene`), with locations resolved through `sources`.
///
/// # Errors
/// A defect text: a built-in block without a layout, a span outside the source map, or a
/// planned instance whose material or field is not in the plan.
pub fn bindings_view(
    scene: &str,
    target_profile: &str,
    plan: &ResourcePlan,
    sources: &SourceMap,
) -> Result<BindingsView, String> {
    let mut blocks = Vec::new();
    for block in builtin_blocks() {
        let (group, visibility, owner, dynamic_offset) = match block.id {
            "builtin:frame" => (FRAME_GROUP, vec!["vertex", "fragment"], "runtime", false),
            "builtin:object" => (OBJECT_GROUP, vec!["vertex"], "object", true),
            // `builtin:light` is a struct nested in the frame block.
            _ => continue,
        };
        let record = compute(&block.ty, block.id, block.wgsl_struct)
            .map_err(|e| format!("the block '{}' has no layout: {e}", block.id))?;
        let fields = fields(&record, &[]);
        blocks.push(Block {
            record,
            group,
            binding: 0,
            dynamic_offset,
            visibility,
            owner,
            material: None,
            fields,
        });
    }
    let mut materials: Vec<_> = plan
        .materials
        .iter()
        .filter(|m| m.layout.is_some())
        .collect();
    materials.sort_by(|a, b| {
        let id = |m: &&crate::plan::PlannedMaterial| m.layout.as_ref().map(|l| l.id.clone());
        id(a).cmp(&id(b))
    });
    for material in materials {
        let Some(record) = material.layout.clone() else {
            continue;
        };
        let mut declarations = Vec::with_capacity(material.params.len());
        for param in &material.params {
            declarations.push((param.name.clone(), SourceLocation::of(param.span, sources)?));
        }
        let fields = fields(&record, &declarations);
        blocks.push(Block {
            record,
            group: MATERIAL_GROUP,
            binding: 0,
            dynamic_offset: false,
            visibility: vec!["fragment"],
            owner: "material instance",
            material: Some(material.symbol.to_string()),
            fields,
        });
    }

    let mut instances = Vec::with_capacity(plan.instances.len());
    for instance in &plan.instances {
        let material = plan.material(&instance.material).ok_or_else(|| {
            format!(
                "the material '{}' of instance {} is not in the plan",
                instance.material, instance.index
            )
        })?;
        let members: &[LayoutMember] = match material.layout.as_ref().map(|l| &l.root) {
            Some(LayoutNode::Struct { members, .. }) => members,
            _ => &[],
        };
        let mut params = Vec::with_capacity(instance.params.len());
        for (param, declared) in instance.params.iter().zip(&material.params) {
            let member = members
                .iter()
                .find(|m| m.name == param.name)
                .ok_or_else(|| {
                    format!(
                        "the param '{}' of '{}' has no field in its block",
                        param.name, material.symbol
                    )
                })?;
            params.push(InstanceParam {
                name: param.name.clone(),
                ty: declared.ty.clone(),
                declaration: SourceLocation::of(declared.span, sources)?,
                instance: SourceLocation::of(param.span, sources)?,
                update: param.class.as_str(),
                dependencies: Vec::new(),
                field: member.name.clone(),
                offset: member.node.offset(),
                size: member.node.size(),
            });
        }
        instances.push(Instance {
            index: instance.index,
            material: instance.material.to_string(),
            entity: instance.entity_symbol.to_string(),
            entity_index: instance.entity,
            layout: material.layout.as_ref().map(|l| l.id.clone()),
            group: MATERIAL_GROUP,
            binding: material.layout.as_ref().map(|_| 0),
            shareable: instance.shareable(),
            params,
        });
    }
    Ok(BindingsView {
        scene: scene.to_owned(),
        target_profile: target_profile.to_owned(),
        blocks,
        instances,
    })
}

/// The fields of `record`, flattened in member order; `declarations` gives the `param`
/// declaration of top-level members by name.
fn fields(record: &LayoutRecord, declarations: &[(String, SourceLocation)]) -> Vec<FieldRow> {
    let mut out = Vec::new();
    if let LayoutNode::Struct { members, .. } = &record.root {
        struct_fields(
            members,
            record.root.offset() + record.root.size(),
            "",
            declarations,
            &mut out,
        );
    }
    out
}

/// The members of a struct ending at `end`, with the path prefix `prefix`. Struct nesting
/// is bounded by the type checker's depth limit, which bounds the recursion.
fn struct_fields(
    members: &[LayoutMember],
    end: u32,
    prefix: &str,
    declarations: &[(String, SourceLocation)],
    out: &mut Vec<FieldRow>,
) {
    for (index, member) in members.iter().enumerate() {
        let node = &member.node;
        let next = members.get(index + 1).map_or(end, |m| m.node.offset());
        let path = format!("{prefix}{}", member.name);
        let (length, stride, padded) = match node {
            LayoutNode::Array {
                length,
                stride,
                padded,
                ..
            } => (Some(*length), Some(*stride), Some(*padded)),
            _ => (None, None, None),
        };
        out.push(FieldRow {
            path: path.clone(),
            mtek_type: member.mtek_type.clone(),
            wgsl_type: type_expr(node),
            offset: node.offset(),
            size: node.size(),
            padding: next.saturating_sub(node.offset() + node.size()),
            length,
            stride,
            padded,
            declaration: if prefix.is_empty() {
                declarations
                    .iter()
                    .find(|(name, _)| *name == member.name)
                    .map(|(_, location)| location.clone())
            } else {
                None
            },
        });
        if let LayoutNode::Struct {
            members: inner,
            offset,
            size,
            ..
        } = node
        {
            struct_fields(inner, offset + size, &format!("{path}."), declarations, out);
        }
    }
}

impl BindingsView {
    /// `--format json`: pretty JSON, keys in declaration order.
    #[must_use]
    pub fn to_json(&self) -> String {
        to_json(self)
    }

    /// `--format human`: one table per block and per instance.
    #[must_use]
    pub fn to_human(&self) -> String {
        let mut out = format!(
            "bindings of scene {} (target profile {})\n",
            self.scene, self.target_profile
        );
        for block in &self.blocks {
            out.push('\n');
            let slot = if block.dynamic_offset {
                format!(
                    "group {} binding {} (dynamic offset)",
                    block.group, block.binding
                )
            } else {
                format!("group {} binding {}", block.group, block.binding)
            };
            out.push_str(&format!(
                "block {} {}  {slot}  visibility {}  owner {}  size {} align {}\n",
                block.record.id,
                block.record.wgsl_struct,
                block.visibility.join("+"),
                block.owner,
                block.record.size,
                block.record.align
            ));
            let material = block.material.is_some();
            let mut columns = vec![
                ("field", Align::Left),
                ("type", Align::Left),
                ("wgsl", Align::Left),
                ("offset", Align::Right),
                ("size", Align::Right),
                ("padding", Align::Right),
                ("array", Align::Left),
            ];
            if material {
                columns.push(("declared at", Align::Left));
            }
            let rows: Vec<Vec<String>> = block
                .fields
                .iter()
                .map(|field| {
                    let array = match (field.length, field.stride, field.padded) {
                        (Some(length), Some(stride), Some(padded)) => format!(
                            "{length} x stride {stride}{}",
                            if padded { " (padded)" } else { "" }
                        ),
                        _ => String::new(),
                    };
                    let mut row = vec![
                        field.path.clone(),
                        field.mtek_type.clone(),
                        field.wgsl_type.clone(),
                        field.offset.to_string(),
                        field.size.to_string(),
                        field.padding.to_string(),
                        array,
                    ];
                    if material {
                        row.push(
                            field
                                .declaration
                                .as_ref()
                                .map_or_else(String::new, SourceLocation::human),
                        );
                    }
                    row
                })
                .collect();
            table(&mut out, 2, &columns, &rows);
        }
        for instance in &self.instances {
            out.push('\n');
            let slot = match (&instance.layout, instance.binding) {
                (Some(layout), Some(binding)) => {
                    format!("block {layout}  group {} binding {binding}", instance.group)
                }
                _ => format!("no parameter block (empty group {})", instance.group),
            };
            out.push_str(&format!(
                "instance #{} of {}  entity {} (#{})  {slot}  storage {}\n",
                instance.index,
                instance.material,
                instance.entity,
                instance.entity_index,
                if instance.shareable {
                    "shareable"
                } else {
                    "owned"
                }
            ));
            let rows: Vec<Vec<String>> = instance
                .params
                .iter()
                .map(|param| {
                    vec![
                        param.name.clone(),
                        param.ty.clone(),
                        param.update.to_owned(),
                        if param.dependencies.is_empty() {
                            "-".to_owned()
                        } else {
                            param.dependencies.join(", ")
                        },
                        param.field.clone(),
                        param.offset.to_string(),
                        param.size.to_string(),
                        param.declaration.human(),
                        param.instance.human(),
                    ]
                })
                .collect();
            table(
                &mut out,
                2,
                &[
                    ("param", Align::Left),
                    ("type", Align::Left),
                    ("update", Align::Left),
                    ("dependencies", Align::Left),
                    ("field", Align::Left),
                    ("offset", Align::Right),
                    ("size", Align::Right),
                    ("declared at", Align::Left),
                    ("instance at", Align::Left),
                ],
                &rows,
            );
        }
        out
    }
}
