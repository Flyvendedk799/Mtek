# 0057. PBR lighting: the `Pbr` material, `lighting.pbr` and its validation against the oracle

- Status: Accepted
- Date: 2026-10-18
- Blueprint origin: M4 (blueprint §11), task M4-03; `spec/materials.md` §3.1, §3.3, §8, §9; `spec/gpu-layout.md` §6.1; `spec/testing.md` §6.4; decisions 0029 (shader IR), 0035 and 0053 and 0054 (items that land before their milestone's gate), 0041 (helper library), 0044 (prelude materials), 0053 (lights in the frame block), 0054 (`sample`).
- Supersedes: nothing. Lifts the M4 gating of the `Pbr` schema and its fields, the namespace `lighting` and `lighting.pbr`. Assets (`asset`, `glb_asset`) stay M4 items of other tasks.

## Context

The specification fixes the lighting model (`spec/materials.md` §8, rule by rule), the prelude `Pbr` (§9), the frame block the lights are packed into (`spec/gpu-layout.md` §6.1, decision 0053) and the vertex interface (§3.3). It leaves open how the model becomes WGSL, which stage-input fields `lighting.pbr(surface, …)` counts as read, how the gate is lifted, and what the implementation does where an f32 evaluation of the formulas is undefined or loses precision. The CPU oracle (`tests/browser/support/reference-shading.ts`, task M4-01) implements the formulas in binary64 and recorded five operator questions. They are **open** and this record implements the specification as written. Every choice below is a **proposal** the owner may overrule.

## Decision

1. **Gate.** As decisions 0053 and 0054 did for lights and textures, the rows are marked implemented by the current build (`since` `M1`; `CURRENT_MILESTONE` is unchanged): the schema `Pbr` with its five fields, the namespace `lighting` and `lighting.pbr`. The prelude therefore compiles `Pbr` together with `Unlit` whenever a program uses a built-in material (decision 0044 item 3 is unchanged in mechanism; no declaration is left out any more); `Unlit`-only programs gain the unused `Pbr` item in `mtek inspect --ir`, the effect on the IR and manifest goldens being the extra item and the new hash of `std/materials.mtek` (the file differs by one comment line of the same length). `spec/stdlib-schema.json` is regenerated. The `gate_builtin_schema` fixture, which used `Pbr` as its example of a gated schema, now uses `Static` (`material: Static {}`, planned for M5); `every_gated_construct_has_a_gating_fixture` expects that message.

2. **`SurfaceInput` reads.** A call `lighting.pbr(x, …)` whose first argument is the stage's own `SurfaceInput` parameter by name reads `world_position` and `world_normal` of it and nothing else: the name is counted as a field read of those two fields instead of a use of the whole input (`types/material.rs`, `note_lighting_surface`). The `Pbr` stage therefore reads `world_position`, `world_normal` and (through `sample`) `uv`: its vertex stage has the attributes position, normal and uv and the varyings 1–3, and no `local_position` varying (`spec/materials.md` §3.1, §3.3). A stage that hands the input on in any other way (`let s = input;`) still reads every field, as before. The lowering checks that the two fields are in the stage's set when it uses the helper (`E9999` otherwise).

3. **The helper.** `lighting.pbr` lowers to a generated function `mtek_lighting_pbr(surface: MtekSurfaceInput, base_color: vec4<f32>, metallic: f32, roughness: f32) -> vec4<f32>` of the helper library (decision 0041 item 8, `lowering/shader/helpers.rs`, built from the shader IR like the others, emitted once per module and only when called). It reads the module's `mtek_frame` (`lights`, `light_count`, `camera_position`, `ambient`), so it is the one helper that needs a global and a struct of the standard stage. It follows the rules of `spec/materials.md` §8 in order and in their own operations: rule 1 (`clamp(roughness, 0.045, 1)`, `α = r²`, `a2 = α²`; `clamp(metallic, 0, 1)`), rule 2 (`D = a2 / (π (NH² (a2 − 1) + 1)²)`), rule 3 (height-correlated Smith-GGX with the zero-denominator rule), rule 4 (`F0 = 0.04 (1 − m) + c m`, `F = F0 + (1 − F0) (1 − VH)⁵`, per channel), rule 5 (specular `D Vis F`, diffuse `(1 − F)(1 − m) c / π`), rule 6 (directional: the packed `color`, which is `color.rgb × intensity`, decision 0053 item 10; point: `color / max(d², 1e-4) × w`, `w = 1` for `range = 0`, else `clamp(1 − (d / range)⁴, 0, 1)²`), rule 7 (`Σ (Diffuse + Specular) E NL + c ambient`, alpha 1). The result alpha is 1, the fragment wrapper writes 1 anyway. There is **no tone mapping**: values above 1 reach the render target and clip there (`spec/materials.md` §6).

4. **Where the f32 evaluation differs from the binary64 oracle by construction** (and what the helper does about it; none changes a defined value of the specification):
   - A light term is **skipped when `NL == 0`**, before the half vector is formed. Rule 7 multiplies the term by `NL`, so it is exactly 0 whatever `H` is, and `normalize(L + V)` is `NaN` for `L = −V`. This is the oracle's own choice (`reference-shading.ts`).
   - `(1 − VH)⁵` is `t2 · t2 · t` with `t = 1 − VH` (the oracle's evaluation), so `pow` — undefined for a negative base — is never involved.
   - `range = 0` means unlimited: the divisor `d / range` is replaced by `d / 1` for such a light and the quotient is discarded by a `select`, so no infinity or `NaN` is formed.
   - The loop runs over `min(light_count, 4)` lights, so a corrupt frame block can not index past the array (the runtime writes at most 4, decision 0053 item 2).
   - `N` is the fragment wrapper's re-normalised interpolated normal (`spec/materials.md` §3.1) and is not normalised a second time.
   - `π` is the binary32 nearest to π; `mix(0.04, c, m)` is written `0.04 (1 − m) + c m`.
   - **Not guarded, because the specification gives no value:** `L = −V` with `NL > 0` (a back-facing normal at a silhouette lit exactly from behind the viewer), a point light at the shaded point (`d = 0`), and a zero-length normal or view vector produce `NaN`, as in the oracle, which throws for them. The roughness floor 0.045 makes `a2 ≈ 4.1·10⁻⁶`, so `NH² (a2 − 1) + 1` at `NH ≈ 1` cancels in binary32: `a2 − 1` is rounded to a multiple of `6·10⁻⁸`, which is up to 0.7 % of the result `≈ a2`, so the peak of `D` at the floor is uncertain by up to about 1.4 % of its value (analysis only). It is **not measured** on the hardware: the specs use roughness 0.2 and 0.8, where the relative error of that sum is below 0.01 %, and a roughness near the floor is an open risk that a later record may measure. A GPU may contract `a * b + c`; the measured results include whatever the adapter does.
   - The five operator questions of the oracle review are implemented as the specification is written: the diffuse term uses `(1 − F)` with the metal-mixed `F`; the point-light window is squared; ambient is `c · ambient` without the factor `(1 − m)`; the roughness floor is applied in binary32 as above; `L = −V` is the guarded case above.

5. **Vertex interface.** The standard stage already emits the normal attribute, `normalize((normal_matrix · vec4(normal, 0)).xyz)` and the varyings for the fields a material reads (decision 0029); nothing changed there. All built-in meshes carry normals and uv, so no mesh is rejected (`E7010` has no producer in v0.1).

6. **Texture params of `Pbr`** are decision 0054's: `base_color_texture` (default `texture.white()`) and `base_color_sampler` (default `sampler.linear_repeat()`); the albedo is `color.linear(base_color.rgb × texel.xyz, 1.0)` as in `spec/materials.md` §9. The texture colour space rule makes `sample` return linear values for the default sRGB textures.

## Measured against the oracle

`tests/browser/specs/m4/pbr.spec.ts` on the hardware adapter (AMD Radeon RX 7900 XTX, Chromium WebGPU), 256 × 256 `rgba8unorm-srgb` target, ten pixels per case (the middle, the neighbourhood of the specular peak, bright, mid, grazing, and one with `N · L < 0`), tolerance **3/255** per channel against `linearRgbToSrgb8(shadePbr(..))`:

| Case | Max error (bytes) |
|---|---|
| sun, metallic 0 / 1, roughness 0.2 / 0.8 (four renderings) | 1, 1, 0, 1 |
| point light with range 5: inside the window (dielectric, metal), across its edge, outside it | 1, 1, 1, 0 (outside = the ambient-only image, byte for byte) |
| point light without range (two distances) | 1, 1 |
| ambient only (dielectric, metal, black base) | 0, 0, 0 |
| three lights, coloured sun, metallic 0.5 | 1 |
| saturation (12 lux and 5000 lux sun) | 1 and 0; red clips to 255 while green and blue keep the values of the unclipped colour (8 pixels); 5000 lux gives (255, 255, 255) |

The test sphere has 256 × 128 segments, so its facets are far below a pixel and N, V and the surface point are derived analytically from the pixel's ray (`support/pbr-scene.ts`, unit tests in `support/pbr-scene.test.ts`). The directional light's direction is derived by hand from `quat.euler(pitch, yaw, 0)` applied to `−Z`. A mutation check shows that the spec detects errors of the size that matters: dropping the square of the window (`w = clamp(..)` instead of `clamp(..)²`) fails the across-the-edge case with an error of 4 bytes.

## Consequences

- `spec/materials.md` §8 and §9, `spec/stdlib.md` (the `lighting` row) and `spec/decisions/README.md` point here; the decisions 0044 item 3 (the `Pbr` gate) and 0053 consequences ("no visible effect until a lit material exists") are fulfilled.
- Programs that use a built-in material compile and validate `Pbr` as well; its WGSL (`mtek inspect --shaders`) is built only for a scene that uses it. `tests/codegen/wgsl-materials/pbr` holds the WGSL goldens of two user materials that call `lighting.pbr` and of the prelude `Pbr`; `tests/codegen/inspect/materials_lighting.*` the inspect views of `tests/semantics/pass/materials/lighting`.
- M4-08 (instancing) may change how `MtekObject` reaches the vertex stage; the helper reads only `mtek_frame` and the fragment inputs.

## Verification

- Compiler: `tests/shader_lowering.rs` (`lighting_pbr_is_a_helper_over_the_frame_block_that_reads_two_surface_fields`: vertex attributes and varyings, one helper per module, the exact guards and loop, no `pow`, Naga validity of every golden), the goldens `tests/codegen/wgsl-materials/pbr/expected/*`, `tests/inspect_views.rs` (goldens for `materials/lighting`), `tests/stdlib_registry.rs` (gate rows), `tests/fixtures.rs` and `gate_builtin_schema`, `src/prelude.rs` and `tests/unlit_shader.rs` (the prelude holds both materials), the re-blessed IR and manifest goldens, `tests/build.rs` (the new semantic fixture `materials/lighting` builds).
- Browser (`tests/browser/specs/m4/pbr.spec.ts`, fixture `fixtures/m4/pbr`): the table above. `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware`.
