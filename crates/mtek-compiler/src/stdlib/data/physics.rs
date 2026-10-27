//! Body commands and readable body properties (`spec/physics.md` section 3).

use super::build::p;
use crate::stdlib::model::{
    BodyCommandDef, BodyKind, BodyPropertyDef, Milestone, SigType, TypeRef,
};

const DYNAMIC: &[BodyKind] = &[BodyKind::Dynamic];
const KINEMATIC: &[BodyKind] = &[BodyKind::Kinematic];
const MOVING: &[BodyKind] = &[BodyKind::Dynamic, BodyKind::Kinematic];

/// The body commands, written `Name.body.<command>(..)`.
pub(super) fn body_commands() -> Vec<BodyCommandDef> {
    let vec3 = SigType::Exact(TypeRef::Vec3);
    let quat = SigType::Exact(TypeRef::Quat);
    vec![
        BodyCommandDef {
            name: "apply_impulse",
            params: vec![p("impulse", vec3)],
            applies_to: DYNAMIC,
            since: Milestone::M1,
            doc: "Instantaneous change of momentum in newton-seconds, at the centre of mass, applied at the start of the next tick.",
        },
        BodyCommandDef {
            name: "apply_force",
            params: vec![p("force", vec3)],
            applies_to: DYNAMIC,
            since: Milestone::M1,
            doc: "A force in newtons applied for exactly the next tick, then cleared.",
        },
        BodyCommandDef {
            name: "set_kinematic_target",
            params: vec![p("position", vec3), p("rotation", quat)],
            applies_to: KINEMATIC,
            since: Milestone::M1,
            doc: "The pose reached at the end of the next tick; the solver derives the velocity.",
        },
        BodyCommandDef {
            name: "teleport",
            params: vec![
                p("position", vec3),
                p("rotation", quat),
                p("keep_velocity", SigType::Exact(TypeRef::Bool)),
            ],
            applies_to: MOVING,
            since: Milestone::M1,
            doc: "Sets the pose before the next tick; velocities are zeroed unless `keep_velocity` is true.",
        },
        BodyCommandDef {
            name: "set_linear_velocity",
            params: vec![p("v", vec3)],
            applies_to: DYNAMIC,
            since: Milestone::M1,
            doc: "Sets the linear velocity at the start of the next tick.",
        },
        BodyCommandDef {
            name: "move_character",
            params: vec![p("displacement", vec3), p("rotation", quat)],
            applies_to: KINEMATIC,
            since: Milestone::M1,
            doc: "Moves the body by `displacement` metres for this tick, sliding along what it meets, stepping up stairs, staying on slopes and ground and riding a moving kinematic platform, then turns it to `rotation`. Gravity is not applied; add your own vertical motion. Several calls in one tick sum their displacements and the last rotation wins; the move replaces `set_kinematic_target` of the same tick (decisions 0214, 0217).",
        },
    ]
}

/// The readable body properties, `Name.body.<property>`.
pub(super) fn body_properties() -> Vec<BodyPropertyDef> {
    vec![
        BodyPropertyDef {
            name: "linear_velocity",
            ty: TypeRef::Vec3,
            applies_to: MOVING,
            since: Milestone::M1,
            doc: "Linear velocity as of the last completed tick. Read-only.",
        },
        BodyPropertyDef {
            name: "angular_velocity",
            ty: TypeRef::Vec3,
            applies_to: MOVING,
            since: Milestone::M1,
            doc: "Angular velocity as of the last completed tick. Read-only.",
        },
        BodyPropertyDef {
            name: "grounded",
            ty: TypeRef::Bool,
            applies_to: KINEMATIC,
            since: Milestone::M1,
            doc: "Ground found by the last completed `move_character`. Read-only.",
        },
        BodyPropertyDef {
            name: "ground_normal",
            ty: TypeRef::Vec3,
            applies_to: KINEMATIC,
            since: Milestone::M1,
            doc: "Ground normal of the last `move_character`; zero in the air. Read-only.",
        },
    ]
}
