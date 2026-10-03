import { describe, expect, it } from "vitest";
import * as mat4 from "./mat4.js";
import type { Mat4, Quat, Vec3 } from "./mat4.js";

// Test oracles are written independently of the implementation: points are
// transformed with a plain column-major multiply written here, rotations are
// applied with the quaternion-vector formula (not a rotation matrix), and
// expectations come from geometric reasoning (depth of the near/far planes,
// where known world points land in view space, perpendicularity of normals).

const EPS = 1e-5;

function at(m: ArrayLike<number>, i: number): number {
  const v = m[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
}

/** Column-major `m * (x, y, z, w)`. */
function transform4(m: Mat4, p: readonly [number, number, number, number]): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let col = 0; col < 4; col++) sum += at(m, col * 4 + row) * (p[col] as number);
    out[row] = sum;
  }
  return out;
}

function transformPoint(m: Mat4, v: Vec3): Vec3 {
  const [x, y, z, w] = transform4(m, [v.x, v.y, v.z, 1]);
  return { x: x / w, y: y / w, z: z / w };
}

function transformDirection(m: Mat4, v: Vec3): Vec3 {
  const [x, y, z] = transform4(m, [v.x, v.y, v.z, 0]);
  return { x, y, z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scaleBy(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function mulComponents(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}
function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
function normalize(a: Vec3): Vec3 {
  return scaleBy(a, 1 / length(a));
}

/** Rotates `v` by the unit quaternion `q`: v + 2w(q×v) + 2 q×(q×v). */
function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  const qv: Vec3 = { x: q.x, y: q.y, z: q.z };
  const t = scaleBy(cross(qv, v), 2);
  return add(add(v, scaleBy(t, q.w)), cross(qv, t));
}

function axisAngle(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(angle / 2) };
}

function expectVec(actual: Vec3, expected: Vec3, eps = EPS): void {
  expect(actual.x).toBeCloseTo(expected.x, -Math.log10(eps));
  expect(actual.y).toBeCloseTo(expected.y, -Math.log10(eps));
  expect(actual.z).toBeCloseTo(expected.z, -Math.log10(eps));
}

describe("mat4 storage", () => {
  it("returns Float32Array(16) matrices", () => {
    expect(mat4.identity()).toBeInstanceOf(Float32Array);
    expect(mat4.identity()).toHaveLength(16);
    expect(mat4.perspective(0.9, 1.5, 0.1, 100)).toHaveLength(16);
  });

  it("identity has ones on the diagonal only", () => {
    const m = mat4.identity();
    for (let i = 0; i < 16; i++) expect(at(m, i)).toBe(i % 5 === 0 ? 1 : 0);
  });

  it("translation is stored in column-major indices 12, 13, 14", () => {
    const m = mat4.translation({ x: 1, y: 2, z: 3 });
    expect(at(m, 12)).toBe(1);
    expect(at(m, 13)).toBe(2);
    expect(at(m, 14)).toBe(3);
    expect(at(m, 15)).toBe(1);
    expect(at(m, 3)).toBe(0);
  });

  it("transpose swaps (row, column) and is an involution", () => {
    const m = new Float32Array(16);
    for (let i = 0; i < 16; i++) m[i] = i + 1;
    const t = mat4.transpose(m);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) expect(at(t, c * 4 + r)).toBe(at(m, r * 4 + c));
    expect(Array.from(mat4.transpose(t))).toEqual(Array.from(m));
  });
});

