import { describe, expect, it } from "vitest";
import { fromRotationTranslationScale, multiply, orthographic, perspective, scaling, translation, viewMatrix, identity } from "../math/mat4.js";
import type { Mat4 } from "../math/mat4.js";
import { PLANE_NAMES, extractFrustumPlanes, sphereIntersectsFrustum, worldBoundingSphere } from "./frustum.js";

const S = Math.SQRT1_2;

/** One plane `(a, b, c, d)` of the extracted set, by name. */
function plane(planes: Float64Array, name: (typeof PLANE_NAMES)[number]): number[] {
  const base = PLANE_NAMES.indexOf(name) * 4;
  return [planes[base] ?? NaN, planes[base + 1] ?? NaN, planes[base + 2] ?? NaN, planes[base + 3] ?? NaN];
}

function expectPlane(planes: Float64Array, name: (typeof PLANE_NAMES)[number], expected: readonly number[]): void {
  const actual = plane(planes, name);
  expected.forEach((value, i) => {
    // The matrices are f32. The far plane is built from the difference of two nearly equal entries
    // (-1 and far / (far - near)), so its offset is only good to about 1e-5 relative; a wrong plane is off by far more.
    const tolerance = 1e-5 * Math.max(1, Math.abs(value));
    expect(Math.abs((actual[i] ?? NaN) - value), `${name}[${String(i)}] of ${JSON.stringify(actual)}`).toBeLessThanOrEqual(tolerance);
  });
}

describe("extractFrustumPlanes: planes derived by hand from the view volume", () => {
  // A 90 degree vertical field of view and aspect 1 make the side planes 45 degree planes through the
  // eye: the view volume is |x| <= -z, |y| <= -z, near <= -z <= far. Each expectation below is the
  // inward-pointing unit normal of one of those half-spaces, written down without using the matrices.
  const near = 1;
  const far = 100;
  const proj = perspective(Math.PI / 2, 1, near, far);

  it("a camera at the origin looking down -Z", () => {
    const planes = extractFrustumPlanes(multiply(proj, identity()));
    expectPlane(planes, "left", [S, 0, -S, 0]); //   x + (-z) >= 0
    expectPlane(planes, "right", [-S, 0, -S, 0]); // -x + (-z) >= 0
    expectPlane(planes, "bottom", [0, S, -S, 0]); // y + (-z) >= 0
    expectPlane(planes, "top", [0, -S, -S, 0]); //   -y + (-z) >= 0
    expectPlane(planes, "near", [0, 0, -1, -near]); // -z - near >= 0
    expectPlane(planes, "far", [0, 0, 1, far]); //    z + far >= 0
  });

  it("moving the camera moves the planes with it", () => {
    // Camera at (5, 0, 0): the view is T(-5, 0, 0). The side planes pass through the eye, so
    // left: (x - 5) - z >= 0 has d = -5 / sqrt 2 and right has d = +5 / sqrt 2; near and far do not depend on x.
    const planes = extractFrustumPlanes(multiply(proj, translation({ x: -5, y: 0, z: 0 })));
    expectPlane(planes, "left", [S, 0, -S, -5 * S]);
    expectPlane(planes, "right", [-S, 0, -S, 5 * S]);
    expectPlane(planes, "bottom", [0, S, -S, 0]);
    expectPlane(planes, "top", [0, -S, -S, 0]);
    expectPlane(planes, "near", [0, 0, -1, -near]);
    expectPlane(planes, "far", [0, 0, 1, far]);
  });

  it("a camera at the origin looking along +X (right = +Z, up = +Y)", () => {
    // The view basis is right = forward x up = (1,0,0) x (0,1,0) = (0,0,1), so x_view = z_world and
    // -z_view = x_world: the volume is |z| <= x, |y| <= x, near <= x <= far.
    const view = viewMatrix({ x: 0, y: 0, z: 0 }, { target: { x: 1, y: 0, z: 0 } });
    const planes = extractFrustumPlanes(multiply(proj, view));
    expectPlane(planes, "left", [S, 0, S, 0]); //    z + x >= 0
    expectPlane(planes, "right", [S, 0, -S, 0]); //  -z + x >= 0
    expectPlane(planes, "bottom", [S, S, 0, 0]); //  y + x >= 0
    expectPlane(planes, "top", [S, -S, 0, 0]); //    -y + x >= 0
    expectPlane(planes, "near", [1, 0, 0, -near]); // x - near >= 0
    expectPlane(planes, "far", [-1, 0, 0, far]); //  -x + far >= 0
  });

  it("an orthographic camera gives axis-aligned planes at the half extents", () => {
    // height 10, aspect 2: x in [-10, 10], y in [-5, 5]; near 0.5, far 20 along -Z.
    const planes = extractFrustumPlanes(multiply(orthographic(10, 2, 0.5, 20), identity()));
    expectPlane(planes, "left", [1, 0, 0, 10]);
    expectPlane(planes, "right", [-1, 0, 0, 10]);
    expectPlane(planes, "bottom", [0, 1, 0, 5]);
    expectPlane(planes, "top", [0, -1, 0, 5]);
    expectPlane(planes, "near", [0, 0, -1, -0.5]);
    expectPlane(planes, "far", [0, 0, 1, 20]);
  });

  it("normalises every plane", () => {
    const planes = extractFrustumPlanes(multiply(perspective(1.1, 1.7, 0.3, 50), viewMatrix({ x: 3, y: 2, z: 8 }, { target: { x: 0, y: 0.5, z: 0 } })));
    for (const name of PLANE_NAMES) {
      const [a = 0, b = 0, c = 0] = plane(planes, name);
      expect(Math.hypot(a, b, c)).toBeCloseTo(1, 12);
    }
  });

  it("writes into the array it is given and returns it", () => {
    const out = new Float64Array(24);
    expect(extractFrustumPlanes(proj, out)).toBe(out);
    expect(plane(out, "near")[2]).toBeCloseTo(-1, 6);
  });

  it("a degenerate matrix gives all-zero planes, which never cull", () => {
    const planes = extractFrustumPlanes(new Float32Array(16));
    expect([...planes].every((value) => value === 0)).toBe(true);
    expect(sphereIntersectsFrustum(planes, 1e9, 0, 0, 0)).toBe(true);
  });
});

