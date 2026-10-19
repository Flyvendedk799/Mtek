// The in-place forms the hot paths use (decision 0121) against the formulas the allocating forms had before them,
// copied here: every element must be the same binary32 value, for ordinary, unnormalised and degenerate inputs.
import { describe, expect, it } from "vitest";
import * as mat4 from "./mat4.js";
import type { Mat4, Quat, Vec3 } from "./mat4.js";

const f = Math.fround;

function at(m: ArrayLike<number>, i: number): number {
  const v = m[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
}

function referenceRotation(q: Quat): Float32Array {
  const { x, y, z, w } = q;
  const m = new Float32Array(16);
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + w * z);
  m[2] = 2 * (x * z - w * y);
  m[4] = 2 * (x * y - w * z);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + w * x);
  m[8] = 2 * (x * z + w * y);
  m[9] = 2 * (y * z - w * x);
  m[10] = 1 - 2 * (x * x + y * y);
  m[15] = 1;
  return m;
}

function referenceTrs(q: Quat, t: Vec3, s: Vec3): Float32Array {
  const r = referenceRotation(q);
  const m = new Float32Array(16);
  const scales = [s.x, s.y, s.z];
  for (let col = 0; col < 3; col++) {
    const k = scales[col] as number;
    m[col * 4] = at(r, col * 4) * k;
    m[col * 4 + 1] = at(r, col * 4 + 1) * k;
    m[col * 4 + 2] = at(r, col * 4 + 2) * k;
  }
  m[12] = t.x;
  m[13] = t.y;
  m[14] = t.z;
  m[15] = 1;
  return m;
}

function referenceMultiply(a: Mat4, b: Mat4): Float32Array {
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

/** A seeded stream of numbers, with the awkward ones (zero, -0, tiny, huge) mixed in. */
function numbers(seed: number): () => number {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    const pick = next();
    if (pick < 0.05) return 0;
    if (pick < 0.08) return -0;
    if (pick < 0.12) return f(1e-30 * next());
    if (pick < 0.15) return f(1e30 * next());
    return f((next() - 0.5) * 20);
  };
}

/** Elements as strings, so that +0 and -0 differ and NaN equals NaN. */
const bits = (m: ArrayLike<number>): string[] => Array.from(m, (v) => (Object.is(v, -0) ? "-0" : String(v)));

describe("the in-place matrix functions equal the allocating formulas bit for bit", () => {
  const dirty = (): Float32Array => new Float32Array(16).fill(7);

  it("rotation, fromRotationTranslationScale and multiply, including into dirty output arrays", () => {
    const next = numbers(42);
    for (let n = 0; n < 300; n++) {
      const q: Quat = { x: next(), y: next(), z: next(), w: next() };
      const t: Vec3 = { x: next(), y: next(), z: next() };
      const s: Vec3 = { x: next(), y: next(), z: next() };
      expect(bits(mat4.rotation(q))).toEqual(bits(referenceRotation(q)));
      expect(bits(mat4.rotationInto(dirty(), q))).toEqual(bits(referenceRotation(q)));
      expect(bits(mat4.fromRotationTranslationScale(q, t, s))).toEqual(bits(referenceTrs(q, t, s)));
      expect(bits(mat4.fromRotationTranslationScaleInto(dirty(), dirty(), q, t, s))).toEqual(bits(referenceTrs(q, t, s)));
      const a = referenceTrs(q, t, s);
      const b = referenceTrs({ x: next(), y: next(), z: next(), w: next() }, { x: next(), y: next(), z: next() }, { x: next(), y: next(), z: next() });
      expect(bits(mat4.multiply(a, b))).toEqual(bits(referenceMultiply(a, b)));
      expect(bits(mat4.multiplyInto(dirty(), a, b))).toEqual(bits(referenceMultiply(a, b)));
    }
  });

  it("normalMatrixInto writes the 16 elements at an offset and equals normalMatrix; a singular matrix throws before writing", () => {
    const next = numbers(7);
    let singular = 0;
    for (let n = 0; n < 200; n++) {
      const scale = n % 10 === 0 ? { x: 0, y: 1, z: 1 } : { x: Math.abs(next()) + 0.1, y: Math.abs(next()) + 0.1, z: Math.abs(next()) + 0.1 };
      const model = mat4.fromRotationTranslationScale({ x: next(), y: next(), z: next(), w: next() }, { x: next(), y: next(), z: next() }, scale);
      const out = new Float32Array(40).fill(5);
      let expected: Float32Array | undefined;
      try {
        expected = mat4.normalMatrix(model);
      } catch {
        expected = undefined;
      }
      if (expected === undefined) {
        singular += 1;
        expect(() => mat4.normalMatrixInto(out, 8, model)).toThrow(RangeError);
        expect(Array.from(out).every((v) => v === 5)).toBe(true);
        continue;
      }
      mat4.normalMatrixInto(out, 8, model);
      expect(bits(out.subarray(8, 24))).toEqual(bits(expected));
      expect(Array.from(out.subarray(0, 8)).every((v) => v === 5)).toBe(true);
      expect(Array.from(out.subarray(24)).every((v) => v === 5)).toBe(true);
    }
    expect(singular).toBeGreaterThan(0);
  });
});
