/**
 * `f32` operators and intrinsics of the runtime math library `rt` (`spec/runtime-abi.md` 4.1,
 * `spec/language.md` 6.4 and 10, `spec/stdlib.md` 6, decision 0037).
 *
 * Arguments are binary32 values held in JavaScript numbers. Every function returns a binary32
 * value: each Mtek `f32` operation is computed in binary64 and rounded once with `Math.fround`.
 * For `+ - * /`, `sqrt` and `%` that is exactly the correctly rounded binary32 result (binary64
 * has more than twice the precision of binary32, so the double rounding is innocuous); for the
 * transcendental functions it is the binary64 library result rounded to binary32.
 *
 * Where WGSL leaves a result non-portable (NaN, infinities, `min`/`max` with NaN, `sign(NaN)`),
 * the CPU result defined here is the specified one (`spec/language.md` 6.4).
 */

const fr = Math.fround;

/** `a + b`. The emitter inlines the same thing as `Math.fround(a + b)`. */
export function fadd(a: number, b: number): number {
  return fr(a + b);
}

/** `a - b`. */
export function fsub(a: number, b: number): number {
  return fr(a - b);
}

/** `a * b`. */
export function fmul(a: number, b: number): number {
  return fr(a * b);
}

/** `a / b`; division by zero follows IEEE 754 (`spec/language.md` 6.4): `±inf`, or NaN for `0 / 0`. */
export function fdiv(a: number, b: number): number {
  return fr(a / b);
}

/**
 * `a % b`: the truncated remainder `a - b * trunc(a / b)` evaluated exactly, then rounded
 * (`spec/language.md` 6.2). JavaScript's `%` is that exact remainder (C `fmod`); the result of two
 * binary32 operands is always representable, so the rounding never changes it. `x % 0`, `inf % y`
 * are NaN; `x % inf` is `x`.
 */
export function frem(a: number, b: number): number {
  return fr(a % b);
}

/** Unary `-a` (exact; `-0` for `0`). */
export function fneg(a: number): number {
  return -a;
}

/** `abs(x)`. */
export function abs(x: number): number {
  return Math.abs(x);
}

/**
 * `min(a, b)`: `b < a ? b : a`, except that a NaN operand yields the other operand (and two NaNs
 * yield NaN) — the IEEE 754 `minNum` choice WGSL describes; NaN handling is non-portable on the GPU.
 * Between `+0` and `-0` the first operand is returned.
 */
export function min(a: number, b: number): number {
  if (b < a) return b;
  return a !== a ? b : a;
}

/** `max(a, b)`: `b > a ? b : a`, with the NaN rule of {@link min}. */
export function max(a: number, b: number): number {
  if (b > a) return b;
  return a !== a ? b : a;
}

/** `clamp(x, lo, hi) = min(max(x, lo), hi)`; `lo > hi` is non-portable. */
export function clamp(x: number, lo: number, hi: number): number {
  return min(max(x, lo), hi);
}

/** `saturate(x) = clamp(x, 0, 1)`. */
export function saturate(x: number): number {
  return min(max(x, 0), 1);
}

/** `mix(a, b, t) = a * (1 - t) + b * t`, each operation rounded, left to right. */
export function mix(a: number, b: number, t: number): number {
  return fr(fr(a * fr(1 - t)) + fr(b * t));
}

/** `step(edge, x)`: `1` where `x >= edge`, otherwise `0` (WGSL argument order; NaN gives `0`). */
export function step(edge: number, x: number): number {
  return x >= edge ? 1 : 0;
}

/**
 * `smoothstep(e0, e1, x)`: `t = clamp((x - e0) / (e1 - e0), 0, 1)`, result `t * t * (3 - 2 * t)`
 * evaluated as `(t * t) * (3 - (2 * t))`, every operation rounded.
 */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp(fr(fr(x - e0) / fr(e1 - e0)), 0, 1);
  return fr(fr(t * t) * fr(3 - fr(2 * t)));
}

/** `sqrt(x)`, correctly rounded. */
export function sqrt(x: number): number {
  return fr(Math.sqrt(x));
}

/** `inverse_sqrt(x)`: `1 / sqrt(x)` as one operation (one rounding). */
export function inverseSqrt(x: number): number {
  return fr(1 / Math.sqrt(x));
}

