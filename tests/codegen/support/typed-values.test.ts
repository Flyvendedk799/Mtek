// Tests of the exec.json value notation: decoding to the CPU representation, and proof that the
// comparison catches every kind of wrong result the execution tests must detect.
import { describe, expect, it } from "vitest";
import { compare, decode, f32Value, ulpDistance } from "./typed-values.js";

describe("typed values", () => {
  it("decode to the CPU representation of spec/runtime-abi.md section 4.1", () => {
    expect(decode({ f32: "-0" }, "a")).toBe(-0);
    expect(Number.isNaN(decode({ f32: "NaN" }, "a"))).toBe(true);
    expect(decode({ u32: 4294967295 }, "a")).toBe(4294967295);
    expect(decode({ vec3: [1, 2, 3] }, "a")).toEqual({ x: 1, y: 2, z: 3 });
    expect(decode({ color: [0, 0.5, 1, 1] }, "a")).toEqual({ r: 0, g: 0.5, b: 1, a: 1 });
    const m = decode({ mat4: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1] }, "a");
    expect(m).toBeInstanceOf(Float32Array);
    expect(decode({ array: [{ i32: 1 }, { i32: -1 }] }, "a")).toEqual([1, -1]);
    expect(decode({ struct: { a: { f32: 1 }, b: { bool: true } } }, "a")).toEqual({ a: 1, b: true });
    expect(decode(0.5, "a")).toBe(0.5);
    expect(() => decode({ f32: 0.1 }, "a")).toThrow(/not a binary32/);
    expect(() => decode({ i32: 2147483648 }, "a")).toThrow(/not an integer/);
    expect(() => decode({ u32: -1 }, "a")).toThrow(/not an integer/);
    expect(() => decode({ vec3: [1, 2] }, "a")).toThrow(/3 elements/);
    expect(() => decode({ f32: 1, i32: 1 }, "a")).toThrow(/exactly one key/);
  });

  it("compare bit for bit: -0 differs from 0, any NaN matches NaN", () => {
    expect(compare(-0, { f32: "-0" }, undefined)).toEqual([]);
    expect(compare(0, { f32: "-0" }, undefined)).toHaveLength(1);
    expect(compare(Number.NaN, { f32: "NaN" }, undefined)).toEqual([]);
    expect(compare(1, { f32: "NaN" }, undefined)).toHaveLength(1);
    expect(compare(-0, { i32: 0 }, undefined)).toHaveLength(1);
    expect(compare(0, { i32: 0 }, undefined)).toEqual([]);
    expect(compare(4294967295, { i32: -1 }, undefined)).toHaveLength(1);
    expect(compare(-1, { u32: 4294967295 }, undefined)).toHaveLength(1);
    expect(compare(1, { bool: true }, undefined)).toHaveLength(1);
  });

  it("compare rejects f32 results that were not rounded", () => {
    expect(compare(0.1, { f32: 0.10000000149011612 }, undefined)[0]).toMatch(/not a binary32/);
    expect(compare(0.1, { f32: 0.10000000149011612 }, { ulp: 10 })[0]).toMatch(/not a binary32/);
    expect(compare({ x: 0.1, y: 0 }, { vec2: [0.10000000149011612, 0] }, undefined)).toHaveLength(1);
  });

  it("compare checks the shape: keys, lengths, typed arrays", () => {
    expect(compare({ x: 1, y: 2, z: 3, w: 0 }, { vec3: [1, 2, 3] }, undefined)).toHaveLength(1);
    expect(compare({ x: 1, y: 2, z: 3, w: 4 }, { color: [1, 2, 3, 4] }, undefined)).toHaveLength(1);
    expect(compare([1, 2, 3, 4], { vec4: [1, 2, 3, 4] }, undefined)).toHaveLength(1);
    expect(compare(new Array(16).fill(0), { mat4: new Array(16).fill(0) }, undefined)).toHaveLength(1);
    expect(compare(new Float32Array(16), { mat4: new Array(16).fill(0) }, undefined)).toEqual([]);
    expect(compare([1], { array: [{ i32: 1 }, { i32: 2 }] }, undefined)).toHaveLength(1);
    expect(compare({ a: 1, b: 2 }, { struct: { a: { f32: 1 } } }, undefined)).toHaveLength(1);
    expect(compare({ a: 1 }, { struct: { a: { f32: 1 } } }, undefined)).toEqual([]);
  });

  it("tolerances are in binary32 ulps or absolute", () => {
    expect(ulpDistance(1, Math.fround(1 + 2 ** -23))).toBe(1);
    expect(ulpDistance(-0, 0)).toBe(0);
    expect(ulpDistance(Math.fround(-1e-45), Math.fround(1e-45))).toBe(2);
    const next = Math.fround(1 + 2 ** -22);
    expect(compare(next, { f32: 1 }, { ulp: 2 })).toEqual([]);
    expect(compare(next, { f32: 1 }, { ulp: 1 })).toHaveLength(1);
    expect(compare(next, { f32: 1 }, undefined)).toHaveLength(1);
    expect(compare(-4.371138828673793e-8, { f32: 0 }, { abs: 1e-6 })).toEqual([]);
    // With a tolerance, the expectation may be the exact value; it is rounded first.
    expect(f32Value(0.1, "a", false)).toBe(Math.fround(0.1));
    expect(compare(Math.fround(0.1), { f32: 0.1 }, { ulp: 0 })).toEqual([]);
  });
});
