//! `E5016`: a `clip` that cannot play (decision 0156).
//!
//! A clip is the single writer of the channels it has. The mesh must be a mesh of the same
//! GLB, and the named animation must move that mesh. A scale keyframe of 0 or less is rejected
//! here, not when the file is loaded, because a file may still be used by an entity that does
//! not play that channel.

use crate::assets::{AssetStore, GlbChannelPath, GlbFile};
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::Span;
use crate::types::{CheckedEntity, CheckedField, ConstValue, FieldOrigin, Typeck};

/// Report `E5016` for every `clip` of every scene and prefab.
pub(crate) fn check_clips(typecks: &[&Typeck], store: &AssetStore, sink: &mut Diagnostics) {
    for typeck in typecks {
        for scene in typeck.scenes() {
            for entity in &scene.entities {
                visit(entity, store, sink);
            }
        }
        for prefab in typeck.checked_prefabs() {
            check_one(&prefab.name, prefab.span, &prefab.fields, store, sink);
            for child in &prefab.children {
                visit(child, store, sink);
            }
        }
    }
}

fn visit(entity: &CheckedEntity, store: &AssetStore, sink: &mut Diagnostics) {
    if entity.instance.is_none() {
        check_one(&entity.name, entity.span, &entity.fields, store, sink);
    }
    for child in &entity.children {
        visit(child, store, sink);
    }
}

fn check_one(
    name: &str,
    owner: Span,
    fields: &[CheckedField],
    store: &AssetStore,
    sink: &mut Diagnostics,
) {
    let Some(clip_field) = fields.iter().find(|field| field.name == "clip") else {
        return;
    };
    let Some(ConstValue::Str(clip)) = clip_field.value.as_ref() else {
        return;
    };
    let span = match clip_field.origin {
        FieldOrigin::Written { span, .. } => span,
        FieldOrigin::Default => owner,
    };
    let mut report = |message: String, help: String| {
        sink.push(Diagnostic::new(Code::E5016, message).at(span).help(help));
    };
    let Some(mesh_field) = fields.iter().find(|field| field.name == "mesh") else {
        report(
            format!("The clip '{clip}' of '{name}' needs a mesh loaded from a GLB."),
            "set `mesh` to `asset.glb(...).mesh(\"MeshName\")` from the file that holds the animation".to_owned(),
        );
        return;
    };
    let Some(ConstValue::AssetMesh { file, mesh, .. }) = mesh_field.value.as_ref() else {
        report(
            format!("The clip '{clip}' of '{name}' needs a mesh loaded from a GLB."),
            "a `Box`, `Sphere` or `Plane` has no animation; use a mesh from a GLB".to_owned(),
        );
        return;
    };
    let Some(declared) = store.glb(file) else {
        return;
    };
    let Some(played) = declared.file.clip_for(clip, mesh) else {
        let known = clip_names(&declared.file);
        let help = if known.is_empty() {
            format!("'{file}' has no animation a clip can play")
        } else if declared.file.clips.iter().any(|item| item.name == *clip) {
            format!("'{clip}' does not move the mesh '{mesh}'")
        } else {
            format!("the animations of '{file}' are {known}")
        };
        report(
            format!("The clip '{clip}' cannot play on the mesh '{mesh}' of '{file}'."),
            help,
        );
        return;
    };
    for channel in &played.channels {
        let field_name = channel.path.entity_field();
        if let Some(field) = fields.iter().find(|field| field.name == field_name)
            && writes(field)
        {
            report(
                format!(
                    "The clip '{clip}' of '{name}' writes {field_name}, which the entity also writes."
                ),
                "remove that field, or remove the channel from the animation. A clip is the only writer of the channels it has.".to_owned(),
            );
        }
        if channel.path == GlbChannelPath::Scale
            && let Some(value) = channel.values.iter().copied().find(|value| *value <= 0.0)
        {
            report(
                format!(
                    "The clip '{clip}' of '{name}' scales a component to {value}, which is not positive."
                ),
                "keep every scale component greater than 0".to_owned(),
            );
        }
    }
}

fn writes(field: &CheckedField) -> bool {
    field.dynamic || matches!(field.origin, FieldOrigin::Written { .. })
}

fn clip_names(file: &GlbFile) -> String {
    file.clips
        .iter()
        .map(|clip| format!("'{}'", clip.name))
        .collect::<Vec<_>>()
        .join(", ")
}
