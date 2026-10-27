//! Schemas (`spec/stdlib.md` section 3) and scene-object kinds.

use super::build::{field, schema, writable_bindable};
use crate::diagnostics::Code;
use crate::stdlib::model::{
    ActiveObject, DeclarationSchemas, FieldFlags, FieldRule, Milestone, SceneObjectKind,
    SchemaCategory, SchemaDef, TypeRef,
};
use crate::stdlib::value::{Bound, ConstValue, Limit, ValueRange};

const C: FieldFlags = FieldFlags::CONSTRUCTION_ONLY;
/// Construction-only, and absent from a completed descriptor unless the program wrote it.
const CU: FieldFlags = FieldFlags::CONSTRUCTION_ONLY.union(FieldFlags::UNSET_WHEN_OMITTED);
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
    all.extend(emitters());
    all
}

/// `Emitter { .. }` (decision 0155): a construction-only descriptor, not a spawned entity.
fn emitters() -> Vec<SchemaDef> {
    vec![schema(
        "Emitter",
        SchemaCategory::Emitter,
        Milestone::M1,
        "Bounded particle emitter: at most 64 particles, `rate` per second, in a hemisphere around the entity's up axis.",
        vec![
            field(
                "rate",
                TypeRef::F32,
                C,
                "Particles per second; a fraction carries to the next frame.",
            )
            .default(ConstValue::F32(0.0))
            .range(ValueRange::non_negative()),
            field("lifetime", TypeRef::F32, C, "Particle lifetime in seconds.")
                .default(ConstValue::F32(1.0))
                .range(ValueRange::positive().and_finite()),
            field("speed", TypeRef::F32, C, "Initial speed in m/s.")
                .default(ConstValue::F32(1.0))
                .range(ValueRange::non_negative()),
            field("size", TypeRef::F32, C, "Billboard size in metres.")
                .default(ConstValue::F32(0.05))
                .range(ValueRange::positive().and_finite()),
            field(
                "gravity",
                TypeRef::F32,
                C,
                "Downward acceleration in m/s^2.",
            )
            .default(ConstValue::F32(0.0))
            .range(ValueRange::finite()),
        ],
    )]
}

