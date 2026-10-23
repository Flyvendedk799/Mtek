# 0149. Random helpers: `random_range`, `random_int`, `chance`

- Status: Accepted
- Date: 2026-10-21

## Contract

Games keep writing the same three lines around `random()`. They are now intrinsics, CPU only, usable wherever `random()` is: `cpu fn`s, state initialisers, lifecycle functions and handlers. A pure `fn` cannot call them (`E4002`), exactly as it cannot call `random()`; the first version of this text said "functions" and meant `cpu fn`s (corrected in decision 0177: the checker is right, because a draw changes the generator's state). They are not usable in a `bind` (`E5005`) or on the GPU.

| Function | Result |
|---|---|
| `random_range(lo: f32, hi: f32) -> f32` | `lo + (hi − lo) · random()`, rounded to f32: in `[lo, hi)`. With `hi < lo` the same formula gives `(hi, lo]`. |
| `random_int(lo: i32, hi: i32) -> i32` | `lo + floor(random() · (hi − lo))` computed in f64: in `[lo, hi)`. `lo` when `hi ≤ lo`. |
| `chance(p: f32) -> bool` | `random() < p`: never for `p ≤ 0`, always for `p ≥ 1`. |

Each call takes exactly **one** draw of the program's generator (xoshiro128**, seeded by the mount options), also when `hi ≤ lo`. A program that replaces `lo + (hi - lo) * random()` with `random_range(lo, hi)` therefore sees the same sequence under a fixed seed, and `mtek test` fixtures stay deterministic.

Generated code calls `ctx.randomRange(lo, hi)`, `ctx.randomInt(lo, hi)` and `ctx.chance(p)` (`spec/runtime-abi.md` §4.2). The runtime computes them from one `random()` (`packages/runtime-web/src/scene/world.ts`).

## Alternatives considered

- **Inclusive `random_int(lo, hi)`.** Dice read better as `random_int(1, 6)`. But `[lo, hi)` matches `for i in lo..hi`, array indexing (`random_int(0, len)`) and `random_range`, so one rule covers all three.
- **Generic `random_range` over vectors.** Each component would need its own draw, which makes the number of draws depend on the type. Not now.

## Verification

`tests/semantics/pass/random_helpers`; `tests/semantics/fail/gameplay/e5005_random_range_in_bind`, `e3001_random_int_with_f32`; `packages/runtime-web/src/scene/random.test.ts`; `crates/mtek-compiler/tests/stdlib_registry.rs`.
