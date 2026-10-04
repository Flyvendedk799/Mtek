/**
 * `i32` and `u32` operators, conversions and index clamping of the runtime math library `rt`
 * (`spec/language.md` 5.6, 6.3 and 6.5, `spec/runtime-abi.md` 4.1, decision 0037).
 *
 * An `i32` is a JavaScript number that equals `x | 0`, a `u32` one that equals `x >>> 0`. Every
 * helper takes and returns values with that invariant. The semantics equal WGSL's, so the CPU and
 * GPU agree bit for bit: arithmetic wraps modulo 2^32, `x / 0 = x`, `x % 0 = 0`,
 * `i32 MIN / -1 = MIN`, `i32 MIN % -1 = 0`, division truncates toward zero and the remainder has
 * the sign of the dividend.
 *
 * The emitter may inline the wrapping operators with the same patterns these helpers use
 * (`(a + b) | 0`, `Math.imul(a, b)`, `(a + b) >>> 0`, `Math.imul(a, b) >>> 0`); the conformance
 * tests check both forms against `tests/semantics/numeric/cpu.json`.
 */

/** `i32::MIN`. */
export const I32_MIN = -2147483648;
/** `i32::MAX`. */
export const I32_MAX = 2147483647;
/** `u32::MAX`. */
export const U32_MAX = 4294967295;

/** `a + b` for `i32`, wrapping. */
export function iadd(a: number, b: number): number {
  return (a + b) | 0;
}

/** `a - b` for `i32`, wrapping. */
export function isub(a: number, b: number): number {
  return (a - b) | 0;
}

/** `a * b` for `i32`, wrapping (the exact low 32 bits; a plain `*` would lose them above 2^53). */
export function imul(a: number, b: number): number {
  return Math.imul(a, b);
}

/** Unary `-a` for `i32`, wrapping: `-MIN = MIN`. */
export function ineg(a: number): number {
  return -a | 0;
}

/**
 * `a / b` for `i32`: truncates toward zero; `a / 0 = a`; `MIN / -1 = MIN`. For `i32` operands the
 * binary64 quotient never rounds across an integer (the distance to the next integer is at least
 * `1 / |b|`, relatively at least `2^-31`), so truncating it is exact; `| 0` wraps `MIN / -1`.
 */
export function idiv(a: number, b: number): number {
  if (b === 0) return a;
  return (a / b) | 0;
}

/**
 * `a % b` for `i32`: the remainder has the sign of the dividend; `a % 0 = 0`; `MIN % -1 = 0`.
 * JavaScript's `%` on integers is exact with the same sign rule; `| 0` turns `-0` into `0`.
 */
export function irem(a: number, b: number): number {
  if (b === 0) return 0;
  return (a % b) | 0;
}

/** `a + b` for `u32`, wrapping. */
export function uadd(a: number, b: number): number {
  return (a + b) >>> 0;
}

/** `a - b` for `u32`, wrapping (`0 - 1 = 4294967295`). */
export function usub(a: number, b: number): number {
  return (a - b) >>> 0;
}

/** `a * b` for `u32`, wrapping. */
export function umul(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

/** `a / b` for `u32`: truncates; `a / 0 = a`. */
export function udiv(a: number, b: number): number {
  if (b === 0) return a;
  return (a / b) >>> 0;
}

/** `a % b` for `u32`; `a % 0 = 0`. */
export function urem(a: number, b: number): number {
  if (b === 0) return 0;
  return (a % b) >>> 0;
}

/** `abs(x)` for `i32`: `abs(MIN) = MIN` (wrapping, as in WGSL). */
export function iabs(x: number): number {
  return x < 0 ? -x | 0 : x;
}

/** `abs(x)` for `u32`: the identity. */
export function uabs(x: number): number {
  return x;
}

/** `min(a, b)` for `i32`. */
export function imin(a: number, b: number): number {
  return b < a ? b : a;
}

/** `max(a, b)` for `i32`. */
export function imax(a: number, b: number): number {
  return b > a ? b : a;
}

/** `clamp(x, lo, hi) = min(max(x, lo), hi)` for `i32`; `lo > hi` gives `hi`, as on the GPU. */
export function iclamp(x: number, lo: number, hi: number): number {
  return imin(imax(x, lo), hi);
}

/** `min(a, b)` for `u32`. */
export const umin: (a: number, b: number) => number = imin;
/** `max(a, b)` for `u32`. */
export const umax: (a: number, b: number) => number = imax;
/** `clamp(x, lo, hi)` for `u32`. */
export const uclamp: (x: number, lo: number, hi: number) => number = iclamp;

/**
 * `i32(x)` of an `f32`: clamp to `[i32::MIN, i32::MAX]`, then truncate toward zero; NaN gives `0`
 * on the CPU (`spec/language.md` 6.5; NaN is non-portable on the GPU).
 */
export function f2i(x: number): number {
  if (x !== x) return 0;
  if (x >= I32_MAX) return I32_MAX;
  if (x <= I32_MIN) return I32_MIN;
  return x | 0; // ToInt32 truncates toward zero; in range, nothing wraps
}

/** `u32(x)` of an `f32`: clamp to `[0, u32::MAX]`, then truncate toward zero; NaN gives `0`. */
export function f2u(x: number): number {
  if (x !== x) return 0;
  if (x >= U32_MAX) return U32_MAX;
  if (x <= 0) return 0;
  return x >>> 0;
}

/** `f32(x)` of an `i32` or `u32`: round to nearest, ties to even (`Math.fround` does exactly that). */
export function i2f(x: number): number {
  return Math.fround(x);
}

/** `f32(x)` of a `u32`. */
export const u2f: (x: number) => number = i2f;

/** `u32(x)` of an `i32`: bit reinterpretation (`-1` becomes `4294967295`). */
export function i2u(x: number): number {
  return x >>> 0;
}

/** `i32(x)` of a `u32`: bit reinterpretation (`2147483648` becomes `i32::MIN`). */
export function u2i(x: number): number {
  return x | 0;
}

/** What {@link clampIndex} needs of the generated-code context (`spec/runtime-abi.md` 4.2). */
export interface IndexWarningContext {
  warn(code: "W8030", spanId: number): void;
}

/** Span ids already reported per context: `W8030` is reported once per call site. */
const reportedIndexSpans = new WeakMap<object, Set<number>>();

/**
 * A run-time array index clamped to `[0, n - 1]` (`spec/language.md` 5.6, decision 0009). `i` is an
 * `i32` or `u32`, `n` the constant array length (at least 1). The first time a given call site
 * (`spanId`, an index into the manifest `spans` table) clamps for a given `ctx`, it reports `W8030`
 * through `ctx.warn`; whether warnings are shown (development builds only) is the context's concern.
 */
export function clampIndex(i: number, n: number, spanId: number, ctx: IndexWarningContext): number {
  if (i >= 0 && i < n) return i;
  let spans = reportedIndexSpans.get(ctx);
  if (spans === undefined) {
    spans = new Set();
    reportedIndexSpans.set(ctx, spans);
  }
  if (!spans.has(spanId)) {
    spans.add(spanId);
    ctx.warn("W8030", spanId);
  }
  return i < 0 ? 0 : n - 1;
}
