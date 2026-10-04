/**
 * The CPU value representation of `spec/runtime-abi.md` 4.1 for the numeric types.
 *
 * Every number stored in these values is a binary32 value (the result of `Math.fround`), and a
 * value is never mutated after creation: operations build new objects. The `readonly` modifiers
 * make that a compile-time property for TypeScript callers; generated JavaScript keeps it by
 * construction (decision 0037). Values are not frozen (`Object.freeze` cannot freeze a
 * `Float32Array` with elements, and freezing every vector would cost time on hot paths).
 */

/** `vec2`. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** `vec3`. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** `vec4`. */
export interface Vec4 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** `quat`: unit quaternion `(x, y, z, w)` (`spec/language.md` 5.1). */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** `color`: linear RGBA with straight alpha (`spec/language.md` 5.4). */
export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * `mat4`: a column-major `Float32Array(16)`; the element at (row `r`, column `c`) is at index
 * `c * 4 + r` (`spec/language.md` 5.3). Never written after creation.
 */
export type Mat4 = Float32Array;

/** A component name of a vector (`spec/language.md` 6.9). */
export type VecKey = "x" | "y" | "z" | "w";
