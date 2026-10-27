# Mtek Language Reference — Materials, GPU Stages and Lighting (v0.1)

- Repository path: `spec/materials.md`
- Status: Normative for v0.1.
- Depends on: `spec/language.md`, `spec/scenes.md`, `spec/gpu-layout.md` (how params are laid out and uploaded), `spec/compiler-architecture.md` §7 (shader IR and WGSL emission).

---

## 1. Material declaration

```mtek
material Pulse {
    param tint: color = #6b5cff;
    param phase: f32 = 0.0;

    fragment(input: SurfaceInput) -> color {
        return color.linear(tint.rgb * pulse(phase), 1.0);
    }
}
```

A material is a module item with:
- zero or more `param` declarations (§2), then
- exactly one `fragment` stage (§3) and optionally one authored `vertex` stage (§3.5), in either order. A material without `fragment` is `E4020`; duplicate stages are `E2002`. Material-local compute stages are rejected (`E4901`); use bounded standalone programs described in `spec/compute.md`.

Materials are GPU programs plus a typed parameter interface. They have no state, no handlers and no CPU code.

## 2. Parameters

`param name: T [= default];`

- `T` must be **GPU-representable**: `bool`, `i32`, `u32`, `f32`, `vec2`, `vec3`, `vec4`, `mat4`, `quat`, `color`, a `struct` whose fields are all GPU-representable, or `array<T, N>` of a GPU-representable `T` — or one of the resource types `texture` and `sampler` (§5). Other types are `E4030`.
- A default must be a constant expression (`spec/language.md` §8.1) of type `T` (`E4031`). A param without a default must be supplied by every instance (`E5003`).
- Inside the material, params are read-only values in scope by name (`E3061` on assignment).
- **Colour alpha and translucency** (decision 0138, which retires `E5100` and `E5902`). A `color`-typed param takes any alpha, in a default, an instance constant, a write or a binding. While any colour param of an instance has an alpha below 1, its draw is *translucent* (§3.4). A fade is a binding on that alpha: `color: bind(color.linear(rgb, 1.0 - easing.in_quad(t)))`. A host input declared with the `color-hex-opaque` codec still rejects an alpha (`E8100`). Use `vec4` for non-colour four-component data.

Parameter storage is planned by the resource planner (`spec/gpu-layout.md`): value params form one **parameter block** per material instance; `texture`/`sampler` params become explicit resource bindings. **Params are never folded into shader code**, even when they never change: changing an instance value must never require a new shader or pipeline (blueprint §6.1, M3 exit gate).

## 3. The fragment stage

`fragment(name: SurfaceInput) -> color { … }`

- Exactly one parameter, of type `SurfaceInput`, any name; result type `color` (`E4021` otherwise).
- Effect level `pure`, with additional access to: the stage input, the material's params, and GPU-only intrinsics (`sample`, `sample_mip`, `lighting.pbr`, `lighting.pbr_mapped`).
- Everything reachable from it must satisfy GPU reachability (`spec/language.md` §8.4).
- **No captures.** Stage code cannot reference scene state, entity fields, `frame.*`, `self`, `cpu fn`s, handles other than its own texture/sampler params, or anything else outside its params and inputs (`E4040`, with a note: "to use `frame.time` in a material, add a param and bind it: `phase: bind(frame.time)`"). This is what makes transport explicit and inspectable.

### 3.1 `SurfaceInput`

| Field | Type | Meaning |
|---|---|---|
| `local_position` | `vec3` | Interpolated object-space position |
| `world_position` | `vec3` | Interpolated world-space position |
| `world_normal` | `vec3` | Interpolated world-space normal, **re-normalised** in the fragment wrapper |
| `uv` | `vec2` | Interpolated `TEXCOORD_0` |
| `world_tangent` | `vec4` | Interpolated world-space tangent xyz and handedness w; zero means unavailable (decision 0212) |

