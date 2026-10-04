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
- exactly one stage function, `fragment` (§3). A material without `fragment` is `E4020`. A `vertex` or `compute` member is `E4901` ("custom vertex and compute stages are planned for v0.2").

Materials are GPU programs plus a typed parameter interface. They have no state, no handlers and no CPU code.

## 2. Parameters

`param name: T [= default];`

- `T` must be **GPU-representable**: `bool`, `i32`, `u32`, `f32`, `vec2`, `vec3`, `vec4`, `mat4`, `quat`, `color`, a `struct` whose fields are all GPU-representable, or `array<T, N>` of a GPU-representable `T` — or one of the resource types `texture` and `sampler` (§5). Other types are `E4030`.
- A default must be a constant expression (`spec/language.md` §8.1) of type `T` (`E4031`). A param without a default must be supplied by every instance (`E5003`).
- Inside the material, params are read-only values in scope by name (`E3061` on assignment).
- **Opaque colours.** Every `color`-typed param must hold an opaque colour (alpha exactly `1.0`) in v0.1: a constant default or instance constant with another alpha is `E5100`; a run-time value with another alpha (from a write, a binding or a host input) is rejected (`E8100`; the previous value stays). Use `vec4` for non-colour four-component data. Transparency is not part of v0.1 (`E5902` where it is requested explicitly).

Parameter storage is planned by the resource planner (`spec/gpu-layout.md`): value params form one **parameter block** per material instance; `texture`/`sampler` params become explicit resource bindings. **Params are never folded into shader code**, even when they never change: changing an instance value must never require a new shader or pipeline (blueprint §6.1, M3 exit gate).

## 3. The fragment stage

`fragment(name: SurfaceInput) -> color { … }`

- Exactly one parameter, of type `SurfaceInput`, any name; result type `color` (`E4021` otherwise).
- Effect level `pure`, with additional access to: the stage input, the material's params, and GPU-only intrinsics (`sample`, `lighting.pbr`).
- Everything reachable from it must satisfy GPU reachability (`spec/language.md` §8.4).
- **No captures.** Stage code cannot reference scene state, entity fields, `frame.*`, `self`, `cpu fn`s, handles other than its own texture/sampler params, or anything else outside its params and inputs (`E4040`, with a note: "to use `frame.time` in a material, add a param and bind it: `phase: bind(frame.time)`"). This is what makes transport explicit and inspectable.

### 3.1 `SurfaceInput`

| Field | Type | Meaning |
|---|---|---|
| `local_position` | `vec3` | Interpolated object-space position |
| `world_position` | `vec3` | Interpolated world-space position |
| `world_normal` | `vec3` | Interpolated world-space normal, **re-normalised** in the fragment wrapper |
| `uv` | `vec2` | Interpolated `TEXCOORD_0` |

The compiler records which fields a material reads. The generated vertex stage outputs, and the vertex layout requires, **only those** (blueprint §7.2). A mesh that lacks an attribute a material reads is rejected: at compile time for built-in and asset meshes whose attributes are known (`E7010`), never by substituting zeros.

### 3.2 The generated wrapper

For each material the compiler generates (in WGSL, from shader IR — never from string templates of user logic):
- the standard vertex entry point: reads `position` (and `normal`, `uv` if used), computes `world = object.model * vec4(position, 1)`, `clip = frame.view_proj * world`, world normal `= normalize((object.normal_matrix * vec4(normal, 0)).xyz)`, and forwards the used `SurfaceInput` fields as interpolated varyings;
- the fragment entry point: reconstructs `SurfaceInput`, calls the user's `fragment` body (lowered to a WGSL function), and writes `vec4(result.rgb, 1.0)` to colour target 0. **Alpha is always written as 1.0** in v0.1 (blueprint §4.2); returning a fractional alpha does not enable blending. When the returned alpha is a constant other than 1.0 the compiler emits warning `W5101`.

Bind groups, struct names and binding numbers are fixed by `spec/gpu-layout.md` §6.

### 3.3 The fixed vertex and varying interface (normative)

| Vertex attribute | `@location` | Format | Present when |
|---|---|---|---|
| `position` | 0 | `float32x3` | always |
| `normal` | 1 | `float32x3` | the material reads `world_normal` |
| `uv` | 2 | `float32x2` | the material reads `uv` |

Each attribute lives in **its own vertex buffer** (non-interleaved, `arrayStride` 12/12/8, `stepMode: "vertex"`). The pipeline's `buffers` array lists only the present attributes, in the order position, normal, uv; vertex-buffer slot `k` is the `k`-th present attribute (so for `Unlit`, slot 0 = position only). The runtime binds the mesh's matching buffers in that order.

| Varying (vertex → fragment) | `@location` | Emitted when |
|---|---|---|
| `local_position` | 0 | read by the material |
| `world_position` | 1 | read by the material |
| `world_normal` | 2 | read by the material |
| `uv` | 3 | read by the material |

Only the varyings the material reads are declared; the locations stay fixed so that pipeline layouts and span maps remain stable across edits.

## 4. Material instances

A material is used through an **instance descriptor** as an entity's `material` field:

```mtek
material: Pulse { tint: bind(tint); phase: bind(frame.time) };
material: Pulse { phase: 0.25 };            // tint uses its default
material: Unlit { color: #ff8800 };
```

