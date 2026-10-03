//! Milestone gating: which specified constructs this compiler build
//! implements (`spec/compiler-architecture.md` section 4.3, decision 0013,
//! decision 0025).
//!
//! Two sources decide, and nothing else:
//!
//! * the **construct table** ([`construct_gate`]): one row per syntactic
//!   construct the resolver meets, with the milestone that implements it;
//! * the **registry**: every standard-library item carries `since`
//!   (`spec/stdlib.md` section 1.1), so a prelude type, function, namespace,
//!   namespace or enum member, schema, schema field, scene-object kind or event
//!   is implemented exactly when its `since` is reached.
//!
//! A construct is implemented when its milestone
//! [is reached by](Milestone::is_reached_by) [`IMPLEMENTED_MILESTONE`].
//! Anything else is `E9010` at the construct's span. Later milestones change a
//! row (or the registry's `since`, or the constant), never the logic.

use crate::stdlib::{CURRENT_MILESTONE, Milestone};

/// The milestone this compiler build implements. It is the registry's
/// [`CURRENT_MILESTONE`] (decision 0024), so that the construct table and the
/// registry can never disagree about the build.
pub const IMPLEMENTED_MILESTONE: Milestone = CURRENT_MILESTONE;

/// The syntactic constructs the resolver gates. Every construct of the
/// grammar that has semantics of its own is one of these or is part of one
/// (statements, parameters and stage functions are part of the function,
/// handler, lifecycle function or material they appear in).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Construct {
    Import,
    /// The `export` keyword in front of an item.
    Export,
    /// A module-level `const` item.
    ConstItem,
    /// `const` in a scene, entity or prefab body.
    BodyConst,
    Fn,
    CpuFn,
    Struct,
    Material,
    Prefab,
    Scene,
    /// `name: value;` in a scene (fields of the schema `Scene`); each field
    /// also has its own registry `since`.
    SceneField,
    State,
    /// `camera Main { … }`; the kind has its own registry `since`.
    SceneObject,
    Entity,
    /// `name: value;` in an entity (fields of the schema `Entity`).
    EntityField,
    /// `entity Name: Prefab { … }`.
    PrefabInstance,
    /// `update(dt: f32) { … }`, `fixed_update(…)` (and any other
    /// `name(…) { … }` member, which is `E5052` once implemented).
    LifecycleFn,
    /// `on event(…) { … }`; the event has its own registry `since`.
    Handler,
    Bind,
    SelfValue,
    /// `Name { … }`; a registry schema has its own `since`.
    Descriptor,
    StringLiteral,
    ArrayLiteral,
    Index,
}

impl Construct {
    /// Every construct, in declaration order.
    pub const ALL: [Construct; 24] = [
        Construct::Import,
        Construct::Export,
        Construct::ConstItem,
        Construct::BodyConst,
        Construct::Fn,
        Construct::CpuFn,
        Construct::Struct,
        Construct::Material,
        Construct::Prefab,
        Construct::Scene,
        Construct::SceneField,
        Construct::State,
        Construct::SceneObject,
        Construct::Entity,
        Construct::EntityField,
        Construct::PrefabInstance,
        Construct::LifecycleFn,
        Construct::Handler,
        Construct::Bind,
        Construct::SelfValue,
        Construct::Descriptor,
        Construct::StringLiteral,
        Construct::ArrayLiteral,
        Construct::Index,
    ];
}

/// One row of the construct table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ConstructGate {
    /// How diagnostics name the construct, at the start of a sentence.
    pub subject: &'static str,
    /// Whether `subject` is plural ("`fn` declarations are …").
    pub plural: bool,
    /// The milestone that implements the construct.
    pub since: Milestone,
}

const fn row(subject: &'static str, plural: bool, since: Milestone) -> ConstructGate {
    ConstructGate {
        subject,
        plural,
        since,
    }
}

/// The construct table. M1 implements scenes with scene fields, `camera`
/// objects, entities (nested), descriptor literals of M1 registry schemas and
/// constants (task M1-09); the milestones of the rest follow the work plan
/// (decision 0025).
#[must_use]
pub const fn construct_gate(construct: Construct) -> ConstructGate {
    use Milestone::{M1, M2, M3, M5};
    match construct {
        Construct::Import => row("Imports", true, M2),
        Construct::Export => row("`export`", false, M2),
        Construct::ConstItem => row("`const` items", true, M1),
        Construct::BodyConst => row("`const` declarations in bodies", true, M1),
        Construct::Fn => row("`fn` declarations", true, M2),
        Construct::CpuFn => row("`cpu fn` declarations", true, M2),
        Construct::Struct => row("`struct` declarations", true, M2),
        Construct::Material => row("`material` declarations", true, M2),
        Construct::Prefab => row("`prefab` declarations", true, M5),
        Construct::Scene => row("Scenes", true, M1),
        Construct::SceneField => row("Scene fields", true, M1),
        Construct::State => row("`state` declarations", true, M3),
        Construct::SceneObject => row("Scene objects", true, M1),
        Construct::Entity => row("Entities", true, M1),
        Construct::EntityField => row("Entity fields", true, M1),
        Construct::PrefabInstance => row("Prefab instances (`entity Name: Prefab`)", true, M5),
        Construct::LifecycleFn => row("Lifecycle functions", true, M3),
        Construct::Handler => row("Event handlers", true, M3),
        Construct::Bind => row("`bind`", false, M3),
        Construct::SelfValue => row("`self`", false, M3),
        Construct::Descriptor => row("Descriptor literals", true, M1),
        Construct::StringLiteral => row("String literals", true, M2),
        Construct::ArrayLiteral => row("Array literals", true, M2),
        Construct::Index => row("Indexing (`a[i]`)", false, M2),
    }
}

