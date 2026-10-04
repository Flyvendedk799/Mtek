//! Namespaces (`spec/stdlib.md` section 2) and prelude types.

use super::build::{F32, exact, function, p, sig};
use crate::stdlib::model::{
    Domain, IntrinsicDef, Milestone, NamespaceDef, NamespaceMember, RecordField, TypeDef, TypeKind,
    TypeRef, ValueDef,
};

fn namespace(
    name: &'static str,
    since: Milestone,
    doc: &'static str,
    members: Vec<NamespaceMember>,
) -> NamespaceDef {
    NamespaceDef {
        name,
        members,
        since,
        doc,
    }
}

/// A function member that is a pure function of its arguments: usable in both domains and in
/// constant expressions.
fn pure(
    name: &'static str,
    since: Milestone,
    doc: &'static str,
    params: &[crate::stdlib::model::ParamDef],
    ret: TypeRef,
) -> NamespaceMember {
    NamespaceMember::Function(function(
        name,
        Domain::Both,
        true,
        since,
        doc,
        vec![sig(params, exact(ret))],
    ))
}

/// A zero-argument constructor of a built-in resource handle.
fn builtin_handle(name: &'static str, ret: TypeRef, doc: &'static str) -> NamespaceMember {
    NamespaceMember::Function(function(
        name,
        Domain::Cpu,
        true,
        Milestone::M4,
        doc,
        vec![sig(&[], exact(ret))],
    ))
}

/// A compile-time function: runs in the compiler, produces a constant.
fn compile_time(
    name: &'static str,
    since: Milestone,
    doc: &'static str,
    params: &[crate::stdlib::model::ParamDef],
    ret: TypeRef,
) -> IntrinsicDef {
    function(
        name,
        Domain::Cpu,
        true,
        since,
        doc,
        vec![sig(params, exact(ret))],
    )
}

