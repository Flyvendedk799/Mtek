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

const VECTOR_KEYS: Readonly<Record<string, readonly string[]>> = {
  vec2: ["x", "y"],
  vec3: ["x", "y", "z"],
  vec4: ["x", "y", "z", "w"],
  quat: ["x", "y", "z", "w"],
  color: ["r", "g", "b", "a"],
};

/**
 * Why `value` is not a CPU value of the param type `type` (`spec/runtime-abi.md` section 4.1), or
 * `undefined` when it is. Scalars and vectors are checked fully (finite components, integer ranges); struct
 * and array params only for being an object or an array, since their members are the writers' business.
 * The generated writers never validate: a missing component would be written as NaN.
 */
export function paramValueProblem(type: string, value: unknown): string | undefined {
  switch (type) {
    case "f32":
      return typeof value === "number" && Number.isFinite(value) ? undefined : "expected a finite number";
    case "i32":
      return typeof value === "number" && Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31 ? undefined : "expected an integer in the i32 range";
    case "u32":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 2 ** 32 ? undefined : "expected an integer in the u32 range";
    case "bool":
      return typeof value === "boolean" ? undefined : "expected a boolean";
    case "mat4":
      return value instanceof Float32Array && value.length === 16 ? undefined : "expected a Float32Array of 16 numbers";
    default: {
      const keys = VECTOR_KEYS[type];
      if (keys === undefined) {
        return typeof value === "object" && value !== null ? undefined : `expected an object or array for the ${type} param`;
      }
      return hasNumbers(value, keys) && keys.every((key) => Number.isFinite((value as Record<string, number>)[key]))
        ? undefined
        : `expected {${keys.join(", ")}} with finite numbers`;
    }
  }
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
