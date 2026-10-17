/**
 * Frustum culling (`spec/runtime-abi.md` section 8.4, decision 0055): the six clip planes of
 * `view_proj`, and the test of a world-space bounding sphere against them.
 *
 * The planes are extracted from `view_proj = P * V` (Gribb and Hartmann) for the depth range `[0, 1]`
 * of section 8.3, so the same code serves the perspective and the orthographic projection. With the
 * clip position `c = view_proj * (p, 1)`, a point is inside the view volume when
 * `-c.w <= c.x <= c.w`, `-c.w <= c.y <= c.w` and `0 <= c.z <= c.w`; each inequality is one plane
 * `a*x + b*y + c*z + d >= 0` whose coefficients are a sum or difference of two rows of the matrix.
 * The coefficients are normalised so that `a*x + b*y + c*z + d` is the signed distance in world units
 * (positive inside), which is what a sphere radius is compared with.
 */
import type { Mat4 } from "../math/mat4.js";

/** Planes in the order left, right, bottom, top, near, far. */
export const PLANE_NAMES = ["left", "right", "bottom", "top", "near", "far"] as const;

/** The six normalised planes, four numbers each `(a, b, c, d)`, as 24 consecutive f64 values. */
export type FrustumPlanes = Float64Array;

/**
 * Extracts the six planes of `viewProj` (column-major, depth range `[0, 1]`) into `out`
 * (or a new array). The normals point into the view volume. A degenerate matrix (a plane whose
 * normal has length 0) yields a plane with all-zero coefficients, which never culls anything.
 */
export function extractFrustumPlanes(viewProj: Mat4, out: FrustumPlanes = new Float64Array(24)): FrustumPlanes {
  // Row r of the matrix is (m[r], m[4 + r], m[8 + r], m[12 + r]); a plane is `s1 * row r1 + s2 * row r2`.
  const plane = (index: number, r1: number, s1: number, r2: number, s2: number): void => {
    const coefficient = (column: number): number => s1 * (viewProj[column * 4 + r1] ?? 0) + s2 * (viewProj[column * 4 + r2] ?? 0);
    const a = coefficient(0);
    const b = coefficient(1);
    const c = coefficient(2);
    const d = coefficient(3);
    const length = Math.hypot(a, b, c);
    const scale = length > 0 ? 1 / length : 0;
    out[index * 4] = a * scale;
    out[index * 4 + 1] = b * scale;
    out[index * 4 + 2] = c * scale;
    out[index * 4 + 3] = d * scale;
  };
  plane(0, 3, 1, 0, 1); //  left:   w + x >= 0
  plane(1, 3, 1, 0, -1); // right:  w - x >= 0
  plane(2, 3, 1, 1, 1); //  bottom: w + y >= 0
  plane(3, 3, 1, 1, -1); // top:    w - y >= 0
  plane(4, 2, 1, 2, 0); //  near:   z >= 0 (depth range [0, 1])
  plane(5, 3, 1, 2, -1); // far:    w - z >= 0
  return out;
}

/**
 * True when the sphere `(cx, cy, cz)`, `radius` may be visible: it is not entirely on the outer side
 * of any plane. A sphere that only touches a plane counts as visible. The test is conservative: it
 * never culls a sphere that intersects the volume, and it may keep one that lies just outside near a
 * corner or an edge of the volume (a plane-by-plane test cannot tell).
 */
export function sphereIntersectsFrustum(planes: FrustumPlanes, cx: number, cy: number, cz: number, radius: number): boolean {
  for (let base = 0; base < 24; base += 4) {
    const distance = (planes[base] ?? 0) * cx + (planes[base + 1] ?? 0) * cy + (planes[base + 2] ?? 0) * cz + (planes[base + 3] ?? 0);
    if (distance < -radius) return false;
  }
  return true;
}

/** A world-space bounding sphere. */
export interface WorldSphere {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/**
 * The world-space bounding sphere of a mesh whose bounding sphere has radius `meshRadius` around the
 * mesh origin: centred at the translation of `world`, with the radius multiplied by the largest scale
 * of the world matrix (the longest of its three basis columns, so non-uniform and inherited scales are
 * covered). Written into `out` and returned.
 */
export function worldBoundingSphere(world: Mat4, meshRadius: number, out: WorldSphere = { x: 0, y: 0, z: 0, radius: 0 }): WorldSphere {
  const column = (c: number): number => Math.hypot(world[c * 4] ?? 0, world[c * 4 + 1] ?? 0, world[c * 4 + 2] ?? 0);
  out.x = world[12] ?? 0;
  out.y = world[13] ?? 0;
  out.z = world[14] ?? 0;
  out.radius = meshRadius * Math.max(column(0), column(1), column(2));
  return out;
}