describe("sphereIntersectsFrustum on the 90 degree frustum", () => {
  // The volume of the previous suite: |x| <= -z, |y| <= -z, 1 <= -z <= 100. The distance of a point to the
  // right plane is (-x - z) / sqrt 2, so a sphere of radius r at z = -10 is culled by it exactly when
  // (10 - x) / sqrt 2 < -r, that is x > 10 + r sqrt 2 (11.4142... for r = 1).
  const planes = extractFrustumPlanes(multiply(perspective(Math.PI / 2, 1, 1, 100), identity()));
  const test = (x: number, y: number, z: number, r: number): boolean => sphereIntersectsFrustum(planes, x, y, z, r);

  it("keeps spheres inside and culls spheres outside", () => {
    expect(test(0, 0, -10, 1)).toBe(true);
    expect(test(20, 0, -10, 1)).toBe(false);
    expect(test(-20, 0, -10, 1)).toBe(false);
    expect(test(0, 20, -10, 1)).toBe(false);
    expect(test(0, -20, -10, 1)).toBe(false);
  });

  it("decides at the radius: tangent beyond a side plane is culled, straddling is kept", () => {
    expect(test(11.4, 0, -10, 1)).toBe(true);
    expect(test(11.43, 0, -10, 1)).toBe(false);
    expect(test(-11.4, 0, -10, 1)).toBe(true);
    expect(test(-11.43, 0, -10, 1)).toBe(false);
    expect(test(0, 11.4, -10, 1)).toBe(true);
    expect(test(0, 11.43, -10, 1)).toBe(false);
  });

  it("a sphere reaching just past the near plane is visible, one stopping just short is not", () => {
    // (0, 0, -0.5) is 0.5 in front of the near plane z = -1 (outside, towards the eye).
    expect(test(0, 0, -0.5, 0.5001)).toBe(true);
    expect(test(0, 0, -0.5, 0.4999)).toBe(false);
  });

  it("culls spheres in front of the near plane, behind the camera and beyond the far plane", () => {
    expect(test(0, 0, -0.5, 0.3)).toBe(false);
    expect(test(0, 0, 5, 1)).toBe(false);
    expect(test(0, 0, -105, 1)).toBe(false);
    expect(test(0, 0, -100.5, 1)).toBe(true);
    expect(test(0, 0, -101.5, 1)).toBe(false);
  });

  it("keeps a sphere that contains the whole volume's near end", () => {
    expect(test(0, 0, 0, 50)).toBe(true);
  });
});

/** Deterministic pseudo-random numbers in [0, 1) (a 32-bit LCG; independent of the code under test). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** The definition of the view volume: the clip coordinates of the point satisfy the three inequalities. */
function insideClipVolume(m: Mat4, x: number, y: number, z: number, margin: number): boolean {
  const clip = (row: number): number => (m[row] ?? 0) * x + (m[4 + row] ?? 0) * y + (m[8 + row] ?? 0) * z + (m[12 + row] ?? 0);
  const [cx, cy, cz, w] = [clip(0), clip(1), clip(2), clip(3)];
  return w - cx > margin && w + cx > margin && w - cy > margin && w + cy > margin && cz > margin && w - cz > margin;
}

