// CPU reference for the built-in PBR shading model (spec/testing.md section 6.4): an `f64`
// implementation of the formulas of spec/materials.md section 8, one numbered rule per block below, so
// that a GPU image can be compared against it with a tolerance. It is a test oracle: it shares no code
// with the runtime or the compiler (only a type is imported from the sibling M1 reference), and it
// implements the specification as written. Where the specification differs from a published
// reference (glTF Sample Renderer, Filament) the difference is recorded as an operator question, not
// "corrected" here; see the review notes in `reference-shading.test.ts`.
//
// Conventions of the inputs, all in world space:
// - `N` and `V` are normalised here (the shader re-normalises the interpolated normal, and computes
//   `V = normalize(camera_position - world_position)`); a zero-length vector is a `RangeError`.
// - A directional light is given by the direction its light travels in (the entity's world `-Z`,
//   spec/materials.md section 7), so `L = -normalize(direction)`.
// - A point light is given by its world position; the shaded surface point is `position` (the origin
//   when omitted). `L` and `d` are the unit vector and the distance from the surface to the light.
// - Light colours, base colour and ambient colour are linear RGB. Nothing is clamped except what
//   section 8 clamps, and a light is not limited to the shader's four lights.
// A configuration for which section 8 has no defined value (`normalize` of a zero vector for the half
// vector, a point light exactly at the surface point, non-finite numbers) throws instead of returning a
// number that a shader would not reliably produce.

import type { Vec3 } from "./m1-reference.ts";

export type { Vec3 };

/** `DirectionalLight` component: `direction` is where the light travels (the entity's world `-Z`). */
export interface DirectionalLight {
  readonly kind: "directional";
  readonly direction: Vec3;
  /** Linear RGB. */
  readonly color: Vec3;
  /** Illuminance in lux. */
  readonly intensity: number;
}

/** `PointLight` component. `range` 0 (the default) is unlimited. */
export interface PointLight {
  readonly kind: "point";
  readonly position: Vec3;
  readonly color: Vec3;
  /** Luminous intensity in candela. */
  readonly intensity: number;
  readonly range?: number;
}

export type Light = DirectionalLight | PointLight;

export interface ShadeInput {
  /** World normal (normalised here). */
  readonly N: Vec3;
  /** Unit vector from the surface towards the camera (normalised here). */
  readonly V: Vec3;
  /** The shaded point in world space; matters for point lights only. Default: the origin. */
  readonly position?: Vec3;
  readonly lights: readonly Light[];
  /** Linear RGB `c`. */
  readonly baseColor: Vec3;
  readonly metallic: number;
  readonly roughness: number;
  /** Linear RGB. */
  readonly ambientColor: Vec3;
  readonly ambientIntensity: number;
}

/** Lower bound of the roughness clamp and of `NV` (spec/materials.md section 8, notation and rule 1). */
export const MIN_ROUGHNESS = 0.045;
export const MIN_NV = 1e-4;
/** Floor of `d²` in the point-light falloff (rule 6). */
export const MIN_DISTANCE_SQUARED = 1e-4;
/** Normal-incidence reflectance of a dielectric (rule 4). */
export const DIELECTRIC_F0 = 0.04;