The compiler records which fields a material reads. The generated vertex stage outputs **only those** varyings; authored vertex reads (§3.5) may require additional mesh attributes (blueprint §7.2). Missing required normal/UV data is rejected at compile time for built-in and asset meshes (`E7010`). Tangents are optional: a shared zero frame selects derivative normal mapping when no source frame exists.

### 3.2 The generated wrapper

For each material the compiler generates (in WGSL, from shader IR — never from string templates of user logic):
- the standard vertex entry point: reads `position` (and `normal`, `uv` if used), computes `world = object.model * vec4(position, 1)`, `clip = frame.view_proj * world`, world normal `= normalize((object.normal_matrix * vec4(normal, 0)).xyz)`, and forwards the used `SurfaceInput` fields as interpolated varyings;
- the fragment entry point: reconstructs `SurfaceInput`, calls the user's `fragment` body (lowered to a WGSL function), and writes the result, alpha included, to colour target 0 (decision 0138). The canvas is opaque, so the alpha only matters for a translucent draw (§3.4). When the returned alpha is a constant other than 1.0 the compiler emits warning `W5101`: that alpha blends only while a colour param of the instance is translucent.

Bind groups, struct names and binding numbers are fixed by `spec/gpu-layout.md` §6.

### 3.3 The fixed vertex and varying interface (normative)

| Vertex attribute | `@location` | Format | Present when |
|---|---|---|---|
| `position` | 0 | `float32x3` | always |
| `normal` | 1 | `float32x3` | the fragment reads `world_normal` or the vertex stage reads `normal` |
| `uv` | 2 | `float32x2` | either stage reads `uv` |
| `tangent` | 11 | `float32x4` | the fragment reads `world_tangent` or the vertex stage reads `tangent`, unless supplied by the authored output |

Each attribute lives in **its own vertex buffer** (non-interleaved, `arrayStride` 12/12/8/16, `stepMode: "vertex"`). The pipeline's `buffers` array lists only the present attributes, in the order position, normal, uv, tangent; vertex-buffer slot `k` is the `k`-th present attribute (so for `Unlit`, slot 0 = position only). The runtime binds the mesh's matching buffers in that order. Instance matrices retain locations 3–10.

| Varying (vertex → fragment) | `@location` | Emitted when |
|---|---|---|
| `local_position` | 0 | read by the fragment |
| `world_position` | 1 | read by the fragment |
| `world_normal` | 2 | read by the fragment |
| `uv` | 3 | read by the fragment |
| `world_tangent` | 4 | read by the fragment |

Only the varyings the fragment reads are declared; vertex-only attribute reads do not add varyings, and the locations stay fixed so that pipeline layouts and span maps remain stable across edits.

### 3.4 Translucent draws (decision 0138)

