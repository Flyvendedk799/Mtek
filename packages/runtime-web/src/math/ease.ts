/**
 * The easing curves of the `easing` namespace (`spec/tweens.md`, decision 0135): `f32 -> f32`, the argument clamped to
 * `[0, 1]` (NaN counts as 0, so +∞ is 1 and −∞ is 0), computed in binary64 and rounded once to binary32. Every curve is 0 at
 * 0 and 1 at 1; `out_back` and `out_elastic` overshoot 1 in between. The formulas are those of easings.net.
 */
const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;
const ELASTIC_C4 = (2 * Math.PI) / 3;

function clamp01(t: number): number {
  return Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
}

function bounce(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x - 1.5 / d1) ** 2 + 0.75;
  if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) ** 2 + 0.9375;
  return n1 * (x - 2.625 / d1) ** 2 + 0.984375;
}

/** `easing.in_quad`: t². */
export function easeInQuad(t: number): number {
  const x = clamp01(t);
  return Math.fround(x * x);
}

/** `easing.out_quad`: 1 − (1 − t)². */
export function easeOutQuad(t: number): number {
  const x = clamp01(t);
  return Math.fround(1 - (1 - x) * (1 - x));
}

/** `easing.in_out_quad`: quadratic in, then out. */
export function easeInOutQuad(t: number): number {
  const x = clamp01(t);
  return Math.fround(x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
}

/** `easing.in_cubic`: t³. */
export function easeInCubic(t: number): number {
  const x = clamp01(t);
  return Math.fround(x * x * x);
}

/** `easing.out_cubic`: 1 − (1 − t)³. */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return Math.fround(1 - (1 - x) ** 3);
}

/** `easing.in_out_cubic`: cubic in, then out. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return Math.fround(x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
}

/** `easing.in_out_sine`: (1 − cos(π t)) / 2. */
export function easeInOutSine(t: number): number {
  const x = clamp01(t);
  return Math.fround((1 - Math.cos(Math.PI * x)) / 2);
}

/** `easing.out_back`: overshoots slightly past 1, then settles. */
export function easeOutBack(t: number): number {
  const x = clamp01(t);
  return Math.fround(1 + BACK_C3 * (x - 1) ** 3 + BACK_C1 * (x - 1) ** 2);
}

/** `easing.out_elastic`: springs past 1 and oscillates to rest. */
export function easeOutElastic(t: number): number {
  const x = clamp01(t);
  return Math.fround(x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ELASTIC_C4) + 1);
}

/** `easing.out_bounce`: bounces at 1 like a dropped ball. */
export function easeOutBounce(t: number): number {
  const x = clamp01(t);
  return Math.fround(bounce(x));
}
