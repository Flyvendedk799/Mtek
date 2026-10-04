//! Schemas (`spec/stdlib.md` section 3) and scene-object kinds.

use super::build::{field, schema, writable_bindable};
use crate::diagnostics::Code;
use crate::stdlib::model::{
    ActiveObject, DeclarationSchemas, FieldFlags, FieldRule, Milestone, SceneObjectKind,
    SchemaCategory, SchemaDef, TypeRef,
};
use crate::stdlib::value::{Bound, ConstValue, Limit, ValueRange};

const C: FieldFlags = FieldFlags::CONSTRUCTION_ONLY;
const R_C: FieldFlags = FieldFlags::REQUIRED.union(FieldFlags::CONSTRUCTION_ONLY);

/// The schemas of scene and entity bodies.
pub(super) fn declaration_schemas() -> DeclarationSchemas {
    DeclarationSchemas {
        scene: "Scene",
        entity: "Entity",
    }
}

/// The scene-object kinds: scene members introduced by a contextual keyword.
pub(super) fn scene_objects() -> Vec<SceneObjectKind> {
    vec![SceneObjectKind {
        keyword: "camera",
        schema: "Camera",
        // `spec/scenes.md` section 3: exactly one active camera.
        active: Some(ActiveObject {
            field: "active",
            missing: Code::E5012,
            ambiguous: Code::E5013,
        }),
        since: Milestone::M1,
        doc: "Declares a camera: `camera Main { .. }`. A scene needs exactly one active camera.",
    }]
}

/// Every schema of the v0.1 registry.
pub(super) fn schemas() -> Vec<SchemaDef> {
    let mut all = Vec::new();
    all.extend(objects());
    all.extend(projections());
    all.extend(meshes());
    all.extend(materials());
    all.extend(lights());
    all.extend(bodies());
    all.extend(colliders());
    all
}

