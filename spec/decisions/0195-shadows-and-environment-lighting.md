# 0195. Directional shadows and HDR environment lighting

Date: 2026-10-25. Amends 0057, 0080, 0193 and 0194. Final validation is tracked in
[the implementation record](../../evidence/platform-step/lighting-progress.md).

## Host contract and compatibility

`MtekMountOptions.rendering` adds optional `shadows` and `environment` settings.
They are opt-in, independent of each other, and apply to `Pbr`, `lighting.pbr`
and `lighting.pbr_mapped`. Unlit materials retain their existing output. Host
options supply scene resources; this introduces no new language declaration.

The compiler marks lit shaders with `lighting: 1`, the version of the private
scene-lighting binding group. Absent, the runtime uses the older three-group
pipeline and allocates no scene-lighting group. Current runtimes accept older
compiled programs. New lit programs require the current embedded runtime; an
older runtime rejects their additional shader metadata instead of misbinding it.
Requesting new lighting options on a program without the interface reports
`E8051` with an explanation to rebuild a scene containing a lit material.
Unknown interface versions are rejected by the manifest schema.

Scene-lighting group 3 is fragment-visible:

| Binding | Resource |
|---|---|
| 0 | 256-byte uniform `MtekSceneLighting` |
| 1 | `texture_depth_2d` shadow map |
| 2 | `sampler_comparison` |
| 3 | Filterable `texture_cube<f32>` of prefiltered linear RGBA16F radiance |
| 4 | Filtering sampler (linear texel and mip interpolation, clamped) |
| 5 | RGBA16F two-channel BRDF lookup texture |

Uniform layout: shadow matrix @0 (64 bytes); shadow parameters @64, shadow filter
@80 and environment parameters @96 (one vec4 each); nine SH vec4s @112 (144 bytes).
The matrix transforms world positions into the orthographic light clip space.
Shadow parameters hold packed light index plus one (zero disables shadows), depth
bias and geometric-normal offset. Filter parameters hold reciprocal resolution and
PCF radius. Environment parameters hold intensity, cosine/sine of yaw and the
largest prefilter LOD. Unused lanes are zero.

Lighting reserves three sampled textures and two samplers of the default per-stage
limits. Lit materials may therefore declare at most thirteen textures and fourteen
samplers, while the combined material-resource limit remains sixteen. The checker
propagates lighting use through the whole function graph, including imports, and
reports `E6002` before packaging. Non-lit shaders retain the existing limits.
The runtime also validates externally supplied manifests against the reservation.

## Directional shadows

`shadows.light` uniquely names a directional-light entity, by name or full symbol.
Ambiguous, absent and point-light names fail startup with an actionable `E8051`.
One directional map is supported per scene; point shadows and cascades are not.

The host configures a fixed world-space volume: `center` (default `[0,0,0]`), square
`size` (20), light-camera `distance` (20), `near` (0.1) and `far` (40). The camera
looks from `center - direction * distance` toward `center`; direction is the light's
current normalized world minus-Z axis, including parents. Settings must be finite
and representable in f32, sizes/distances positive, and far greater than near.
This is an explicit volume, not automatic scene fitting or a camera cascade.

Quality presets:

| Quality | Map resolution | Comparison taps |
|---|---|---|
| low | 512 square | 1 |
| medium (default) | 1024 square | 9 (3 x 3 PCF) |
| high | 2048 square | 25 (5 x 5 PCF) |

The map is depth32float, cleared to one; triangle-list casters use CCW fronts,
back-face culling, depth writes and `less` testing. Every live, visible, opaque
entity with geometry casts, regardless of camera culling. Skinned casters use
their current deformed positions, including actors culled by the camera. Casters
are currently submitted individually; this is not a crowd-shadow optimization.
Translucent/additive draws and particle billboards do not cast opacity shadows.

Receivers are offset along their geometric world normal by `normalBias` (0.01
world units), transformed by the light matrix, then compared at `z - bias`
(`bias` defaults to 0.001 in light depth units). Clip X/Y become top-left UV;
positions outside the volume are lit. PCF uses nearest comparison sampling and
clamped edge addressing. `textureSampleCompareLevel` needs no implicit derivatives,
so it is legal in the per-light conditional. Visibility scales only the selected
directional light's direct diffuse/specular contribution; it does not darken
ambient, environment or emissive terms. The map is regenerated each rendered frame.

## Environment lighting and colour

An environment is a host-supplied linear RGBA Float32Array panorama, top row at
+Y, longitude zero along +X and increasing toward +Z. Dimensions are positive
integers, at most 4096 x 2048; data length is width x height x four. Components
must be finite, nonnegative and at most 65504, the retained RGBA16F range. Alpha
does not affect illumination. Pixel data and shadow coordinates are copied at
mount so later host mutations do not alter recovery or program replacement.
No network fetch occurs implicitly. A host may use its declared asset loader.

