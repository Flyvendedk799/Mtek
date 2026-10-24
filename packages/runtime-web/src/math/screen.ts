import { viewMatrix } from "./mat4.js";
import type { Vec2, Vec3 } from "./types.js";
import type { CameraRecord } from "../scene/world.js";

function view(camera: CameraRecord): Float32Array {
  return viewMatrix(camera.position, camera.target === null ? { rotation: camera.rotation } : { target: camera.target });
}

/** Canvas NDC to a point on the world Z plane. A parallel ray returns NaN x/y. */
export function screenToWorld(camera: CameraRecord, aspect: number, point: Vec2, z: number): Vec3 {
  const v = view(camera);
  const rotate = (x: number, y: number, localZ: number): Vec3 => ({
    x: (v[0] ?? 0) * x + (v[1] ?? 0) * y + (v[2] ?? 0) * localZ,
    y: (v[4] ?? 0) * x + (v[5] ?? 0) * y + (v[6] ?? 0) * localZ,
    z: (v[8] ?? 0) * x + (v[9] ?? 0) * y + (v[10] ?? 0) * localZ,
  });
  const p = camera.projection;
  const half = p.kind === "perspective" ? Math.tan(p.fov_y / 2) : p.height / 2;
  const x = point.x * half * aspect, y = point.y * half;
  const offset = p.kind === "perspective" ? { x: 0, y: 0, z: 0 } : rotate(x, y, 0);
  const direction = p.kind === "perspective" ? rotate(x, y, -1) : rotate(0, 0, -1);
  const origin = { x: camera.position.x + offset.x, y: camera.position.y + offset.y, z: camera.position.z + offset.z };
  if (Math.abs(direction.z) < 1e-8) return { x: NaN, y: NaN, z };
  const t = (z - origin.z) / direction.z;
  return { x: Math.fround(origin.x + t * direction.x), y: Math.fround(origin.y + t * direction.y), z };
}

/** World point to canvas NDC, with the active projection and viewport aspect ratio. */
export function worldToScreen(camera: CameraRecord, aspect: number, point: Vec3): Vec2 {
  const v = view(camera);
  const component = (row: number): number => (v[row] ?? 0) * point.x + (v[4 + row] ?? 0) * point.y + (v[8 + row] ?? 0) * point.z + (v[12 + row] ?? 0);
  const p = camera.projection;
  const half = p.kind === "perspective" ? -component(2) * Math.tan(p.fov_y / 2) : p.height / 2;
  return { x: Math.fround(component(0) / (half * aspect)), y: Math.fround(component(1) / half) };
}
