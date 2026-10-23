# 0174. Clips compose with the entity, and unplayable animations fail where they are used

- Status: Accepted
- Date: 2026-10-23
- Amends: 0156 (animated GLB clips)
- Audit: `docs/audits/2026-10-23-game-audit.md` findings R5 and R9.

## Context

A clip wrote the entity's `position`, `rotation` and `scale`, so a prefab given a translation clip appeared where the glTF node was and not where it was placed, and `E5016` forbade the entity from writing the same field, which left no way to place it. Separately, one cubic-spline or morph-weight animation anywhere in a file failed the whole file (`E7019`), even for a program that only used the mesh, and a rotation stored as normalised BYTE or SHORT, which glTF allows, was refused (`E7025`).

## Decision

1. **`base · clip`.** The local matrix of an entity with a clip is `T·R·S` of its own transform times `T·R·S` of the clip's pose. The entity's own `position`, `rotation` and `scale` are untouched by the clip; a channel the clip lacks is the identity. The pose is sampled in phase 3 as before, and a spawned entity is posed at time 0 when it is created, not a frame later. The parent chain applies on top, as for any entity.
2. **`E5016` no longer reports a field the entity also writes.** Composition makes the two compatible: the entity's value is the base. The rest of `E5016` stands (no such mesh, name or channel for the mesh; a scale keyframe that is not positive).
3. **Unplayable animations are not file errors.** A morph-weight channel, a cubic-spline or other interpolation, a path other than translation, rotation or scale, or a keyframe count outside 1 to 4096 puts the animation on `GlbFile.unsupported_animations` with the reason. The file validates; a `clip` that names it is `E7019` with that reason, at the `clip` field. Skins and a duplicate animation name stay `E7019` at the file, and bad accessor data stays `E7025` or `E7011`.
4. **Quantised rotations.** A rotation output may be FLOAT or a normalised BYTE or SHORT (signed or unsigned), dequantised as glTF specifies (`max(c / 127, -1)`, `max(c / 32767, -1)`, `c / 255`, `c / 65535`). A non-normalised integer output, or an integer translation, scale or time accessor, is `E7025`.

## Consequences

- A static entity with a clip and a position now plays the clip around that position; before, the position was ignored. The `stage-show` prop did not write a channel its clip has, so it is unchanged.
- The `unsupported_animations` list is compile-time only; the manifest has no new field.

## Verification

- `packages/runtime-web/src/scene/clip-compose.test.ts` (translation, rotation and scale order, two places).
- `crates/mtek-compiler/src/assets/glb/tests.rs` (cubic and morph are unsupported, not errors; SHORT and BYTE dequantise; integers only for rotation).
- `tests/assets/pass/animated_clip_prefab` (two spawns of a prefab with `position` and a translation clip), `pass/animation_unused_cubic`, `pass/animated_clip_quantised`, `fail/e7019_cubic_clip`.
