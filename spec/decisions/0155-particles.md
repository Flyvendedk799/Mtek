# 0155. Particles

- Status: Accepted
- Date: 2026-10-21

## Context

A fountain, a spark and a puff of smoke are many short-lived points. Spawning an entity per point would spend the entity limit and a draw each. v0.1 had no emitter.

## Decision

1. **`particles: Emitter { … }`** on an entity or prefab, construction-only. Fields: `rate` (per second, default 0, ≥ 0), `lifetime` (seconds, default 1, > 0 and finite), `speed` (metres per second, default 1, ≥ 0), `size` (metres, default 0.05, > 0 and finite), `gravity` (metres per second squared, downward, default 0, finite).
2. **A pool, not entities.** Each emitter keeps at most 64 particles. `rate * dt` spawns with a fractional accumulator (`floor`, the leftover stays). The direction is uniform on the upper hemisphere: the up component is `random()` in `[0, 1]`, the ring is the rest, the azimuth is `random() * 2π`, then scaled by `speed`. Velocity `y` loses `gravity * dt`. They are born at the entity's world position.
3. **Drawing.** A particle is a camera-facing copy of the entity's mesh, in the colour of its material, through the opaque instanced pipeline. No mesh: the particles are still simulated and `particle_count()` counts them, and nothing is drawn. At most 256 particles are drawn in one frame.
4. **`particle_count() -> i32`.** CPU, legal wherever `paused()` is. The sum of the living particles.
5. **Pause.** Emitters advance at the start of phase 3, before timers and `update`, so `pause()` stops them and `update` sees the new count.

## Verification

- `tests/semantics/pass/particles`.
- `packages/runtime-web/src/scene/particles.test.ts` (rate 24 and `dt` 0.0625 for eight frames is 12; the pool stops at 64).
- `examples/stage-show`.
