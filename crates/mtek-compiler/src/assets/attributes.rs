//! `E7010`: a mesh from a GLB that lacks an attribute its material reads
//! (`spec/materials.md` section 3.1, `spec/assets.md` section 3).
//!
//! The generated vertex stage outputs only the `SurfaceInput` fields a material reads, and the
//! vertex layout needs exactly those attributes (blueprint section 7.2). A primitive without
//! `TEXCOORD_0` cannot supply `uv`, one without `NORMAL` cannot supply `world_normal`; the
//! compiler never substitutes zeros or computes normals (decision 0058).

use super::AssetStore;
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::types::{CheckedEntity, ConstValue, MaterialInfo, Typeck};

/// The `SurfaceInput` fields `material` reads.
fn surface_inputs<'t>(
    typecks: &[&'t Typeck],
    value: &ConstValue,
) -> Option<(&'t MaterialInfo, String)> {
    for typeck in typecks {
        for (_, info) in typeck.materials() {
            let found = match value {
                ConstValue::Struct { name, .. } => info.name == *name,
                ConstValue::Material { material, .. } => info.key == *material,
                _ => false,
            };
            if found {
                return Some((info, info.name.clone()));
            }
        }
    }
    None
}

fn visit(entity: &CheckedEntity, typecks: &[&Typeck], store: &AssetStore, sink: &mut Diagnostics) {
    check_entity(entity, typecks, store, sink);
    for child in &entity.children {
        visit(child, typecks, store, sink);
    }
}

fn check_entity(
    entity: &CheckedEntity,
    typecks: &[&Typeck],
    store: &AssetStore,
    sink: &mut Diagnostics,
) {
    let Some(mesh_field) = entity.field("mesh") else {
        return;
    };
    let Some(ConstValue::AssetMesh {
        file,
        mesh,
        primitive,
    }) = &mesh_field.value
    else {
        return;
    };
    let Some(material_value) = entity.field("material").and_then(|f| f.value.as_ref()) else {
        return;
    };
    let Some((info, material_name)) = surface_inputs(typecks, material_value) else {
        return;
    };
    let Some(stage) = &info.fragment else {
        return;
    };
    let Some(declared) = store.glb(file) else {
        return;
    };
    let Some(primitive_data) = declared
        .file
        .meshes
        .iter()
        .find(|m| m.name.as_deref() == Some(mesh.as_str()))
        .and_then(|m| m.primitives.get(*primitive as usize))
    else {
        return;
    };
    let span = match mesh_field.origin {
        crate::types::scene::FieldOrigin::Written { span, .. } => span,
        crate::types::scene::FieldOrigin::Default => entity.span,
    };
    for (input, attribute, present) in [
        ("uv", "TEXCOORD_0", primitive_data.uv.is_some()),
        ("world_normal", "NORMAL", primitive_data.normal.is_some()),
    ] {
        if present || !stage.surface_inputs.contains(&input) {
            continue;
        }
        sink.push(
            Diagnostic::new(
                Code::E7010,
                format!(
                    "The mesh '{mesh}' of '{file}' has no {attribute}, but the material {material_name} reads `{input}`."
                ),
            )
            .at(span)
            .related(info.name_span, format!("the material {material_name} is declared here"))
            .note("the compiler does not invent vertex data: it never substitutes zeros and does not compute normals or texture coordinates")
            .help(format!(
                "export the model with {attribute}, or draw it with a material that does not read `{input}`"
            )),
        );
    }
}

/// Report `E7010` for every entity of every scene of `typecks`.
pub(crate) fn check_attributes(typecks: &[&Typeck], store: &AssetStore, sink: &mut Diagnostics) {
    if store.is_empty() {
        return;
    }
    for typeck in typecks {
        for scene in typeck.scenes() {
            for entity in &scene.entities {
                visit(entity, typecks, store, sink);
            }
        }
    }
}