function finite(value: number, what: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be a finite number, got ${String(value)}`);
  return value;
}

function checkedVec(v: Vec3, what: string): Vec3 {
  v.forEach((component, index) => finite(component, `${what}[${String(index)}]`));
  return v;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vec3, what: string): Vec3 {
  const len = length(a);
  if (len === 0) throw new RangeError(`${what} is a zero-length vector and cannot be normalised`);
  return [a[0] / len, a[1] / len, a[2] / len];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/** `(1 - x)⁵`, evaluated by repeated multiplication so that no `pow` rounding is involved. */
function oneMinusToFifth(x: number): number {
  const t = 1 - x;
  const t2 = t * t;
  return t2 * t2 * t;
}

/** One light's `(L, E)` for the surface point `p`: the unit vector towards the light and its radiance `E`. */
function lightAt(light: Light, p: Vec3): { readonly L: Vec3; readonly E: Vec3 } {
  checkedVec(light.color, "light colour");
  finite(light.intensity, "light intensity");
  if (light.kind === "directional") {
    const travel = normalize(checkedVec(light.direction, "directional light direction"), "directional light direction");
    const scale = light.intensity;
    return { L: [-travel[0], -travel[1], -travel[2]], E: [light.color[0] * scale, light.color[1] * scale, light.color[2] * scale] };
  }
  checkedVec(light.position, "point light position");
  const range = finite(light.range ?? 0, "point light range");
  if (range < 0) throw new RangeError(`point light range must be >= 0 (0 is unlimited), got ${String(range)}`);
  const toLight: Vec3 = [light.position[0] - p[0], light.position[1] - p[1], light.position[2] - p[2]];
  const d = length(toLight);
  if (d === 0) throw new RangeError("a point light at the shaded point has no direction");
  const L = normalize(toLight, "point light direction");
  // Rule 6: E = colour · intensity / max(d², 1e-4) · w, with w = 1 for an unlimited light and the
  // squared smooth window clamp(1 − (d / range)⁴, 0, 1)² otherwise.
  const window = range === 0 ? 1 : clamp(1 - Math.pow(d / range, 4), 0, 1) ** 2;
  const scale = (light.intensity / Math.max(d * d, MIN_DISTANCE_SQUARED)) * window;
  return { L, E: [light.color[0] * scale, light.color[1] * scale, light.color[2] * scale] };
}

/**
 * The linear RGB colour of a surface point lit per spec/materials.md section 8 (alpha is always 1 and
 * is not returned). Values above 1 are not clipped: there is no tone mapping.
 */
export function shadePbr(input: ShadeInput): Vec3 {
  const N = normalize(checkedVec(input.N, "N"), "N");
  const V = normalize(checkedVec(input.V, "V"), "V");
  const p = checkedVec(input.position ?? [0, 0, 0], "position");
  const c = checkedVec(input.baseColor, "baseColor");
  const ambientColor = checkedVec(input.ambientColor, "ambientColor");
  finite(input.ambientIntensity, "ambientIntensity");

  // Rule 1.
  const r = clamp(finite(input.roughness, "roughness"), MIN_ROUGHNESS, 1);
  const alpha = r * r;
  const alpha2 = alpha * alpha;
  const m = clamp(finite(input.metallic, "metallic"), 0, 1);
  // Rule 4, F0 = mix(vec3(0.04), c, m).
  const f0: Vec3 = [
    DIELECTRIC_F0 + (c[0] - DIELECTRIC_F0) * m,
    DIELECTRIC_F0 + (c[1] - DIELECTRIC_F0) * m,
    DIELECTRIC_F0 + (c[2] - DIELECTRIC_F0) * m,
  ];

  const NV = Math.max(dot(N, V), MIN_NV);
  const rgb: [number, number, number] = [0, 0, 0];
  for (const light of input.lights) {
    const { L, E } = lightAt(light, p);
    const NL = Math.max(dot(N, L), 0);
    // Rule 7 multiplies the whole light term by NL, so NL = 0 is exactly 0. Skipping here also covers
    // L = −V, where the half vector is undefined but the term is still 0 (a shader that evaluates
    // `normalize(L + V)` first gets NaN there, which is why it is worth a test).
    if (NL === 0) continue;
    const sum: Vec3 = [L[0] + V[0], L[1] + V[1], L[2] + V[2]];
    const H = normalize(sum, "L + V (the half vector)");
    const NH = Math.max(dot(N, H), 0);
    const VH = Math.max(dot(V, H), 0);

    // Rule 2: GGX / Trowbridge-Reitz distribution.
    const f = NH * NH * (alpha2 - 1) + 1;
    const D = alpha2 / (Math.PI * f * f);
    // Rule 3: height-correlated Smith-GGX visibility, 0 when the denominator is 0.
    const denominator = NL * Math.sqrt(NV * NV * (1 - alpha2) + alpha2) + NV * Math.sqrt(NL * NL * (1 - alpha2) + alpha2);
    const Vis = denominator === 0 ? 0 : 0.5 / denominator;
    // Rule 4: Schlick Fresnel.
    const w5 = oneMinusToFifth(VH);
    for (let i = 0; i < 3; i += 1) {
      const F = f0[i]! + (1 - f0[i]!) * w5;
      // Rule 5.
      const specular = D * Vis * F;
      const diffuse = ((1 - F) * (1 - m) * c[i]!) / Math.PI;
      // Rule 7, per light.
      rgb[i] = rgb[i]! + (diffuse + specular) * E[i]! * NL;
    }
  }
  // Rule 7, ambient: c · ambient_color · ambient_intensity (independent of metallic and roughness).
  for (let i = 0; i < 3; i += 1) rgb[i] = rgb[i]! + c[i]! * ambientColor[i]! * input.ambientIntensity;
  return rgb;
}

/**
 * The exact sRGB OETF (linear 0..1 to an encoded channel), rounded to 8 bits as an `-srgb` render
 * target stores it: `c <= 0.0031308 ? 12.92·c : 1.055·c^(1/2.4) − 0.055`, then `round(255 · …)`.
 * The input is clamped to 0..1 first (the target saturates); NaN is a `RangeError`.
 */
export function linearToSrgb8(linear: number): number {
  if (Number.isNaN(linear)) throw new RangeError("a NaN colour channel cannot be encoded");
  const c = clamp(linear, 0, 1);
  const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

/** `linearToSrgb8` of each channel of a linear RGB colour. */
export function linearRgbToSrgb8(rgb: Vec3): [number, number, number] {
  return [linearToSrgb8(rgb[0]), linearToSrgb8(rgb[1]), linearToSrgb8(rgb[2])];
}
