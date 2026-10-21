# 0170. Sprites: a built-in Sprite material, sheet cells and the 2D camera

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/materials.md` §9.1; `spec/diagnostics.md` (`E5701`).
- Small-game plan: phase 6, step 4.

## Decision

1. **`Sprite` is a built-in material written in Mtek** (`std/materials.mtek`), with the params `sheet`, `sheet_sampler`, `tint`, `cell`, `columns` and `rows`.
   - The fragment stage picks the cell and multiplies by `tint`, alpha included.
   - Frame animation is a binding on `cell` (floored and wrapped), so it needs no new run-time system and is as tweenable as any param.
   - The param is called `cell`, not `frame`, because `frame` is a built-in namespace (`E2001`).
2. **Sprites are always translucent.** The renderer treats every draw of `std/materials.mtek::Sprite` as translucent (decision 0138): it is sorted back to front, blended, and writes no depth. This is the only material with a fixed blend; other materials stay translucent only while a colour alpha is below 1.
3. **No new mesh and no new camera kind.**
   - A sprite is a `Plane` rotated to face `+Z`.
   - The 2D camera preset is the existing `Orthographic` projection on a camera looking down `-Z`.
   - Both are documented patterns, so existing tooling (bounding spheres, culling, `mtek inspect`) applies unchanged.
4. **`E5701`**: a constant `columns` or `rows` outside `1..64`. A run-time value outside that range is clamped by the fragment stage, never a division by zero.

## Consequences

- There is no `Quad` mesh and no keyword or preset object for a 2D camera. A camera preset beyond the documented pattern would be a later decision.
- There are no per-sprite flips: a negative `scale.x` mirrors the plane, and back-face culling then hides it. Mirrored sheets must be authored as cells.
- Fixtures: `tests/semantics/pass/sprite_sheet_animation` and `tests/semantics/fail/e5701_sprite_sheet_layout`.
- Test: `render/translucency.test.ts` (sprites always blend).