describe("mat4.perspective (spec/runtime-abi.md 8.3)", () => {
  const fovY = 0.9;
  const aspect = 16 / 9;
  const near = 0.1;
  const far = 250;
  const p = mat4.perspective(fovY, aspect, near, far);

  it("places the non-zero entries at the documented column-major indices", () => {
    const f = 1 / Math.tan(fovY / 2);
    expect(at(p, 0)).toBeCloseTo(f / aspect, 5);
    expect(at(p, 5)).toBeCloseTo(f, 5);
    expect(at(p, 10)).toBeCloseTo(far / (near - far), 5);
    expect(at(p, 11)).toBe(-1);
    expect(at(p, 14)).toBeCloseTo((near * far) / (near - far), 5);
    for (const i of [1, 2, 3, 4, 6, 7, 8, 9, 12, 13, 15]) expect(at(p, i)).toBe(0);
  });

  it("maps z = -near to depth 0 and z = -far to depth 1", () => {
    expect(transformPoint(p, { x: 0, y: 0, z: -near }).z).toBeCloseTo(0, 5);
    expect(transformPoint(p, { x: 0, y: 0, z: -far }).z).toBeCloseTo(1, 5);
  });

  it("maps depth monotonically between near and far", () => {
    let previous = -Infinity;
    for (const d of [0.1, 0.5, 1, 10, 100, 250]) {
      const z = transformPoint(p, { x: 0, y: 0, z: -d }).z;
      expect(z).toBeGreaterThan(previous);
      previous = z;
    }
  });

  it("maps the frustum edges to normalised device coordinates +-1", () => {
    const d = 7;
    const halfHeight = d * Math.tan(fovY / 2);
    const halfWidth = halfHeight * aspect;
    const corner = transformPoint(p, { x: halfWidth, y: halfHeight, z: -d });
    expect(corner.x).toBeCloseTo(1, 5);
    expect(corner.y).toBeCloseTo(1, 5);
    const other = transformPoint(p, { x: -halfWidth, y: -halfHeight, z: -d });
    expect(other.x).toBeCloseTo(-1, 5);
    expect(other.y).toBeCloseTo(-1, 5);
  });

  it("puts the view-space distance in w (right-handed, looking down -Z)", () => {
    const [, , , w] = transform4(p, [1, 2, -5, 1]);
    expect(w).toBeCloseTo(5, 6);
  });
});

describe("mat4.orthographic (spec/runtime-abi.md 8.3)", () => {
  const height = 10;
  const aspect = 2;
  const near = 0.1;
  const far = 1000;
  const o = mat4.orthographic(height, aspect, near, far);

  it("places the non-zero entries at the documented column-major indices", () => {
    const width = height * aspect;
    expect(at(o, 0)).toBeCloseTo(2 / width, 6);
    expect(at(o, 5)).toBeCloseTo(2 / height, 6);
    expect(at(o, 10)).toBeCloseTo(1 / (near - far), 6);
    expect(at(o, 14)).toBeCloseTo(near / (near - far), 6);
    expect(at(o, 15)).toBe(1);
    for (const i of [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13]) expect(at(o, i)).toBe(0);
  });

  it("maps z = -near to depth 0 and z = -far to depth 1", () => {
    expect(transformPoint(o, { x: 0, y: 0, z: -near }).z).toBeCloseTo(0, 5);
    expect(transformPoint(o, { x: 0, y: 0, z: -far }).z).toBeCloseTo(1, 5);
  });

  it("maps the box width x height to NDC +-1 independent of depth", () => {
    for (const d of [near, 1, far]) {
      const c = transformPoint(o, { x: (height * aspect) / 2, y: height / 2, z: -d });
      expect(c.x).toBeCloseTo(1, 5);
      expect(c.y).toBeCloseTo(1, 5);
    }
  });

  it("keeps w at 1 (no perspective divide)", () => {
    expect(transform4(o, [3, 4, -5, 1])[3]).toBe(1);
  });
});