describe("sphereIntersectsFrustum agrees with the clip-space definition of the view volume", () => {
  const random = lcg(0x5eed);
  const cameras: Array<{ name: string; viewProj: Mat4 }> = [
    {
      name: "perspective, looking at a target",
      viewProj: multiply(perspective(0.9, 1.6, 0.5, 60), viewMatrix({ x: 4, y: 3, z: 9 }, { target: { x: -1, y: 0.5, z: 0 } })),
    },
    {
      name: "perspective, rotated",
      viewProj: multiply(perspective(1.3, 0.8, 0.1, 30), viewMatrix({ x: -2, y: 1, z: -3 }, { rotation: { x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) } })),
    },
    {
      name: "orthographic",
      viewProj: multiply(orthographic(8, 1.5, 0.2, 40), viewMatrix({ x: 1, y: 6, z: 7 }, { target: { x: 0, y: 0, z: 0 } })),
    },
  ];

  for (const { name, viewProj } of cameras) {
    it(`points (radius 0): ${name}`, () => {
      const planes = extractFrustumPlanes(viewProj);
      let inside = 0;
      let outside = 0;
      for (let i = 0; i < 4000; i += 1) {
        const x = (random() - 0.5) * 60;
        const y = (random() - 0.5) * 60;
        const z = (random() - 0.5) * 60;
        // Skip points within 1e-3 of a boundary: the f32 matrix and the f64 planes may disagree there.
        const strictlyInside = insideClipVolume(viewProj, x, y, z, 1e-3);
        const strictlyOutside = !insideClipVolume(viewProj, x, y, z, -1e-3);
        if (!strictlyInside && !strictlyOutside) continue;
        expect(sphereIntersectsFrustum(planes, x, y, z, 0), `${name} at (${String(x)}, ${String(y)}, ${String(z)})`).toBe(strictlyInside);
        if (strictlyInside) inside += 1;
        else outside += 1;
      }
      // The sample must exercise both answers, or the loop proves nothing.
      expect(inside).toBeGreaterThan(20);
      expect(outside).toBeGreaterThan(20);
    });

    it(`never culls a sphere that has a point inside the volume: ${name}`, () => {
      const planes = extractFrustumPlanes(viewProj);
      let kept = 0;
      for (let i = 0; i < 3000; i += 1) {
        const cx = (random() - 0.5) * 50;
        const cy = (random() - 0.5) * 50;
        const cz = (random() - 0.5) * 50;
        const r = random() * 4;
        // Points of the ball: the centre and 40 points on its surface and half-radius shell.
        let anyInside = insideClipVolume(viewProj, cx, cy, cz, 1e-3);
        for (let k = 0; k < 40 && !anyInside; k += 1) {
          const u = random() * 2 - 1;
          const phi = random() * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          const shell = k % 2 === 0 ? r : r / 2;
          anyInside = insideClipVolume(viewProj, cx + shell * s * Math.cos(phi), cy + shell * u, cz + shell * s * Math.sin(phi), 1e-3);
        }
        if (anyInside) {
          kept += 1;
          expect(sphereIntersectsFrustum(planes, cx, cy, cz, r), `sphere (${String(cx)}, ${String(cy)}, ${String(cz)}) r ${String(r)}`).toBe(true);
        }
      }
      expect(kept).toBeGreaterThan(50);
    });
  }
});

describe("worldBoundingSphere: radius times the largest world scale", () => {
  const q = (angle: number): { x: number; y: number; z: number; w: number } => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });

  it("an unscaled entity keeps the mesh radius and is centred at its translation", () => {
    const sphere = worldBoundingSphere(translation({ x: 1, y: 2, z: 3 }), 0.75);
    expect(sphere).toEqual({ x: 1, y: 2, z: 3, radius: 0.75 });
  });

  it("uses the largest axis scale and ignores rotation", () => {
    const world = fromRotationTranslationScale(q(0.7), { x: -4, y: 0.5, z: 9 }, { x: 2, y: 3, z: 4 });
    const sphere = worldBoundingSphere(world, 0.5);
    expect(sphere.x).toBeCloseTo(-4, 6);
    expect(sphere.y).toBeCloseTo(0.5, 6);
    expect(sphere.z).toBeCloseTo(9, 6);
    expect(sphere.radius).toBeCloseTo(0.5 * 4, 5);
  });

  it("includes the scale inherited from a parent", () => {
    const parent = scaling({ x: 3, y: 3, z: 3 });
    const child = fromRotationTranslationScale(q(1.2), { x: 1, y: 0, z: 0 }, { x: 1, y: 2, z: 1 });
    const sphere = worldBoundingSphere(multiply(parent, child), 1);
    expect(sphere.x).toBeCloseTo(3, 5);
    expect(sphere.radius).toBeCloseTo(6, 5); // the largest axis: 2 * 3
  });

  it("reuses the object it is given", () => {
    const out = { x: 0, y: 0, z: 0, radius: 0 };
    expect(worldBoundingSphere(identity(), 2, out)).toBe(out);
    expect(out.radius).toBe(2);
  });
});
