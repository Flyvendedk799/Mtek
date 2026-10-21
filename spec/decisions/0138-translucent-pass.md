# 0138. Transparency: colour alpha drives a translucent pass

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/materials.md` §2 (colour alpha), §3 (fragment output), §3.4 (translucent draws), §10; `spec/diagnostics.md` (`E5100` and `E5902` retired, `E8100` narrowed).
- Small-game plan: phase 6, step 1 (alpha and fades). It lifts `E5902`.

## Decision

1. **Alpha comes from the colours.**
   - Every `color`-typed material param takes any alpha: in a default, an instance constant, a run-time write or a binding.
   - While any colour param of an instance has an alpha below 1, its draw is translucent. There is no new field and no blend-mode enum.
   - A fade is a binding on the alpha, for example `color: bind(color.linear(rgb, 1.0 - easing.in_quad(t)))` (decision 0135). Alpha is therefore tweenable with the same tools as position.
   - `E5100` (constant non-opaque colour) and `E5902` (transparency not supported) are retired and stay reserved, so their numbers are not reused.
   - `E8100` remains only for a host input whose declared codec is `color-hex-opaque`; that codec's contract is opacity.
2. **The fragment writes its real alpha.** The generated fragment entry point returns the fragment's colour unchanged instead of `vec4(result.rgb, 1.0)`.
   - The canvas is configured `alphaMode: "opaque"`, so opaque draws look exactly as before.
   - This changes every generated WGSL module, and with it every shader hash. The codegen goldens under `tests/codegen/*/expected/shaders` were re-blessed deliberately. The only difference in each module is the return statement of `mtek_fs`.
   - Historical evidence and benchmark files that mention the old hashes are records of past runs and were left unchanged.
3. **The pass.**
   - Translucent draws sort after every opaque draw (key prefix U+FFFF).
   - Each frame they are reordered back to front by the clip-space w of their bounding-sphere centre; ties keep draw-list order.
   - They use a pipeline variant with straight-alpha "over" blending, depth test and no depth write.
   - They are never instanced.
4. **Lazy pipeline.** The blended variant of a material is made the first time one of its draws turns translucent. Programs that never fade create exactly the pipelines they did before. Until the variant exists, normally for one or two frames, the draw stays opaque.
5. **Tracking.** `MaterialStore.writeParam` tracks which colour params of each instance are translucent. A change of the instance's translucency bumps the block version, so the draw list is rebuilt.
6. **`W5101` stays.** A constant returned alpha other than 1 still warns, now because it blends only while a colour param of the instance is translucent.

## Consequences

- Sorting is per object, not per triangle. Intersecting translucent objects, or a concave translucent mesh, can show order artefacts; this is a documented limitation (`materials-translucency`).
- There are no additive or multiply blend modes. Particles (a later step) use alpha "over" too.
- Fixtures:
  - the four `E5100` fail fixtures are now pass fixtures (`translucent_*`);
  - `pass/translucent_fade_binding` fades an Unlit colour through an eased binding, beside a constant translucent Pbr box and an opaque wall.
- Tests: `render/translucency.test.ts`; `scene/world.test.ts` and `render/renderer.test.ts` (a translucent write is uploaded, with no diagnostic).