fn objects() -> Vec<SchemaDef> {
    let scene = schema(
        "Scene",
        SchemaCategory::Object,
        Milestone::M1,
        "The fields of a scene declaration. All are construction-only and must be constant expressions.",
        vec![
            field(
                "clear_color",
                TypeRef::Color,
                C,
                "Colour the canvas is cleared to. Only the RGB channels are used.",
            )
            .default(ConstValue::srgb(0x00, 0x00, 0x00)),
            field(
                "ambient_color",
                TypeRef::Color,
                C,
                "Colour of the ambient light term of lit materials. Only the RGB channels are used.",
            )
            .default(ConstValue::srgb(0xff, 0xff, 0xff))
            .since(Milestone::M4),
            field(
                "ambient_intensity",
                TypeRef::F32,
                C,
                "Scale of the ambient light term of lit materials; 0 turns ambient light off.",
            )
            .default(ConstValue::F32(0.0))
            .range(ValueRange::non_negative())
            .since(Milestone::M4),
            field(
                "gravity",
                TypeRef::Vec3,
                C,
                "Gravitational acceleration in metres per second squared. Used only when the scene has physics bodies.",
            )
            .default(ConstValue::Vec3([0.0, -9.81, 0.0]))
            .since(Milestone::M5),
        ],
    );

    let entity = schema(
        "Entity",
        SchemaCategory::Object,
        Milestone::M1,
        "The fields of an entity or prefab body: a named node with a transform and optional components.",
        vec![
            field(
                "position",
                TypeRef::Vec3,
                writable_bindable(),
                "Position local to the parent, in metres.",
            )
            .default(ConstValue::splat3(0.0)),
            field(
                "rotation",
                TypeRef::Quat,
                writable_bindable(),
                "Rotation local to the parent.",
            )
            .default(ConstValue::QuatIdentity),
            field(
                "scale",
                TypeRef::Vec3,
                writable_bindable(),
                "Scale local to the parent. Construction-only (and `vec3(1.0)` for dynamic and kinematic bodies) when the entity has a body; that rule belongs to the checker, not to this field.",
            )
            .default(ConstValue::splat3(1.0))
            .range(ValueRange::positive().and_finite())
            .range_code(Code::E5090),
            field(
                "visible",
                TypeRef::Bool,
                writable_bindable(),
                "Hides the mesh draw only; the entity's behaviour keeps running.",
            )
            .default(ConstValue::Bool(true)),
            field(
                "mesh",
                TypeRef::Mesh,
                C,
                "The mesh drawn for this entity: a mesh descriptor (`Box`, `Sphere`, `Plane`) or an asset mesh.",
            ),
            field(
                "material",
                TypeRef::Material,
                C,
                "The material instance used to draw the mesh. The instance is construction-only; its parameters are writable and bindable. Requires `mesh`.",
            )
            .default(ConstValue::EmptyDescriptor("Unlit"))
            .default_when_set("mesh"),
            field(
                "light",
                TypeRef::Descriptor(SchemaCategory::Light),
                C,
                "A light component (`DirectionalLight`, `PointLight`). Its fields are writable and bindable as their schemas say. Named entities only.",
            )
            .since(Milestone::M4),
            field(
                "body",
                TypeRef::Descriptor(SchemaCategory::Body),
                C,
                "A physics body (`Static`, `Dynamic`, `Kinematic`). Root entities only.",
            )
            .since(Milestone::M5),
            field(
                "collider",
                TypeRef::Descriptor(SchemaCategory::Collider),
                C,
                "A collision shape (`BoxCollider`, `SphereCollider`). Requires `body`.",
            )
            .since(Milestone::M5),
        ],
    )
    // `spec/scenes.md` section 4.1: a material without a mesh is `E5020`.
    .rule(FieldRule::Requires {
        field: "material",
        requires: "mesh",
        code: Code::E5020,
    });

    let camera = schema(
        "Camera",
        SchemaCategory::Object,
        Milestone::M1,
        "The fields of a `camera` scene object. Looks along its local -Z axis, or at `target` when one is declared.",
        vec![
            field(
                "position",
                TypeRef::Vec3,
                writable_bindable(),
                "Camera position in world space, in metres.",
            )
            .default(ConstValue::Vec3([0.0, 0.0, 5.0])),
            field(
                "target",
                TypeRef::Vec3,
                writable_bindable(),
                "Optional point to look at (up is +Y). When declared, `rotation` must not be.",
            ),
            field(
                "rotation",
                TypeRef::Quat,
                writable_bindable(),
                "Orientation when no `target` is declared.",
            )
            .default(ConstValue::QuatIdentity),
            field(
                "projection",
                TypeRef::Descriptor(SchemaCategory::Projection),
                C,
                "`Perspective {..}` or `Orthographic {..}`. The projection kind is construction-only; the fields of the descriptor are writable and bindable.",
            )
            .default(ConstValue::EmptyDescriptor("Perspective")),
            field(
                "active",
                TypeRef::Bool,
                C,
                "Marks the active camera. Optional when the scene has exactly one camera; with several cameras exactly one must declare `active: true`.",
            ),
        ],
    )
    // `spec/scenes.md` section 3: with a `target`, `rotation` must not be declared.
    .rule(FieldRule::ExcludedBy {
        field: "rotation",
        excluded_by: "target",
        code: Code::E5010,
    });

    vec![scene, entity, camera]
}

fn projections() -> Vec<SchemaDef> {
    let fov = ValueRange::bounded(
        Some(Bound::exclusive(Limit::Int(0))),
        Some(Bound::exclusive(Limit::Pi)),
    );
    // `spec/scenes.md` section 3: constant violations of the projection constraints are
    // `E5011`.
    let near = |doc| {
        field("near", TypeRef::F32, writable_bindable(), doc)
            .default(ConstValue::F32(0.1))
            .range(ValueRange::positive())
            .range_code(Code::E5011)
    };
    let far = |doc| {
        field("far", TypeRef::F32, writable_bindable(), doc)
            .default(ConstValue::F32(1000.0))
            .range(ValueRange::above_field("near"))
            .range_code(Code::E5011)
    };
    vec![
        schema(
            "Perspective",
            SchemaCategory::Projection,
            Milestone::M1,
            "A perspective projection (right-handed, clip depth 0 to 1).",
            vec![
                field(
                    "fov_y",
                    TypeRef::F32,
                    writable_bindable(),
                    "Full vertical field of view in radians.",
                )
                .default(ConstValue::F32(0.9))
                .range(fov)
                .range_code(Code::E5011),
                near("Distance to the near plane."),
                far("Distance to the far plane."),
            ],
        ),
        schema(
            "Orthographic",
            SchemaCategory::Projection,
            Milestone::M1,
            "An orthographic projection (right-handed, clip depth 0 to 1).",
            vec![
                field(
                    "height",
                    TypeRef::F32,
                    writable_bindable(),
                    "Height of the view volume in world units; the width follows from the aspect ratio.",
                )
                .default(ConstValue::F32(10.0))
                .range(ValueRange::positive())
                .range_code(Code::E5011),
                near("Distance to the near plane."),
                far("Distance to the far plane."),
            ],
        ),
    ]
}

