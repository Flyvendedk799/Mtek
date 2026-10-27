//! Global intrinsic functions (`spec/stdlib.md` section 6).

use super::build::{ARRAY_TN, ELEMENT_T, F32, I, T, V, exact, function, p, sig};
use crate::stdlib::model::{Domain, IntrinsicDef, Milestone, TypeRef};

/// A both-domain, const-eligible math function. Planned for M2 (the milestone that adds
/// functions; decision 0024 item 5); task M2-01 implemented them before the M2 gate, so they are
/// marked as implemented by the current build (decision 0035 item 1).
fn math(
    name: &'static str,
    doc: &'static str,
    cpu: &'static str,
    signatures: Vec<crate::stdlib::model::Signature>,
) -> IntrinsicDef {
    function(name, Domain::Both, true, Milestone::M1, doc, signatures).cpu_semantics(cpu)
}

/// `T -> T`.
fn unary(name: &'static str, doc: &'static str, cpu: &'static str) -> IntrinsicDef {
    math(name, doc, cpu, vec![sig(&[p("x", T)], T)])
}

/// `(T, T) -> T` and `(I, I) -> I`.
fn binary_float_int(name: &'static str, doc: &'static str, cpu: &'static str) -> IntrinsicDef {
    math(
        name,
        doc,
        cpu,
        vec![
            sig(&[p("a", T), p("b", T)], T),
            sig(&[p("a", I), p("b", I)], I),
        ],
    )
}

