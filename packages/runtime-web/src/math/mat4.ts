/**
 * Internal runtime 4x4 matrix math (`spec/runtime-abi.md` 8.3, `spec/scenes.md` 12,
 * `spec/gpu-layout.md` 6.2).
 *
 * Matrices are `Float32Array(16)` in **column-major** order: the element at
 * (row `r`, column `c`) is stored at index `c * 4 + r`, so the translation of a
 * rigid transform is at indices 12, 13 and 14. Intermediate arithmetic runs in
 * f64 and every result is rounded once to f32 when it is stored. That suits the
 * renderer; Mtek-visible matrix operations (`rt`, `./matrix.ts`) instead round every
 * operation, in the order constant folding uses.
 *
 * Coordinate system: right-handed, `+Y` up, cameras look along their local `-Z`,
 * clip-space depth is `[0, 1]`.
 */

import type { Mat4, Quat, Vec3 } from "./types.js";

/** The value types live in `./types.ts`; re-exported for the renderer and the scene code. */
export type { Mat4, Quat, Vec3 } from "./types.js";

/**
 * How a camera is oriented: looking at a `target` (look-at with up `+Y`) or by an
 * explicit `rotation`. Exactly the two forms of `spec/scenes.md` 3.
 */
export type CameraOrientation = { readonly target: Vec3 } | { readonly rotation: Quat };

/** `|dot(f, +Y)|` above `1 - PARALLEL_EPSILON` selects the `-Z` up vector. */
const PARALLEL_EPSILON = 1e-6;

/** Reads element `i`; indices are produced internally and always in range. */
function at(a: ArrayLike<number>, i: number): number {
  const value = a[i];
  if (value === undefined) throw new RangeError(`matrix index ${i} out of range`);
  return value;
}

/** The identity matrix. */
export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

/** `T(v)`: translation by `v`. */
export function translation(v: Vec3): Mat4 {
  const m = identity();
  m[12] = v.x;
  m[13] = v.y;
  m[14] = v.z;
  return m;
}

/** `S(v)`: scale by `v` along the coordinate axes. */
export function scaling(v: Vec3): Mat4 {
  const m = new Float32Array(16);
  m[0] = v.x;
  m[5] = v.y;
  m[10] = v.z;
  m[15] = 1;
  return m;
}

/** The transpose of `m`. */
export function transpose(m: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) out[row * 4 + col] = at(m, col * 4 + row);
  }
  return out;
}

/** `a * b` (apply `b` first, then `a`). Inputs are not modified. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += at(a, k * 4 + row) * at(b, col * 4 + k);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** The rotation matrix of the unit quaternion `q` (no translation). */
export function rotation(q: Quat): Mat4 {
  const { x, y, z, w } = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  const m = new Float32Array(16);
  m[0] = 1 - 2 * (yy + zz);
  m[1] = 2 * (xy + wz);
  m[2] = 2 * (xz - wy);
  m[4] = 2 * (xy - wz);
  m[5] = 1 - 2 * (xx + zz);
  m[6] = 2 * (yz + wx);
  m[8] = 2 * (xz + wy);
  m[9] = 2 * (yz - wx);
  m[10] = 1 - 2 * (xx + yy);
  m[15] = 1;
  return m;
}

/**
 * Local transform `L = T(translation) * R(rotation) * S(scale)`
 * (`spec/scenes.md` 12). Scale is applied first, along the entity's local axes.
 */
export function fromRotationTranslationScale(rotationQuat: Quat, translationVec: Vec3, scale: Vec3): Mat4 {
  const r = rotation(rotationQuat);
  const m = new Float32Array(16);
  // Column c of the upper 3x3 is column c of R times scale component c.
  const scales = [scale.x, scale.y, scale.z] as const;
  for (let col = 0; col < 3; col++) {
    const s = scales[col] as number;
    m[col * 4] = at(r, col * 4) * s;
    m[col * 4 + 1] = at(r, col * 4 + 1) * s;
    m[col * 4 + 2] = at(r, col * 4 + 2) * s;
  }
  m[12] = translationVec.x;
  m[13] = translationVec.y;
  m[14] = translationVec.z;
  m[15] = 1;
  return m;
}

/**
 * Perspective projection, right-handed, looking down `-Z`, depth to `[0, 1]`
 * (`spec/runtime-abi.md` 8.3). `fovY` is the vertical field of view in radians and
 * `aspect` is `width / height`. Maps `z = -near` to depth 0 and `z = -far` to depth 1.
 */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}

/**
 * Orthographic projection, depth to `[0, 1]` (`spec/runtime-abi.md` 8.3). `height`
 * is the visible world height, the width is `height * aspect`. Maps `z = -near` to
 * depth 0 and `z = -far` to depth 1.
 */