describe("mat4.multiply", () => {
  it("composes so that (A*B)p = A(Bp)", () => {
    const a = mat4.fromRotationTranslationScale(
      axisAngle({ x: 1, y: 2, z: 3 }, 0.7),
      { x: 1, y: -2, z: 3 },
      { x: 2, y: 3, z: 0.5 },
    );
    const b = mat4.fromRotationTranslationScale(
      axisAngle({ x: -1, y: 0, z: 1 }, -1.1),
      { x: 4, y: 5, z: -6 },
      { x: 1, y: 1, z: 2 },
    );
    const p: Vec3 = { x: 0.3, y: -1.7, z: 2.2 };
    expectVec(transformPoint(mat4.multiply(a, b), p), transformPoint(a, transformPoint(b, p)), 1e-4);
  });

  it("is not commutative: T*S scales the translation by nothing, S*T scales it", () => {
    const t = mat4.translation({ x: 1, y: 2, z: 3 });
    const s = mat4.scaling({ x: 2, y: 2, z: 2 });
    const ts = mat4.multiply(t, s);
    expect([at(ts, 12), at(ts, 13), at(ts, 14)]).toEqual([1, 2, 3]);
    expect([at(ts, 0), at(ts, 5), at(ts, 10)]).toEqual([2, 2, 2]);
    const st = mat4.multiply(s, t);
    expect([at(st, 12), at(st, 13), at(st, 14)]).toEqual([2, 4, 6]);
  });

  it("has identity as a neutral element and does not mutate its inputs", () => {
    const a = mat4.perspective(1, 1, 0.5, 50);
    const copy = Float32Array.from(a);
    expect(Array.from(mat4.multiply(a, mat4.identity()))).toEqual(Array.from(a));
    expect(Array.from(mat4.multiply(mat4.identity(), a))).toEqual(Array.from(a));
    expect(Array.from(a)).toEqual(Array.from(copy));
  });
});

describe("mat4.rotation", () => {
  it("rotates +X by +90 degrees about +Y onto -Z (right-handed)", () => {
    const m = mat4.rotation(axisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2));
    expectVec(transformDirection(m, { x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: -1 });
  });

  it("agrees with the quaternion-vector formula for an arbitrary rotation", () => {
    const q = axisAngle({ x: 0.3, y: -0.8, z: 0.5 }, 2.1);
    const m = mat4.rotation(q);
    for (const v of [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 2, z: 3 },
    ]) {
      expectVec(transformDirection(m, v), rotateByQuat(q, v));
    }
  });

  it("has a zero translation and w row (0,0,0,1)", () => {
    const m = mat4.rotation(axisAngle({ x: 1, y: 1, z: 1 }, 1));
    expect([at(m, 3), at(m, 7), at(m, 11), at(m, 12), at(m, 13), at(m, 14), at(m, 15)]).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });
});