/// Every global intrinsic of the v0.1 registry.
pub(super) fn intrinsics() -> Vec<IntrinsicDef> {
    let vec3 = exact(TypeRef::Vec3);
    let sound = exact(TypeRef::Sound);
    let unit = exact(TypeRef::Unit);
    vec![
        function(
            "screen_to_world", Domain::Cpu, false, Milestone::M1,
            "Canvas NDC to the world Z plane `z`; parallel rays return NaN x/y.",
            vec![sig(&[p("point", exact(TypeRef::Vec2)), p("z", F32)], vec3)],
        ),
        function(
            "world_to_screen", Domain::Cpu, false, Milestone::M1,
            "World position to canvas NDC, using the active camera and viewport.",
            vec![sig(&[p("point", vec3)], exact(TypeRef::Vec2))],
        ),
        function(
            "overlap_spheres", Domain::Cpu, false, Milestone::M1,
            "World-space sphere intersection, touching included. No physics needed.",
            vec![sig(&[p("a", vec3), p("radius_a", F32), p("b", vec3), p("radius_b", F32)], exact(TypeRef::Bool))],
        ),
        function(
            "overlap_boxes", Domain::Cpu, false, Milestone::M1,
            "Oriented box intersection from world centres, full sizes and rotations.",
            vec![sig(&[p("a", vec3), p("size_a", vec3), p("rotation_a", exact(TypeRef::Quat)), p("b", vec3), p("size_b", vec3), p("rotation_b", exact(TypeRef::Quat))], exact(TypeRef::Bool))],
        ),
        function(
            "send", Domain::Cpu, false, Milestone::M1,
            "Queues a string for a live entity's `on message(value: string)` handler.",
            vec![sig(&[p("target", exact(TypeRef::EntityRef)), p("message", exact(TypeRef::String))], unit)],
        ).handlers_only(),
        math(
            "abs",
            "Absolute value, component-wise.",
            "`abs(i32 MIN) = MIN`.",
            vec![sig(&[p("x", T)], T), sig(&[p("x", I)], I)],
        ),
        binary_float_int("min", "Smaller of two values, component-wise.", "NaN handling is non-portable."),
        binary_float_int("max", "Larger of two values, component-wise.", "NaN handling is non-portable."),
        math(
            "clamp",
            "Limits `x` to the range `lo..hi`.",
            "`min(max(x, lo), hi)`; `lo > hi` is non-portable.",
            vec![
                sig(&[p("x", T), p("lo", T), p("hi", T)], T),
                sig(&[p("x", I), p("lo", I), p("hi", I)], I),
            ],
        ),
        unary("saturate", "Limits `x` to 0..1.", "`clamp(x, 0, 1)`."),
        math(
            "mix",
            "Linear interpolation `a * (1 - t) + b * t`, with a scalar or a component-wise `t`.",
            "`a * (1 - t) + b * t`.",
            vec![
                sig(&[p("a", T), p("b", T), p("t", F32)], T),
                sig(&[p("a", T), p("b", T), p("t", T)], T),
            ],
        ),
        math(
            "step",
            "0 where `x < edge`, otherwise 1, component-wise. WGSL argument order: `step(edge, x)`.",
            "`x >= edge ? 1 : 0` per component.",
            vec![sig(&[p("edge", T), p("x", T)], T)],
        ),
        math(
            "smoothstep",
            "Smooth Hermite interpolation between `edge0` and `edge1`.",
            "Hermite, `t = clamp((x - e0) / (e1 - e0), 0, 1)`.",
            vec![sig(&[p("edge0", T), p("edge1", T), p("x", T)], T)],
        ),
        unary("sqrt", "Square root.", "Correctly rounded on the CPU."),
        unary("inverse_sqrt", "Reciprocal of the square root.", ""),
        math(
            "pow",
            "`base` raised to `exponent`, component-wise.",
            "Tolerance-based CPU/GPU agreement.",
            vec![sig(&[p("base", T), p("exponent", T)], T)],
        ),
        unary("exp", "e raised to `x`.", "Tolerance-based CPU/GPU agreement."),
        unary("exp2", "2 raised to `x`.", "Tolerance-based CPU/GPU agreement."),
        unary("log", "Natural logarithm.", "Tolerance-based CPU/GPU agreement."),
        unary("log2", "Base-2 logarithm.", "Tolerance-based CPU/GPU agreement."),
        unary("sin", "Sine of an angle in radians.", ""),
        unary("cos", "Cosine of an angle in radians.", ""),
        unary("tan", "Tangent of an angle in radians.", ""),
        unary("asin", "Arc sine, in radians.", ""),
        unary("acos", "Arc cosine, in radians.", ""),
        unary("atan", "Arc tangent, in radians.", ""),
        math(
            "atan2",
            "Angle of the point `(x, y)` in radians; note the argument order `atan2(y, x)`.",
            "",
            vec![sig(&[p("y", T), p("x", T)], T)],
        ),
        unary("floor", "Largest integer value not above `x`.", ""),
        unary("ceil", "Smallest integer value not below `x`.", ""),
        unary("trunc", "Integer part of `x`, rounding toward zero.", ""),
        unary("fract", "Fractional part of `x`.", "`fract(x) = x - floor(x)`."),
        unary("sign", "-1, 0 or 1 according to the sign of `x`.", "`sign(0) = 0`."),
        unary(
            "round",
            "Nearest integer value, halves to even.",
            "Ties to even (not JavaScript `Math.round`).",
        ),
        unary("radians", "Degrees to radians.", ""),
        unary("degrees", "Radians to degrees.", ""),
        math(
            "length",
            "Length of a vector, or the absolute value of a scalar.",
            "",
            vec![sig(&[p("x", T)], F32)],
        ),
        math(
            "distance",
            "Distance between two points.",
            "",
            vec![sig(&[p("a", T), p("b", T)], F32)],
        ),
        math(
            "dot",
            "Dot product of two vectors.",
            "",
            vec![sig(&[p("a", V), p("b", V)], F32)],
        ),
        math(
            "cross",
            "Cross product of two 3D vectors.",
            "",
            vec![sig(&[p("a", vec3), p("b", vec3)], vec3)],
        ),
        math(
            "normalize",
            "The vector scaled to length 1.",
            "A zero vector, or one whose squared length underflows or overflows, gives the zero vector on the CPU and the GPU (decision 0047).",
            vec![sig(&[p("v", V)], V)],
        ),
        math(
            "reflect",
            "Reflects incident vector `i` about the surface normal `n`.",
            "`i - 2 * dot(n, i) * n`.",
            vec![sig(&[p("i", V), p("n", V)], V)],
        ),
        math(
            "transpose",
            "Transpose of a 4x4 matrix.",
            "",
            vec![sig(&[p("m", exact(TypeRef::Mat4))], exact(TypeRef::Mat4))],
        ),
        function(
            "sample",
            Domain::Gpu,
            false,
            Milestone::M1,
            "Level-zero texel of `t` at `uv`. Texture/sampler params are direct operands of `sample` or `sample_mip` only.",
            vec![sig(
                &[
                    p("t", exact(TypeRef::Texture)),
                    p("s", exact(TypeRef::Sampler)),
                    p("uv", exact(TypeRef::Vec2)),
                ],
                exact(TypeRef::Vec4),
            )],
        ),
        function(
            "sample_mip",
            Domain::Gpu,
            false,
            Milestone::M1,
            "Implicit mip texel; fragment initial straight-line code only. Resource rules as for `sample`.",
            vec![sig(
                &[
                    p("t", exact(TypeRef::Texture)),
                    p("s", exact(TypeRef::Sampler)),
                    p("uv", exact(TypeRef::Vec2)),
                ],
                exact(TypeRef::Vec4),
            )],
        ),
        function(
            "random",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Pseudo-random in `[0, 1)`.",
            vec![sig(&[], F32)],
        )
        .cpu_semantics("Seeded PRNG (xoshiro128**, seed from the mount options); deterministic under a fixed seed."),
        // Random helpers (decision 0149): one draw of `random()` each.
        function(
            "random_range",
            Domain::Cpu,
            false,
            Milestone::M1,
            "A random f32 in `[lo, hi)`.",
            vec![sig(&[p("lo", F32), p("hi", F32)], F32)],
        )
        .cpu_semantics("`lo + (hi - lo) * random()`, rounded to f32; one draw."),
        function(
            "random_int",
            Domain::Cpu,
            false,
            Milestone::M1,
            "A random i32 in `[lo, hi)`; `lo` if `hi <= lo`.",
            vec![sig(&[p("lo", exact(TypeRef::I32)), p("hi", exact(TypeRef::I32))], exact(TypeRef::I32))],
        )
        .cpu_semantics("`lo + floor(random() * (hi - lo))` in f64; one draw, also when `hi <= lo`."),
        function(
            "chance",
            Domain::Cpu,
            false,
            Milestone::M1,
            "True with probability `p`.",
            vec![sig(&[p("p", F32)], exact(TypeRef::Bool))],
        )
        .cpu_semantics("`random() < p`; one draw."),
        // `choose` and `shuffle` (decision 0152). The checker reads `T` and `N` off the argument.
        function(
            "choose",
            Domain::Cpu,
            false,
            Milestone::M1,
            "A uniformly chosen element.",
            vec![sig(&[p("items", ARRAY_TN)], ELEMENT_T)],
        )
        .cpu_semantics("One draw of `random()`: index `floor(random() * N)`. `N` is at least 1."),
        function(
            "shuffle",
            Domain::Cpu,
            false,
            Milestone::M1,
            "A new array in random order.",
            vec![sig(&[p("items", ARRAY_TN)], ARRAY_TN)],
        )
        .cpu_semantics("Fisher-Yates: `N - 1` draws of `random()` (`N` below 2 draws none). Does not modify `items`."),
        function(
            "print",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Writes to the development console.",
            vec![sig(&[p("message", exact(TypeRef::String))], exact(TypeRef::Unit))],
        )
        .cpu_semantics("No-op in release builds."),
        function(
            "is_key_down",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Whether the key is down. Sampled after this frame's input handling.",
            vec![sig(&[p("key", exact(TypeRef::Enum("Key")))], exact(TypeRef::Bool))],
        ),
        // Input polling (decision 0153).
        function(
            "key_pressed",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Whether the key went down. Sampled after this frame's input handling.",
            vec![sig(&[p("key", exact(TypeRef::Enum("Key")))], exact(TypeRef::Bool))],
        ),
        function(
            "key_released",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Whether the key went up. Sampled after this frame's input handling.",
            vec![sig(&[p("key", exact(TypeRef::Enum("Key")))], exact(TypeRef::Bool))],
        ),
        function(
            "pointer_position",
            Domain::Cpu,
            false,
            Milestone::M1,
            "The pointer position after input handling, in canvas NDC.",
            vec![sig(&[], exact(TypeRef::Vec2))],
        )
        .cpu_semantics("`x` right, `y` up, both in `[-1, 1]`. `(0, 0)` until the pointer moves or a button changes."),
        function(
            "is_pointer_down",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Whether pointer button `button` is down after input handling.",
            vec![sig(&[p("button", exact(TypeRef::I32))], exact(TypeRef::Bool))],
        )
        .cpu_semantics("0 primary, 1 middle, 2 secondary. Any other button is false."),
        function(
            "spawn",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Queues a prefab instance as a root entity; the reference is valid now, `alive` after the next flush.",
            vec![sig(
                &[p("prefab", exact(TypeRef::PrefabDescriptor))],
                exact(TypeRef::EntityRef),
            )],
        )
        .handlers_only(),
        function(
            "destroy",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Queues removal of a spawned entity; it counts as dead at once.",
            vec![sig(&[p("target", exact(TypeRef::EntityRef))], exact(TypeRef::Unit))],
        )
        .handlers_only(),
        // Audio (spec/audio.md, decision 0130): CPU intrinsics that reach `ctx.audio`.
        function(
            "play",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Plays a sound once at `volume` (default 1, 0..4) and `pitch` (rate, default 1, 0.0625..16).",
            vec![
                sig(&[p("sound", sound)], unit),
                sig(&[p("sound", sound), p("volume", F32)], unit),
                sig(&[p("sound", sound), p("volume", F32), p("pitch", F32)], unit),
            ],
        )
        .handlers_only()
        .cpu_semantics("Web Audio; silent until the first user input unlocks audio (spec/audio.md section 5)."),
        function(
            "play_at",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Plays a sound once at a world position, attenuated by distance from the camera and panned.",
            vec![
                sig(&[p("sound", sound), p("position", vec3)], unit),
                sig(&[p("sound", sound), p("position", vec3), p("volume", F32)], unit),
            ],
        )
        .handlers_only()
        .cpu_semantics("A Web Audio PannerNode (HRTF off, inverse distance, reference distance 1 m); the listener follows the active camera each frame."),
        function(
            "play_music",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Starts a sound as looping music, replacing the current music.",
            vec![
                sig(&[p("sound", sound)], unit),
                sig(&[p("sound", sound), p("volume", F32)], unit),
            ],
        )
        .handlers_only(),
        function(
            "stop_music",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Stops the music started with `play_music`; does nothing when none plays.",
            vec![sig(&[], unit)],
        )
        .handlers_only(),
        function(
            "set_volume",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Global volume of all sound and music (default 1.0, range 0..4).",
            vec![sig(&[p("volume", F32)], unit)],
        )
        .handlers_only(),
        function(
            "set_muted",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Mutes or unmutes all audio, keeping the volume.",
            vec![sig(&[p("muted", exact(TypeRef::Bool))], unit)],
        )
        .handlers_only(),
        function(
            "is_muted",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Whether audio is muted with `set_muted`.",
            vec![sig(&[], exact(TypeRef::Bool))],
        ),
        function(
            "go_to",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Switches scene, keeping shared state.",
            vec![sig(&[p("scene", exact(TypeRef::SceneName))], exact(TypeRef::Unit))],
        )
        .handlers_only(),
        function(
            "set_camera",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Switches the active camera.",
            vec![sig(
                &[p("camera", exact(TypeRef::CameraName))],
                exact(TypeRef::Unit),
            )],
        )
        .handlers_only(),
        function(
            "reset",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Next frame, restarts the scene.",
            vec![sig(&[], exact(TypeRef::Unit))],
        )
        .handlers_only(),
        function(
            "pause",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Stops update, physics and timers; input goes on.",
            vec![sig(&[], exact(TypeRef::Unit))],
        )
        .handlers_only(),
        function(
            "resume",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Undoes pause().",
            vec![sig(&[], exact(TypeRef::Unit))],
        )
        .handlers_only(),
        function(
            "paused",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Whether paused.",
            vec![sig(&[], exact(TypeRef::Bool))],
        ),
        function(
            "particle_count",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Live particle count.",
            vec![sig(&[], exact(TypeRef::I32))],
        ),
        function(
            "save",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Writes the saved and setting state to storage.",
            vec![sig(&[], exact(TypeRef::Unit))],
        )
        .handlers_only(),
        function(
            "load",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Reads saved values back; false if none.",
            vec![sig(&[], exact(TypeRef::Bool))],
        )
        .handlers_only(),
        function(
            "clear_saved",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Deletes everything stored.",
            vec![sig(&[], exact(TypeRef::Unit))],
        )
        .handlers_only(),
        function(
            "alive",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Whether the reference points at a live entity.",
            vec![sig(&[p("target", exact(TypeRef::EntityRef))], exact(TypeRef::Bool))],
        ),
        // Tag queries (decision 0150): the tag is a string literal that some entity or prefab of
        // the program declares as its `tag`.
        function(
            "count_tagged",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Number of live entities with the tag.",
            vec![sig(&[p("tag", exact(TypeRef::String))], exact(TypeRef::I32))],
        ),
        function(
            "first_tagged",
            Domain::Cpu,
            false,
            Milestone::M1,
            "The first live entity with the tag in instance order; a dead reference if none.",
            vec![sig(&[p("tag", exact(TypeRef::String))], exact(TypeRef::EntityRef))],
        ),
        function(
            "nearest_tagged",
            Domain::Cpu,
            false,
            Milestone::M1,
            "The live entity with the tag nearest `point` (world position); a dead reference if none.",
            vec![sig(
                &[p("tag", exact(TypeRef::String)), p("point", exact(TypeRef::Vec3))],
                exact(TypeRef::EntityRef),
            )],
        )
        .cpu_semantics("Ties go to the first in instance order."),
        function(
            "has_tag",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Whether the entity is live and has the tag.",
            vec![sig(
                &[p("target", exact(TypeRef::EntityRef)), p("tag", exact(TypeRef::String))],
                exact(TypeRef::Bool),
            )],
        ),
        function(
            "tagged",
            Domain::Cpu,
            false,
            Milestone::M1,
            "The live entities with the tag in instance order; only a `for` iterable.",
            vec![sig(&[p("tag", exact(TypeRef::String))], exact(TypeRef::TaggedEntities))],
        )
        .cpu_semantics("The loop skips an entity that is destroyed before its turn and does not visit one spawned during the loop."),
        function(
            "destroy_tagged",
            Domain::Cpu,
            false,
            Milestone::M1,
            "Queues removal of every live spawned entity with the tag (not named entities).",
            vec![sig(&[p("tag", exact(TypeRef::String))], exact(TypeRef::Unit))],
        )
        .handlers_only(),
    ]
}