export function orthographic(height: number, aspect: number, near: number, far: number): Mat4 {
  const width = height * aspect;
  const m = new Float32Array(16);
  m[0] = 2 / width;
  m[5] = 2 / height;
  m[10] = 1 / (near - far);
  m[14] = near / (near - far);
  m[15] = 1;
  return m;
}

/**
 * The camera rotation `R = columns(r, u, -f)` of a look-at from `position` to
 * `target` with up `+Y`, or `-Z` when `|dot(f, +Y)| > 1 - 1e-6`
 * (`spec/runtime-abi.md` 8.3). Throws `RangeError` when `position == target`
 * (callers treat that as `E8011` and ignore the write).
 */
export function lookAtRotation(position: Vec3, target: Vec3): Mat4 {
  let fx = target.x - position.x;
  let fy = target.y - position.y;
  let fz = target.z - position.z;
  const fLength = Math.hypot(fx, fy, fz);
  if (!(fLength > 0) || !Number.isFinite(fLength)) {
    throw new RangeError("look-at needs distinct, finite position and target");
  }
  fx /= fLength;
  fy /= fLength;
  fz /= fLength;

  // up = +Y, or -Z when the view direction is (nearly) parallel to +Y
  const upIsMinusZ = Math.abs(fy) > 1 - PARALLEL_EPSILON;
  const ux0 = 0;
  const uy0 = upIsMinusZ ? 0 : 1;
  const uz0 = upIsMinusZ ? -1 : 0;

  // r = normalize(cross(f, up))
  let rx = fy * uz0 - fz * uy0;
  let ry = fz * ux0 - fx * uz0;
  let rz = fx * uy0 - fy * ux0;
  const rLength = Math.hypot(rx, ry, rz);
  rx /= rLength;
  ry /= rLength;
  rz /= rLength;

  // u = cross(r, f)
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const m = new Float32Array(16);
  m[0] = rx;
  m[1] = ry;
  m[2] = rz;
  m[4] = ux;
  m[5] = uy;
  m[6] = uz;
  m[8] = -fx;
  m[9] = -fy;
  m[10] = -fz;
  m[15] = 1;
  return m;
}

/** `V = transpose(R) * T(-p)`: the inverse of the rigid transform `T(p) * R`. */
function viewFromRotation(position: Vec3, r: Mat4): Mat4 {
  return multiply(transpose(r), translation({ x: -position.x, y: -position.y, z: -position.z }));
}

/** View matrix of a camera at `position` looking at `target` (see {@link lookAtRotation}). */
export function lookAt(position: Vec3, target: Vec3): Mat4 {
  return viewFromRotation(position, lookAtRotation(position, target));
}

/**
 * View matrix of a camera at `position` (`spec/runtime-abi.md` 8.3): with a `target`
 * the look-at rotation (up `+Y`, `-Z` fallback), otherwise `R = rotation(q)`;
 * then `V = transpose(R) * T(-p)`.
 */
export function viewMatrix(position: Vec3, orientation: CameraOrientation): Mat4 {
  const r = "target" in orientation ? lookAtRotation(position, orientation.target) : rotation(orientation.rotation);
  return viewFromRotation(position, r);
}

/**
 * Normal matrix of `model` (`spec/gpu-layout.md` 6.2): the inverse-transpose of the
 * upper 3x3, placed in the upper 3x3 of a mat4 whose last row and column are
 * `(0, 0, 0, 1)`. Translation is ignored. Throws `RangeError` when the upper 3x3 is
 * singular (the runtime rejects scales that are not finite and positive earlier,
 * `E8090`).
 */
export function normalMatrix(model: Mat4): Mat4 {
  // M(r, c) = model[c * 4 + r]
  const a = at(model, 0);
  const b = at(model, 4);
  const c = at(model, 8);
  const d = at(model, 1);
  const e = at(model, 5);
  const f = at(model, 9);
  const g = at(model, 2);
  const h = at(model, 6);
  const i = at(model, 10);

  // cofactors C(r, c); the inverse-transpose of M is C / det(M)
  const c00 = e * i - f * h;
  const c01 = f * g - d * i;
  const c02 = d * h - e * g;
  const c10 = c * h - b * i;
  const c11 = a * i - c * g;
  const c12 = b * g - a * h;
  const c20 = b * f - c * e;
  const c21 = c * d - a * f;
  const c22 = a * e - b * d;

  const det = a * c00 + b * c01 + c * c02;
  if (det === 0 || !Number.isFinite(det)) {
    throw new RangeError("normal matrix of a singular transform is undefined");
  }
  const inv = 1 / det;

  const m = new Float32Array(16);
  m[0] = c00 * inv;
  m[1] = c10 * inv;
  m[2] = c20 * inv;
  m[4] = c01 * inv;
  m[5] = c11 * inv;
  m[6] = c21 * inv;
  m[8] = c02 * inv;
  m[9] = c12 * inv;
  m[10] = c22 * inv;
  m[15] = 1;
  return m;
}