fn meshes() -> Vec<SchemaDef> {
    vec![
        schema(
            "Box",
            SchemaCategory::Mesh,
            Milestone::M1,
            "An axis-aligned box centred on the origin.",
            vec![
                field("size", TypeRef::Vec3, C, "Full extents along X, Y and Z.")
                    .default(ConstValue::splat3(1.0))
                    .range(ValueRange::positive()),
            ],
        ),
        schema(
            "Sphere",
            SchemaCategory::Mesh,
            Milestone::M1,
            "A UV sphere centred on the origin.",
            vec![
                field("radius", TypeRef::F32, C, "Radius in metres.")
                    .default(ConstValue::F32(0.5))
                    .range(ValueRange::positive()),
                field(
                    "segments",
                    TypeRef::U32,
                    C,
                    "Subdivisions around the Y axis.",
                )
                .default(ConstValue::U32(32))
                .range(ValueRange::closed(3, 256)),
                field("rings", TypeRef::U32, C, "Subdivisions from pole to pole.")
                    .default(ConstValue::U32(16))
                    .range(ValueRange::closed(2, 256)),
            ],
        ),
        schema(
            "Plane",
            SchemaCategory::Mesh,
            Milestone::M1,
            "A single-sided horizontal plane at y = 0 facing +Y.",
            vec![
                field("size", TypeRef::Vec2, C, "Extent along X and Z.")
                    .default(ConstValue::splat2(1.0))
                    .range(ValueRange::positive()),
            ],
        ),
    ]
}

fn materials() -> Vec<SchemaDef> {
    vec![
        schema(
            "Unlit",
            SchemaCategory::Material,
            Milestone::M1,
            "Flat colour, no lighting. Defined in the embedded prelude source `std/materials.mtek`.",
            vec![
                field(
                    "color",
                    TypeRef::Color,
                    writable_bindable(),
                    "The colour written to the canvas.",
                )
                .default(ConstValue::srgb(0xff, 0xff, 0xff)),
            ],
        ),
        schema(
            "Pbr",
            SchemaCategory::Material,
            Milestone::M4,
            "The documented PBR subset (metallic-roughness, no image-based lighting). Defined in the embedded prelude source `std/materials.mtek`.",
            vec![
                field(
                    "base_color",
                    TypeRef::Color,
                    writable_bindable(),
                    "Linear base colour multiplied with the base colour texture.",
                )
                .default(ConstValue::srgb(0xff, 0xff, 0xff))
                .since(Milestone::M4),
                field(
                    "metallic",
                    TypeRef::F32,
                    writable_bindable(),
                    "Metalness; clamped to 0..1 by the lighting model.",
                )
                .default(ConstValue::F32(0.0))
                .since(Milestone::M4),
                field(
                    "roughness",
                    TypeRef::F32,
                    writable_bindable(),
                    "Perceptual roughness; clamped to 0.045..1 by the lighting model.",
                )
                .default(ConstValue::F32(0.5))
                .since(Milestone::M4),
                field(
                    "base_color_texture",
                    TypeRef::Texture,
                    C,
                    "Base colour texture.",
                )
                .default(ConstValue::Texture(
                    crate::stdlib::value::BuiltinTexture::White,
                ))
                .since(Milestone::M4),
                field(
                    "base_color_sampler",
                    TypeRef::Sampler,
                    C,
                    "Sampler for the base colour texture.",
                )
                .default(ConstValue::Sampler(
                    crate::stdlib::value::BuiltinSampler::LinearRepeat,
                ))
                .since(Milestone::M4),
            ],
        ),
    ]
}

