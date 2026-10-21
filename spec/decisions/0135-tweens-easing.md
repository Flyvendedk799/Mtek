# 0135. Tweens: CPU easing curves in an `easing` namespace, allowed in bindings

- Status: Accepted
- Date: 2026-10-21
- Specification: `spec/tweens.md`, `spec/stdlib.md` §2 (`easing`), `spec/scenes.md` §14.
- Small-game plan: phase 6 (rendering and assets for games), step 2 (tweens).

## Context

Small games animate a lot of small things: a score pops, a door slides open, a menu slides in, a coin bounces. v0.1 has bindings (`bind(..)`, re-evaluated every frame) and `mix`/`smoothstep`, but no easing curves, so every game writes out back-out or bounce-out by hand, and bindings cannot call a `cpu fn`.

## Decision

1. **Curves, not tween objects** (proposal). A tween is a progress `state` plus `bind(mix(a, b, easing.curve(t)))`. There is no tween runtime, no timeline, no scheduler and no new IR node, manifest section or binding target. Program state stays the only state, so `mtek test` fixtures can observe a tween's progress like any other state.
2. **Ten curves** in an `easing` namespace: `in_quad`, `out_quad`, `in_out_quad`, `in_cubic`, `out_cubic`, `in_out_cubic`, `in_out_sine`, `out_back`, `out_elastic`, `out_bounce`. These are the curves small games use most; the rest of easings.net can follow without design work. The namespace is `easing`, not `ease`: a built-in namespace cannot be shadowed (`E2001`), and `ease` is a common name for a user function (an existing fixture imports one).
3. **CPU domain, allowed in `bind`.** The curves are implemented once, in `rt` (`packages/runtime-web/src/math/ease.ts`, rows `easing.*` in both copies of the `rt` helper table). They are `Domain::Cpu` so a plain `fn` (which may run on the GPU) cannot call them (`E4002`), and the binding pass exempts the `easing.` prefix from its "no CPU-only built-in in `bind`" rule because bindings are evaluated by `rt` on the CPU. Making them `both` would require a WGSL implementation of every curve for no current use.
4. **Clamp and binary32.** `t` is clamped to 0..1 (NaN → 0) so a progress value that runs past the end is harmless, and the result is rounded to `f32` once.
5. **No new diagnostic codes.** Misuse is covered by `E4002` (from a `fn`), `E3090` (in a `const`) and the ordinary argument type errors.

## Consequences

- Registry: an `easing` namespace (10 functions); `spec/stdlib-schema.json` regenerated.
- `bind.rs`: the `easing.` exemption. `rt_ops.rs` and `operations.ts`: ten rows each.
- The example `examples/hud-score` pops its cube with `easing.out_back`.
- Easing is CPU-only; the GPU has `smoothstep`.

## Verification

- Compiler: `tests/semantics/pass/ease_tweens` (every curve, in `bind`, `update` and a `cpu fn`), `tests/syntax/pass/EaseTween.mtek`, `crates/mtek-compiler/tests/stdlib_registry.rs` (`the_easing_namespace_is_ten_cpu_curves`).
- Runtime: `packages/runtime-web/src/math/ease.test.ts` (endpoints, clamping, NaN, known values, binary32) and `operations.test.ts` (table rows exist with the right arity).
- In a browser: `TESTING-codey2.md`, section "Phase 6.2". Not run here.
