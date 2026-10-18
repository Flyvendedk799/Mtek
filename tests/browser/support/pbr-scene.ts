// The geometry of `fixtures/m4/pbr` for the PBR browser spec (M4-03, decision 0057), derived by hand and sharing no code with the
// compiler or the runtime: the unit sphere at the origin seen by a pinhole camera on the +Z axis, so that for a pixel the surface
// point, the normal `N` and the view vector `V` follow from the ray of that pixel, and the direction of the directional light
// follows from its Euler angles. The lighting itself is the oracle `shadePbr` (reference-shading.ts).
import type { Vec3 } from "./reference-shading.ts";

/** Side of the square offscreen target the spec renders into. */
export const TARGET_SIZE = 256;
/** Camera position on the +Z axis, looking at the origin (the fixture's `camera Main`). */
export const CAMERA_DISTANCE = 3.5;
/** Full vertical field of view of the fixture's camera, as the binary32 the compiler stores. */
export const FOV_Y = Math.fround(0.9);
/** Radius of the fixture's sphere. */
export const SPHERE_RADIUS = 1;

/** The camera position of the fixture. */
export const CAMERA_POSITION: Vec3 = [0, 0, CAMERA_DISTANCE];

export interface SurfacePoint {
  /** World position of the visible point of the sphere. */
  readonly position: Vec3;
  /** Unit world normal: radial, for a sphere centred on the origin. */
  readonly N: Vec3;
  /** Unit vector from the point towards the camera. */
  readonly V: Vec3;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(a: Vec3): Vec3 {
  const length = Math.sqrt(dot(a, a));
  return [a[0] / length, a[1] / length, a[2] / length];
}

/**
 * The sphere point visible at pixel `(x, y)` of the square target (the sample is the pixel centre, `y` counts down from the
 * top), or `undefined` when the ray misses. With the camera on +Z looking at -Z and +Y up, the ray through NDC `(u, v)` is
 * `(u * tan(fov/2) * aspect, v * tan(fov/2), -1)` from the camera position; the visible point is the nearer root of
 * `|o + t d|^2 = r^2`.
 */
export function surfaceAt(x: number, y: number): SurfacePoint | undefined {
  const u = (2 * (x + 0.5)) / TARGET_SIZE - 1;
  const v = 1 - (2 * (y + 0.5)) / TARGET_SIZE;
  const tanHalf = Math.tan(FOV_Y / 2);
  const d: Vec3 = [u * tanHalf, v * tanHalf, -1];
  const o = CAMERA_POSITION;
  const a = dot(d, d);
  const b = 2 * dot(o, d);
  const c = dot(o, o) - SPHERE_RADIUS * SPHERE_RADIUS;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  const position: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  return { position, N: unit(position), V: unit(sub(o, position)) };
}

/**
 * The direction a light travels in when its entity's rotation is `quat.euler(pitch, yaw, 0)`: the world `-Z` axis turned by
 * `Ry(yaw) · Rx(pitch)` (the order of `quat.euler`, spec/stdlib.md), written out as the two rotations of the axis:
 * `Rx(p)(0, 0, -1) = (0, sin p, -cos p)`, then `Ry(w)` maps `(x, y, z)` to `(x cos w + z sin w, y, -x sin w + z cos w)`.
 */
export function sunDirection(pitch: number, yaw: number): Vec3 {
  const afterPitch: Vec3 = [0, Math.sin(pitch), -Math.cos(pitch)];
  return [
    afterPitch[0] * Math.cos(yaw) + afterPitch[2] * Math.sin(yaw),
    afterPitch[1],
    -afterPitch[0] * Math.sin(yaw) + afterPitch[2] * Math.cos(yaw),
  ];
}
