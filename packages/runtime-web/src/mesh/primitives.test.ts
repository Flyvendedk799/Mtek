import { describe, expect, it } from "vitest";
import { generateBox, generatePlane, generateSphere } from "./primitives.js";
import type { MeshData } from "./primitives.js";

// Expectations come from the spec tables (hand-computed vertex lists) and from
// geometry (cross products, distances), not from re-running the generators.

type V3 = readonly [number, number, number];

function at(a: ArrayLike<number>, i: number): number {
  const v = a[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
}

function vec(a: ArrayLike<number>, vertex: number): V3 {
  return [at(a, vertex * 3), at(a, vertex * 3 + 1), at(a, vertex * 3 + 2)];
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function len(a: V3): number {
  return Math.sqrt(dot(a, a));
}

/** Cheap assertion for hot loops over large meshes (vitest's `expect` is too slow for 10^5 checks). */
function assert(condition: boolean, message: () => string): void {
  if (!condition) throw new Error(message());
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function vertexCount(mesh: MeshData): number {
  return mesh.positions.length / 3;
}

/** Calls `visit` with the three vertex indices of every triangle. */
function forEachTriangle(mesh: MeshData, visit: (a: number, b: number, c: number, triangle: number) => void): void {
  expect(mesh.indices.length % 3).toBe(0);
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    visit(at(mesh.indices, t * 3), at(mesh.indices, t * 3 + 1), at(mesh.indices, t * 3 + 2), t);
  }
}

/** Asserts structural invariants shared by every primitive. */
function expectWellFormed(mesh: MeshData): void {
  const n = vertexCount(mesh);
  expect(Number.isInteger(n)).toBe(true);
  expect(mesh.normals.length).toBe(n * 3);
  expect(mesh.uvs.length).toBe(n * 2);
  expect(mesh.positions).toBeInstanceOf(Float32Array);
  expect(mesh.normals).toBeInstanceOf(Float32Array);
  expect(mesh.uvs).toBeInstanceOf(Float32Array);
  for (let i = 0; i < mesh.indices.length; i++) assert(at(mesh.indices, i) < n, () => `index ${i} is out of range`);
  // unit normals
  for (let v = 0; v < n; v++) assert(near(len(vec(mesh.normals, v)), 1, 1e-6), () => `normal ${v} is not unit length`);
  // uv within [0, 1]
  for (let i = 0; i < mesh.uvs.length; i++) {
    assert(at(mesh.uvs, i) >= 0 && at(mesh.uvs, i) <= 1, () => `uv component ${i} is outside [0, 1]`);
  }
  // every position lies inside the bounding sphere
  for (let v = 0; v < n; v++) {
    assert(len(vec(mesh.positions, v)) <= mesh.boundingRadius * (1 + 1e-6), () => `vertex ${v} is outside the bounding sphere`);
  }
}

/**
 * Counter-clockwise from outside, checked for every triangle two ways:
 * the geometric normal (b - a) x (c - a) agrees with each vertex normal, and, for
 * closed convex shapes centred on the origin, points away from the centre.
 */
function expectCounterClockwiseFromOutside(mesh: MeshData, closedAroundOrigin: boolean): void {
  forEachTriangle(mesh, (a, b, c, t) => {
    assert(a !== b && b !== c && a !== c, () => `triangle ${t} has repeated vertices`);
    const pa = vec(mesh.positions, a);
    const pb = vec(mesh.positions, b);
    const pc = vec(mesh.positions, c);
    const g = cross(sub(pb, pa), sub(pc, pa));
    assert(len(g) > 0, () => `triangle ${t} is degenerate`);
    for (const v of [a, b, c]) {
      assert(dot(g, vec(mesh.normals, v)) > 0, () => `triangle ${t} winds against vertex ${v}'s normal`);
    }
    if (closedAroundOrigin) {
      const centroid: V3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
      assert(dot(g, centroid) > 0, () => `triangle ${t} faces the centre`);
    }
  });
}

describe("generateBox (spec/stdlib.md 4)", () => {
  const box = generateBox([2, 4, 6]);

  it("has 24 vertices and 36 uint16 indices", () => {
    expect(vertexCount(box)).toBe(24);
    expect(box.indices).toHaveLength(36);
    expect(box.indices).toBeInstanceOf(Uint16Array);
  });

  // half extents h = (1, 2, 3); per face: [position, uv] for vertices 0..3 as in the spec
  // (c - a*u - b*v, c + a*u - b*v, c + a*u + b*v, c - a*u + b*v), computed by hand.
  const faces: Array<{ name: string; normal: V3; positions: V3[] }> = [
    { name: "+X", normal: [1, 0, 0], positions: [[1, -2, 3], [1, -2, -3], [1, 2, -3], [1, 2, 3]] },
    { name: "-X", normal: [-1, 0, 0], positions: [[-1, -2, -3], [-1, -2, 3], [-1, 2, 3], [-1, 2, -3]] },
    { name: "+Y", normal: [0, 1, 0], positions: [[-1, 2, 3], [1, 2, 3], [1, 2, -3], [-1, 2, -3]] },
    { name: "-Y", normal: [0, -1, 0], positions: [[-1, -2, -3], [1, -2, -3], [1, -2, 3], [-1, -2, 3]] },
    { name: "+Z", normal: [0, 0, 1], positions: [[-1, -2, 3], [1, -2, 3], [1, 2, 3], [-1, 2, 3]] },
    { name: "-Z", normal: [0, 0, -1], positions: [[1, -2, -3], [-1, -2, -3], [-1, 2, -3], [1, 2, -3]] },
  ];
  const uvCorners: Array<[number, number]> = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];

  faces.forEach((face, f) => {
    it(`emits face ${face.name} in order with the specified vertex order, normals and uv corners`, () => {
      for (let k = 0; k < 4; k++) {
        const v = f * 4 + k;
        expect(Array.from(vec(box.positions, v)), `${face.name} vertex ${k} position`).toEqual(face.positions[k]);
        expect(Array.from(vec(box.normals, v)), `${face.name} vertex ${k} normal`).toEqual(Array.from(face.normal));
        expect([at(box.uvs, v * 2), at(box.uvs, v * 2 + 1)], `${face.name} vertex ${k} uv`).toEqual(uvCorners[k]);
      }
      const base = f * 4;
      expect(Array.from(box.indices.slice(f * 6, f * 6 + 6))).toEqual([base, base + 1, base + 2, base, base + 2, base + 3]);
    });
  });

  it("has bounding radius |h|", () => {
    expect(box.boundingRadius).toBeCloseTo(Math.sqrt(14), 6);
  });

  for (const size of [
    [1, 1, 1],
    [2, 4, 6],
    [0.1, 5, 0.3],
    [7, 0.5, 2],
  ] as const) {
    it(`is well formed and counter-clockwise from outside for size ${size.join("x")}`, () => {
      const mesh = generateBox(size);
      expectWellFormed(mesh);
      expectCounterClockwiseFromOutside(mesh, true);
      expect(mesh.boundingRadius).toBeCloseTo(Math.hypot(size[0], size[1], size[2]) / 2, 6);
      // flat normals: all four vertices of a face share one axis-aligned normal
      for (let f = 0; f < 6; f++) {
        const n0 = vec(mesh.normals, f * 4);
        for (let k = 1; k < 4; k++) expect(Array.from(vec(mesh.normals, f * 4 + k))).toEqual(Array.from(n0));
        expect(Math.abs(n0[0]) + Math.abs(n0[1]) + Math.abs(n0[2])).toBe(1);
      }
    });
  }

  it("places the extremes at plus/minus half the size", () => {
    const mesh = generateBox([3, 5, 9]);
    const max = [0, 0, 0];
    for (let v = 0; v < 24; v++) for (let a = 0; a < 3; a++) max[a] = Math.max(max[a] as number, Math.abs(at(mesh.positions, v * 3 + a)));
    expect(max).toEqual([1.5, 2.5, 4.5]);
  });

  it("is deterministic", () => {
    const again = generateBox([2, 4, 6]);
    expect(Array.from(again.positions)).toEqual(Array.from(box.positions));
    expect(Array.from(again.indices)).toEqual(Array.from(box.indices));
  });

  it("rejects sizes that are not finite and positive", () => {
    expect(() => generateBox([0, 1, 1])).toThrow(RangeError);
    expect(() => generateBox([1, -1, 1])).toThrow(RangeError);
    expect(() => generateBox([1, 1, Number.NaN])).toThrow(RangeError);
    expect(() => generateBox([Infinity, 1, 1])).toThrow(RangeError);
  });
});

describe("generatePlane (spec/stdlib.md 4)", () => {
  const plane = generatePlane([4, 6]);

  it("has 4 vertices and 6 uint16 indices", () => {
    expect(vertexCount(plane)).toBe(4);
    expect(plane.indices).toHaveLength(6);
    expect(plane.indices).toBeInstanceOf(Uint16Array);
    expect(Array.from(plane.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("is the +Y face of a box at y = 0 with the specified vertex order and uv corners", () => {
    const expected: V3[] = [
      [-2, 0, 3],
      [2, 0, 3],
      [2, 0, -3],
      [-2, 0, -3],
    ];
    const uvs = [0, 1, 1, 1, 1, 0, 0, 0];
    for (let v = 0; v < 4; v++) {
      expect(Array.from(vec(plane.positions, v))).toEqual(Array.from(expected[v] as V3));
      expect(Array.from(vec(plane.normals, v))).toEqual([0, 1, 0]);
    }
    expect(Array.from(plane.uvs)).toEqual(uvs);
  });

  it("has bounding radius |(sx, sz)| / 2", () => {
    expect(plane.boundingRadius).toBeCloseTo(Math.sqrt(13), 6);
  });

  for (const size of [
    [1, 1],
    [4, 6],
    [0.2, 30],
  ] as const) {
    it(`is well formed and faces up (single-sided) for size ${size.join("x")}`, () => {
      const mesh = generatePlane(size);
      expectWellFormed(mesh);
      expectCounterClockwiseFromOutside(mesh, false);
      forEachTriangle(mesh, (a, b, c) => {
        const pa = vec(mesh.positions, a);
        const g = cross(sub(vec(mesh.positions, b), pa), sub(vec(mesh.positions, c), pa));
        expect(g[0]).toBeCloseTo(0, 6);
        expect(g[2]).toBeCloseTo(0, 6);
        expect(g[1]).toBeGreaterThan(0);
      });
      expect(mesh.boundingRadius).toBeCloseTo(Math.hypot(size[0], size[1]) / 2, 6);
    });
  }

  it("rejects sizes that are not finite and positive", () => {
    expect(() => generatePlane([0, 1])).toThrow(RangeError);
    expect(() => generatePlane([1, -2])).toThrow(RangeError);
    expect(() => generatePlane([Number.NaN, 1])).toThrow(RangeError);
  });
});

describe("generateSphere (spec/stdlib.md 4)", () => {
  it("S=4, R=2, r=2 matches the hand-computed vertices, uvs and indices", () => {
    const mesh = generateSphere(2, 4, 2);
    expect(vertexCount(mesh)).toBe(15);
    // row i = 0: north pole; row 1: equator at phi = 0, 90, 180, 270, 360 degrees; row 2: south pole
    const north: V3 = [0, 2, 0];
    const equator: V3[] = [
      [0, 0, 2],
      [2, 0, 0],
      [0, 0, -2],
      [-2, 0, 0],
      [0, 0, 2],
    ];
    const south: V3 = [0, -2, 0];
    const expected: V3[] = [...Array<V3>(5).fill(north), ...equator, ...Array<V3>(5).fill(south)];
    for (let k = 0; k < 15; k++) {
      const p = vec(mesh.positions, k);
      const e = expected[k] as V3;
      for (let a = 0; a < 3; a++) expect(at(p, a)).toBeCloseTo(at(e, a), 6);
      // normal = unit direction = position / r
      const n = vec(mesh.normals, k);
      for (let a = 0; a < 3; a++) expect(at(n, a)).toBeCloseTo(at(e, a) / 2, 6);
      // uv = (j / S, i / R)
      const i = Math.floor(k / 5);
      const j = k % 5;
      expect(at(mesh.uvs, k * 2)).toBeCloseTo(j / 4, 7);
      expect(at(mesh.uvs, k * 2 + 1)).toBeCloseTo(i / 2, 7);
    }
    // north cap triangles (a, b, c) for i = 0; south cap triangles (a, c, d) for i = 1
    expect(Array.from(mesh.indices)).toEqual([
      0, 5, 6, 1, 6, 7, 2, 7, 8, 3, 8, 9,
      5, 11, 6, 6, 12, 7, 7, 13, 8, 8, 14, 9,
    ]);
    expect(mesh.indices).toBeInstanceOf(Uint16Array);
    expect(mesh.boundingRadius).toBe(2);
  });

  const parameterSets: Array<[radius: number, segments: number, rings: number]> = [
    [0.5, 32, 16],
    [1, 3, 2],
    [2, 7, 5],
    [0.25, 4, 3],
    [3, 16, 8],
    [1, 64, 2],
    [1, 3, 64],
    [0.5, 256, 256],
  ];

  for (const [radius, segments, rings] of parameterSets) {
    describe(`radius ${radius}, ${segments} segments, ${rings} rings`, () => {
      const mesh = generateSphere(radius, segments, rings);

      it("has (R+1)(S+1) vertices and S(2R-2)*3 indices", () => {
        expect(vertexCount(mesh)).toBe((rings + 1) * (segments + 1));
        expect(mesh.indices.length).toBe(segments * (2 * rings - 2) * 3);
        expect(mesh.boundingRadius).toBe(radius);
      });

      it("is well formed with unit normals and uv in [0, 1]", () => {
        expectWellFormed(mesh);
      });

      it("winds every triangle counter-clockwise from outside", () => {
        expectCounterClockwiseFromOutside(mesh, true);
      });

      it("places every vertex on the sphere with normal = position / radius", () => {
        for (let v = 0; v < vertexCount(mesh); v++) {
          const p = vec(mesh.positions, v);
          assert(near(len(p), radius, 1e-5 * radius), () => `vertex ${v} is not on the sphere`);
          const n = vec(mesh.normals, v);
          for (let a = 0; a < 3; a++) assert(near(at(n, a), at(p, a) / radius, 1e-5), () => `normal ${v} is not position / radius`);
        }
      });

      it("assigns uv (j / S, i / R) and duplicates the seam with u = 1", () => {
        for (let i = 0; i <= rings; i++) {
          for (let j = 0; j <= segments; j++) {
            const k = i * (segments + 1) + j;
            assert(near(at(mesh.uvs, k * 2), j / segments, 1e-6), () => `u of vertex (${i}, ${j})`);
            assert(near(at(mesh.uvs, k * 2 + 1), i / rings, 1e-6), () => `v of vertex (${i}, ${j})`);
          }
          const first = i * (segments + 1);
          const last = first + segments;
          expect(at(mesh.uvs, first * 2)).toBe(0);
          expect(at(mesh.uvs, last * 2)).toBe(1);
          const a = vec(mesh.positions, first);
          const b = vec(mesh.positions, last);
          for (let axis = 0; axis < 3; axis++) assert(near(at(b, axis), at(a, axis), 1e-5 * radius), () => `seam of row ${i}`);
        }
      });

      it("skips exactly the degenerate pole triangles", () => {
        // the north pole row has S triangles with one vertex each, the south pole row likewise
        let northTriangles = 0;
        let southTriangles = 0;
        forEachTriangle(mesh, (a, b, c) => {
          for (const v of [a, b, c]) {
            const row = Math.floor(v / (segments + 1));
            if (row === 0) northTriangles++;
            if (row === rings) southTriangles++;
          }
        });
        // each cap triangle touches exactly one pole vertex; no other triangle touches a pole row
        expect(northTriangles).toBe(segments);
        expect(southTriangles).toBe(segments);
      });
    });
  }

  it("switches from uint16 to uint32 indices above 65 535 vertices", () => {
    // S = 256, R = 254 -> 257 * 255 = 65 535 vertices: still uint16
    const atLimit = generateSphere(1, 256, 254);
    expect(vertexCount(atLimit)).toBe(65535);
    expect(atLimit.indices).toBeInstanceOf(Uint16Array);
    let atLimitMax = 0;
    for (let i = 0; i < atLimit.indices.length; i++) atLimitMax = Math.max(atLimitMax, at(atLimit.indices, i));
    expect(atLimitMax).toBe(65534);
    // S = 256, R = 255 -> 257 * 256 = 65 792 vertices: uint32, and indices really exceed 16 bits
    const above = generateSphere(1, 256, 255);
    expect(vertexCount(above)).toBe(65792);
    expect(above.indices).toBeInstanceOf(Uint32Array);
    let max = 0;
    for (let i = 0; i < above.indices.length; i++) max = Math.max(max, at(above.indices, i));
    expect(max).toBe(65791);
    expect(above.indices.length).toBe(256 * (2 * 255 - 2) * 3);
    expectCounterClockwiseFromOutside(above, true);
  });

  it("uses the maximum 256 x 256 case with uint32 indices", () => {
    const mesh = generateSphere(1, 256, 256);
    expect(vertexCount(mesh)).toBe(257 * 257);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
  });

  it("evaluates trigonometry in f64 and stores f32 (positions are exact f32 roundings)", () => {
    const mesh = generateSphere(1.5, 32, 16);
    // vertex (i = 3, j = 5)
    const k = 3 * 33 + 5;
    const theta = (Math.PI * 3) / 16;
    const phi = (2 * Math.PI * 5) / 32;
    const expected = [
      1.5 * Math.sin(theta) * Math.sin(phi),
      1.5 * Math.cos(theta),
      1.5 * Math.sin(theta) * Math.cos(phi),
    ];
    for (let a = 0; a < 3; a++) expect(at(mesh.positions, k * 3 + a)).toBe(Math.fround(at(expected, a)));
  });

  it("is deterministic", () => {
    const a = generateSphere(1, 16, 8);
    const b = generateSphere(1, 16, 8);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it("rejects out-of-range descriptors (radius > 0, segments 3..256, rings 2..256, integers)", () => {
    expect(() => generateSphere(0, 8, 4)).toThrow(RangeError);
    expect(() => generateSphere(-1, 8, 4)).toThrow(RangeError);
    expect(() => generateSphere(Number.NaN, 8, 4)).toThrow(RangeError);
    expect(() => generateSphere(1, 2, 4)).toThrow(RangeError);
    expect(() => generateSphere(1, 257, 4)).toThrow(RangeError);
    expect(() => generateSphere(1, 8, 1)).toThrow(RangeError);
    expect(() => generateSphere(1, 8, 257)).toThrow(RangeError);
    expect(() => generateSphere(1, 8.5, 4)).toThrow(RangeError);
    expect(() => generateSphere(1, 8, 4.5)).toThrow(RangeError);
  });
});