/// Every namespace of the v0.1 registry. (`Key` is an enum, see `events::enums`.)
pub(super) fn namespaces() -> Vec<NamespaceDef> {
    let vec3 = exact(TypeRef::Vec3);
    let vec4 = exact(TypeRef::Vec4);
    let quat = exact(TypeRef::Quat);
    let string = exact(TypeRef::String);
    let value = |name, ty, doc| {
        NamespaceMember::Value(ValueDef {
            name,
            ty,
            domain: Domain::Cpu,
            since: Milestone::M3,
            doc,
        })
    };
    vec![
        namespace(
            "quat",
            Milestone::M1,
            "Quaternion constructors.",
            vec![
                pure(
                    "identity",
                    Milestone::M1,
                    "The rotation that does nothing.",
                    &[],
                    TypeRef::Quat,
                ),
                pure(
                    "axis_angle",
                    Milestone::M1,
                    "Rotation by `angle` radians about `axis`. The axis is normalised; a zero axis gives the identity on the CPU.",
                    &[p("axis", vec3), p("angle", F32)],
                    TypeRef::Quat,
                ),
                pure(
                    "euler",
                    Milestone::M1,
                    "Rotation about Z, then X, then Y, all about fixed world axes: `axis_angle(+Y, y) * axis_angle(+X, x) * axis_angle(+Z, z)`.",
                    &[p("x", F32), p("y", F32), p("z", F32)],
                    TypeRef::Quat,
                ),
            ],
        ),
        namespace(
            "mat4",
            // Planned for M2; implemented by task M2-01 before the M2 gate (decision 0035).
            Milestone::M1,
            "Constructors for column-major 4x4 matrices.",
            vec![
                pure(
                    "identity",
                    Milestone::M1,
                    "The identity matrix.",
                    &[],
                    TypeRef::Mat4,
                ),
                pure(
                    "translation",
                    Milestone::M1,
                    "Translation by `v`.",
                    &[p("v", vec3)],
                    TypeRef::Mat4,
                ),
                pure(
                    "rotation",
                    Milestone::M1,
                    "Rotation matrix of a quaternion.",
                    &[p("q", quat)],
                    TypeRef::Mat4,
                ),
                pure(
                    "scale",
                    Milestone::M1,
                    "Non-uniform scale by `v`.",
                    &[p("v", vec3)],
                    TypeRef::Mat4,
                ),
                pure(
                    "columns",
                    Milestone::M1,
                    "Matrix from its four columns.",
                    &[p("c0", vec4), p("c1", vec4), p("c2", vec4), p("c3", vec4)],
                    TypeRef::Mat4,
                ),
            ],
        ),
        namespace(
            "color",
            Milestone::M1,
            "Colour constructors.",
            vec![
                pure(
                    "linear",
                    Milestone::M1,
                    "A colour from linear-light components.",
                    &[p("rgb", vec3), p("a", F32)],
                    TypeRef::Color,
                ),
                // Const-eligible, folded in binary32 with `libm::powf`; decision 0024 item 6.
                NamespaceMember::Function(
                    function(
                        "srgb",
                        Domain::Both,
                        true,
                        Milestone::M1,
                        "A colour from sRGB-encoded components, converted to linear light with the sRGB transfer function.",
                        vec![sig(&[p("rgb", vec3), p("a", F32)], exact(TypeRef::Color))],
                    )
                    .cpu_semantics(
                        "Per channel `c <= 0.04045 ? c / 12.92 : powf((c + 0.055) / 1.055, 2.4)`, every operation rounded to `f32`; alpha unchanged. Constant folding uses `libm::powf` (deterministic); run time agrees within the CPU/GPU tolerance. `#rrggbb` literals use the exact `f64` conversion instead and may differ in the last bit.",
                    ),
                ),
            ],
        ),
        namespace(
            "texture",
            Milestone::M4,
            "Built-in textures.",
            vec![
                builtin_handle("white", TypeRef::Texture, "A 1x1 opaque white texture."),
                builtin_handle("black", TypeRef::Texture, "A 1x1 opaque black texture."),
            ],
        ),
        namespace(
            "sampler",
            Milestone::M4,
            "Built-in sampler presets.",
            vec![
                builtin_handle(
                    "linear_repeat",
                    TypeRef::Sampler,
                    "Bilinear filtering, texture coordinates wrap.",
                ),
                builtin_handle(
                    "linear_clamp",
                    TypeRef::Sampler,
                    "Bilinear filtering, texture coordinates clamp to the edge.",
                ),
                builtin_handle(
                    "nearest_repeat",
                    TypeRef::Sampler,
                    "Nearest-texel filtering, texture coordinates wrap.",
                ),
                builtin_handle(
                    "nearest_clamp",
                    TypeRef::Sampler,
                    "Nearest-texel filtering, texture coordinates clamp to the edge.",
                ),
            ],
        ),
        namespace(
            "frame",
            Milestone::M3,
            "Per-frame values. Readable in CPU code and in `bind` expressions, not in GPU stage code: route them through material parameters.",
            vec![
                value(
                    "time",
                    TypeRef::F32,
                    "Active application time in seconds since mount, excluding paused time.",
                ),
                value(
                    "delta",
                    TypeRef::F32,
                    "The clamped frame delta of the current rendered frame; the value passed to `update`.",
                ),
                value(
                    "index",
                    TypeRef::U32,
                    "Rendered frame counter since mount, wrapping.",
                ),
            ],
        ),
        namespace(
            "asset",
            Milestone::M4,
            "Compile-time asset declarations. The argument must be a string literal naming a file inside the project.",
            vec![
                NamespaceMember::Function(compile_time(
                    "glb",
                    Milestone::M4,
                    "A static GLB model. May be stored only in a `const` and used through its accessors.",
                    &[p("path", string)],
                    TypeRef::GlbAsset,
                )),
                NamespaceMember::Function(compile_time(
                    "texture",
                    Milestone::M4,
                    "An sRGB colour texture.",
                    &[p("path", string)],
                    TypeRef::Texture,
                )),
                NamespaceMember::Function(compile_time(
                    "linear_texture",
                    Milestone::M4,
                    "A linear data texture (masks, normal data).",
                    &[p("path", string)],
                    TypeRef::Texture,
                )),
            ],
        ),
        namespace(
            "lighting",
            Milestone::M4,
            "Lighting functions for material fragment stages.",
            vec![NamespaceMember::Function(function(
                "pbr",
                Domain::Gpu,
                false,
                Milestone::M4,
                "The documented PBR subset evaluated for every light in the scene.",
                vec![sig(
                    &[
                        p("surface", exact(TypeRef::Record("SurfaceInput"))),
                        p("base_color", exact(TypeRef::Color)),
                        p("metallic", F32),
                        p("roughness", F32),
                    ],
                    exact(TypeRef::Color),
                )],
            ))],
        ),
    ]
}

fn scalar(name: &'static str, since: Milestone, gpu: bool, doc: &'static str) -> TypeDef {
    simple(name, TypeKind::Scalar, since, gpu, doc)
}

fn simple(
    name: &'static str,
    kind: TypeKind,
    since: Milestone,
    gpu: bool,
    doc: &'static str,
) -> TypeDef {
    TypeDef {
        name,
        kind,
        gpu,
        fields: Vec::new(),
        methods: Vec::new(),
        since,
        doc,
    }
}

