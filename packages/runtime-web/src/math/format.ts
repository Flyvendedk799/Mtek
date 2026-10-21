/**
 * `rt.fmt`: the text of one interpolated value, `"${value}"` or `"${value:.N}"` (spec/language.md
 * 5.6, decision 0133). The compiler passes the Mtek type of the value and the precision of a `.N`
 * format spec, or -1 without one.
 *
 * - `string` as it is; `bool` as `true` or `false`; `i32` and `u32` in decimal.
 * - `f32` without a spec: the shortest decimal that reads back as the same binary32 value, with
 *   `.0` added to whole numbers (`3.0`, `0.1`, `1e+21`), `NaN`, `inf` and `-inf`.
 * - `f32` with `.N`: exactly N digits after the decimal point (`toFixed`), rounding half away
 *   from zero as `toFixed` does on the binary value.
 * - `vec2`/`vec3`/`vec4`: `(x, y, z)`, each component formatted as an `f32` with the same spec.
 */

import type { Vec2, Vec3, Vec4 } from "./types.js";

/** The shortest decimal text of a binary32 value (see the module comment). */
export function formatF32(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  let text = String(value);
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = value.toPrecision(digits);
    if (Math.fround(Number(candidate)) === value) {
      text = String(Number(candidate));
      break;
    }
  }
  return /[.eEn]/.test(text) ? text : `${text}.0`;
}

function formatFloat(value: number, precision: number): string {
  if (precision < 0 || !Number.isFinite(value)) return formatF32(value);
  return value.toFixed(precision);
}

/** One interpolated value; `type` is its Mtek type name. */
export function fmt(value: unknown, type: string, precision: number): string {
  switch (type) {
    case "string":
      return typeof value === "string" ? value : "";
    case "bool":
      return value === true ? "true" : "false";
    case "i32":
    case "u32":
      return typeof value === "number" ? String(value) : "0";
    case "f32":
      return typeof value === "number" ? formatFloat(value, precision) : "NaN";
    case "vec2": {
      const v = value as Vec2;
      return `(${formatFloat(v.x, precision)}, ${formatFloat(v.y, precision)})`;
    }
    case "vec3": {
      const v = value as Vec3;
      return `(${formatFloat(v.x, precision)}, ${formatFloat(v.y, precision)}, ${formatFloat(v.z, precision)})`;
    }
    case "vec4": {
      const v = value as Vec4;
      return `(${formatFloat(v.x, precision)}, ${formatFloat(v.y, precision)}, ${formatFloat(v.z, precision)}, ${formatFloat(v.w, precision)})`;
    }
    default:
      return typeof value === "string" ? value : "";
  }
}
