/**
 * `mat4` constructors and operators of the runtime math library `rt` (`spec/language.md` 5.3, 6.2
 * and 6.7, `spec/stdlib.md` 2 and 6, `spec/runtime-abi.md` 4.1).
 *
 * Unlike the renderer's matrix code in `./mat4.ts` (binary64 intermediates, one rounding per
 * stored element), these helpers round **every** operation to binary32, in the order constant
 * folding uses (decision 0026 item 6; `mat4.rotation` in decision 0037), so run-time results equal
 * folded constants bit for bit. The constructors without arithmetic are the ones of `./mat4.ts`.
 */
import { identity, scaling, translation, transpose } from "./mat4.js";
import type { Mat4, Quat, Vec3, Vec4 } from "./types.js";

const fr = Math.fround;

/** Reads element `i` of a matrix; indices are produced here and always in range. */
function at(m: Mat4, i: number): number {
  return m[i] as number;
}

/** `mat4.identity()`. */
export function m4identity(): Mat4 {
  return identity();
}

/** `mat4.translation(v)`. */
export function m4translation(v: Vec3): Mat4 {
  return translation(v);
}

/** `mat4.scale(v)`. */
export function m4scale(v: Vec3): Mat4 {
  return scaling(v);
}

/** `mat4.columns(c0, c1, c2, c3)`. */
export function m4columns(c0: Vec4, c1: Vec4, c2: Vec4, c3: Vec4): Mat4 {
  return new Float32Array([c0.x, c0.y, c0.z, c0.w, c1.x, c1.y, c1.z, c1.w, c2.x, c2.y, c2.z, c2.w, c3.x, c3.y, c3.z, c3.w]);
}

/**
 * `mat4.rotation(q)` of a unit quaternion, with `xx = x*x`, `xy = x*y`, `wz = w*z`, … each
 * rounded: column 0 is `(1 - 2*(yy + zz), 2*(xy + wz), 2*(xz - wy), 0)`, column 1
 * `(2*(xy - wz), 1 - 2*(xx + zz), 2*(yz + wx), 0)`, column 2
 * `(2*(xz + wy), 2*(yz - wx), 1 - 2*(xx + yy), 0)`, column 3 `(0, 0, 0, 1)`.
 */
export function m4rotation(q: Quat): Mat4 {
  const { x, y, z, w } = q;
  const xx = fr(x * x);
  const yy = fr(y * y);
  const zz = fr(z * z);
  const xy = fr(x * y);
  const xz = fr(x * z);
  const yz = fr(y * z);
  const wx = fr(w * x);
  const wy = fr(w * y);
  const wz = fr(w * z);
  const m = new Float32Array(16);
  m[0] = fr(1 - fr(2 * fr(yy + zz)));
  m[1] = fr(2 * fr(xy + wz));
  m[2] = fr(2 * fr(xz - wy));
  m[4] = fr(2 * fr(xy - wz));
  m[5] = fr(1 - fr(2 * fr(xx + zz)));
  m[6] = fr(2 * fr(yz + wx));
  m[8] = fr(2 * fr(xz + wy));
  m[9] = fr(2 * fr(yz - wx));
  m[10] = fr(1 - fr(2 * fr(xx + yy)));
  m[15] = 1;
  return m;
}

/** `m[i]`: column `i` as a `vec4`. `i` is already clamped to `0..3` by the emitter. */
export function m4col(m: Mat4, i: number): Vec4 {
  const base = i * 4;
  return { x: at(m, base), y: at(m, base + 1), z: at(m, base + 2), w: at(m, base + 3) };
}

/** Row `row` of `m` times the column `(v0, v1, v2, v3)`, products rounded, summed left to right. */
function rowTimes(m: Mat4, row: number, v0: number, v1: number, v2: number, v3: number): number {
  return fr(fr(fr(fr(at(m, row) * v0) + fr(at(m, 4 + row) * v1)) + fr(at(m, 8 + row) * v2)) + fr(at(m, 12 + row) * v3));
}

/** `a * b` (applies `b` first): element (row `i`, column `j`) is `sum_k a[k][i] * b[j][k]`, left to right. */
export function m4mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    const base = col * 4;
    const b0 = at(b, base);
    const b1 = at(b, base + 1);
    const b2 = at(b, base + 2);
    const b3 = at(b, base + 3);
    for (let row = 0; row < 4; row++) out[base + row] = rowTimes(a, row, b0, b1, b2, b3);
  }
  return out;
}

/** `m * v`: component `i` is `m[0][i]*v.x + m[1][i]*v.y + m[2][i]*v.z + m[3][i]*v.w`, left to right. */
export function m4mulv(m: Mat4, v: Vec4): Vec4 {
  return {
    x: rowTimes(m, 0, v.x, v.y, v.z, v.w),
    y: rowTimes(m, 1, v.x, v.y, v.z, v.w),
    z: rowTimes(m, 2, v.x, v.y, v.z, v.w),
    w: rowTimes(m, 3, v.x, v.y, v.z, v.w),
  };
}

/** `transpose(m)`. */
export function m4transpose(m: Mat4): Mat4 {
  return transpose(m);
}