/// The accessors of `glb_asset` (`spec/assets.md` section 2.1), all const-eligible.
fn glb_methods() -> Vec<IntrinsicDef> {
    let name = p("name", exact(TypeRef::String));
    let accessor = |method, doc, params: &[crate::stdlib::model::ParamDef], ret| {
        compile_time(method, Milestone::M4, doc, params, ret)
    };
    vec![
        accessor(
            "mesh",
            "The glTF mesh with this name; it must have exactly one primitive.",
            &[name],
            TypeRef::Mesh,
        ),
        accessor(
            "primitive",
            "Primitive `index` (an integer literal) of the named glTF mesh.",
            &[name, p("index", exact(TypeRef::U32))],
            TypeRef::Mesh,
        ),
        accessor(
            "material",
            "The glTF material with this name as a `Pbr` instance with every parameter taken from the file.",
            &[name],
            TypeRef::Material,
        ),
        accessor(
            "material_base_color",
            "The linear `baseColorFactor` of the material; alpha must be 1.",
            &[name],
            TypeRef::Color,
        ),
        accessor(
            "material_metallic",
            "The `metallicFactor` of the material.",
            &[name],
            TypeRef::F32,
        ),
        accessor(
            "material_roughness",
            "The `roughnessFactor` of the material.",
            &[name],
            TypeRef::F32,
        ),
        accessor(
            "material_texture",
            "The `baseColorTexture` of the material, or `texture.white()` when absent.",
            &[name],
            TypeRef::Texture,
        ),
        accessor(
            "node_position",
            "World position of the node in the default scene.",
            &[name],
            TypeRef::Vec3,
        ),
        accessor(
            "node_rotation",
            "World rotation of the node in the default scene.",
            &[name],
            TypeRef::Quat,
        ),
        accessor(
            "node_scale",
            "World scale of the node in the default scene.",
            &[name],
            TypeRef::Vec3,
        ),
    ]
}

/// Every prelude type of the v0.1 registry (`spec/stdlib.md` section 2).
pub(super) fn types() -> Vec<TypeDef> {
    let handle = |name, since, doc| simple(name, TypeKind::Handle, since, false, doc);
    vec![
        scalar("bool", Milestone::M1, true, "Truth value."),
        scalar("i32", Milestone::M1, true, "32-bit signed integer."),
        scalar("u32", Milestone::M1, true, "32-bit unsigned integer."),
        scalar(
            "f32",
            Milestone::M1,
            true,
            "IEEE-754 binary32 floating-point number.",
        ),
        simple(
            "string",
            TypeKind::Text,
            Milestone::M2,
            false,
            "Immutable text. CPU only.",
        ),
        simple(
            "vec2",
            TypeKind::Vector,
            Milestone::M1,
            true,
            "Two `f32` components.",
        ),
        simple(
            "vec3",
            TypeKind::Vector,
            Milestone::M1,
            true,
            "Three `f32` components.",
        ),
        simple(
            "vec4",
            TypeKind::Vector,
            Milestone::M1,
            true,
            "Four `f32` components.",
        ),
        simple(
            "mat4",
            TypeKind::Matrix,
            // Planned for M2; implemented by task M2-01 before the M2 gate (decision 0035).
            Milestone::M1,
            true,
            "4x4 `f32` matrix, column-major; multiplies column vectors on the right.",
        ),
        simple(
            "quat",
            TypeKind::Rotation,
            Milestone::M1,
            true,
            "Unit quaternion `(x, y, z, w)`; distinct from `vec4`.",
        ),
        simple(
            "color",
            TypeKind::Color,
            Milestone::M1,
            true,
            "Linear-light RGBA with straight alpha; distinct from `vec4`.",
        ),
        simple(
            "array",
            TypeKind::Array,
            Milestone::M2,
            true,
            "The generic `array<T, N>`: a fixed-length array of `N` (1 to 65536) elements of type `T`.",
        ),
        handle(
            "mesh",
            Milestone::M1,
            "An immutable mesh: a primitive descriptor or an asset mesh.",
        ),
        handle(
            "material",
            Milestone::M1,
            "A material instance with its own parameter storage.",
        ),
        handle(
            "texture",
            Milestone::M4,
            "An immutable texture. Usable only as a material parameter.",
        ),
        handle(
            "sampler",
            Milestone::M4,
            "A sampler preset. Usable only as a material parameter.",
        ),
        handle(
            "entity_ref",
            Milestone::M5,
            "A generation-checked reference to an entity. Supports comparison, `alive`, `destroy` and body commands only.",
        ),
        TypeDef {
            methods: glb_methods(),
            ..handle(
                "glb_asset",
                Milestone::M4,
                "The compile-time handle of `asset.glb(..)`; may be stored only in a `const` and used through its accessors.",
            )
        },
        TypeDef {
            fields: vec![
                RecordField {
                    name: "local_position",
                    ty: TypeRef::Vec3,
                },
                RecordField {
                    name: "world_position",
                    ty: TypeRef::Vec3,
                },
                RecordField {
                    name: "world_normal",
                    ty: TypeRef::Vec3,
                },
                RecordField {
                    name: "uv",
                    ty: TypeRef::Vec2,
                },
            ],
            ..simple(
                "SurfaceInput",
                TypeKind::Record,
                Milestone::M2,
                true,
                "The interpolated inputs of a material fragment stage; the compiler records which fields a material reads.",
            )
        },
        TypeDef {
            fields: vec![
                RecordField {
                    name: "position",
                    ty: TypeRef::Vec2,
                },
                RecordField {
                    name: "button",
                    ty: TypeRef::I32,
                },
            ],
            ..simple(
                "PointerEvent",
                TypeKind::Record,
                Milestone::M3,
                false,
                "A pointer event: `position` in normalised canvas coordinates (x right, y up, both in -1..1) and the `button` (0 primary, 1 middle, 2 secondary).",
            )
        },
    ]
}