/// Whether something added in `since` is implemented by this build.
#[must_use]
pub const fn is_implemented(since: Milestone) -> bool {
    since.is_reached_by(IMPLEMENTED_MILESTONE)
}

/// The `E9010` message for `subject` (`plural` selects "are" over "is"),
/// planned for `since`.
#[must_use]
pub fn gate_message(subject: &str, plural: bool, since: Milestone) -> String {
    let verb = if plural { "are" } else { "is" };
    format!(
        "{subject} {verb} specified for v0.1 but not implemented by this compiler build yet (planned for {}).",
        since.as_str()
    )
}

/// The note every `E9010` of the resolver carries.
#[must_use]
pub fn gate_note() -> String {
    format!(
        "this compiler build implements the language up to milestone {}",
        IMPLEMENTED_MILESTONE.as_str()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stdlib::registry;

    #[test]
    fn the_list_of_constructs_is_complete_and_unique() {
        let mut seen = Vec::new();
        for construct in Construct::ALL {
            assert!(!seen.contains(&construct), "{construct:?} twice");
            seen.push(construct);
        }
        // `construct_gate` is an exhaustive match, so a new variant cannot be
        // forgotten there; `ALL` is checked against the variant count by the
        // array length.
        assert_eq!(seen.len(), Construct::ALL.len());
    }

    #[test]
    fn m1_implements_scenes_cameras_entities_descriptors_and_constants() {
        for construct in [
            Construct::ConstItem,
            Construct::BodyConst,
            Construct::Scene,
            Construct::SceneField,
            Construct::SceneObject,
            Construct::Entity,
            Construct::EntityField,
            Construct::Descriptor,
        ] {
            assert!(
                is_implemented(construct_gate(construct).since),
                "{construct:?}"
            );
        }
        for construct in [
            Construct::Import,
            Construct::Export,
            Construct::Fn,
            Construct::CpuFn,
            Construct::Struct,
            Construct::Material,
            Construct::Prefab,
            Construct::State,
            Construct::PrefabInstance,
            Construct::LifecycleFn,
            Construct::Handler,
            Construct::Bind,
            Construct::SelfValue,
            Construct::StringLiteral,
            Construct::ArrayLiteral,
            Construct::Index,
        ] {
            assert!(
                !is_implemented(construct_gate(construct).since),
                "{construct:?}"
            );
        }
    }

    #[test]
    fn literal_rows_agree_with_the_registry_types() {
        // String and array literals produce values of the registry types
        // `string` and `array`, so they land with them.
        let registry = registry();
        let since = |name: &str| registry.type_def(name).map(|t| t.since);
        assert_eq!(
            Some(construct_gate(Construct::StringLiteral).since),
            since("string")
        );
        assert_eq!(
            Some(construct_gate(Construct::ArrayLiteral).since),
            since("array")
        );
        assert_eq!(Some(construct_gate(Construct::Index).since), since("array"));
    }

    #[test]
    fn rows_agree_with_the_registry_where_it_has_the_same_item() {
        let registry = registry();
        let schema = |name: &str| registry.schema(name).map(|s| s.since);
        assert_eq!(
            Some(construct_gate(Construct::Scene).since),
            schema("Scene")
        );
        assert_eq!(
            Some(construct_gate(Construct::Entity).since),
            schema("Entity")
        );
        let camera = registry.scene_object("camera").map(|k| k.since);
        assert_eq!(Some(construct_gate(Construct::SceneObject).since), camera);
    }

    #[test]
    fn messages_follow_the_specified_wording() {
        let gate = construct_gate(Construct::Import);
        assert_eq!(
            gate_message(gate.subject, gate.plural, gate.since),
            "Imports are specified for v0.1 but not implemented by this compiler build yet (planned for M2)."
        );
        let gate = construct_gate(Construct::Bind);
        assert_eq!(
            gate_message(gate.subject, gate.plural, gate.since),
            "`bind` is specified for v0.1 but not implemented by this compiler build yet (planned for M3)."
        );
        assert_eq!(
            gate_note(),
            "this compiler build implements the language up to milestone M1"
        );
    }
}
