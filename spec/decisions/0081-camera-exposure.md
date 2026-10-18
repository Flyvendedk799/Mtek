# 0081. Camera exposure (EV100) for physical light units

- Status: Accepted
- Date: 2026-10-18
- Blueprint origin: M4 (blueprint §11), follow-up task M4-12 of the M4-01 review (question 2/2, item d); `spec/scenes.md` §3, `spec/materials.md` §6 and §8, `spec/gpu-layout.md` §6.1; decisions 0053, 0057, 0080.
- Supersedes: nothing. Uses the reserved member `reserved0` of `MtekFrame` (offset 92), renamed `exposure`; the block's size and every other offset are unchanged.
- Numbering note: as 0080, 0064–0079 are left free for the parallel M5 work.

## Context

Light intensities are physical: a `DirectionalLight` is in lux, a `PointLight` in candela (`spec/materials.md` §7). Under the default 1 lux a white Lambertian surface has radiance `1/π ≈ 0.32`, so the default scene looked dim. The owner chose to keep the units and not inflate the default intensity, and to add a camera exposure as Filament, Unreal and Blender do.

## Decision

1. **Field** (proposal): `Camera.exposure: f32`, the exposure value at ISO 100 (EV100), construction-only and therefore a constant (`E3090`), default `-log2(1.2 π) = -1.9145305` (binary32). Not writable or bindable in v0.1 (camera switching and auto-exposure are not in v0.1 either); making it writable later only needs a writer for the frame member.
2. **Formula** (constraint, Filament's photometric exposure for a camera at ISO 100, `exposure = 1 / (1.2 · 2^EV100)`; Lagarde and de Rousiers, "Moving Frostbite to PBR", 2014): lit materials multiply their summed radiance (lights and ambient, `spec/materials.md` §8 rule 9) by this scale. With the default the scale is `π`, so white Lambertian under 1 lux is 1.0; the `Pbr` material (roughness 0.5) shows a white surface under the default light at about 0.97–1.0. Real-world EV100 values work unchanged (sunny day ≈ 15 with ≈ 100 000 lux).
3. **Scope** (proposal): only `lighting.pbr` applies it. `Unlit` and user materials that do not call it write their colour unchanged, so an unlit colour picked by an author stays the colour on screen. There is still no tone mapping; values above 1 clip.
4. **Transport** (proposal): the manifest's camera entry carries `exposure` (EV100, required; `spec/manifest.schema.json`). The runtime writes `1 / (1.2 · 2^exposure)` of the active camera into `MtekFrame.exposure` (`render/renderer.ts`, `exposureScale`). The helper `mtek_lighting_pbr` multiplies its result by `mtek_frame.exposure`.
5. **Fixtures and the example** (proposal): the lit GPU fixtures (`fixtures/m4/pbr`, `fixtures/m4/assets_scene`) and `examples/material-configurator` declare `exposure: -0.2630344` (= `-log2(1.2)`, scale 1 to binary32 precision), so their measured images and the CPU models stay the ones of 0057 / 0061 apart from decision 0080. The oracle takes an optional `exposure` scale (default 1).

## Consequences

- Every scene that uses `Pbr` and does not declare an exposure becomes about π times brighter. Scenes tuned for the old brightness either lower their intensities or declare `exposure: -0.2630344`.
- The manifest changes shape (one more required camera key): every manifest fixture and golden is updated; the frame block layout golden renames `reserved0`.

## Verification

- Without a GPU (done): `tests/stdlib_registry.rs` (the field row), the manifest goldens (default `-1.9145305`; `tests/codegen/lights` declares `1.5 - 0.25` → `1.25`), `tests/semantics/fail/e3090_camera_exposure_not_constant`, the helper golden (`* mtek_frame.exposure`), `packages/runtime-web/src/render/renderer.test.ts` (the scale is written into `MtekFrame.exposure`), and the oracle tests (`camera exposure (rule 9)`).
- On a GPU (pending): a scene with the default camera and default 1 lux sun renders a white `Pbr` (roughness 1) surface at sRGB ≈ 252 (`linearRgbToSrgb8(0.97)`); and the M4 lit specs (`pbr`, `assets`, `configurator`) still pass with the unit exposure.
