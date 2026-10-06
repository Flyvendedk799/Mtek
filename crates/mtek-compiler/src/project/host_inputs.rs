//! Validation of `[host.inputs]` against the entry scene (`spec/tooling.md` §3,
//! `spec/runtime-abi.md` §6.3): `E9020` / `E9021`, codec selection, and the
//! TypeScript field type for `app.d.ts`.

use std::collections::{BTreeMap, BTreeSet};

use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::package::manifest::{HostInput, HostInputTarget};
use crate::syntax::ast::{
    EntityMember, ExprKind, FieldValue, Module, SceneDecl, SceneMember,
};
use crate::types::CheckedScene;

/// One validated host input ready for the manifest and `app.d.ts`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedHostInput {
    pub name: String,
    pub state_name: String,
    pub ty: String,
    pub codec: String,
    /// TypeScript type for the `Inputs` interface field.
    pub ts_type: String,
}

/// Exposable host-input types and their default codecs (`spec/runtime-abi.md` §6.3).
fn codec_and_ts(ty: &str, feeds_opaque_color: bool) -> Option<(&'static str, &'static str)> {
    match ty {
        "f32" => Some(("f32", "number")),
        "i32" => Some(("i32", "number")),
        "u32" => Some(("u32", "number")),
        "bool" => Some(("bool", "boolean")),
        "vec2" => Some(("vec2", "number[]")),
        "vec3" => Some(("vec3", "number[]")),
        "vec4" => Some(("vec4", "number[]")),
        "string" => Some(("string", "string")),
        "color" if feeds_opaque_color => Some(("color-hex-opaque", "`#${string}`")),
        "color" => Some(("color-hex", "`#${string}`")),
        _ => None,
    }
}

/// Collect scene-state names that reach a material colour param through `bind(name)`.
pub fn states_feeding_opaque_color(module: &Module, scene_name: &str) -> BTreeSet<String> {
    let Some(scene) = module.items.iter().find_map(|item| match &item.kind {
        crate::syntax::ast::ItemKind::Scene(s) if s.name.name == scene_name => Some(s),
        _ => None,
    }) else {
        return BTreeSet::new();
    };
    let mut out = BTreeSet::new();
    collect_opaque_feeds_from_scene(scene, &mut out);
    out
}

fn collect_opaque_feeds_from_scene(scene: &SceneDecl, out: &mut BTreeSet<String>) {
    for member in &scene.members {
        if let SceneMember::Entity(entity) = member {
            collect_opaque_feeds_from_entity(entity, out);
        }
    }
}

fn collect_opaque_feeds_from_entity(
    entity: &crate::syntax::ast::EntityDecl,
    out: &mut BTreeSet<String>,
) {
    for member in &entity.members {
        match member {
            EntityMember::Field(field) if field.name.name == "material" => {
                if let FieldValue::Expr(expr) = &field.value {
                    collect_opaque_from_material_literal(expr, out);
                }
            }
            EntityMember::Entity(child) => collect_opaque_feeds_from_entity(child, out),
            _ => {}
        }
    }
}

fn collect_opaque_from_material_literal(
    expr: &crate::syntax::ast::Expr,
    out: &mut BTreeSet<String>,
) {
    let ExprKind::Descriptor { fields, .. } = &expr.kind else {
        return;
    };
    for field in fields {
        // Colour params are opaque in v0.1. Record every bare name bound into a
        // material param; codec selection upgrades to color-hex-opaque only when
        // the host-input state's type is `color`.
        if let FieldValue::Bind(bind) = &field.value
            && let ExprKind::Name(name) = &bind.source.kind
        {
            out.insert(name.clone());
        }
    }
}

/// Validate `host_inputs` (name → `"Scene.state"`) against the entry scene.
pub fn validate_host_inputs(
    host_inputs: &BTreeMap<String, String>,
    entry_scene: &CheckedScene,
    opaque_feeds: &BTreeSet<String>,
    sink: &mut Diagnostics,
) -> Vec<ResolvedHostInput> {
    let state_by_name: BTreeMap<&str, &str> = entry_scene
        .state
        .iter()
        .map(|s| (s.name.as_str(), s.ty.as_str()))
        .collect();
    let mut resolved = Vec::new();
    for (name, target) in host_inputs {
        let Some((scene_part, state_part)) = target.split_once('.') else {
            sink.push(
                Diagnostic::new(
                    Code::E9021,
                    format!(
                        "Unknown host input target '{target}': expected 'Scene.state_name'."
                    ),
                )
                .note(format!("host.inputs.{name}"))
                .help("use the form SceneName.stateName, naming scene state of the entry scene"),
            );
            continue;
        };
        if scene_part != entry_scene.name {
            sink.push(
                Diagnostic::new(
                    Code::E9021,
                    format!(
                        "Unknown host input target '{target}': the entry scene is '{}'.",
                        entry_scene.name
                    ),
                )
                .note(format!("host.inputs.{name}"))
                .help(format!(
                    "write '{}.{}' to expose state of the entry scene",
                    entry_scene.name, state_part
                )),
            );
            continue;
        }
        let Some(ty) = state_by_name.get(state_part).copied() else {
            // State name unknown, or not scene state (entity state is not exposable).
            if entry_scene
                .entities_in_order()
                .iter()
                .any(|e| e.name == state_part)
            {
                sink.push(
                    Diagnostic::new(
                        Code::E9020,
                        format!(
                            "Host input target '{target}' is not exposable: only scene state can be a host input, not an entity."
                        ),
                    )
                    .note(format!("host.inputs.{name}")),
                );
            } else {
                sink.push(
                    Diagnostic::new(
                        Code::E9021,
                        format!(
                            "Unknown host input target '{target}': scene '{}' has no state '{state_part}'.",
                            entry_scene.name
                        ),
                    )
                    .note(format!("host.inputs.{name}")),
                );
            }
            continue;
        };
        let feeds = opaque_feeds.contains(state_part);
        let Some((codec, ts_type)) = codec_and_ts(ty, feeds) else {
            sink.push(
                Diagnostic::new(
                    Code::E9020,
                    format!(
                        "Host input target '{target}' is not exposable: type '{ty}' cannot be a host input."
                    ),
                )
                .note(format!("host.inputs.{name}"))
                .note("exposable types: f32, i32, u32, bool, vec2, vec3, vec4, color, string"),
            );
            continue;
        };
        resolved.push(ResolvedHostInput {
            name: name.clone(),
            state_name: state_part.to_owned(),
            ty: ty.to_owned(),
            codec: codec.to_owned(),
            ts_type: ts_type.to_owned(),
        });
    }
    resolved
}

impl ResolvedHostInput {
    /// The manifest entry.
    #[must_use]
    pub fn to_manifest(&self) -> HostInput {
        HostInput {
            name: self.name.clone(),
            target: HostInputTarget {
                kind: "state".to_owned(),
                name: self.state_name.clone(),
            },
            ty: self.ty.clone(),
            codec: self.codec.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_hex_opaque_when_state_feeds_a_material_colour() {
        assert_eq!(
            codec_and_ts("color", true),
            Some(("color-hex-opaque", "`#${string}`"))
        );
        assert_eq!(
            codec_and_ts("color", false),
            Some(("color-hex", "`#${string}`"))
        );
    }

    #[test]
    fn unsupported_types_are_not_exposable() {
        assert!(codec_and_ts("mat4", false).is_none());
        assert!(codec_and_ts("quat", false).is_none());
        assert!(codec_and_ts("mesh", false).is_none());
    }
}
