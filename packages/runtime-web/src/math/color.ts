/**
 * `color` constructors and accessors of the runtime math library `rt` (`spec/language.md` 5.4,
 * `spec/stdlib.md` 2, decision 0024 item 6).
 */
import type { Color, Vec3 } from "./types.js";

const fr = Math.fround;

/** A colour from linear components (rounded to binary32). */
export function color(r: number, g: number, b: number, a: number): Color {
  return { r: fr(r), g: fr(g), b: fr(b), a: fr(a) };
}

/** `color.linear(rgb, a)`: the components as given. */
export function clinear(rgb: Vec3, a: number): Color {
  return { r: rgb.x, g: rgb.y, b: rgb.z, a: fr(a) };
}

const SRGB_THRESHOLD = fr(0.04045);
const SRGB_LINEAR_SCALE = fr(12.92);
const SRGB_OFFSET = fr(0.055);
const SRGB_SCALE = fr(1.055);
const SRGB_GAMMA = fr(2.4);

/**
 * One channel of `color.srgb`: `c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)`, the
 * formula and operation order of constant folding (`srgb_channel_to_linear_f32` in the compiler),
 * every operation and every constant binary32. The compiler's `libm::powf` is binary32; here the
 * power is the binary64 `Math.pow` rounded once, so the two agree within the tolerance of
 * `spec/testing.md` 5 rather than bit for bit (decision 0024 item 6).
 */
export function srgbChannelToLinear(c: number): number {
  if (c <= SRGB_THRESHOLD) return fr(c / SRGB_LINEAR_SCALE);
  return fr(Math.pow(fr(fr(c + SRGB_OFFSET) / SRGB_SCALE), SRGB_GAMMA));
}

/** `color.srgb(rgb, a)`: each RGB channel through {@link srgbChannelToLinear}; alpha unchanged. */
export function csrgb(rgb: Vec3, a: number): Color {
  return { r: srgbChannelToLinear(rgb.x), g: srgbChannelToLinear(rgb.y), b: srgbChannelToLinear(rgb.z), a: fr(a) };
}

/** `c.rgb`. */
export function crgb(c: Color): Vec3 {
  return { x: c.r, y: c.g, z: c.b };
}
