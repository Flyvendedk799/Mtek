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
        // Textures and samplers landed with task M4-04, before the M4 gate (decision 0054).
        Milestone::M1,
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

/// Imported node clip controls (decision 0190).
fn animation_namespace() -> NamespaceDef {
    let target = p("target", exact(TypeRef::EntityRef));
    let boolean = exact(TypeRef::Bool);
    let member = |name, doc, params: Vec<_>, ret, mutation| {
        let f = function(
            name,
            Domain::Cpu,
            false,
            Milestone::M1,
            doc,
            vec![sig(&params, ret)],
        );
        NamespaceMember::Function(if mutation { f.handlers_only() } else { f })
    };
    namespace(
        "animation",
        Milestone::M1,
        "Controls an entity's imported node clip (decision 0190).",
        vec![
            member(
                "copy_pose",
                "Copies the displayed pose from a compatible skeleton and holds it. A subsequent transition blends from that pose.",
                vec![target, p("source", exact(TypeRef::EntityRef))],
                boolean,
                true,
            ),
            member(
                "joint_position",
                "Joint position in the skeletal mesh local space; zero if missing.",
                vec![target, p("name", exact(TypeRef::String))],
                exact(TypeRef::Vec3),
                false,
            ),
            member(
                "joint_rotation",
                "Joint rotation in skeletal mesh local space; identity if missing.",
                vec![target, p("name", exact(TypeRef::String))],
                exact(TypeRef::Quat),
                false,
            ),
            member(
                "transition",
                "Selects a skeletal clip, crossfading from the current pose. Repeating the current name does not restart it; use play to restart.",
                vec![
                    target,
                    p("name", exact(TypeRef::String)),
                    p("seconds", F32),
                    p("looping", boolean),
                    p("speed", F32),
                ],
                boolean,
                true,
            ),
            member(
                "play",
                "Restarts the clip. Speed must be finite and nonnegative. Returns false for an unavailable clip.",
                vec![target, p("looping", boolean), p("speed", F32)],
                boolean,
                true,
            ),
            member(
                "pause",
                "Freezes clip time; fades continue during scene updates.",
                vec![target],
                boolean,
                true,
            ),
            member(
                "resume",
                "Continues a paused clip; returns false for a finished clip.",
                vec![target],
                boolean,
                true,
            ),
            member(
                "seek",
                "Clamps time to the clip duration and applies the pose immediately, without crossing markers or resuming.",
                vec![target, p("time", F32)],
                boolean,
                true,
            ),
            member(
                "fade",
                "Smoothly blends clip weight toward a clamped 0..1 target over seconds; zero applies immediately.",
                vec![target, p("weight", F32), p("duration", F32)],
                boolean,
                true,
            ),
            member(
                "time",
                "Current clip time in seconds; zero for an unavailable clip.",
                vec![target],
                F32,
                false,
            ),
            member(
                "duration",
                "Clip duration in seconds; zero for an unavailable clip.",
                vec![target],
                F32,
                false,
            ),
            member(
                "weight",
                "Current clip weight; zero for an unavailable clip.",
                vec![target],
                F32,
                false,
            ),
            member(
                "playing",
                "Whether clip time is advancing; false for an unavailable clip.",
                vec![target],
                boolean,
                false,
            ),
            member(
                "finished",
                "Whether a one-shot clip reached its end.",
                vec![target],
                boolean,
                false,
            ),
            member(
                "crossed",
                "Whether a marker in (0, duration] was crossed in the latest update, including loop wraps. Not consumed by reading.",
                vec![target, p("marker", F32)],
                boolean,
                false,
            ),
        ],
    )
}