fn lights() -> Vec<SchemaDef> {
    let color = || {
        field(
            "color",
            TypeRef::Color,
            writable_bindable(),
            "Light colour (linear RGB; alpha is ignored).",
        )
        .default(ConstValue::srgb(0xff, 0xff, 0xff))
        .since(Milestone::M4)
    };
    vec![
        schema(
            "DirectionalLight",
            SchemaCategory::Light,
            Milestone::M4,
            "A light infinitely far away. Travels along the entity's world -Z axis; rotate the entity to aim it.",
            vec![
                color(),
                field(
                    "intensity",
                    TypeRef::F32,
                    writable_bindable(),
                    "Illuminance in lux.",
                )
                .default(ConstValue::F32(1.0))
                .since(Milestone::M4),
            ],
        ),
        schema(
            "PointLight",
            SchemaCategory::Light,
            Milestone::M4,
            "A light radiating from the entity's world position.",
            vec![
                color(),
                field(
                    "intensity",
                    TypeRef::F32,
                    writable_bindable(),
                    "Luminous intensity in candela.",
                )
                .default(ConstValue::F32(1.0))
                .since(Milestone::M4),
                field(
                    "range",
                    TypeRef::F32,
                    C,
                    "Distance at which the light fades to nothing; 0 means unlimited.",
                )
                .default(ConstValue::F32(0.0))
                .range(ValueRange::non_negative())
                .since(Milestone::M4),
            ],
        ),
    ]
}

fn bodies() -> Vec<SchemaDef> {
    vec![
        schema(
            "Static",
            SchemaCategory::Body,
            Milestone::M5,
            "An immovable body; its pose is fixed at creation from the entity transform.",
            vec![],
        ),
        schema(
            "Kinematic",
            SchemaCategory::Body,
            Milestone::M5,
            "A body whose pose the program sets with `set_kinematic_target`.",
            vec![],
        ),
        schema(
            "Dynamic",
            SchemaCategory::Body,
            Milestone::M5,
            "A solver-controlled body; forces, impulses and teleports are explicit commands.",
            vec![
                field("mass", TypeRef::F32, C, "Mass in kilograms.")
                    .default(ConstValue::F32(1.0))
                    .range(ValueRange::positive().and_finite())
                    .since(Milestone::M5),
                field(
                    "linear_damping",
                    TypeRef::F32,
                    C,
                    "Rate at which linear velocity decays.",
                )
                .default(ConstValue::F32(0.0))
                .range(ValueRange::non_negative())
                .since(Milestone::M5),
                field(
                    "angular_damping",
                    TypeRef::F32,
                    C,
                    "Rate at which angular velocity decays.",
                )
                .default(ConstValue::F32(0.05))
                .range(ValueRange::non_negative())
                .since(Milestone::M5),
            ],
        ),
    ]
}

fn colliders() -> Vec<SchemaDef> {
    let sensor = || {
        field(
            "sensor",
            TypeRef::Bool,
            C,
            "A sensor reports collisions but does not push other bodies.",
        )
        .default(ConstValue::Bool(false))
        .since(Milestone::M5)
    };
    let friction = || {
        field("friction", TypeRef::F32, C, "Coulomb friction coefficient.")
            .default(ConstValue::F32(0.5))
            .range(ValueRange::non_negative())
            .since(Milestone::M5)
    };
    let restitution = || {
        field(
            "restitution",
            TypeRef::F32,
            C,
            "Bounciness, 0 (none) to 1 (perfect).",
        )
        .default(ConstValue::F32(0.0))
        .range(ValueRange::closed(0, 1))
        .since(Milestone::M5)
    };
    vec![
        schema(
            "BoxCollider",
            SchemaCategory::Collider,
            Milestone::M5,
            "A box collision shape.",
            vec![
                field("size", TypeRef::Vec3, R_C, "Full extents along X, Y and Z.")
                    .range(ValueRange::positive())
                    .since(Milestone::M5),
                sensor(),
                friction(),
                restitution(),
            ],
        ),
        schema(
            "SphereCollider",
            SchemaCategory::Collider,
            Milestone::M5,
            "A sphere collision shape.",
            vec![
                field("radius", TypeRef::F32, R_C, "Radius in metres.")
                    .range(ValueRange::positive())
                    .since(Milestone::M5),
                sensor(),
                friction(),
                restitution(),
            ],
        ),
    ]
}
