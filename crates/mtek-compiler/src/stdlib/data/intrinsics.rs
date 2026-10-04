//! Global intrinsic functions (`spec/stdlib.md` section 6).

use super::build::{F32, I, T, V, exact, function, p, sig};
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
    vec![
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
            "A zero vector gives the zero vector on the CPU; non-portable on the GPU.",
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
            Milestone::M4,
            "Filtered texel of `t` at `uv`. `texture` and `sampler` parameters may be used only as direct arguments to `sample`.",
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
            Milestone::M3,
            "A pseudo-random number in `[0, 1)`.",
            vec![sig(&[], F32)],
        )
        .cpu_semantics("Seeded PRNG (xoshiro128**, seed from the mount options); deterministic under a fixed seed."),
        function(
            "print",
            Domain::Cpu,
            false,
            Milestone::M3,
            "Writes a message to the development console.",
            vec![sig(&[p("message", exact(TypeRef::String))], exact(TypeRef::Unit))],
        )
        .cpu_semantics("No-op in release builds."),
        function(
            "is_key_down",
            Domain::Cpu,
            false,
            Milestone::M3,
            "Whether the key was down at the end of input handling in the current frame.",
            vec![sig(&[p("key", exact(TypeRef::Enum("Key")))], exact(TypeRef::Bool))],
        ),
        function(
            "spawn",
            Domain::Cpu,
            false,
            Milestone::M5,
            "Queues creation of a prefab instance as a root entity; the reference is valid immediately and `alive` turns true after the next lifecycle flush.",
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
            Milestone::M5,
            "Queues removal of a spawned entity; it counts as dead from the moment of the call.",
            vec![sig(&[p("target", exact(TypeRef::EntityRef))], exact(TypeRef::Unit))],
        )
        .handlers_only(),
        function(
            "alive",
            Domain::Cpu,
            false,
            Milestone::M5,
            "Whether the entity reference points at a live entity.",
            vec![sig(&[p("target", exact(TypeRef::EntityRef))], exact(TypeRef::Bool))],
        ),
    ]
}