/// Immediate-mode text, rectangles and buttons (decision 0134, `spec/hud.md`).
fn hud_namespace() -> NamespaceDef {
    let string = exact(TypeRef::String);
    let vec2 = exact(TypeRef::Vec2);
    let tint = exact(TypeRef::Color);
    let unit = exact(TypeRef::Unit);
    let boolean = exact(TypeRef::Bool);
    let font = exact(TypeRef::Font);
    let member = |name, doc, signatures, semantics| {
        NamespaceMember::Function(
            function(name, Domain::Cpu, false, Milestone::M1, doc, signatures)
                .handlers_only()
                .cpu_semantics(semantics),
        )
    };
    namespace(
        "hud",
        Milestone::M1,
        "The heads-up display: text, rectangles and buttons drawn over the canvas. Immediate mode: what a frame draws is shown until the next frame, so draw from `update`.",
        vec![
            member(
                "text",
                "Draws a line of text at `at` (canvas NDC, y up): `size` in CSS pixels (default 24.0), `tint` (default white), `align` 0.0 puts the left edge at `at`, 0.5 the centre (default), 1.0 the right edge, `font` an `asset.font(..)` or `hud.pixel_font()` (default: the page's sans-serif). The line is centred vertically on `at`.",
                vec![
                    sig(&[p("content", string), p("at", vec2)], unit),
                    sig(&[p("content", string), p("at", vec2), p("size", F32)], unit),
                    sig(
                        &[
                            p("content", string),
                            p("at", vec2),
                            p("size", F32),
                            p("tint", tint),
                        ],
                        unit,
                    ),
                    sig(
                        &[
                            p("content", string),
                            p("at", vec2),
                            p("size", F32),
                            p("tint", tint),
                            p("align", F32),
                        ],
                        unit,
                    ),
                    sig(
                        &[
                            p("content", string),
                            p("at", vec2),
                            p("size", F32),
                            p("tint", tint),
                            p("align", F32),
                            p("font", font),
                        ],
                        unit,
                    ),
                ],
                "A DOM element over the canvas; the text is set as text, never as HTML.",
            ),
            member(
                "pixel_font",
                "The built-in font: a 5x7 pixel bitmap of printable ASCII, the same in every browser (decision 0139). Other characters show as a box.",
                vec![sig(&[], font)],
                "Returns the built-in font; draws nothing.",
            ),
            member(
                "rect",
                "Draws a filled rectangle of `size` CSS pixels at `at` (canvas NDC), aligned like `hud.text` (default centred). For panels and bars.",
                vec![
                    sig(&[p("at", vec2), p("size", vec2), p("tint", tint)], unit),
                    sig(
                        &[
                            p("at", vec2),
                            p("size", vec2),
                            p("tint", tint),
                            p("align", F32),
                        ],
                        unit,
                    ),
                ],
                "A DOM element over the canvas.",
            ),
            member(
                "button",
                "Draws a button centred at `at` (canvas NDC) with the label `label` (`size` in CSS pixels, default 24.0). Returns true in the frame after the button was clicked, once per click; buttons are told apart by their label and their order among buttons with that label.",
                vec![
                    sig(&[p("label", string), p("at", vec2)], boolean),
                    sig(
                        &[p("label", string), p("at", vec2), p("size", F32)],
                        boolean,
                    ),
                ],
                "A DOM button over the canvas; clicks are queued and reported by the next frame's call.",
            ),
        ],
    )
}

