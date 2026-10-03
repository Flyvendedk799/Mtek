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
            since: Milestone::M5,
            doc: "Instantaneous change of momentum in newton-seconds, at the centre of mass, applied at the start of the next tick.",
        },
        BodyCommandDef {
            name: "apply_force",
            params: vec![p("force", vec3)],
            applies_to: DYNAMIC,
            since: Milestone::M5,
            doc: "A force in newtons applied for exactly the next tick, then cleared.",
        },
        BodyCommandDef {
            name: "set_kinematic_target",
            params: vec![p("position", vec3), p("rotation", quat)],
            applies_to: KINEMATIC,
            since: Milestone::M5,
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
            since: Milestone::M5,
            doc: "Sets the pose before the next tick; velocities are zeroed unless `keep_velocity` is true.",
        },
        BodyCommandDef {
            name: "set_linear_velocity",
            params: vec![p("v", vec3)],
            applies_to: DYNAMIC,
            since: Milestone::M5,
            doc: "Sets the linear velocity at the start of the next tick.",
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
            since: Milestone::M5,
            doc: "Linear velocity as of the last completed tick. Read-only.",
        },
        BodyPropertyDef {
            name: "angular_velocity",
            ty: TypeRef::Vec3,
            applies_to: MOVING,
            since: Milestone::M5,
            doc: "Angular velocity as of the last completed tick. Read-only.",
        },
    ]
}