A draw is translucent while a `color` param of its material instance has an alpha below 1 (§2). Translucent draws:
- are drawn after every opaque draw;
- are ordered back to front each frame by the **view-space depth** of their bounding-sphere centre (distance along the camera's view direction, so it holds for an orthographic projection too, where clip `w` is the same for every point); draws at equal depth keep draw-list order (decision 0173). There is no explicit layer: put sprites at different `z`;
- are not re-batched while that order does not change: a static translucent scene costs the same grouping work as an opaque one (decision 0173);
- blend straight alpha "over" what is behind them (`src·a + dst·(1 − a)`);
- test depth but do not write it;
- are never instanced.

Order is per object, not per triangle: intersecting translucent objects, or one concave translucent mesh, can show order artefacts. The blended pipeline of a material is made at scene start for every material known to blend then (`Sprite`, an instance whose initial colour alpha is below 1, and the instanced variant for an emitter's material); a material that turns translucent later gets it the first time one of its draws does, and until it exists, for a frame or two, the draw is opaque (decision 0173).

Particles (`particles`, `spec/scenes.md` §4.6) are drawn between the opaque pass and the translucent one. An emitter whose material is translucent (`Sprite`, a colour alpha below 1) draws with the blended instanced pipeline and no depth write; its particles are sorted back to front by view depth, and such emitters come after the opaque ones, back to front by their mean depth. They are not merged into the order of the translucent entities: a blended particle is hidden by a nearer translucent entity only through the blend order of the passes, not per object.

### 3.5 Authored vertex stage (decisions 0197–0198)

`vertex(input: VertexInput) -> vec3 { … }` returns a mesh-local position.
`VertexInput` has `position: vec3`, `normal: vec3`, `uv: vec2`, `tangent: vec4`. Alternatively the
result may be an ordinary user struct containing `position: vec3`, optional
`normal: vec3`, `uv: vec2` and `tangent: vec4`, plus scalar/vector payload fields. Output geometry
fields replace mesh values; omitted normal/UV fields retain them. Vertex reads
add to required mesh attributes independently of fragment varyings. Generated
normal/UV outputs remove the corresponding fragment-only mesh requirement.
Passing the whole input record to a helper requires all fields; tangent data may
be the unavailable zero frame. An authored vertex result without `tangent`
invalidates the original tangent frame and selects the derivative fallback.
Missing required asset data is `E7010`.

A fragment may take a second parameter of exactly the vertex output struct type:
`fragment(surface: SurfaceInput, data: MyVertexData) -> color`. Without a matching
structured vertex result this is `E4021`. All struct fields are forwarded when the
second parameter exists. Payload fields support f32/i32/u32/bool, float vectors,
color and quat; matrices, arrays, nested structs and CPU/resource values are
`E4021`. Float/color fields interpolate in perspective at pixel centers; integer,
boolean and quaternion fields take the first vertex's value. Surface varyings keep
locations 0–4; payload fields fill unused locations in declaration order. The
combined limit is 16 variables (`E6003`). Shader inspection lists the mapping.

Both stages are GPU roots with existing purity/capture rules. `sample` reads level
zero; implicit derivatives remain fragment-only (`E4042`). Skeletal deformation
precedes the authored function; model/instance and camera transforms follow it.
The result feeds clip position, fragment local/world positions and directional
shadow passes. Chosen normals pass through the object's inverse-transpose matrix
and are normalized for SurfaceInput; the custom payload keeps its local values.
Tangents use the model's linear transform and safe per-vertex normalization
before interpolation; handedness includes the determinant sign. Mapped PBR
re-orthogonalizes the interpolated frame against the final normal. A supplied
tangent must have unit xyz and w ±1, or be the zero unavailable marker.

No authored finite bound is available yet: camera-frustum rejection is skipped for
these draws, and sorting/inspection centers remain the original mesh centers.
Arbitrarily displaced translucent objects can therefore sort approximately.
[Decision 0198](decisions/0198-typed-vertex-outputs-and-varyings.md) specifies the full
IO contract; the [source examples](../examples/vertex-deformation/README.md) compare
geometry, normals, UVs, typed payloads and shadows with ordinary transforms.

## 4. Material instances

A material is used through an **instance descriptor** as an entity's `material` field:

```mtek
material: Pulse { tint: bind(tint); phase: bind(frame.time) };
material: Pulse { phase: 0.25 };            // tint uses its default
material: Unlit { color: #ff8800 };
```

- Every param without a default must be supplied; unknown/duplicate names are `E5001`/`E5002`; types are checked exactly (`E3102`, e.g. "Material parameter `phase` expects `f32`, but received `vec3`").
- A supplied value is either an expression evaluated **once** at instance construction (initialisation) or `bind(expr)` (a live dependency re-evaluated every frame, `spec/scenes.md` §10 phase 5). `phase: frame.time` and `phase: bind(frame.time)` therefore mean different things (blueprint §3.2): the first freezes the value at construction.
- Each entity's descriptor creates a **distinct instance with its own parameter storage**. Two instances never share mutable parameter storage. The runtime may share storage between instances whose every value is constant and never written, because that is unobservable (blueprint §6.3); it must count shared and unshared blocks separately in its counters. The M4 runtime does so (decision 0059, `spec/gpu-layout.md` section 8.2).
- Param values are readable and writable from handlers (`Cube.material.phase = 0.5;`) unless bound (`E5070`); texture and sampler params are construction-only (`E5073`, §5). This holds for the built-in `Unlit` and `Pbr` exactly as for user materials, also for the default `Unlit {}` of an entity with a `mesh`: their params are the prelude's (§9), with its names and types, and go through the same instances, update classes and `setParam` (decision 0087). Instance identity (`Cube.material = …`) is construction-only in v0.1 (`E5073`).

**Update classes** (recorded per param in the manifest and shown by `mtek inspect --bindings`):

| Class | Source | Uploaded |
|---|---|---|
| `initial` | default or constant initialiser, never written | once at creation |
| `imperative` | some handler writes it | in the render phase of a frame in which it was written |
| `bound` | `bind(expr)` | in the render phase when the evaluated bytes differ from the CPU mirror |
| `resource` | `texture`/`sampler` | bind group created at instance creation (resource params are construction-only in v0.1) |

## 5. Textures and samplers (M4)

- Param types `texture` and `sampler`. Values come from asset declarations (`spec/assets.md`: `asset.texture("…")`) and built-in constants: `texture.white()`, `texture.black()`, `sampler.linear_repeat()`, `sampler.linear_clamp()`, `sampler.nearest_repeat()`, `sampler.nearest_clamp()`.
- GPU intrinsic `sample(t: texture, s: sampler, uv: vec2) -> vec4` — returns the filtered texel. Textures declared with colour space `srgb` (the default for colour images) are created with an `-srgb` format, so `sample` returns linear values; `linear` textures are returned as stored.
- `texture` and `sampler` params may be used **only as direct arguments to `sample`** (`E4041` for any other use, including passing them to user functions), which keeps lowering to WGSL handle variables trivial.
- Mip-maps are not generated in v0.1 (one level); documented limitation, measured in the runtime benchmark. `sample` therefore reads level 0 explicitly (`textureSampleLevel`), which is also valid in non-uniform control flow.
- A material has at most 16 `texture` and `sampler` params together (`E6002`, reported by `check`), and a resource is a param of its own, never an element of an array or a field of a struct (`E4030`). Resource params are construction-only: assigning one is `E5073` and binding one `E5004`.
- Built-in textures are 1×1 and opaque, `texture.white()` `(1, 1, 1, 1)` and `texture.black()` `(0, 0, 0, 1)`; the samplers are filtering samplers (`linear_*` or `nearest_*` filtering, `*_repeat` or `*_clamp` addressing). How they are lowered, bound and created, and the `test.textures` control a test uses to sample a generated texture before asset textures exist, are decision 0054.

`sample_mip(texture, sampler, uv)` selects mip levels from screen derivatives. It and
`lighting.pbr_mapped` must appear in a fragment's initial straight-line prefix,
before branches, loops, matches, nested blocks or short-circuit expressions
(`E4042`); they cannot be called inside user helpers. Evaluate texels first and
use the values in conditional code. `sample` retains its level-zero behavior.
Each sampler preset has a `_level0` variant; linear presets add `_mip_nearest`,
and nearest presets add `_mip_linear`. GLB import preserves the requested mip
filter. See [decision 0194](decisions/0194-gltf-material-channels.md).

## 6. Colour pipeline

- All shading is in linear space (`spec/language.md` §5.4).
- The render target is written through an sRGB view (`spec/runtime-abi.md` §8.2), so the hardware performs the linear→sRGB encode. Lit materials apply the camera's exposure (§8 rule 9) before the output. There is **no tone mapping** in v0.1: linear values above 1.0 clip. This is documented and visible in tests (a light of high intensity saturates).
- Opaque draws use depth test `less` and depth writes; translucent draws follow §3.4. Back-face culling uses counter-clockwise front faces (glTF convention). All built-in meshes are generated counter-clockwise when viewed from outside.

## 7. Lights (components, M4)

Lights are components on **named** entities only in v0.1 (a `light` in a prefab is `E5110`), so the light count is static.

| Component | Fields | Direction / position |
|---|---|---|
| `DirectionalLight` | `color: color = #ffffff`, `intensity: f32 = 1.0` (illuminance, lux) | travels along the entity's world `-Z` axis (rotate the entity to aim it) |
| `PointLight` | `color: color = #ffffff`, `intensity: f32 = 1.0` (luminous intensity, candela), `range: f32 = 0.0` (`0` = unlimited) | at the entity's world position |

`color` and `intensity` are writable and bindable, and a binding may read them (decision `spec/decisions/0067-light-bindings-and-hot-reload.md`: they are binding dependencies, and a hot reload keeps or applies them by their update class). At most **4** lights per scene in v0.1 (`E5111` at compile time); the limit is a constant in the frame/view block layout (`spec/gpu-layout.md` §6.1). Shadows are not in v0.1. How lights are checked, written, bound and packed into `MtekFrame` each frame is decision `spec/decisions/0053-lights.md`.

## 8. Lighting model: the documented PBR subset (M4)

The built-in `Pbr` material and the GPU intrinsic `lighting.pbr(surface: SurfaceInput, base_color: color, metallic: f32, roughness: f32) -> color` implement exactly the following. The runtime test-suite contains a CPU reference implementation of the same formulas (`spec/testing.md` §6.4); images are compared against it with tolerances, so these formulas are a test oracle, not just documentation. How the model is lowered to WGSL (one generated helper over `mtek_frame`), which `SurfaceInput` fields a call reads, where binary32 evaluation needs a guard, and the measured agreement with the oracle are decision `spec/decisions/0057-pbr-lighting.md`. Rules 2, 3, 5, 6, 7 and 8 follow the glTF Sample Renderer and `KHR_lights_punctual` with physical light units since decision `spec/decisions/0080-pbr-gltf-alignment.md`.

Notation: `N` = normalised world normal; `V = normalize(camera_position − world_position)`; for each light, `L` = unit vector from the surface towards the light, `H = normalize(L + V)`; `NL = max(dot(N, L), 0)`, `NV = max(dot(N, V), 1e-4)`, `NH = max(dot(N, H), 0)`, `VH = max(dot(V, H), 0)`; `c = base_color.rgb`.

1. Roughness: `r = clamp(roughness, 0.045, 1.0)`, `α = r²`. Metallic: `m = clamp(metallic, 0.0, 1.0)`.
2. Distribution (GGX / Trowbridge-Reitz): `D = α² / (π · f²)` with `f = (1 − NH²) + NH² · α²`. (This is the same value as `NH² · (α² − 1) + 1`, written so that it does not cancel at `NH ≈ 1` when `α²` is small; implementations use this form.)
3. Visibility (height-correlated Smith-GGX): `Vis = 0.5 / (NL · sqrt(NV² · (1 − α²) + α²) + NV · sqrt(NL² · (1 − α²) + α²))`; if the denominator is `0`, `Vis = 0`. Under the clamps of rule 1 and the notation (`NV ≥ 1e-4`, `α ≥ 0.002025`) the denominator is at least `2.025e-7`, so the zero case is **unreachable**; it is kept as a guard only.
4. Fresnel (Schlick): `F0 = mix(vec3(0.04), c, m)`; `F = F0 + (1 − F0) · (1 − VH)⁵`. The dielectric Fresnel is `F_d = 0.04 + 0.96 · (1 − VH)⁵` (a scalar).
5. Specular `= D · Vis · F`. Diffuse `= (1 − m) · (1 − F_d) · c / π`. (Together this is glTF's `mix(dielectric_brdf, metal_brdf, m)` exactly.)
6. Radiance of a directional light: `E = light.color.rgb · intensity`. Of a point light at distance `d`: `E = light.color.rgb · intensity / max(d², 1e-4) · w`, with `w = 1` if `range = 0`, else `w = clamp(1 − (d / range)⁴, 0, 1)` (the `KHR_lights_punctual` window, not squared).
7. Result: `rgb = Σ_lights (Diffuse + Specular) · E · NL + (1 − m) · c · ambient_color.rgb · ambient_intensity`; alpha is the supplied base colour's alpha (decision 0210). A metal receives no diffuse ambient. Lighting, occlusion, emission and exposure affect RGB only; alpha is straight, not premultiplied.
8. No `NaN`: a light's term is exactly `0` when `NL ≤ 0`, and when `L + V = 0` (no half vector, reachable with `NL > 0` only for a back-facing normal). Implementations must test both before forming `H = normalize(L + V)`.
9. Exposure: the result `rgb` of rule 7 is multiplied by the active camera's exposure scale `1 / (1.2 · 2^EV100)`, where EV100 is `Camera.exposure` (`spec/scenes.md` §3, decision `spec/decisions/0081-camera-exposure.md`). Light intensities stay physical (lux, candela); the default exposure (`-log2(1.2 · π)`, scale `π`) maps a white Lambertian surface under 1 lux to `1.0`.

These direct-lighting formulas are extended by mapped emissive/occlusion/normal inputs (decision 0194) and optional scene shadows/environment lighting (decision 0195). Clear-coat remains unsupported. A call `lighting.pbr(input, …)` reads `world_position` and `world_normal` of the stage input (§3.1), and nothing else of it.

## 9. Built-in materials (prelude, written in Mtek)

Built-in materials are ordinary Mtek source in the embedded prelude (`std/materials.mtek` inside the compiler), compiled by the same pipeline as user materials. This keeps them inspectable and proves the language can express them.

```mtek
export material Unlit {
    param color: color = #ffffff;
    fragment(surface: SurfaceInput) -> color { return color; }
}

export material Pbr {
    param base_color: color = #ffffff;
    param metallic: f32 = 0.0;
    param roughness: f32 = 0.5;
    param base_color_texture: texture = texture.white();
    param base_color_sampler: sampler = sampler.linear_repeat();
    param metallic_roughness_texture: texture = texture.white();
    param metallic_roughness_sampler: sampler = sampler.linear_repeat();
    param normal_texture: texture = texture.white();
    param normal_sampler: sampler = sampler.linear_repeat();
    param occlusion_texture: texture = texture.white();
    param occlusion_sampler: sampler = sampler.linear_repeat();
    param emissive_texture: texture = texture.white();
    param emissive_sampler: sampler = sampler.linear_repeat();
    // Zero disables normal mapping for the neutral white fallback. GLB imports set
    // this to the file's normalTexture.scale (default 1) when a normal map exists.
    param normal_scale: f32 = 0.0;
    param occlusion_strength: f32 = 1.0;
    param emissive: color = #000000;
    fragment(surface: SurfaceInput) -> color {
        let texel = sample_mip(base_color_texture, base_color_sampler, surface.uv);
        let albedo = color.linear(base_color.rgb * texel.xyz, base_color.a);
        let mr = sample_mip(metallic_roughness_texture, metallic_roughness_sampler, surface.uv);
        let normal = sample_mip(normal_texture, normal_sampler, surface.uv).xyz;
        let ao = sample_mip(occlusion_texture, occlusion_sampler, surface.uv).x;
        let emissive_texel = sample_mip(emissive_texture, emissive_sampler, surface.uv).xyz;
        let emission = emissive.rgb * emissive_texel;
        return lighting.pbr_mapped(surface, albedo, metallic * mr.z, roughness * mr.y, normal, normal_scale, 1.0 + clamp(occlusion_strength, 0.0, 1.0) * (ao - 1.0), emission);
    }
}
```

The param named `color` in `Unlit` relies on the rule in `spec/language.md` §4.2: a material param may share a prelude type's name; inside `Unlit`, `color` in expression position is the param, `color` in type position is the type, and `color.linear(…)` would be `E2005` (the prelude does not use it). (M1 provided `Unlit` through a minimal compiler-built shader IR; since M2 it is compiled from this source, and the temporary path is gone, decision 0044.) `Pbr` is compiled from this source too since task M4-03 (decision 0057).

`Pbr` follows [decision 0194](decisions/0194-gltf-material-channels.md): sampled
blue multiplies metallic, green multiplies roughness, and red supplies occlusion.
Base and emissive textures are sRGB; the other maps are linear data. Occlusion
scales ambient light only; emission is added before exposure. Normal mapping
uses an authored tangent frame when available (decision 0212), otherwise a
derivative cotangent frame with geometric-normal fallback for degenerate UVs.
No MikkTSpace tangent generator is provided. Directly
assigned normal maps need `normal_scale` (default zero); GLB imports use the
file's scale, default one.

### 9.1 Sprites and the 2D camera (decision 0170)

`Sprite` is a built-in material in `std/materials.mtek`, written in Mtek like `Unlit`. It shows one cell of a sprite sheet: a texture of `columns` × `rows` equal cells, numbered from 0 left to right, then top to bottom. Its params are:

- `sheet` (`texture`, default `texture.white()`);
- `sheet_sampler` (default `sampler.nearest_clamp()`, for crisp pixels);
- `tint` (`color`, default white; multiplies the texel, alpha included);
- `cell` (`f32`, default `0.0`): floored and wrapped modulo `columns · rows`, so `cell: bind(t * 8.0)` plays the sheet at 8 cells per second and loops;
- `columns` and `rows` (`f32`, default `1.0`): a constant outside `1..64` is `E5701`. A run-time value is floored and held to `1..64` by the fragment stage, so a write of `0` or a negative number never divides by zero (decision 0170 §4, made true by decision 0173).

A `Sprite` draw is **always translucent** (§3.4), so transparent texels show what is behind them.

A sprite is a `Plane` turned to face `+Z`: `mesh: Plane { size: vec2(w, h) }; rotation: quat.euler(1.5707964, 0.0, 0.0);`. With that rotation the top of the sheet is at `+Y`.

The 2D camera preset is a camera on `+Z` looking down `-Z` with `projection: Orthographic { height: H }`: one world unit is `canvas height / H` pixels, `x` goes right and `y` goes up. Sprites at different `z` are ordered back to front by the translucent pass by their depth along the view direction (decision 0173), so a sprite nearer the camera is drawn over a farther one whatever order they are declared in.

Authored finite spheres are available through entity/prefab `bounds_center` and
`bounds_radius` (decision 0199). Positive radii must enclose the final result after
skinning and vertex deformation; zero retains conservative authored visibility.
These fields can bind to the same state or drive material params through binding
dependencies. They do not prove that a shader respects its enclosure.

## 10. Not in v0.1

Material-local compute stages (standalone programs use `spec/compute.md`); multiply blending and per-triangle sorting of translucent draws; point/cascaded shadows; multiple render targets; material inheritance; texture params written at run time; general derivatives (`dpdx`); unrestricted storage buffers, texture arrays and cube maps.

The host runtime provides additive material selection and ordered custom WGSL LDR
post effects through `MtekMountOptions.rendering` (decision 0193). Image asset textures
receive complete mip chains on WebGPU, averaged in linear light. These do not add
custom shader stages. Decision 0194 adds mapped PBR channels and mip-aware sampling
functions. Host rendering options add directional shadows and HDR panorama IBL
(decision 0195). HDR display/post targets, tone mapping and sky backgrounds remain
unsupported. The scene-lighting group reserves three textures/two samplers: lit
materials may declare at most thirteen textures/fourteen samplers, with the existing
combined resource limit of sixteen.
