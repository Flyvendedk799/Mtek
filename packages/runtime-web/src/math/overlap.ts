import { rotation } from "./mat4.js";
import type { Quat, Vec3 } from "./types.js";

function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function valid(v: Vec3): boolean { return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z); }

/** Closed spheres: touching counts as overlap, like Rapier's shape intersection. */
export function overlapSpheres(a: Vec3, radiusA: number, b: Vec3, radiusB: number): boolean {
  if (!valid(a) || !valid(b) || !Number.isFinite(radiusA + radiusB) || radiusA < 0 || radiusB < 0) return false;
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz <= (radiusA + radiusB) ** 2;
}

function axes(q: Quat): readonly Vec3[] {
  const m = rotation(q);
  return [0, 4, 8].map(i => ({ x: m[i] ?? 0, y: m[i + 1] ?? 0, z: m[i + 2] ?? 0 }));
}

/** Oriented boxes; sizes are full world-space dimensions, as in BoxCollider. */
export function overlapBoxes(a: Vec3, sizeA: Vec3, rotationA: Quat, b: Vec3, sizeB: Vec3, rotationB: Quat): boolean {
  if (![a, sizeA, b, sizeB].every(valid) || [sizeA, sizeB].some(s => s.x < 0 || s.y < 0 || s.z < 0)) return false;
  const aa = axes(rotationA), bb = axes(rotationB);
  const delta = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const extent = (basis: readonly Vec3[], size: Vec3, axis: Vec3): number =>
    basis.reduce((sum, v, i) => sum + Math.abs(dot(v, axis)) * ([size.x, size.y, size.z][i] ?? 0) * 0.5, 0);
  for (const axis of [...aa, ...bb, ...aa.flatMap(x => bb.map(y => cross(x, y)))]) {
    if (dot(axis, axis) < 1e-12) continue;
    if (Math.abs(dot(delta, axis)) > extent(aa, sizeA, axis) + extent(bb, sizeB, axis)) return false;
  }
  return true;
}
