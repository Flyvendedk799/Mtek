/**
 * `quat` constructors and operators of the runtime math library `rt` (`spec/language.md` 6.2 and
 * 6.7, `spec/runtime-abi.md` 4.1).
 *
 * The operation order is the one constant folding uses (decision 0026 item 6,
 * `crates/mtek-compiler/src/types/value.rs`), every operation rounded to binary32, so a run-time
 * result equals the folded constant bit for bit wherever no transcendental function is involved
 * (`qaxisAngle` and `qeuler` use `sin`/`cos`: binary64 rounded once here, binary32 `libm` in the
 * compiler; they agree within the tolerance of `spec/testing.md` 5).
 */
import type { Quat, Vec3 } from "./types.js";

const fr = Math.fround;

/** A quaternion from components (rounded to binary32). Not normalised. */
export function quat(x: number, y: number, z: number, w: number): Quat {
  return { x: fr(x), y: fr(y), z: fr(z), w: fr(w) };
}

/** `quat.identity()`. */
export function qidentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

/**
 * The Hamilton product `a * b` (rotates by `b` first, then by `a`):
 * `x = aw*bx + ax*bw + ay*bz - az*by`, `y = aw*by - ax*bz + ay*bw + az*bx`,
 * `z = aw*bz + ax*by - ay*bx + az*bw`, `w = aw*bw - ax*bx - ay*by - az*bz`, left to right.
 */
export function qmul(a: Quat, b: Quat): Quat {
  const { x: ax, y: ay, z: az, w: aw } = a;
  const { x: bx, y: by, z: bz, w: bw } = b;
  return {
    x: fr(fr(fr(fr(aw * bx) + fr(ax * bw)) + fr(ay * bz)) - fr(az * by)),
    y: fr(fr(fr(fr(aw * by) - fr(ax * bz)) + fr(ay * bw)) + fr(az * bx)),
    z: fr(fr(fr(fr(aw * bz) + fr(ax * by)) - fr(ay * bx)) + fr(az * bw)),
    w: fr(fr(fr(fr(aw * bw) - fr(ax * bx)) - fr(ay * by)) - fr(az * bz)),
  };
}

/** `q * v`: `t = 2 * cross(q.xyz, v)`, result `v + q.w * t + cross(q.xyz, t)`, left to right. */
export function qrotate(q: Quat, v: Vec3): Vec3 {
  const { x: qx, y: qy, z: qz, w } = q;
  const tx = fr(2 * fr(fr(qy * v.z) - fr(qz * v.y)));
  const ty = fr(2 * fr(fr(qz * v.x) - fr(qx * v.z)));
  const tz = fr(2 * fr(fr(qx * v.y) - fr(qy * v.x)));
  const cx = fr(fr(qy * tz) - fr(qz * ty));
  const cy = fr(fr(qz * tx) - fr(qx * tz));
  const cz = fr(fr(qx * ty) - fr(qy * tx));
  return {
    x: fr(fr(v.x + fr(w * tx)) + cx),
    y: fr(fr(v.y + fr(w * ty)) + cy),
    z: fr(fr(v.z + fr(w * tz)) + cz),
  };
}

/**
 * `quat.axis_angle(axis, angle)`: an all-zero axis gives the identity on the CPU (non-portable on
 * the GPU). Otherwise the axis is divided by its largest component magnitude (so squaring neither
 * underflows nor overflows), then by the length of the result; with `h = angle * 0.5` the result
 * is `(n * sin(h), cos(h))`.
 */
export function qaxisAngle(axis: Vec3, angle: number): Quat {
  // The largest magnitude as Rust's f32::max folds it: a NaN component is ignored.
  let largest = 0;
  for (const c of [axis.x, axis.y, axis.z]) {
    const m = Math.abs(c);
    if (m > largest) largest = m;
  }
  if (largest === 0) return qidentity();
  const sx = fr(axis.x / largest);
  const sy = fr(axis.y / largest);
  const sz = fr(axis.z / largest);
  const len = fr(Math.sqrt(fr(fr(fr(sx * sx) + fr(sy * sy)) + fr(sz * sz))));
  const nx = fr(sx / len);
  const ny = fr(sy / len);
  const nz = fr(sz / len);
  const half = fr(angle * 0.5);
  const sinHalf = fr(Math.sin(half));
  const cosHalf = fr(Math.cos(half));
  return { x: fr(nx * sinHalf), y: fr(ny * sinHalf), z: fr(nz * sinHalf), w: cosHalf };
}

const AXIS_X: Vec3 = { x: 1, y: 0, z: 0 };
const AXIS_Y: Vec3 = { x: 0, y: 1, z: 0 };
const AXIS_Z: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * `quat.euler(x, y, z) = (axis_angle(+Y, y) * axis_angle(+X, x)) * axis_angle(+Z, z)`: a vector is
 * rotated about Z first, then X, then Y, all fixed world axes (`spec/language.md` 6.7).
 */
export function qeuler(x: number, y: number, z: number): Quat {
  return qmul(qmul(qaxisAngle(AXIS_Y, y), qaxisAngle(AXIS_X, x)), qaxisAngle(AXIS_Z, z));
}
