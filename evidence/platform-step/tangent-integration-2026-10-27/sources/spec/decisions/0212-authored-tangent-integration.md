# 0212 — Authored tangent import and material integration

Status: Implemented; broader validation and software product comparison remain in progress. Date: 2026-10-27.
Extends 0015, 0058, 0194 and [0211](0211-tangent-frame-deformation.md).

Preserve original tangent-bearing assets rather than stripping their frames or
replacing them with generated derivative data. The unchanged Khronos WaterBottle
is the production-product acceptance case; mathematical calibration fixtures
separately distinguish the authored frame from a derivative or incorrectly
transformed frame.

## Asset data

The GLB profile accepts optional FLOAT/VEC4 `TANGENT` with the POSITION count,
finite components, normalized xyz (absolute squared-length error at most 0.001)
and w exactly -1 or +1. Invalid direction/handedness is E7027, naming the first
invalid vertex; accessor format/count/range/nonfinite errors retain E7007/E7025.
This strict profile requires NORMAL when TANGENT exists (E7010). Other UV sets,
vertex colours, compressed attributes, morphs and other existing import limits
are unchanged. A missing tangent stream is valid and selects the existing
derivative frame; no MikkTSpace tangent generator is added.

Packed mesh data adds optional `tangent` metadata/offset, with 16 bytes per vertex
after UVs and before indices. The source streams retain their exact binary32
values and handedness. Manifest/schema/runtime validation includes the stream's
extent and normal dependency. Old packages without it remain valid development
ABI 1 packages. A new renderer can consume old shaders; an old renderer is not
expected to understand a new tangent-bearing shader. No stable-release promise
is introduced.

## Source and shader interface

`VertexInput.tangent: vec4` is the skinned mesh-local frame, or the all-zero
unavailable marker when the mesh has no authored frame. It is optional data;
normal/UV attributes retain their existing required-attribute rules. Structured
vertex output may supply `tangent: vec4`, with unit xyz and w ±1, or the zero
marker. An authored vertex stage without a tangent result invalidates the source
frame and selects the derivative fallback. This avoids using a stale frame after
arbitrary position/normal/UV deformation. Authors remain responsible for the
validity of values computed in their shaders, as for authored normals.

The tangent attribute is `float32x4` at vertex location 11. Existing position,
normal and UV locations 0–2 and instance-matrix locations 3–10 remain unchanged.
`SurfaceInput.world_tangent: vec4` occupies varying location 4: interpolated
world tangent xyz, plus handedness. The vertex wrapper uses the model matrix's
linear part, safely normalizes each vertex direction before interpolation, and
multiplies w by determinant sign. Interpolation can change its length. PBR
re-orthogonalizes against the final normal, normalizes, and reconstructs the
bitangent from cross(normal,tangent) and handedness. Public entity scale rules
remain positive; reflection arithmetic is independently tested in 0211's
deformation matrices and mirrored UV frames retain their imported sign.

Mapped PBR prefers a usable authored frame; otherwise it retains its derivative
cotangent/geometric-normal fallback. Derivatives run unconditionally before frame
selection, preserving WGSL uniformity validation. Normal-map XY scale, colour
spaces, exposure, PBR alpha and other channel semantics remain unchanged. Typed
payloads use unoccupied varying locations; surface plus payload still has a
16-variable bound.

## Runtime ownership and acceptance

Original streams are shared per immutable mesh. Skin outputs are owned by a pose
cohort and depend on whether the consumer requires normals/tangents. Position-
and normal-only consumers avoid tangent deformation/output allocation. Authored
tangent skinning uses 0211's eight-binding variant. Missing-frame streams use a
zero-initialized 16-byte-per-vertex fallback buffer, shared with the source mesh;
no CPU array or per-frame fallback upload is required. These allocations must be
included in measurements. Scene disposal and recovery rebuild/retire the same
owners; no buffer ownership crosses the public host API.
The compute position-only bridge retains the original normal/UV/tangent streams;
its existing host obligation to preserve their validity also applies to tangents.

Acceptance requires independent rendered normal/BRDF references for imported,
mirrored, degenerate-UV, nonuniform-transform, actual GPU-skinned, authored and
fallback cases, instance transforms, recovery and resource retirement. Each case
must distinguish a stated incorrect frame beyond its pixel tolerance. The
unchanged WaterBottle must retain source geometry/tangents/textures and original
node rotation in both engines, pass the predeclared visual gates at both quality
levels, and show a visible normal-map contribution in independent same-engine
controls. Package budgets, old-package/derivative behavior, compiler/tooling and
broader rendering regressions remain required. Qualified performance and the
rest of the platform plan remain separate open requirements.