describe("mat4.fromRotationTranslationScale (L = T * R * S, spec/scenes.md 12)", () => {
  const q = axisAngle({ x: 1, y: 2, z: -1 }, 0.9);
  const t: Vec3 = { x: 5, y: -3, z: 2 };
  const s: Vec3 = { x: 2, y: 0.5, z: 3 };
  const m = mat4.fromRotationTranslationScale(q, t, s);

  it("transforms a point as T + R(S p)", () => {
    for (const p of [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: -1, y: 2, z: 0.5 },
    ]) {
      expectVec(transformPoint(m, p), add(rotateByQuat(q, mulComponents(s, p)), t), 1e-4);
    }
  });

  it("stores the translation at 12, 13, 14 and the last row as (0,0,0,1)", () => {
    expect([at(m, 12), at(m, 13), at(m, 14)]).toEqual([5, -3, 2]);
    expect([at(m, 3), at(m, 7), at(m, 11), at(m, 15)]).toEqual([0, 0, 0, 1]);
  });

  it("is the identity for identity rotation, zero translation and unit scale", () => {
    const id = mat4.fromRotationTranslationScale({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(Array.from(id)).toEqual(Array.from(mat4.identity()));
  });

  it("equals translation * rotation * scaling built from the parts", () => {
    const composed = mat4.multiply(mat4.translation(t), mat4.multiply(mat4.rotation(q), mat4.scaling(s)));
    for (let i = 0; i < 16; i++) expect(at(m, i)).toBeCloseTo(at(composed, i), 5);
  });

  it("scales along the entity's local axes (scale is applied before rotation)", () => {
    const quarterTurn = axisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    const flat = mat4.fromRotationTranslationScale(quarterTurn, { x: 0, y: 0, z: 0 }, { x: 4, y: 1, z: 1 });
    // local +X, stretched 4x, is then rotated onto +Y
    expectVec(transformPoint(flat, { x: 1, y: 0, z: 0 }), { x: 0, y: 4, z: 0 });
  });
});

describe("mat4.lookAt and view matrices (spec/runtime-abi.md 8.3)", () => {
  it("maps the camera position to the view-space origin and the target onto -Z", () => {
    const position: Vec3 = { x: 3, y: 4, z: 5 };
    const target: Vec3 = { x: -1, y: 0.5, z: 2 };
    const v = mat4.lookAt(position, target);
    expectVec(transformPoint(v, position), { x: 0, y: 0, z: 0 });
    const distance = length({ x: target.x - position.x, y: target.y - position.y, z: target.z - position.z });
    expectVec(transformPoint(v, target), { x: 0, y: 0, z: -distance }, 1e-4);
  });

  it("keeps world +Y pointing up on screen and the view rigid (orthonormal)", () => {
    const position: Vec3 = { x: 3, y: 4, z: 5 };
    const v = mat4.lookAt(position, { x: 0, y: 0, z: 0 });
    const up = transformDirection(v, { x: 0, y: 1, z: 0 });
    expect(up.y).toBeGreaterThan(0);
    // an up vector lies in the plane (forward, screen-up), so it has no screen-x part
    expect(up.x).toBeCloseTo(0, 5);
    expect(length(up)).toBeCloseTo(1, 5);
    // the right axis is horizontal: world +Y has no component along view +X
    const right = transformDirection(mat4.transpose(v), { x: 1, y: 0, z: 0 });
    expect(right.y).toBeCloseTo(0, 5);
    // no scale or shear: rows of the upper 3x3 are unit length and mutually orthogonal
    const rows = [0, 1, 2].map((r) => ({ x: at(v, r), y: at(v, 4 + r), z: at(v, 8 + r) }));
    for (let i = 0; i < 3; i++) {
      expect(length(rows[i] as Vec3)).toBeCloseTo(1, 5);
      for (let j = i + 1; j < 3; j++) expect(dot(rows[i] as Vec3, rows[j] as Vec3)).toBeCloseTo(0, 5);
    }
  });

  it("reduces to a pure translation for the default pose (camera on +Z looking at the origin)", () => {
    const v = mat4.lookAt({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 0 });
    // camera on +Z looking at the origin is the default pose: V = T(0, 0, -5)
    expect(Array.from(v)).toEqual(Array.from(mat4.translation({ x: 0, y: 0, z: -5 })));
  });

  it("looking along +X puts world +X straight ahead and world +Z to the right", () => {
    const v = mat4.lookAt({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expectVec(transformPoint(v, { x: 10, y: 0, z: 0 }), { x: 0, y: 0, z: -10 });
    // facing +X with +Y up, the right-hand side is +Z
    expectVec(transformPoint(v, { x: 0, y: 0, z: 1 }), { x: 1, y: 0, z: 0 });
  });

  it("falls back to up = -Z when looking straight down", () => {
    const position: Vec3 = { x: 0, y: 10, z: 0 };
    const v = mat4.lookAt(position, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 16; i++) expect(Number.isFinite(at(v, i))).toBe(true);
    expectVec(transformPoint(v, { x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: -10 });
    // -Z is screen-up, +X is screen-right
    expectVec(transformPoint(v, { x: 0, y: 10, z: -1 }), { x: 0, y: 1, z: 0 });
    expectVec(transformPoint(v, { x: 1, y: 10, z: 0 }), { x: 1, y: 0, z: 0 });
  });

  it("falls back to up = -Z when looking straight up", () => {
    const v = mat4.lookAt({ x: 0, y: -4, z: 0 }, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 16; i++) expect(Number.isFinite(at(v, i))).toBe(true);
    expectVec(transformPoint(v, { x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: -4 });
    // f = +Y, up = -Z: right = f x up = (-1, 0, 0), screen-up = right x f = (0, 0, -1)
    expectVec(transformPoint(v, { x: 0, y: -4, z: -1 }), { x: 0, y: 1, z: 0 });
    expectVec(transformPoint(v, { x: -1, y: -4, z: 0 }), { x: 1, y: 0, z: 0 });
  });

  it("switches to the fallback exactly where |dot(f, +Y)| exceeds 1 - 1e-6", () => {
    // forward f = (sin a, cos a, 0) so dot(f, +Y) = cos a = 1 - delta
    const lookingAlong = (delta: number): Mat4 => {
      const a = Math.acos(1 - delta);
      return mat4.lookAt({ x: 0, y: 0, z: 0 }, { x: 10 * Math.sin(a), y: 10 * Math.cos(a), z: 0 });
    };
    // inside the threshold (delta = 1e-7): screen-up is -Z
    const steep = lookingAlong(1e-7);
    expect(transformDirection(steep, { x: 0, y: 0, z: -1 }).y).toBeGreaterThan(0.99);
    // outside the threshold (delta = 1e-5): screen-up is derived from +Y
    const shallow = lookingAlong(1e-5);
    const upY = transformDirection(shallow, { x: 0, y: 1, z: 0 }).y;
    expect(upY).toBeGreaterThan(1e-3);
    expect(Math.abs(transformDirection(shallow, { x: 0, y: 0, z: -1 }).y)).toBeLessThan(0.1);
  });

  it("rejects position == target", () => {
    expect(() => mat4.lookAt({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 })).toThrow(RangeError);
  });

  describe("viewMatrix with a target", () => {
    it("equals lookAt", () => {
      const position: Vec3 = { x: 2, y: 3, z: 4 };
      const target: Vec3 = { x: 0, y: 1, z: 0 };
      expect(Array.from(mat4.viewMatrix(position, { target }))).toEqual(Array.from(mat4.lookAt(position, target)));
    });

    it("applies the -Z fallback", () => {
      const v = mat4.viewMatrix({ x: 0, y: 10, z: 0 }, { target: { x: 0, y: 0, z: 0 } });
      expectVec(transformPoint(v, { x: 0, y: 10, z: -1 }), { x: 0, y: 1, z: 0 });
    });
  });

  describe("viewMatrix with a rotation", () => {
    it("is the inverse rigid transform T(-p) under the identity rotation", () => {
      const v = mat4.viewMatrix({ x: 1, y: 2, z: 3 }, { rotation: { x: 0, y: 0, z: 0, w: 1 } });
      expect(Array.from(v)).toEqual(Array.from(mat4.translation({ x: -1, y: -2, z: -3 })));
    });

    it("looks along the rotated -Z axis from the camera position", () => {
      // +90 degrees about +Y turns forward (-Z) into -X and right (+X) into -Z
      const q = axisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
      const p: Vec3 = { x: 1, y: 2, z: 3 };
      const v = mat4.viewMatrix(p, { rotation: q });
      expectVec(transformPoint(v, p), { x: 0, y: 0, z: 0 });
      expectVec(transformPoint(v, add(p, { x: -5, y: 0, z: 0 })), { x: 0, y: 0, z: -5 });
      expectVec(transformPoint(v, add(p, { x: 0, y: 1, z: 0 })), { x: 0, y: 1, z: 0 });
      expectVec(transformPoint(v, add(p, { x: 0, y: 0, z: -1 })), { x: 1, y: 0, z: 0 });
    });

    it("undoes the camera's own rigid transform (V * (T(p) R) = identity)", () => {
      const q = axisAngle({ x: 0.2, y: 1, z: -0.4 }, 1.3);
      const p: Vec3 = { x: -3, y: 0.5, z: 7 };
      const world = mat4.multiply(mat4.translation(p), mat4.rotation(q));
      const product = mat4.multiply(mat4.viewMatrix(p, { rotation: q }), world);
      for (let i = 0; i < 16; i++) expect(at(product, i)).toBeCloseTo(i % 5 === 0 ? 1 : 0, 5);
    });

    it("composes with a projection into view_proj = P * V that maps the look direction to the screen centre", () => {
      const q = axisAngle({ x: 1, y: 0, z: 0 }, -0.5);
      const p: Vec3 = { x: 0, y: 3, z: 0 };
      const forward = rotateByQuat(q, { x: 0, y: 0, z: -1 });
      const viewProj = mat4.multiply(mat4.perspective(0.9, 1, 0.1, 100), mat4.viewMatrix(p, { rotation: q }));
      const ahead = transformPoint(viewProj, add(p, scaleBy(forward, 10)));
      expect(ahead.x).toBeCloseTo(0, 5);
      expect(ahead.y).toBeCloseTo(0, 5);
      expect(ahead.z).toBeGreaterThan(0);
      expect(ahead.z).toBeLessThan(1);
    });
  });
});

describe("mat4.normalMatrix (spec/gpu-layout.md 6.2, spec/scenes.md 12)", () => {
  it("has last row and column (0,0,0,1)", () => {
    const n = mat4.normalMatrix(
      mat4.fromRotationTranslationScale(axisAngle({ x: 1, y: 1, z: 0 }, 0.5), { x: 9, y: 8, z: 7 }, { x: 1, y: 2, z: 3 }),
    );
    expect([at(n, 3), at(n, 7), at(n, 11), at(n, 12), at(n, 13), at(n, 14), at(n, 15)]).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it("is the identity for the identity model and ignores translation", () => {
    expect(Array.from(mat4.normalMatrix(mat4.identity()))).toEqual(Array.from(mat4.identity()));
    const n = mat4.normalMatrix(mat4.translation({ x: 4, y: 5, z: 6 }));
    expect(Array.from(n)).toEqual(Array.from(mat4.identity()));
  });

  it("is diag(1/sx, 1/sy, 1/sz) for a pure non-uniform scale", () => {
    const n = mat4.normalMatrix(mat4.scaling({ x: 2, y: 4, z: 8 }));
    expect(at(n, 0)).toBeCloseTo(0.5, 6);
    expect(at(n, 5)).toBeCloseTo(0.25, 6);
    expect(at(n, 10)).toBeCloseTo(0.125, 6);
    for (const i of [1, 2, 4, 6, 8, 9]) expect(at(n, i)).toBeCloseTo(0, 6);
  });

  it("keeps normals perpendicular to transformed surface tangents under non-uniform scale", () => {
    // A 45 degree slope in the XY plane: tangent (1, 1, 0), normal (1, -1, 0)/sqrt 2.
    const model = mat4.fromRotationTranslationScale(
      axisAngle({ x: 0.3, y: 1, z: 0.2 }, 0.8),
      { x: 3, y: 2, z: 1 },
      { x: 1, y: 4, z: 0.5 },
    );
    const n = mat4.normalMatrix(model);
    const tangent: Vec3 = { x: 1, y: 1, z: 0 };
    const normal: Vec3 = { x: 1, y: -1, z: 0 };
    expect(dot(tangent, normal)).toBe(0);
    const worldTangent = transformDirection(model, tangent);
    const worldNormal = transformDirection(n, normal);
    expect(dot(worldTangent, worldNormal)).toBeCloseTo(0, 4);
    // the plain model matrix would NOT preserve perpendicularity (guards against a no-op)
    expect(Math.abs(dot(worldTangent, transformDirection(model, normal)))).toBeGreaterThan(0.5);
  });

  it("equals R * S^-1 for model = T R S (inverse-transpose identity with orthogonal R)", () => {
    const q = axisAngle({ x: -1, y: 0.4, z: 0.7 }, 1.9);
    const s: Vec3 = { x: 2, y: 0.25, z: 3 };
    const n = mat4.normalMatrix(mat4.fromRotationTranslationScale(q, { x: 1, y: 1, z: 1 }, s));
    for (const v of [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 2, z: 3 },
    ]) {
      const expected = rotateByQuat(q, { x: v.x / s.x, y: v.y / s.y, z: v.z / s.z });
      expectVec(transformDirection(n, v), expected, 1e-4);
    }
  });

  it("reduces to R / s for uniform scale", () => {
    const q = axisAngle({ x: 0, y: 0, z: 1 }, 0.4);
    const n = mat4.normalMatrix(mat4.fromRotationTranslationScale(q, { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }));
    expectVec(transformDirection(n, { x: 1, y: 0, z: 0 }), scaleBy(rotateByQuat(q, { x: 1, y: 0, z: 0 }), 0.5), 1e-5);
  });

  it("rejects a singular upper 3x3", () => {
    expect(() => mat4.normalMatrix(mat4.scaling({ x: 1, y: 0, z: 1 }))).toThrow(RangeError);
  });
});
