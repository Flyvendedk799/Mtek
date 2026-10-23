# 0173. Translucent order, the particle pass and the cost of both

- Status: Accepted
- Date: 2026-10-23
- Amends: 0138 (translucent draws), 0155 (particles), 0170 (sprites)
- Audit: `docs/audits/2026-10-23-game-audit.md` findings R1 to R4, R6, R7, R8.

## Context

The audit of the small-game work found that 2D layering, the one thing every sprite game needs, did not work: translucent draws were sorted by the clip-space `w` of their centre, which is `1` for every point under `orthographic()`, so sprites at different `z` tied and fell back to the order of the draw list. Particles were drawn after the translucent pass with the opaque pipeline, so they covered sprites and glass and a `Sprite` emitter showed solid quads. A scene with one translucent draw rebatched and re-uploaded every frame, the particle buffer was recreated while the count ramped up, blended pipelines were made a frame or two late, `Sprite` could divide by zero, and the particle cap, the instancing-off case and the shared random stream were silent.

## Decision

1. **Sort key.** Translucent draws are ordered back to front by the view-space depth of the world-space bounding-sphere centre (the dot product of the centre with the third row of the view matrix), which is the same for an orthographic and a perspective camera. Draws at equal depth keep draw-list order. There is no explicit `layer`: the `z` of a sprite is its layer, and a second ordering key would have to be learned and kept in step with `z`.
2. **No work when nothing moved.** The sorted list lives in a buffer of the renderer. It is compared with the previous frame's, and the same array is returned with an "unchanged" flag when the order is the same, so culling, batching and the instance upload are kept. `Renderer.rebatchesCumulative` and the debug counter `rebatchesTotal` count the frames that split the draw calls into batches again. Translucent draws stay un-instanced; an instanced sprite path is a later decision.
3. **Particles between the passes.** Particles are drawn after the opaque draws and before the translucent ones. An emitter whose material blends (`Sprite`, or an instance with a colour alpha below 1) uses the blended instanced pipeline, which writes no depth; its particles are sorted back to front by view depth, and the blended emitters follow the opaque ones, back to front by mean depth. They are not interleaved with the translucent entities.
4. **One buffer.** The particle billboard buffer has `256` records and is made once, on the first frame that draws a particle; the mirror, the batches and the sort scratch are reused. `ParticleSim.draws()` hands out reused records. Clip sampling writes into a scratch array.
5. **The cap warns.** More than 256 particles alive in a frame draw the first 256 and report `W8210` ("too many particles") once per scene run, as `W8203` does for the HUD.
6. **Instancing off.** Particles are always instanced draws (decision 0155), so the instanced variant of an emitter's material is created even when `test.disableInstancing` is set; that option affects the batching of entities only.
7. **A stream of their own.** Particles draw from a seeded generator inside `ParticleSim`, with a fixed seed, so adding an emitter does not move the sequence `random()` gives to the gameplay in a seeded run.
8. **Blended pipelines at start.** `startScene` creates the blended pipeline of every material known to blend (`Sprite`, an entity instance whose initial alpha is below 1, a `Sprite` prefab) and the instanced blended variant for emitter materials, before the renderer exists. The lazy path stays for a material that turns translucent later.
9. **Sprite layout.** The fragment stage of `Sprite` floors `columns` and `rows` and holds them to `1..64`, as decision 0170 section 4 promised.

## Consequences

- The `translucent` draw order of a perspective scene is unchanged for cameras that look along the depth axis; for a diagonal view it now follows the depth along the view direction, which is what `clip w` was approximating.
- A blended emitter is not sorted against translucent entities: a particle that should be behind a glass pane is still drawn before it (so the pane covers it correctly) and one that should be in front is drawn before it too (so the pane blends over it). A game that needs exact interleaving draws its particles as entities.
- New code `W8210`.
- The stdlib source of `Sprite` changed, so the goldens that carry its text or hash were regenerated.

## Verification

- `packages/runtime-web/src/render/translucency.test.ts` (orthographic and perspective orders, an unchanged order returns the same array).
- `packages/runtime-web/src/render/renderer.test.ts` (a static translucent scene settles at a constant `rebatchesTotal`).
- `packages/runtime-web/src/render/particles-render.test.ts` (pass order, blended emitter pipeline, one buffer, the cap and `W8210`, instancing off).
- `packages/runtime-web/src/scene/particles.test.ts` (own stream, reused draw records).
- `tests/codegen/wgsl-materials/pbr/expected/materials.Sprite.wgsl` (the clamp).
- `tests/browser/specs/m6/sprite-layers.spec.ts` (two overlapping sprites under an orthographic camera, declared far-last).
