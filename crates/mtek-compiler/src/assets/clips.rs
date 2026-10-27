//! `E5016`: a `clip` that cannot play (decision 0156). `E7028`: a `clips_from` that cannot supply
//! clips (decision 0223).
//!
//! A clip composes with the entity's own transform (decision 0174). The mesh must be a mesh of the same
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
    if let Some(source) = fields.iter().find(|field| field.name == "clips_from") {
        check_clips_from(name, owner, fields, source, store, sink);
        return;
    }
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
        // An animation the profile cannot play fails where it is used, not where the file is declared (decision 0174).
        if let Some(unsupported) = declared
            .file
            .unsupported_animations
            .iter()
            .find(|item| item.name == *clip)
        {
            sink.push(
                Diagnostic::new(
                    Code::E7019,
                    format!(
                        "The clip '{clip}' of '{name}' names an animation of '{file}' that cannot play. {}",
                        unsupported.reason
                    ),
                )
                .at(span)
                .help("export the animation with LINEAR or STEP translation, rotation and scale channels"),
            );
            return;
        }
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
    // The clip composes with the entity's own transform (`base * clip`, decision 0174), so the entity may
    // write or bind `position`, `rotation` and `scale` too; only a scale the clip drives to 0 or below is wrong.
    for channel in &played.channels {
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

/// `clips_from: asset.glb(..)` (decision 0223): the entity needs a skeletal mesh, the file needs a skin
/// with clips (`E7028`), and a `clip` names one of those clips (`E5016`). Whether the two skeletons
/// are humanoid is a run-time question (`E8110`).
fn check_clips_from(
    name: &str,
    owner: Span,
    fields: &[CheckedField],
    source: &CheckedField,
    store: &AssetStore,
    sink: &mut Diagnostics,
) {
    let span = match source.origin {
        FieldOrigin::Written { span, .. } => span,
        FieldOrigin::Default => owner,
    };
    let Some(ConstValue::GlbAsset(file)) = source.value.as_ref() else {
        return;
    };
    let mut report = |code: Code, message: String, help: String| {
        sink.push(Diagnostic::new(code, message).at(span).help(help));
    };
    let skeletal = fields
        .iter()
        .find(|field| field.name == "mesh")
        .and_then(|field| match field.value.as_ref() {
            Some(ConstValue::AssetMesh { file, mesh, .. }) => store
                .glb(file)
                .filter(|declared| declared.file.skins.iter().any(|skin| skin.mesh == *mesh)),
            _ => None,
        });
    if skeletal.is_none() {
        report(
            Code::E7028,
            format!("The clips_from of '{name}' needs a skeletal mesh on the same entity."),
            "set `mesh` to a skinned mesh, e.g. `asset.glb(...).mesh(\"MeshName\")` of a file with a skin".to_owned(),
        );
    }
    let Some(declared) = store.glb(file) else {
        return;
    };
    let Some(skin) = declared
        .file
        .skins
        .iter()
        .find(|skin| !skin.skin.clips.is_empty())
    else {
        report(
            Code::E7028,
            format!("The clips_from file '{file}' of '{name}' has no skeleton with clips."),
            "use a GLB that has a skin and at least one animation that moves it".to_owned(),
        );
        return;
    };
    let Some(ConstValue::Str(clip)) = fields
        .iter()
        .find(|field| field.name == "clip")
        .and_then(|field| field.value.as_ref())
    else {
        return;
    };
    if skin.skin.clips.iter().all(|item| item.name != *clip) {
        let known = skin
            .skin
            .clips
            .iter()
            .map(|item| format!("'{}'", item.name))
            .collect::<Vec<_>>()
            .join(", ");
        let clip_span = fields
            .iter()
            .find(|field| field.name == "clip")
            .and_then(|field| match field.origin {
                FieldOrigin::Written { span, .. } => Some(span),
                FieldOrigin::Default => None,
            })
            .unwrap_or(span);
        sink.push(
            Diagnostic::new(
                Code::E5016,
                format!(
                    "The clip '{clip}' of '{name}' is not a clip of its clips_from file '{file}'."
                ),
            )
            .at(clip_span)
            .help(format!("the clips of '{file}' are {known}")),
        );
    }
}

fn clip_names(file: &GlbFile) -> String {
    file.clips
        .iter()
        .map(|clip| format!("'{}'", clip.name))
        .collect::<Vec<_>>()
        .join(", ")
}
