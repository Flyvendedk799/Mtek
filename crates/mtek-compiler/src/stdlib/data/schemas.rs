//! Schemas (`spec/stdlib.md` section 3) and scene-object kinds.

use super::build::{field, schema, writable_bindable};
use crate::diagnostics::Code;
use crate::stdlib::model::{
    ActiveObject, DeclarationSchemas, FieldFlags, FieldRule, Milestone, SceneObjectKind,
    SchemaCategory, SchemaDef, TypeRef,
};
use crate::stdlib::value::{Bound, ConstValue, Limit, ValueRange};

const C: FieldFlags = FieldFlags::CONSTRUCTION_ONLY;
/// The default `Camera.exposure`, `-log2(1.2 * pi)` (decision 0081): the exposure scale
/// `1 / (1.2 * 2^EV100)` is then pi, so a white Lambertian surface under 1 lux is 1.0.
pub(crate) const CAMERA_DEFAULT_EV100: f32 = -1.914_530_5;
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
            .default(ConstValue::srgb(0xff, 0xff, 0xff)),
            field(
                "ambient_intensity",
                TypeRef::F32,
                C,
                "Scale of the ambient light term of lit materials; 0 turns ambient light off. Like every lit result it is multiplied by the camera's exposure scale (about 3.14 at the default exposure), so 0.3 already gives nearly full brightness on white. Unlit materials ignore it.",
            )
            .default(ConstValue::F32(0.0))
            .range(ValueRange::non_negative()),
            field(
                "gravity",
                TypeRef::Vec3,
                C,
                "Gravitational acceleration in metres per second squared. Used only when the scene has physics bodies.",
            )
            .default(ConstValue::Vec3([0.0, -9.81, 0.0]))
            .range(ValueRange::finite()),
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
                "Scale local to the parent. Construction-only (and `vec3(1.0)` for dynamic and kinematic bodies) when the entity has a body.",
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
            ),
            field(
                "body",
                TypeRef::Descriptor(SchemaCategory::Body),
                C,
                "A physics body (`Static`, `Dynamic`, `Kinematic`). Root entities only; requires `collider`.",
            ),
            field(
                "collider",
                TypeRef::Descriptor(SchemaCategory::Collider),
                C,
                "A collision shape (`BoxCollider`, `SphereCollider`). Requires `body`.",
            ),
            field(
                "tag",
                TypeRef::String,
                C,
                "A group name (`\"rock\"`) that `count_tagged`, `first_tagged`, `nearest_tagged`, `tagged`, `has_tag` and `destroy_tagged` look the entity up by (decision 0150). A string literal of lowercase letters, digits and `_`.",
            ),
        ],
    )
    // `spec/scenes.md` section 4.1: a material without a mesh is `E5020`.
    .rule(FieldRule::Requires {
        field: "material",
        requires: "mesh",
        code: Code::E5020,
        help: None,
    })
    // `spec/physics.md` section 2: a collider needs a body (`E5120`) and a body needs a collider
    // (`E5121`; decision 0065).
    .rule(FieldRule::Requires {
        field: "collider",
        requires: "body",
        code: Code::E5120,
        help: Some("add `body: Static {}` for fixed geometry, or `Dynamic` or `Kinematic` for a moving body"),
    })
    .rule(FieldRule::Requires {
        field: "body",
        requires: "collider",
        code: Code::E5121,
        help: Some("add a `collider: BoxCollider { size: ... }` or `SphereCollider { radius: ... }` that gives the body its shape"),
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
            field(
                "exposure",
                TypeRef::F32,
                C,
                "Exposure value EV100; lit materials are scaled by 1 / (1.2 * 2^exposure). The default, -log2(1.2 * pi), shows a white Lambertian surface under a 1 lux light as white; a sunny day (about 100 000 lux) is about 15.",
            )
            .default(ConstValue::F32(CAMERA_DEFAULT_EV100)),
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
            "Flat colour, no lighting.",
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
            Milestone::M1,
            "The documented PBR subset (metallic-roughness, no image-based lighting).",
            vec![
                field(
                    "base_color",
                    TypeRef::Color,
                    writable_bindable(),
                    "Linear base colour multiplied with the base colour texture.",
                )
                .default(ConstValue::srgb(0xff, 0xff, 0xff)),
                field(
                    "metallic",
                    TypeRef::F32,
                    writable_bindable(),
                    "Metalness; clamped to 0..1 by the lighting model.",
                )
                .default(ConstValue::F32(0.0)),
                field(
                    "roughness",
                    TypeRef::F32,
                    writable_bindable(),
                    "Perceptual roughness; clamped to 0.045..1 by the lighting model.",
                )
                .default(ConstValue::F32(0.5)),
                field(
                    "base_color_texture",
                    TypeRef::Texture,
                    C,
                    "Base colour texture.",
                )
                .default(ConstValue::Texture(
                    crate::stdlib::value::BuiltinTexture::White,
                )),
                field(
                    "base_color_sampler",
                    TypeRef::Sampler,
                    C,
                    "Sampler for the base colour texture.",
                )
                .default(ConstValue::Sampler(
                    crate::stdlib::value::BuiltinSampler::LinearRepeat,
                )),
            ],
        ),
        // Decision 0170: sprites, always drawn in the translucent pass (decision 0138).
        schema(
            "Sprite",
            SchemaCategory::Material,
            Milestone::M1,
            "One frame of a sprite sheet, tinted; always translucent.",
            vec![
                field("sheet", TypeRef::Texture, C, "The sprite sheet: `columns` x `rows` equal cells.")
                    .default(ConstValue::Texture(crate::stdlib::value::BuiltinTexture::White)),
                field("sheet_sampler", TypeRef::Sampler, C, "Sampler of the sheet (default nearest, clamped: crisp pixels).")
                    .default(ConstValue::Sampler(crate::stdlib::value::BuiltinSampler::NearestClamp)),
                field("tint", TypeRef::Color, writable_bindable(), "Multiplies the texel, alpha included.")
                    .default(ConstValue::srgb(0xff, 0xff, 0xff)),
                field("cell", TypeRef::F32, writable_bindable(), "The cell (animation frame) shown, from 0, left to right then top to bottom; floored and wrapped, so `bind(t * fps)` animates.")
                    .default(ConstValue::F32(0.0)),
                field("columns", TypeRef::F32, writable_bindable(), "Cells per row of the sheet.")
                    .default(ConstValue::F32(1.0))
                    .range(ValueRange::closed(1, 64))
                    .range_code(Code::E5701),
                field("rows", TypeRef::F32, writable_bindable(), "Rows of cells in the sheet.")
                    .default(ConstValue::F32(1.0))
                    .range(ValueRange::closed(1, 64))
                    .range_code(Code::E5701),
            ],
        ),
    ]
}

