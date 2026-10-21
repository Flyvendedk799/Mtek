# Tweens: Easing Curves in Bindings (v0.1 extension)

- Repository path: `spec/tweens.md`
- Status: Normative for the small-game extension (decision 0135). Covers "tweens" of the small-game plan, phase 6, step 2.
- Depends on: `spec/stdlib.md` section 2 (the `easing` namespace), `spec/scenes.md` section 7 (bindings), section 10 (the frame).

---

## 1. Model

A tween is **program state plus a curve**. Mtek has no tween object, timeline or scheduler. A tween is:

1. a `state` progress value `t` in 0..1 that a lifecycle function or handler advances (usually `t = min(t + dt / duration, 1.0)` in `update`) or resets (`t = 0.0`);
2. a binding that maps `t` through an easing curve and `mix`: `bind(mix(from, to, easing.<curve>(t)))`.

The binding re-evaluates every frame (`spec/scenes.md` §7), so the entity follows the curve without any further code. Restarting, reversing (`1.0 - t`), chaining (a second progress state that starts when the first reaches 1) and looping (`fract`) are ordinary state logic.

## 2. Example

```mtek
scene Tween {
    // 0 at the start of the tween, 1 at its end.
    state t: f32 = 0.0;
    camera Cam { position: vec3(0.0, 0.0, 6.0); }
    entity Ball {
        position: bind(mix(vec3(-2.0, 0.0, 0.0), vec3(2.0, 0.0, 0.0), easing.in_out_cubic(t)));
        mesh: Sphere { radius: 0.5 };
    }
    update(dt: f32) {
        // A one-second tween.
        t = min(t + dt / 1.0, 1.0);
    }
    on key_down(Key.Space) {
        t = 0.0;
    }
}
```

## 3. The `easing` namespace

Ten functions, each `(t: f32) -> f32`, CPU only (`spec/stdlib.md` §2):

| Function | Curve (easings.net) | Overshoots |
|---|---|---|
| `easing.in_quad` | t² | no |
| `easing.out_quad` | 1 − (1 − t)² | no |
| `easing.in_out_quad` | quadratic in, quadratic out | no |
| `easing.in_cubic` | t³ | no |
| `easing.out_cubic` | 1 − (1 − t)³ | no |
| `easing.in_out_cubic` | cubic in, cubic out | no |
| `easing.in_out_sine` | −(cos(πt) − 1) / 2 | no |
| `easing.out_back` | back-out, c1 = 1.70158 | yes, about 10 % above 1 |
| `easing.out_elastic` | elastic-out, period 1/3 | yes |
| `easing.out_bounce` | bounce-out, n1 = 7.5625, d1 = 2.75 | no |

Rules:

1. **Clamped argument.** `t` is clamped to 0..1 before evaluation; NaN is treated as 0. So every curve returns exactly its value at 0 for `t <= 0` and at 1 for `t >= 1`, and every curve is 0 at 0 and 1 at 1.
2. **Binary32.** The result is rounded to `f32` (`spec/numerics.md`); the curves are computed in double precision and rounded once.
3. **Where they may be called.** In bindings (`bind(..)`), lifecycle functions, handlers and `cpu fn`s. A plain `fn` may not call them (`E4002`: a pure function calls a CPU-only built-in), because a `fn` may also run on the GPU and the curves have no WGSL implementation. Bindings are the one place a CPU-only built-in is allowed in `bind` (the binding pass exempts `easing.`, decision 0135); other CPU-only built-ins in `bind` are still rejected.
4. **Not constant.** The curves cannot appear in a `const` initialiser (`E3090`); bake a value into a literal instead.

## 4. Limits

- No GPU easing: shaders that need a curve write it out (`smoothstep` is available there).
- No tween objects, durations, delays, yoyo or callbacks: these are state logic (section 1).
- No user-defined curves in bindings other than through `mix`, `smoothstep` and the ten curves; a `cpu fn` is not callable from `bind`.
