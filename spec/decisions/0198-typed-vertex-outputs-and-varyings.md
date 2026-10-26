# 0198: Typed vertex outputs and fragment payloads

Status: accepted, 2026-10-26. Extends decision 0197; its `vec3` result remains valid.
[Decision 0199](0199-authored-deformation-bounds.md) adds finite authored bounds.

## Source contract

An authored vertex function may return an ordinary named Mtek struct. It must
contain `position: vec3` in mesh-local coordinates. Optional `normal: vec3` and
`uv: vec2` fields replace the corresponding mesh values; omitted fields preserve
them. The vertex function runs after skinning. Model/instance transforms then
apply to position; the object's inverse-transpose normal matrix applies to the
chosen normal. The fragment wrapper normalizes `SurfaceInput.world_normal`.

Other output fields may be `f32`, `i32`, `u32`, `bool`, `vec2`, `vec3`, `vec4`,
`color` or `quat`. Nested structs, arrays, matrices and CPU/resource types are
rejected with source diagnostic `E4021`. A malformed geometry field is also
`E4021`. Helpers and imported struct/material declarations retain normal nominal
type identity and GPU effect rules.

A fragment may declare a second parameter of exactly that output struct type:

```mtek
struct VertexData { position: vec3; normal: vec3; uv: vec2; heat: f32; tag: u32; }
material Surface {
    vertex(input: VertexInput) -> VertexData {
        return VertexData { position: input.position; normal: input.normal;
            uv: input.uv; heat: input.uv.x; tag: u32(7) };
    }
    fragment(surface: SurfaceInput, data: VertexData) -> color {
        return color.linear(vec3(surface.uv.x, data.heat, f32(data.tag) * 0.1), 1.0);
    }
}
```

The first parameter remains `SurfaceInput`. Without a second parameter, output
geometry fields still apply but no custom payload is forwarded. With one, every
output field is forwarded, including geometry fields; there is no field-read
pruning of that payload yet. The payload's positions/normals remain local values;
its `normal` field is ordinary interpolated `vec3`, unlike the normalized world
normal in `SurfaceInput`.

## Linkage and interpolation

Surface varyings keep their existing locations 0–3. Payload fields take the lowest
unused locations in declaration order. Surface and payload fields together may
use at most 16 variables. More produce `E6003` before shader generation. Locations
stay below 16 even when there are holes in the SurfaceInput interface.

| Mtek payload type | Interpolation |
|---|---|
| `f32`, float vectors, `color` | Perspective-correct at pixel centers |
| `i32`, `u32`, `bool` | Flat, first vertex |
| `quat` | Flat, first vertex; interpolation must not silently violate unit-quaternion semantics |

Booleans use the existing stored `u32` representation and decode back to bool in
fragment expressions. Quaternions use their stored `vec4<f32>` with flat
interpolation. Users who need interpolated component data can use `vec4`.
These mappings use the [WGSL interpolation rules](https://www.w3.org/TR/WGSL/#interpolation).
Other interpolation modes and explicit source location annotations are not exposed.

The same IO struct declares both stage interfaces, so location/type/interpolation
linkage cannot drift. Shader inspection lists each payload's source type, WGSL
type, location and interpolation. Existing one-parameter fragments and vec3-return
vertices preserve their shader bytes.

## Attributes, runtime and evidence

Mesh normal/UV attributes are required when the vertex body reads them, or when a
fragment needs them and the vertex output does not supply them. A shader that
generates UVs/normals can consume a mesh without those attributes; the compiler
still reports `E7010` for required missing data. Whole VertexInput uses remain
conservative and require every input field.

Runtime bindings and `vertexDeformation: 1` are unchanged. Structured outputs and
payloads live entirely within the shader module. Both ordinary and instanced
entries and the existing authored shadow path use the chosen geometry outputs.
Conservative culling remains in place until authored finite bounds are defined.

The structured example compares rotation, normal and UV updates and typed payloads
with an ordinary transform reference. Its integer/boolean/quaternion values differ
between triangle vertices, testing the flat rule as well as smooth float/color
data. CPU checks cover imported outputs and generated attributes, nominal
mismatches, unsupported fields, exact slot limits, WGSL/source maps and inspection.
Bounded device recovery with nondefault uniforms and repeated cross-profile
replacement are verified on the desktop hardware/software backends. Combined
skinned/recovery checks, wider physical-device evidence, finite bounds and
authored compute remain required work in the platform plan.