- Every param without a default must be supplied; unknown/duplicate names are `E5001`/`E5002`; types are checked exactly (`E3102`, e.g. "Material parameter `phase` expects `f32`, but received `vec3`").
- A supplied value is either an expression evaluated **once** at instance construction (initialisation) or `bind(expr)` (a live dependency re-evaluated every frame, `spec/scenes.md` §10 phase 5). `phase: frame.time` and `phase: bind(frame.time)` therefore mean different things (blueprint §3.2): the first freezes the value at construction.
- Each entity's descriptor creates a **distinct instance with its own parameter storage**. Two instances never share mutable parameter storage. The runtime may share storage between instances whose every value is constant and never written, because that is unobservable (blueprint §6.3); it must count shared and unshared blocks separately in its counters.
- Param values are writable from handlers (`Cube.material.phase = 0.5;`) unless bound (`E5070`). Instance identity (`Cube.material = …`) is construction-only in v0.1 (`E5073`).

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
- Mip-maps are not generated in v0.1 (one level); documented limitation, measured in the runtime benchmark.

## 6. Colour pipeline

- All shading is in linear space (`spec/language.md` §5.4).
- The render target is written through an sRGB view (`spec/runtime-abi.md` §8.2), so the hardware performs the linear→sRGB encode. There is **no tone mapping** in v0.1: linear values above 1.0 clip. This is documented and visible in tests (a light of high intensity saturates).
- Opaque rendering only; depth test `less`, depth write on, back-face culling with counter-clockwise front faces (glTF convention). All built-in meshes are generated counter-clockwise when viewed from outside.

## 7. Lights (components, M4)

Lights are components on **named** entities only in v0.1 (a `light` in a prefab is `E5110`), so the light count is static.

| Component | Fields | Direction / position |
|---|---|---|
| `DirectionalLight` | `color: color = #ffffff`, `intensity: f32 = 1.0` (illuminance, lux) | travels along the entity's world `-Z` axis (rotate the entity to aim it) |
| `PointLight` | `color: color = #ffffff`, `intensity: f32 = 1.0` (luminous intensity, candela), `range: f32 = 0.0` (`0` = unlimited) | at the entity's world position |

`color` and `intensity` are writable and bindable. At most **4** lights per scene in v0.1 (`E5111` at compile time); the limit is a constant in the frame/view block layout (`spec/gpu-layout.md` §6.1). Shadows are not in v0.1.

## 8. Lighting model: the documented PBR subset (M4)

The built-in `Pbr` material and the GPU intrinsic `lighting.pbr(surface: SurfaceInput, base_color: color, metallic: f32, roughness: f32) -> color` implement exactly the following. The runtime test-suite contains a CPU reference implementation of the same formulas (`spec/testing.md` §6.4); images are compared against it with tolerances, so these formulas are a test oracle, not just documentation.

Notation: `N` = normalised world normal; `V = normalize(camera_position − world_position)`; for each light, `L` = unit vector from the surface towards the light, `H = normalize(L + V)`; `NL = max(dot(N, L), 0)`, `NV = max(dot(N, V), 1e-4)`, `NH = max(dot(N, H), 0)`, `VH = max(dot(V, H), 0)`; `c = base_color.rgb`.

1. Roughness: `r = clamp(roughness, 0.045, 1.0)`, `α = r²`. Metallic: `m = clamp(metallic, 0.0, 1.0)`.
2. Distribution (GGX / Trowbridge-Reitz): `D = α² / (π · (NH² · (α² − 1) + 1)²)`.
3. Visibility (height-correlated Smith-GGX): `Vis = 0.5 / (NL · sqrt(NV² · (1 − α²) + α²) + NV · sqrt(NL² · (1 − α²) + α²))`; if the denominator is `0`, `Vis = 0`.
4. Fresnel (Schlick): `F0 = mix(vec3(0.04), c, m)`; `F = F0 + (1 − F0) · (1 − VH)⁵`.
5. Specular `= D · Vis · F`. Diffuse `= (1 − F) · (1 − m) · c / π`.
6. Radiance of a directional light: `E = light.color.rgb · intensity`. Of a point light at distance `d`: `E = light.color.rgb · intensity / max(d², 1e-4) · w`, with `w = 1` if `range = 0`, else `w = clamp(1 − (d / range)⁴, 0, 1)²`.
7. Result: `rgb = Σ_lights (Diffuse + Specular) · E · NL + c · ambient_color.rgb · ambient_intensity`; alpha `= 1`.

No image-based lighting, emissive, occlusion, normal mapping, clear-coat or shadows in v0.1.

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
    fragment(surface: SurfaceInput) -> color {
        let texel = sample(base_color_texture, base_color_sampler, surface.uv);
        let albedo = color.linear(base_color.rgb * texel.xyz, 1.0);
        return lighting.pbr(surface, albedo, metallic, roughness);
    }
}
```

The param named `color` in `Unlit` relies on the rule in `spec/language.md` §4.2: a material param may share a prelude type's name; inside `Unlit`, `color` in expression position is the param, `color` in type position is the type, and `color.linear(…)` would be `E2005` (the prelude does not use it). (M1 provided `Unlit` through a minimal compiler-built shader IR; since M2 it is compiled from this source, and the temporary path is gone, decision 0044.)

## 10. Not in v0.1

Vertex and compute stages; transparency and blending; shadows; post-processing; multiple render targets; material inheritance; changing material identity at run time; texture params written at run time; mip-map generation; derivatives (`dpdx`); storage buffers; texture arrays and cube maps.
