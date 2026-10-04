//! The v0.1 registry tables: every prelude name, complete from the start
//! (`spec/stdlib.md`). Items carry the milestone in which the compiler implements them.

mod build;
mod events;
mod intrinsics;
mod namespaces;
mod physics;
mod schemas;

use super::model::Registry;

/// The embedded prelude Mtek sources: `(path, text)`.
const PRELUDE_SOURCES: [(&str, &str); 1] =
    [("std/materials.mtek", include_str!("../std/materials.mtek"))];

/// Builds the complete v0.1 registry.
pub(super) fn build_registry() -> Registry {
    Registry {
        types: namespaces::types(),
        schemas: schemas::schemas(),
        declaration_schemas: schemas::declaration_schemas(),
        scene_objects: schemas::scene_objects(),
        events: events::events(),
        enums: events::enums(),
        intrinsics: intrinsics::intrinsics(),
        namespaces: namespaces::namespaces(),
        body_commands: physics::body_commands(),
        body_properties: physics::body_properties(),
        prelude_sources: PRELUDE_SOURCES.to_vec(),
    }
}