`decodeRadiance(bytes)` is an independent RGBE decoder for flat pixels and modern
scanline RLE, with Y-major positive/negative X/Y orientation. It checks dimensions,
scanline lengths, run bounds and truncation before unsafe allocation/indexing.
Legacy RGBE repeat markers and XYZE are explicitly unsupported. Pixel decoding
does not apply colour-primary, exposure or colour-correction header metadata;
the host supplies scene-linear RGB and controls the lighting scale.

`intensity` defaults to one and `rotation` to zero radians of panorama yaw. A zero
intensity suppresses IBL; it does not disable ordinary scene ambient lighting.
Panorama sampling wraps longitude, clamps latitude and bilinearly filters linear
components. The diffuse representation is nine real SH coefficients convolved
with Lambert's cosine kernel and divided by pi (band factors 1, 2/3 and 1/4).
Negative reconstructed diffuse radiance is clamped to zero.
Large inputs are reduced onto the SH integration grid by summing each texel's
linear radiance times its exact latitude-band solid angle. This preserves tiny
bright HDR features between grid samples. Basis functions are evaluated on the
small grid, limiting the full-resolution preprocessing work to a linear scan.

The GPU converts the panorama into a cubemap with roughness-prefiltered GGX mips.
At level zero it samples the panorama directly; other levels importance-sample
GGX with N = V = reflection direction and normalize by accumulated N dot L.
Quality controls cube size/sample count: low 64/32, medium 128/64, high 256/128.
The mip roughness is `level / (levels - 1)` and shading selects
`perceptualRoughness * (levels - 1)`, with linear mip interpolation. The input
panorama is unfilterable RGBA32F; explicit texel loads implement wrapped bilinear
sampling without requiring `float32-filterable`.

A 64-square BRDF LUT integrates correlated Smith-GGX with 256 Hammersley samples
per texel, retaining the two split-sum factors A and B. This uses the same GGX
distribution/visibility definition as direct PBR. Specular IBL is filtered radiance
times `(F0 * A + B)`. Diffuse is reconstructed SH times base colour, `(1-metallic)`
and one minus roughness-aware view Fresnel. The Fresnel power clamps its base to
zero to avoid undefined `pow` for a rounded dot product slightly above one.
This is a finite-resolution split-sum approximation, not a path-traced reference.

The environment term joins ambient before occlusion and emission: mapped occlusion
affects both ambient and IBL, never direct light. Emission is added afterwards, and
camera exposure scales the final lit radiance. Rendering still writes to the LDR
linear/sRGB surface: HDR input/preprocessing does not add tone mapping, HDR display,
HDR intermediate post targets or a sky background.

## Lifecycle, measurement and source mapping

All preprocessing is queued before scene draws. Transient GPU inputs and compute
objects are retired after submission; retained maps, samplers, uniforms and groups
are disposed with their scene. Device recovery regenerates them from the retained
CPU panorama and settings. Startup validation failures unwind partially allocated
lighting resources. Hot reload reuses compatible immutable binding layouts while
rebuilding scene-owned lighting resources.

The shadow pass precedes colour in the same frame encoder. When timestamp queries
are available, the start is written at shadow-pass begin and the end at colour-pass
end. Post effects and separate skinning/preprocessing submissions are outside that
interval. Draw-call counters include shadow draws. These scopes must be stated in
any performance comparison; correctness probes are not performance benchmarks.

Expanded helper code must not inflate package metadata needlessly. On WGSL lines
whose mappings all have the same original span/symbol, exported source maps union
overlapping or adjacent intervals. Mixed-source lines, ties between different
sources and uncovered gaps are retained. Per-position source lookup is unchanged;
the compiler retains its original detailed map internally. A regression checks
every position of a mixed example before and after compaction.

## Evidence and remaining work

The final retained GPU run passes 64 checks across RX 7900 XTX and SwiftShader
on one Windows computer. It covers all quality levels, off-camera rigid and
animated casters, timestamp-enabled rendering, environment direction/roughness,
a separate numerical hemisphere integral, recovery, disposal and the studio UI.
The [implementation record](../../evidence/platform-step/lighting-progress.md)
links the reports and regression results. No multi-device tier, matched Three.js
parity or speed claim follows from these checks.

Algorithm context: [Khronos glTF IBL Sampler](https://github.com/KhronosGroup/glTF-IBL-Sampler)
uses Lambertian/GGX environment prefiltering and a split-sum LUT. This implementation
uses its own WGSL and a diffuse SH approximation; it does not import those assets
or claim identical output to the Sample Viewer.