/**
 * `pow(base, exponent)` with the special cases of IEEE 754 / C99 Annex F `pow` (the `libm`
 * semantics constant folding uses): `pow(1, y) = 1` and `pow(-1, ±inf) = 1` for every `y`,
 * including NaN, where JavaScript's `Math.pow` returns NaN. Negative bases and `pow(0, y <= 0)`
 * are non-portable on the GPU.
 */
export function pow(base: number, exponent: number): number {
  if (base === 1) return 1;
  if (base === -1 && (exponent === Infinity || exponent === -Infinity)) return 1;
  return fr(Math.pow(base, exponent));
}

/** `exp(x)`. */
export function exp(x: number): number {
  return fr(Math.exp(x));
}

/** `exp2(x)`. */
export function exp2(x: number): number {
  return fr(Math.pow(2, x));
}

/** `log(x)`. */
export function log(x: number): number {
  return fr(Math.log(x));
}

/** `log2(x)`. */
export function log2(x: number): number {
  return fr(Math.log2(x));
}

/** `sin(x)`. */
export function sin(x: number): number {
  return fr(Math.sin(x));
}

/** `cos(x)`. */
export function cos(x: number): number {
  return fr(Math.cos(x));
}

/** `tan(x)`. */
export function tan(x: number): number {
  return fr(Math.tan(x));
}

/** `asin(x)`. */
export function asin(x: number): number {
  return fr(Math.asin(x));
}

/** `acos(x)`. */
export function acos(x: number): number {
  return fr(Math.acos(x));
}

/** `atan(x)`. */
export function atan(x: number): number {
  return fr(Math.atan(x));
}

/** `atan2(y, x)` (note the argument order). */
export function atan2(y: number, x: number): number {
  return fr(Math.atan2(y, x));
}

/** `floor(x)` (exact). */
export function floor(x: number): number {
  return Math.floor(x);
}

/** `ceil(x)` (exact; `ceil(-0.5) = -0`). */
export function ceil(x: number): number {
  return Math.ceil(x);
}

/** `trunc(x)` (exact; `trunc(-0.5) = -0`). */
export function trunc(x: number): number {
  return Math.trunc(x);
}

/**
 * `fract(x) = x - floor(x)`, rounded: in `[0, 1]`; a tiny negative `x` gives `1` (as WGSL notes).
 * `fract(±inf)` is NaN.
 */
export function fract(x: number): number {
  return fr(x - Math.floor(x));
}

/** `sign(x)`: `1`, `-1`, or `0` for both zeros (`sign(-0) = +0`); NaN gives NaN (non-portable). */
export function sign(x: number): number {
  if (x > 0) return 1;
  if (x < 0) return -1;
  return x === 0 ? 0 : x;
}

/** `2^23`: every binary32 value of at least this magnitude is an integer. */
const INTEGRAL_THRESHOLD = 8388608;

/**
 * `round(x)`: nearest integer, halves to **even** (WGSL `round`, IEEE `roundTiesToEven`) — not
 * JavaScript's `Math.round`, which rounds halves up. The sign of zero is kept (`round(-0.25) = -0`).
 */
export function round(x: number): number {
  if (!(Math.abs(x) < INTEGRAL_THRESHOLD)) return x; // integral already, ±inf or NaN
  const down = Math.floor(x);
  const diff = x - down; // exact: x has at most 24 significant bits
  let result: number;
  if (diff < 0.5) result = down;
  else if (diff > 0.5) result = down + 1;
  else result = down % 2 === 0 ? down : down + 1;
  // A negative input that rounds to zero gives -0, like roundTiesToEven.
  return result === 0 && (x < 0 || Object.is(x, -0)) ? -0 : result;
}

/** The binary32 value nearest `π / 180`. */
const RADIANS_PER_DEGREE = fr(Math.PI / 180);

/** The binary32 value nearest `180 / π`. */
const DEGREES_PER_RADIAN = fr(180 / Math.PI);

/** `radians(x)`: one binary32 multiplication by the binary32 constant nearest `π / 180`. */
export function radians(x: number): number {
  return fr(x * RADIANS_PER_DEGREE);
}

/** `degrees(x)`: one binary32 multiplication by the binary32 constant nearest `180 / π`. */
export function degrees(x: number): number {
  return fr(x * DEGREES_PER_RADIAN);
}

/** `length(x)` of a scalar: `abs(x)`. */
export function length(x: number): number {
  return Math.abs(x);
}

/** `distance(a, b)` of scalars: `abs(a - b)`. */
export function distance(a: number, b: number): number {
  return Math.abs(fr(a - b));
}