/// `easing` (decision 0135, `spec/tweens.md`): easing curves `f32 -> f32` for tweens. CPU functions
/// that are pure, so `bind` may use them (`types/bind.rs`); not in GPU code and not constant.
fn ease_namespace() -> NamespaceDef {
    let member = |name, doc| {
        NamespaceMember::Function(
            function(
                name,
                Domain::Cpu,
                false,
                Milestone::M1,
                doc,
                vec![sig(&[p("t", F32)], F32)],
            )
            .cpu_semantics("Binary64 arithmetic on the clamped argument, rounded once to f32."),
        )
    };
    namespace(
        "easing",
        Milestone::M1,
        "Easing curves for tweens: `mix(a, b, easing.out_cubic(t))` moves from `a` to `b` as `t` goes from 0 to 1.",
        vec![
            member(
                "in_quad",
                "Easing t²; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "out_quad",
                "Easing 1 − (1 − t)²; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "in_out_quad",
                "Easing quadratic in, then out; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "in_cubic",
                "Easing t³; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "out_cubic",
                "Easing 1 − (1 − t)³; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "in_out_cubic",
                "Easing cubic in, then out; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "in_out_sine",
                "Easing (1 − cos(π t)) / 2; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "out_back",
                "Easing overshoots slightly past 1, then settles; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "out_elastic",
                "Easing springs past 1 and oscillates to rest; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
            member(
                "out_bounce",
                "Easing bounces at 1 like a dropped ball; `t` is clamped to 0..1, the result is 0 at 0 and 1 at 1.",
            ),
        ],
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
            since: Milestone::M1,
            doc,
        })
    };
    vec![
        animation_namespace(),
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
            Milestone::M1,
            "Built-in textures.",
            vec![
                builtin_handle("white", TypeRef::Texture, "A 1x1 opaque white texture."),
                builtin_handle("black", TypeRef::Texture, "A 1x1 opaque black texture."),
            ],
        ),
        namespace(
            "sampler",
            Milestone::M1,
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
                builtin_handle("linear_repeat_level0", TypeRef::Sampler, "Base-level-only filtering."),
                builtin_handle("linear_repeat_mip_nearest", TypeRef::Sampler, "Explicit mip interpolation preset."),
                builtin_handle("linear_clamp_level0", TypeRef::Sampler, "Base-level-only filtering."),
                builtin_handle("linear_clamp_mip_nearest", TypeRef::Sampler, "Explicit mip interpolation preset."),
                builtin_handle("nearest_repeat_level0", TypeRef::Sampler, "Base-level-only filtering."),
                builtin_handle("nearest_repeat_mip_linear", TypeRef::Sampler, "Explicit mip interpolation preset."),
                builtin_handle("nearest_clamp_level0", TypeRef::Sampler, "Base-level-only filtering."),
                builtin_handle("nearest_clamp_mip_linear", TypeRef::Sampler, "Explicit mip interpolation preset."),

            ],
        ),
        namespace(
            "frame",
            Milestone::M1,
            "Per-frame CPU/`bind` values; route to GPU stages through material params. `update(dt)` gets variable frame delta; `fixed_update(dt)` runs zero or more times per frame with a constant fixed step (default 1/60 s).",
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
            // Implemented by task M4-05 ahead of the M4 gate, like textures and samplers
            // (decisions 0054 and 0058): `CURRENT_MILESTONE` does not move.
            Milestone::M1,
            "Compile-time asset declarations. The argument must be a string literal naming a file inside the project.",
            vec![
                NamespaceMember::Function(compile_time(
                    "glb",
                    Milestone::M1,
                    "A static GLB model. May be stored only in a `const` and used through its accessors.",
                    &[p("path", string)],
                    TypeRef::GlbAsset,
                )),
                NamespaceMember::Function(compile_time(
                    "texture",
                    Milestone::M1,
                    "An sRGB colour texture.",
                    &[p("path", string)],
                    TypeRef::Texture,
                )),
                NamespaceMember::Function(compile_time(
                    "linear_texture",
                    Milestone::M1,
                    "A linear data texture (masks, normal data).",
                    &[p("path", string)],
                    TypeRef::Texture,
                )),
                // Decision 0130 (spec/audio.md): sounds are assets like images.
                NamespaceMember::Function(compile_time(
                    "sound",
                    Milestone::M1,
                    "A sound file (`.wav`, `.ogg` or `.mp3`) for `play`, `play_at` and `play_music`.",
                    &[p("path", string)],
                    TypeRef::Sound,
                )),
                // Decision 0139 (spec/hud.md section 6): fonts for `hud.text`.
                NamespaceMember::Function(compile_time(
                    "font",
                    Milestone::M1,
                    "A font file (`.ttf`, `.otf`, `.woff` or `.woff2`) for `hud.text`.",
                    &[p("path", string)],
                    TypeRef::Font,
                )),
            ],
        ),
        // Decision 0134 (spec/hud.md): immediate-mode HUD drawn over the canvas each frame.
        hud_namespace(),
        namespace("gamepad", Milestone::M1, "Polled gamepads; raw browser indices, sampled once per input phase.", vec![
            NamespaceMember::Function(function("axis", Domain::Cpu, false, Milestone::M1,
                "Axis in [-1,1]; missing/disconnected is zero.",
                vec![sig(&[p("pad", exact(TypeRef::I32)), p("axis", exact(TypeRef::I32))], F32)])),
            NamespaceMember::Function(function("button", Domain::Cpu, false, Milestone::M1,
                "Button pressure in [0,1]; missing/disconnected is zero.",
                vec![sig(&[p("pad", exact(TypeRef::I32)), p("button", exact(TypeRef::I32))], F32)])),
            NamespaceMember::Function(function("connected", Domain::Cpu, false, Milestone::M1,
                "Whether the pad is connected.",
                vec![sig(&[p("pad", exact(TypeRef::I32))], exact(TypeRef::Bool))])),
        ]),
        // Decision 0135 (spec/tweens.md): easing curves for tweens.
        ease_namespace(),
        // `lighting.pbr` and the `Pbr` material landed with task M4-03, before the M4 gate
        // (decision 0057).
        namespace(
            "lighting",
            Milestone::M1,
            "Lighting functions for material fragment stages.",
            vec![NamespaceMember::Function(function(
                "pbr",
                Domain::Gpu,
                false,
                Milestone::M1,
                "PBR with scene lights, optional shadows and environment lighting.",
                vec![sig(
                    &[
                        p("surface", exact(TypeRef::Record("SurfaceInput"))),
                        p("base_color", exact(TypeRef::Color)),
                        p("metallic", F32),
                        p("roughness", F32),
                    ],
                    exact(TypeRef::Color),
                )],
            )), NamespaceMember::Function(function(
                "pbr_mapped", Domain::Gpu, false, Milestone::M1,
                "Derivative normal, indirect occlusion, exposed emission; fragment initial straight-line code only.",
                vec![sig(&[
                    p("surface", exact(TypeRef::Record("SurfaceInput"))),
                    p("base_color", exact(TypeRef::Color)),
                    p("metallic", F32), p("roughness", F32),
                    p("normal_texel", exact(TypeRef::Vec3)), p("normal_scale", F32),
                    p("occlusion", F32), p("emissive", exact(TypeRef::Vec3)),
                ], exact(TypeRef::Color))],
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
        compile_time(method, Milestone::M1, doc, params, ret)
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
            // Planned for M2; implemented by task M2-01 before the M2 gate (decision 0035).
            Milestone::M1,
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
            "Linear-light RGBA with straight alpha; distinct from `vec4`. A literal `#rrggbb` is sRGB-encoded and converted; `color.linear(rgb, a)` takes linear components, `color.srgb(rgb, a)` sRGB ones. Fields `.r .g .b .a` and `.rgb`; no arithmetic.",
        ),
        simple(
            "array",
            TypeKind::Array,
            // Planned for M2; implemented by task M2-01 before the M2 gate (decision 0035).
            Milestone::M1,
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
            Milestone::M1,
            "An immutable texture. Usable only as a material parameter.",
        ),
        handle(
            "sampler",
            Milestone::M1,
            "A sampler preset. Usable only as a material parameter.",
        ),
        handle(
            "entity_ref",
            Milestone::M1,
            "A generation-checked reference to an entity. Compare it, test `alive`, `destroy` it, command its body, and read `position`, `rotation`, `scale` and `visible`.",
        ),
        handle(
            "font",
            Milestone::M1,
            "A font for `hud.text`: `asset.font(..)` or the built-in `hud.pixel_font()`; CPU only (decision 0139).",
        ),
        handle(
            "sound",
            Milestone::M1,
            "A sound file declared with `asset.sound(..)`; CPU only. Played with `play`, `play_at` and `play_music` (decision 0130).",
        ),
        TypeDef {
            methods: glb_methods(),
            ..handle(
                "glb_asset",
                Milestone::M1,
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
                RecordField {
                    name: "world_tangent",
                    ty: TypeRef::Vec4,
                },
            ],
            ..simple(
                "SurfaceInput",
                TypeKind::Record,
                // Planned for M2; implemented by task M2-04 before the M2 gate (decision 0039).
                Milestone::M1,
                true,
                "Interpolated fragment inputs.",
            )
        },
        TypeDef {
            fields: vec![
                RecordField {
                    name: "position",
                    ty: TypeRef::Vec3,
                },
                RecordField {
                    name: "normal",
                    ty: TypeRef::Vec3,
                },
                RecordField {
                    name: "uv",
                    ty: TypeRef::Vec2,
                },
                RecordField {
                    name: "tangent",
                    ty: TypeRef::Vec4,
                },
            ],
            ..simple(
                "VertexInput",
                TypeKind::Record,
                Milestone::M1,
                true,
                "Skinned local vertex inputs.",
            )
        },
        TypeDef {
            fields: [
                "index",
                "global_x",
                "global_y",
                "global_z",
                "local_x",
                "local_y",
                "local_z",
                "group_x",
                "group_y",
                "group_z",
                "group_count_x",
                "group_count_y",
                "group_count_z",
                "local_index",
            ]
            .into_iter()
            .map(|name| RecordField {
                name,
                ty: TypeRef::U32,
            })
            .collect(),
            ..simple(
                "ComputeInput",
                TypeKind::Record,
                Milestone::M1,
                true,
                "Compute invocation IDs.",
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
                Milestone::M1,
                false,
                "A pointer event: `position` in normalised canvas coordinates (x right, y up, both in -1..1) and the `button` (0 primary, 1 middle, 2 secondary).",
            )
        },
    ]
}
