/**
 * Shape checks for the CPU value representation of `spec/runtime-abi.md` section 4.1, as the setters of
 * the generated-code context receive them: vectors `{x, y, z}`, quaternions `{x, y, z, w}`, colours
 * `{r, g, b, a}` (linear), numbers and booleans.
 */
import type { Quat, Vec3 } from "../math/mat4.js";

export type { Quat, Vec3 } from "../math/mat4.js";

/** A linear RGBA colour. */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function hasNumbers(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return keys.every((key) => typeof record[key] === "number");
}

export function isVec3(value: unknown): value is Vec3 {
  return hasNumbers(value, ["x", "y", "z"]);
}

export function isQuat(value: unknown): value is Quat {
  return hasNumbers(value, ["x", "y", "z", "w"]);
}

export function isColor(value: unknown): value is Color {
  return hasNumbers(value, ["r", "g", "b", "a"]);
}

export function isFiniteVec3(value: Vec3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function isFiniteQuat(value: Quat): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z) && Number.isFinite(value.w);
}

/** A short rendering of a value for diagnostics: `(1, 0, 0)`, `0.5`, `true`. */
export function describeValue(value: unknown): string {
  if (isColor(value)) return `(r ${String(value.r)}, g ${String(value.g)}, b ${String(value.b)}, a ${String(value.a)})`;
  if (isQuat(value)) return `(${String(value.x)}, ${String(value.y)}, ${String(value.z)}, ${String(value.w)})`;
  if (isVec3(value)) return `(${String(value.x)}, ${String(value.y)}, ${String(value.z)})`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return Object.prototype.toString.call(value);
}