/// The light schemas. M4-02 implements them ahead of the M4 gate, so they are marked as
/// implemented by the current build (decision 0053), like the M2 and M3 items before them.
fn lights() -> Vec<SchemaDef> {
    let color = || {
        field(
            "color",
            TypeRef::Color,
            writable_bindable(),
            "Light colour (linear RGB; alpha is ignored).",
        )
        .default(ConstValue::srgb(0xff, 0xff, 0xff))
    };
    vec![
        schema(
            "DirectionalLight",
            SchemaCategory::Light,
            Milestone::M1,
            "A light infinitely far away. Travels along the entity's world -Z axis; rotate the entity to aim it.",
            vec![
                color(),
                field(
                    "intensity",
                    TypeRef::F32,
                    writable_bindable(),
                    "Illuminance in lux.",
                )
                .default(ConstValue::F32(1.0)),
            ],
        ),
        schema(
            "PointLight",
            SchemaCategory::Light,
            Milestone::M1,
            "A light radiating from the entity's world position.",
            vec![
                color(),
                field(
                    "intensity",
                    TypeRef::F32,
                    writable_bindable(),
                    "Luminous intensity in candela.",
                )
                .default(ConstValue::F32(1.0)),
                field(
                    "range",
                    TypeRef::F32,
                    C,
                    "Distance at which the light fades to nothing; 0 means unlimited.",
                )
                .default(ConstValue::F32(0.0))
                .range(ValueRange::non_negative()),
            ],
        ),
    ]
}

fn bodies() -> Vec<SchemaDef> {
    vec![
        schema(
            "Static",
            SchemaCategory::Body,
            Milestone::M1,
            "An immovable body; its pose is fixed at creation from the entity transform.",
            vec![],
        ),
        schema(
            "Kinematic",
            SchemaCategory::Body,
            Milestone::M1,
            "A body whose pose the program sets with `set_kinematic_target`.",
            vec![],
        ),
        schema(
            "Dynamic",
            SchemaCategory::Body,
            Milestone::M1,
            "A solver-controlled body; forces, impulses and teleports are explicit commands.",
            vec![
                field("mass", TypeRef::F32, C, "Mass in kilograms.")
                    .default(ConstValue::F32(1.0))
                    .range(ValueRange::positive().and_finite()),
                field(
                    "linear_damping",
                    TypeRef::F32,
                    C,
                    "Rate at which linear velocity decays.",
                )
                .default(ConstValue::F32(0.0))
                .range(ValueRange::non_negative().and_finite()),
                field(
                    "angular_damping",
                    TypeRef::F32,
                    C,
                    "Rate at which angular velocity decays.",
                )
                .default(ConstValue::F32(0.05))
                .range(ValueRange::non_negative().and_finite()),
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
    };
    let friction = || {
        field("friction", TypeRef::F32, C, "Coulomb friction coefficient.")
            .default(ConstValue::F32(0.5))
            .range(ValueRange::non_negative().and_finite())
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
    };
    vec![
        schema(
            "BoxCollider",
            SchemaCategory::Collider,
            Milestone::M1,
            "A box collision shape.",
            vec![
                field("size", TypeRef::Vec3, R_C, "Full extents along X, Y and Z.")
                    .range(ValueRange::positive().and_finite()),
                sensor(),
                friction(),
                restitution(),
            ],
        ),
        schema(
            "SphereCollider",
            SchemaCategory::Collider,
            Milestone::M1,
            "A sphere collision shape.",
            vec![
                field("radius", TypeRef::F32, R_C, "Radius in metres.")
                    .range(ValueRange::positive().and_finite()),
                sensor(),
                friction(),
                restitution(),
            ],
        ),
    ]
}
