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
use crate::syntax::ast::{BinaryOp, UnaryOp};

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
    /// Unary `-` (operators: decision 0026).
    Negation,
    /// Binary `+`, `-`, `*`, `/`.
    Arithmetic,
    /// Binary `%`.
    Remainder,
    /// `<`, `<=`, `>`, `>=`.
    Comparison,
    /// `==`, `!=`.
    Equality,
    /// `!`, `&&`, `||`.
    Logical,
}

impl Construct {
    /// Every construct, in declaration order.
    pub const ALL: [Construct; 30] = [
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
        Construct::Negation,
        Construct::Arithmetic,
        Construct::Remainder,
        Construct::Comparison,
        Construct::Equality,
        Construct::Logical,
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
/// constants (task M1-09), and unary minus and the arithmetic operators (task
/// M1-10); the milestones of the rest follow the work plan (decisions 0025 and
/// 0026).
#[must_use]
pub const fn construct_gate(construct: Construct) -> ConstructGate {
    use Milestone::{M1, M2, M3, M5};
    match construct {
        // Modules (task M2-03, decision 0036) are implemented ahead of the M2
        // gate; this build still reports milestone M1, so the rows say M1.
        Construct::Import => row("Imports", true, M1),
        Construct::Export => row("`export`", false, M1),
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
        // Operators (decision 0026): M1 types and folds unary minus and the
        // four arithmetic operators. The others are M2 work (M2-01) that
        // landed before the M2 gate: `M1` marks them implemented by this
        // build (decision 0035).
        Construct::Negation => row("Unary minus", false, M1),
        Construct::Arithmetic => row("Arithmetic operators", true, M1),
        Construct::Remainder => row("The remainder operator `%`", false, M1),
        Construct::Comparison => row("Comparison operators (`<`, `<=`, `>`, `>=`)", true, M1),
        Construct::Equality => row("Equality operators (`==`, `!=`)", true, M1),
        Construct::Logical => row("Logical operators (`!`, `&&`, `||`)", true, M1),
    }
}

/// The construct a unary operator belongs to.
#[must_use]
pub const fn unary_construct(op: UnaryOp) -> Construct {
    match op {
        UnaryOp::Neg => Construct::Negation,
        UnaryOp::Not => Construct::Logical,
    }
}

/// The construct a binary operator belongs to.
#[must_use]
pub const fn binary_construct(op: BinaryOp) -> Construct {
    match op {
        BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul | BinaryOp::Div => Construct::Arithmetic,
        BinaryOp::Rem => Construct::Remainder,
        BinaryOp::Lt | BinaryOp::Le | BinaryOp::Gt | BinaryOp::Ge => Construct::Comparison,
        BinaryOp::Eq | BinaryOp::Ne => Construct::Equality,
        BinaryOp::And | BinaryOp::Or => Construct::Logical,
    }
}

/// Whether this build implements `construct`. The type checker asks the
/// same table, so it never types what the resolver reported as `E9010`.
#[must_use]
pub const fn construct_implemented(construct: Construct) -> bool {
    is_implemented(construct_gate(construct).since)
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
    fn this_build_implements_scenes_entities_descriptors_constants_and_operators() {
        for construct in [
            Construct::ConstItem,
            Construct::BodyConst,
            Construct::Scene,
            Construct::SceneField,
            Construct::SceneObject,
            Construct::Entity,
            Construct::EntityField,
            Construct::Descriptor,
            Construct::Negation,
            Construct::Arithmetic,
            Construct::Import,
            Construct::Export,
            Construct::Remainder,
            Construct::Comparison,
            Construct::Equality,
            Construct::Logical,
        ] {
            assert!(
                is_implemented(construct_gate(construct).since),
                "{construct:?}"
            );
        }
        for construct in [
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
    fn every_operator_belongs_to_one_construct() {
        use BinaryOp::*;
        for op in [Add, Sub, Mul, Div] {
            assert_eq!(binary_construct(op), Construct::Arithmetic);
        }
        assert_eq!(binary_construct(Rem), Construct::Remainder);
        for op in [Lt, Le, Gt, Ge] {
            assert_eq!(binary_construct(op), Construct::Comparison);
        }
        for op in [Eq, Ne] {
            assert_eq!(binary_construct(op), Construct::Equality);
        }
        for op in [And, Or] {
            assert_eq!(binary_construct(op), Construct::Logical);
        }
        assert_eq!(unary_construct(UnaryOp::Neg), Construct::Negation);
        assert_eq!(unary_construct(UnaryOp::Not), Construct::Logical);
        assert!(construct_implemented(Construct::Arithmetic));
        assert!(construct_implemented(Construct::Logical));
        assert!(!construct_implemented(Construct::Fn));
    }

    #[test]
    fn messages_follow_the_specified_wording() {
        let gate = construct_gate(Construct::Fn);
        assert_eq!(
            gate_message(gate.subject, gate.plural, gate.since),
            "`fn` declarations are specified for v0.1 but not implemented by this compiler build yet (planned for M2)."
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
