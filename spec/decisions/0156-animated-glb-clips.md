# 0156. Animated GLB clips

- Status: Accepted
- Date: 2026-10-21

## Context

Decision 0015 rejected every glTF animation (`E7019`). A prop that spins, or a lid that opens, is a node transform over time. Skinning, morph targets and cubic splines stay out.

## Decision

1. **What plays.** A LINEAR or STEP channel of `translation`, `rotation` or `scale` is a clip. An animation with no name is `animation_N` (`N` its index). An empty name is unnamed. Skins, morph-weight channels, cubic spline, any other interpolation or path, a duplicate name, and a channel with no keyframes or more than 4096 are still `E7019` (the title stays "animation present"). Bad accessor data stays `E7025` or `E7011`.
2. **`clip: "Name"`** on the entity or prefab whose `mesh` is `asset.glb(…).mesh(…)` of that file. The clip plays the channels of the node that mesh (or a node of that name) sits on. The duration is the whole animation's. `E5016` when there is no such mesh, the name is missing, no channel moves that mesh, the entity also writes a field the clip writes (`translation` is `position`, `rotation` is `rotation`, `scale` is `scale`), or a scale component is not positive. A file that failed to load reports its own diagnostic and not a second `E5016`.
3. **Playback.** The pose at time 0 is applied after `init` and the first binding pass. Phase 3 advances the clip before particles, timers and `update`. LINEAR lerps; STEP holds the previous key; rotation is nlerp, then normalised. Time wraps after the duration; the exact end holds the last key. One clip is the only writer of the channels it has (`spec/scenes.md` §8.2).

## Verification

- `tests/assets/pass/animated_clip` (the former `e7019_animation` triangle, now `clip: "animation_0"`).
- `tests/assets/fail/e7019_skin` still rejects a skin. `tests/assets/fail/e5016_unknown_clip`.
- `packages/runtime-web/src/scene/clips.test.ts` (a half turn about Y is `y ≈ √2/2`).
- `examples/stage-show`.