fn objects() -> Vec<SchemaDef> {
    let scene = schema(
        "Scene",
        SchemaCategory::Object,
        Milestone::M1,
        "The fields of a scene: all construction-only constant expressions.",
        vec![
            field(
                "clear_color",
                TypeRef::Color,
                C,
                "Canvas clear colour; only RGB is used.",
            )
            .default(ConstValue::srgb(0x00, 0x00, 0x00)),
            field(
                "ambient_color",
                TypeRef::Color,
                C,
                "Ambient light colour; only RGB is used.",
            )
            .default(ConstValue::srgb(0xff, 0xff, 0xff)),
            field(
                "ambient_intensity",
                TypeRef::F32,
                C,
                "Ambient light scale for lit materials; 0 is off. Times the exposure scale (about 3.14): 0.3 is near full brightness on white. Unlit ignores it.",
            )
            .default(ConstValue::F32(0.0))
            .range(ValueRange::non_negative()),
            field(
                "gravity",
                TypeRef::Vec3,
                C,
                "Gravitational acceleration in m/s^2; used only with physics bodies.",
            )
            .default(ConstValue::Vec3([0.0, -9.81, 0.0]))
            .range(ValueRange::finite()),
        ],
    );

    let entity = schema(
        "Entity",
        SchemaCategory::Object,
        Milestone::M1,
        "Entity/prefab: a named transform with optional components.",
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
                "Parent-local scale; construction-only on bodies, `vec3(1.0)` on dynamic and kinematic ones.",
            )
            .default(ConstValue::splat3(1.0))
            .range(ValueRange::positive().and_finite())
            .range_code(Code::E5090),
            field(
                "visible",
                TypeRef::Bool,
                writable_bindable(),
                "Hide the mesh; behavior keeps running.",
            )
            .default(ConstValue::Bool(true)),
            field(
                "bounds_center", TypeRef::Vec3, writable_bindable(),
                "Final deformed local sphere center; used when bounds_radius > 0.",
            ).default(ConstValue::splat3(0.0)).range(ValueRange::finite()),
            field(
                "bounds_radius", TypeRef::F32, writable_bindable(),
                "Enclose every final local vertex/pose; 0 uses mesh/skin bounds, or unbounded authored vertices.",
            ).default(ConstValue::F32(0.0)).range(ValueRange::non_negative().and_finite()),
            field(
                "mesh",
                TypeRef::Mesh,
                C,
                "The mesh: `Box`, `Sphere`, `Plane` or an asset mesh.",
            ),
            field(
                "material",
                TypeRef::Material,
                FieldFlags::WRITABLE,
                "Material instance; a value-only one can be replaced by the same type; params are writable and bindable. Needs `mesh`.",
            )
            .default(ConstValue::EmptyDescriptor("Unlit"))
            .default_when_set("mesh"),
            field(
                "light",
                TypeRef::Descriptor(SchemaCategory::Light),
                C,
                "A light (`DirectionalLight`, `PointLight`); fields writable and bindable. Named entities only.",
            ),
            field(
                "body",
                TypeRef::Descriptor(SchemaCategory::Body),
                C,
                "A physics body (`Static`, `Dynamic`, `Kinematic`). Root entities only; needs `collider`.",
            ),
            field(
                "collider",
                TypeRef::Descriptor(SchemaCategory::Collider),
                C,
                "A collision shape (`BoxCollider`, `SphereCollider`, `CapsuleCollider`). Requires `body`.",
            ),
            field(
                "tag",
                TypeRef::String,
                C,
                "Group name (lowercase letters, digits, `_`) for `count_tagged`, `first_tagged`, `nearest_tagged`, `tagged`, `has_tag`, `destroy_tagged`.",
            ),
            field(
                "particles",
                TypeRef::Descriptor(SchemaCategory::Emitter),
                C,
                "Particle emitter: up to 64 camera-facing billboards of the entity's mesh in its material's colour",
            ),
            field(
                "clip",
                TypeRef::String,
                C,
                "A glTF animation name that moves this entity; the mesh must come from that file.",
            ),
            field(
                "clips_from",
                TypeRef::GlbAsset,
                C,
                "GLB whose humanoid clips play on this skeletal mesh; `clip` names its clips.",
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
        help: Some("add a `collider: BoxCollider { size: ... }`, `SphereCollider { radius: ... }` or `CapsuleCollider { radius: ...; height: ... }` that gives the body its shape"),
    });

    let camera = schema(
        "Camera",
        SchemaCategory::Object,
        Milestone::M1,
        "The fields of a `camera`. Looks along local -Z, or at `target` when declared.",
        vec![
            field(
                "position",
                TypeRef::Vec3,
                writable_bindable(),
                "World position in metres.",
            )
            .default(ConstValue::Vec3([0.0, 0.0, 5.0])),
            field(
                "target",
                TypeRef::Vec3,
                writable_bindable(),
                "Optional point to look at (up is +Y); excludes `rotation`.",
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
                "`Perspective {..}` or `Orthographic {..}`; the kind is construction-only, its fields writable and bindable.",
            )
            .default(ConstValue::EmptyDescriptor("Perspective")),
            field(
                "active",
                TypeRef::Bool,
                C,
                "Marks the active camera: optional with one, exactly one `active: true` with several.",
            ),
            field(
                "exposure",
                TypeRef::F32,
                C,
                "EV100; lit materials scale by 1 / (1.2 * 2^exposure). By default white under 1 lux shows white.",
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
                near("Near plane."),
                far("Far plane."),
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
                    "View volume height in world units; width follows the aspect ratio.",
                )
                .default(ConstValue::F32(10.0))
                .range(ValueRange::positive())
                .range_code(Code::E5011),
                near("Near plane."),
                far("Far plane."),
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
            "Axis-aligned box centred on the origin.",
            vec![
                field("size", TypeRef::Vec3, C, "Full extents.")
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
            "Single-sided plane at y = 0 facing +Y.",
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
                    "Colour.",
                )
                .default(ConstValue::srgb(0xff, 0xff, 0xff)),
            ],
        ),
        schema(
            "Pbr",
            SchemaCategory::Material,
            Milestone::M1,
            "Metallic-roughness PBR; optional scene shadows and environment lighting.",
            vec![
                field(
                    "base_color",
                    TypeRef::Color,
                    writable_bindable(),
                    "Linear base colour, multiplied with the texture.",
                )
                .default(ConstValue::srgb(0xff, 0xff, 0xff)),
                field(
                    "metallic",
                    TypeRef::F32,
                    writable_bindable(),
                    "Metalness, clamped to 0..1.",
                )
                .default(ConstValue::F32(0.0)),
                field(
                    "roughness",
                    TypeRef::F32,
                    writable_bindable(),
                    "Perceptual roughness, clamped to 0.045..1.",
                )
                .default(ConstValue::F32(0.5)),
                field(
                    "base_color_texture",
                    TypeRef::Texture,
                    C,
                    "Texture.",
                )
                .default(ConstValue::Texture(
                    crate::stdlib::value::BuiltinTexture::White,
                )),
                field(
                    "base_color_sampler",
                    TypeRef::Sampler,
                    C,
                    "Sampler.",
                )
                .default(ConstValue::Sampler(
                    crate::stdlib::value::BuiltinSampler::LinearRepeat,
                )),
                field("metallic_roughness_texture", TypeRef::Texture, C, "Linear green roughness and blue metallic factors.")
                    .default(ConstValue::Texture(crate::stdlib::value::BuiltinTexture::White)),
                field("metallic_roughness_sampler", TypeRef::Sampler, C, "Sampler.")
                    .default(ConstValue::Sampler(crate::stdlib::value::BuiltinSampler::LinearRepeat)),
                field("normal_texture", TypeRef::Texture, C, "Linear tangent-space normal map; enable with normal_scale.")
                    .default(ConstValue::Texture(crate::stdlib::value::BuiltinTexture::White)),
                field("normal_sampler", TypeRef::Sampler, C, "Sampler.")
                    .default(ConstValue::Sampler(crate::stdlib::value::BuiltinSampler::LinearRepeat)),
                field("occlusion_texture", TypeRef::Texture, C, "Linear red indirect-light occlusion.")
                    .default(ConstValue::Texture(crate::stdlib::value::BuiltinTexture::White)),
                field("occlusion_sampler", TypeRef::Sampler, C, "Sampler.")
                    .default(ConstValue::Sampler(crate::stdlib::value::BuiltinSampler::LinearRepeat)),
                field("emissive_texture", TypeRef::Texture, C, "sRGB emissive colour, multiplied by emissive.")
                    .default(ConstValue::Texture(crate::stdlib::value::BuiltinTexture::White)),
                field("emissive_sampler", TypeRef::Sampler, C, "Sampler.")
                    .default(ConstValue::Sampler(crate::stdlib::value::BuiltinSampler::LinearRepeat)),
                field("normal_scale", TypeRef::F32, writable_bindable(), "Normal XY scale; zero suits the white fallback. GLB map default: one.")
                    .default(ConstValue::F32(0.0)),
                field("occlusion_strength", TypeRef::F32, writable_bindable(), "Occlusion strength, clamped to 0..1.")
                    .default(ConstValue::F32(1.0)),
                field("emissive", TypeRef::Color, writable_bindable(), "Linear emission before exposure.")
                    .default(ConstValue::srgb(0, 0, 0)),
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
                field("sheet_sampler", TypeRef::Sampler, C, "Sampler.")
                    .default(ConstValue::Sampler(crate::stdlib::value::BuiltinSampler::NearestClamp)),
                field("tint", TypeRef::Color, writable_bindable(), "Multiplies the texel, alpha included.")
                    .default(ConstValue::srgb(0xff, 0xff, 0xff)),
                field("cell", TypeRef::F32, writable_bindable(), "Cell shown, from 0, row by row; floored and wrapped, so `bind(t * fps)` animates.")
                    .default(ConstValue::F32(0.0)),
                field("columns", TypeRef::F32, writable_bindable(), "Cells per row.")
                    .default(ConstValue::F32(1.0))
                    .range(ValueRange::closed(1, 64))
                    .range_code(Code::E5701),
                field("rows", TypeRef::F32, writable_bindable(), "Rows of cells.")
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
            "Linear RGB colour; alpha is ignored.",
        )
        .default(ConstValue::srgb(0xff, 0xff, 0xff))
    };
    vec![
        schema(
            "DirectionalLight",
            SchemaCategory::Light,
            Milestone::M1,
            "Infinitely distant light travelling along the entity's world -Z; rotate the entity to aim it.",
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
            "Light radiating from the entity's position.",
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
            "An immovable body; its pose is fixed at creation.",
            vec![],
        ),
        schema(
            "Kinematic",
            SchemaCategory::Body,
            Milestone::M1,
            "Program-moved body: `set_kinematic_target`, or `move_character` with collisions. Fields tune it.",
            vec![
                field(
                    "max_slope",
                    TypeRef::F32,
                    CU,
                    "Steepest climbable slope in radians.",
                )
                .default(ConstValue::F32(std::f32::consts::FRAC_PI_4))
                .range(ValueRange::bounded(
                    Some(Bound::inclusive(Limit::Int(0))),
                    Some(Bound::inclusive(Limit::Float(std::f32::consts::FRAC_PI_2))),
                )),
                field(
                    "step_height",
                    TypeRef::F32,
                    CU,
                    "Highest step climbed in metres; 0 disables.",
                )
                .default(ConstValue::F32(0.25))
                .range(ValueRange::non_negative().and_finite()),
                field(
                    "step_min_width",
                    TypeRef::F32,
                    CU,
                    "Narrowest tread stepped onto in metres.",
                )
                .default(ConstValue::F32(0.1))
                .range(ValueRange::positive().and_finite()),
                field(
                    "snap_to_ground",
                    TypeRef::F32,
                    CU,
                    "Longest snap-down in metres; 0 disables.",
                )
                .default(ConstValue::F32(0.2))
                .range(ValueRange::non_negative().and_finite()),
                field(
                    "skin",
                    TypeRef::F32,
                    CU,
                    "Gap kept from contacts in metres.",
                )
                .default(ConstValue::F32(0.01))
                .range(ValueRange::positive().and_finite()),
                field(
                    "carry",
                    TypeRef::Bool,
                    CU,
                    "Moving platforms carry the character.",
                )
                .default(ConstValue::Bool(true)),
            ],
        ),
        schema(
            "Dynamic",
            SchemaCategory::Body,
            Milestone::M1,
            "A solver-controlled body; forces, impulses and teleports are commands.",
            vec![
                field("mass", TypeRef::F32, C, "Mass in kilograms.")
                    .default(ConstValue::F32(1.0))
                    .range(ValueRange::positive().and_finite()),
                field(
                    "linear_damping",
                    TypeRef::F32,
                    C,
                    "Linear velocity decay rate.",
                )
                .default(ConstValue::F32(0.0))
                .range(ValueRange::non_negative().and_finite()),
                field(
                    "angular_damping",
                    TypeRef::F32,
                    C,
                    "Angular velocity decay rate.",
                )
                .default(ConstValue::F32(0.05))
                .range(ValueRange::non_negative().and_finite()),
                field(
                    "continuous",
                    TypeRef::Bool,
                    C,
                    "Continuous collision detection.",
                )
                .default(ConstValue::Bool(false)),
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
            "Reports collisions, pushes nothing.",
        )
        .default(ConstValue::Bool(false))
    };
    let friction = || {
        field("friction", TypeRef::F32, C, "Friction coefficient.")
            .default(ConstValue::F32(0.5))
            .range(ValueRange::non_negative().and_finite())
    };
    let restitution = || {
        field("restitution", TypeRef::F32, C, "Bounciness, 0 to 1.")
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
                field("size", TypeRef::Vec3, R_C, "Full extents.")
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
        schema(
            "CapsuleCollider",
            SchemaCategory::Collider,
            Milestone::M1,
            "A capsule shape: a cylinder along local Y capped by hemispheres.",
            vec![
                field("radius", TypeRef::F32, R_C, "Radius in metres.")
                    .range(ValueRange::positive().and_finite()),
                field(
                    "height",
                    TypeRef::F32,
                    R_C,
                    "Full height including both caps; > 2 * `radius`.",
                )
                .range(ValueRange::positive().and_finite()),
                sensor(),
                friction(),
                restitution(),
            ],
        )
        .rule(FieldRule::ExceedsMultiple {
            field: "height",
            other: "radius",
            factor: 2,
            code: Code::E5124,
            help: "increase `height` or decrease `radius`; the height includes both caps, so a straight part needs `height > 2 * radius`",
        }),
    ]
}
