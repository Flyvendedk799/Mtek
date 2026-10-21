# 0138. Transparency: a translucent pass driven by colour alpha (partially implemented)

- Status: Accepted. Runtime part implemented; compiler part not yet (see "Not done").
- Date: 2026-10-21
- Specification: `spec/materials.md` §2 and §10 are **not yet amended**. They still say opaque only (`E5100`, `E8100`, `E5902`).
- Small-game plan: phase 6, step 1 (alpha and fades).

## Decision

1. **Alpha comes from the colour.** A draw is translucent when its material instance's `color` (Unlit) or `base_color` (Pbr) param, or any user material param with those names of type `color`, has alpha below 1. There is no new field or blend-mode enum. A fade is a binding on that colour: `color: bind(color.linear(rgb, 1.0 - easing.in_quad(t)))` (decision 0135).
2. **Pass.**
   - Translucent draws sort after every opaque draw (key prefix U+FFFF).
   - Each frame they are reordered back to front by the clip-space w of their bounding-sphere centre; ties keep draw-list order.
   - They use a pipeline variant with straight-alpha "over" blending and depth test without depth write.
   - They are never instanced.
3. **Lazy pipeline.** The blended variant is created the first time a draw needs it, so programs without translucency create exactly the pipelines they did before. Until it exists the draw stays opaque, normally for one or two frames.
4. **Tracking.** `MaterialStore.writeParam` tracks the alpha of `color` and `base_color` per instance. A change of translucency bumps the block version, so the draw list is rebuilt.

## Implemented (runtime)

- `render/pipelines.ts`: `ALPHA_PARAMS`, `canBlend`, `ALPHA_BLEND`, and the `blended` request with its own key suffix, blend state and no depth write.
- `render/materials.ts`: `isTranslucent` and the alpha tracking.
- `render/renderer.ts`:
  - `TRANSLUCENT_KEY_PREFIX` and `orderTranslucent`;
  - the lazy `blend` option;
  - translucent draw items.
- `render/startup.ts` supplies `blend`.
- Tests: `render/translucency.test.ts`, plus the whole `src/render` suite (189 tests) green.

## Not done (needed before any program can be translucent)

- The compiler still rejects constant non-opaque material colours (`E5100`) and the runtime still rejects run-time ones (`E8100`). Until both are lifted for these params, no instance ever becomes translucent, so this change alters no current program.
- Generated WGSL still writes `vec4(result.rgb, 1.0)` (`lowering/standard_stage.rs`). It must write the fragment's alpha, at least for the blended variant. This changes every shader hash and the codegen goldens.
- `E5902` is still listed as not supported in `context/capabilities.rs`.
- Still to do:
  - the spec text;
  - fixtures: a pass fixture with a fading colour, and the four `E5100` fail fixtures turned into pass fixtures or retired;
  - the Phase 6 example.
