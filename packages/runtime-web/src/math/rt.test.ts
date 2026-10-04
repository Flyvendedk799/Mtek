/**
 * Hand-checked semantics of the runtime math library `rt` (`spec/language.md` 6.2 to 6.7 and 10,
 * `spec/stdlib.md` 6, decisions 0026 and 0037). The table-driven conformance tests are in
 * `conformance.test.ts`; these cases spell out the rules one by one, with expected values derived by
 * hand or from an independent formula.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as rt from "./rt.js";
import type { Vec3 } from "./types.js";

const fr = Math.fround;

/** The binary32 bit pattern of `x` (which must be a binary32 value). */
function bits(x: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, x);
  return view.getUint32(0);
}

/** The binary32 value with bit pattern `b`. */
function fromBits(b: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, b);
  return view.getFloat32(0);
}

/** `Object.is` equality of every component, so `-0` and `0` differ. */
function expectSame(actual: object, expected: object): void {
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const [key, value] of Object.entries(expected)) {
    expect(Object.is((actual as Record<string, unknown>)[key], value), `${key}: ${String((actual as Record<string, unknown>)[key])} vs ${String(value)}`).toBe(true);
  }
}

describe("constructors", () => {
  it("round every component to binary32", () => {
    expectSame(rt.v2(0.1, 0.2), { x: fr(0.1), y: fr(0.2) });
    expectSame(rt.v3(0.1, 1, -0), { x: fr(0.1), y: 1, z: -0 });
    expectSame(rt.v4(1, 2, 3, 0.3), { x: 1, y: 2, z: 3, w: fr(0.3) });
    expectSame(rt.quat(0.1, 0, 0, 1), { x: fr(0.1), y: 0, z: 0, w: 1 });
    expectSame(rt.color(0.1, 0.2, 0.3, 0.4), { r: fr(0.1), g: fr(0.2), b: fr(0.3), a: fr(0.4) });
  });

  it("splat and compose", () => {
    expectSame(rt.v2splat(0.1), { x: fr(0.1), y: fr(0.1) });
    expectSame(rt.v3splat(2), { x: 2, y: 2, z: 2 });
    expectSame(rt.v4splat(-1), { x: -1, y: -1, z: -1, w: -1 });
    expectSame(rt.v3fromV2(rt.v2(1, 2), 3), { x: 1, y: 2, z: 3 });
    expectSame(rt.v4fromV3(rt.v3(1, 2, 3), 4), { x: 1, y: 2, z: 3, w: 4 });
    expectSame(rt.v4fromV2(rt.v2(1, 2), 3, 4), { x: 1, y: 2, z: 3, w: 4 });
    expectSame(rt.qidentity(), { x: 0, y: 0, z: 0, w: 1 });
    expectSame(rt.clinear(rt.v3(0.25, 0.5, 1), 0.75), { r: 0.25, g: 0.5, b: 1, a: 0.75 });
  });

  it("swizzle with repetition and replace components without mutating", () => {
    const v = rt.v4(1, 2, 3, 4);
    expectSame(rt.swizzle2(v, "w", "x"), { x: 4, y: 1 });
    expectSame(rt.swizzle3(v, "z", "y", "x"), { x: 3, y: 2, z: 1 });
    expectSame(rt.swizzle4(rt.v2(5, 6), "x", "x", "y", "y"), { x: 5, y: 5, z: 6, w: 6 });
    const p = rt.v3(1, 2, 3);
    const q = rt.v3with(p, "y", 0.1);
    expectSame(q, { x: 1, y: fr(0.1), z: 3 });
    expectSame(p, { x: 1, y: 2, z: 3 });
    expectSame(rt.v2with(rt.v2(1, 2), "x", 7), { x: 7, y: 2 });
    expectSame(rt.v4with(v, "w", 9), { x: 1, y: 2, z: 3, w: 9 });
    expectSame(rt.crgb(rt.color(0.5, 0.25, 0.125, 1)), { x: 0.5, y: 0.25, z: 0.125 });
  });
});

describe("f32 operators", () => {
  it("round each result once (0.1 + 0.2 is 0.3 in binary32)", () => {
    expect(rt.fadd(fr(0.1), fr(0.2))).toBe(fr(0.3));
    expect(bits(rt.fdiv(1, 3))).toBe(0x3eaaaaab);
    expect(rt.fmul(fr(3e38), 10)).toBe(Infinity);
  });

  it("divide by zero as IEEE 754", () => {
    expect(rt.fdiv(1, 0)).toBe(Infinity);
    expect(rt.fdiv(-1, 0)).toBe(-Infinity);
    expect(rt.fdiv(1, -0)).toBe(-Infinity);
    expect(rt.fdiv(0, 0)).toBeNaN();
  });

  it("take the truncated remainder with the sign of the dividend", () => {
    expect(rt.frem(5.5, 2)).toBe(1.5);
    expect(rt.frem(-5.5, 2)).toBe(-1.5);
    expect(rt.frem(5.5, -2)).toBe(1.5);
    expect(Object.is(rt.frem(-4, 2), -0)).toBe(true);
    expect(rt.frem(1, 0)).toBeNaN();
    expect(rt.frem(Infinity, 1)).toBeNaN();
    expect(rt.frem(3, Infinity)).toBe(3);
    // Exact even when x / y is not representable: 2^24 + 2 = 16777218, and 16777218 % 3 = 0.
    expect(rt.frem(16777218, 3)).toBe(0);
  });

  it("negate exactly", () => {
    expect(Object.is(rt.fneg(0), -0)).toBe(true);
    expect(rt.fneg(-Infinity)).toBe(Infinity);
  });
});

describe("integer helpers", () => {
  it("divide as WGSL: truncation, x / 0 = x, MIN / -1 = MIN", () => {
    expect(rt.idiv(7, 2)).toBe(3);
    expect(rt.idiv(-7, 2)).toBe(-3);
    expect(rt.idiv(7, -2)).toBe(-3);
    expect(rt.idiv(-7, 0)).toBe(-7);
    expect(rt.idiv(rt.I32_MIN, -1)).toBe(rt.I32_MIN);
    expect(rt.idiv(rt.I32_MAX, 1)).toBe(rt.I32_MAX);
    expect(rt.idiv(rt.I32_MIN, 2)).toBe(-1073741824);
    expect(rt.udiv(7, 2)).toBe(3);
    expect(rt.udiv(rt.U32_MAX, 0)).toBe(rt.U32_MAX);
    expect(rt.udiv(rt.U32_MAX, 2)).toBe(2147483647);
  });

  it("take remainders with the dividend's sign, x % 0 = 0, MIN % -1 = 0", () => {
    expect(rt.irem(7, 3)).toBe(1);
    expect(rt.irem(-7, 3)).toBe(-1);
    expect(rt.irem(7, -3)).toBe(1);
    expect(rt.irem(-7, -3)).toBe(-1);
    expect(rt.irem(7, 0)).toBe(0);
    expect(Object.is(rt.irem(rt.I32_MIN, -1), 0)).toBe(true);
    expect(Object.is(rt.irem(-6, 3), 0)).toBe(true);
    expect(rt.urem(7, 3)).toBe(1);
    expect(rt.urem(7, 0)).toBe(0);
    expect(rt.urem(rt.U32_MAX, 10)).toBe(5);
  });

  it("wrap modulo 2^32", () => {
    expect(rt.iadd(rt.I32_MAX, 1)).toBe(rt.I32_MIN);
    expect(rt.isub(rt.I32_MIN, 1)).toBe(rt.I32_MAX);
    expect(rt.imul(65536, 65536)).toBe(0);
    expect(rt.imul(rt.I32_MAX, rt.I32_MAX)).toBe(1);
    // A plain binary64 product would lose the low bits: 0x7fffffff * 0x7fffffff > 2^53.
    expect(rt.imul(123456789, 987654321)).toBe(-67153019);
    expect(rt.ineg(rt.I32_MIN)).toBe(rt.I32_MIN);
    expect(Object.is(rt.ineg(0), 0)).toBe(true);
    expect(rt.uadd(rt.U32_MAX, 1)).toBe(0);
    expect(rt.usub(0, 1)).toBe(rt.U32_MAX);
    expect(rt.umul(65536, 65536)).toBe(0);
    expect(rt.umul(rt.U32_MAX, rt.U32_MAX)).toBe(1);
  });

  it("abs, min, max and clamp", () => {
    expect(rt.iabs(rt.I32_MIN)).toBe(rt.I32_MIN);
    expect(rt.iabs(-5)).toBe(5);
    expect(rt.uabs(rt.U32_MAX)).toBe(rt.U32_MAX);
    expect(rt.imin(-3, 2)).toBe(-3);
    expect(rt.umax(rt.U32_MAX, 2)).toBe(rt.U32_MAX);
    expect(rt.iclamp(10, -1, 5)).toBe(5);
    expect(rt.uclamp(0, 1, 5)).toBe(1);
  });

  it("convert f32 to integers by clamping, then truncating; NaN gives 0", () => {
    expect(rt.f2i(-2.9)).toBe(-2);
    expect(rt.f2i(2.9)).toBe(2);
    expect(Object.is(rt.f2i(-0.5), 0)).toBe(true);
    expect(rt.f2i(3e9)).toBe(rt.I32_MAX);
    expect(rt.f2i(-3e9)).toBe(rt.I32_MIN);
    expect(rt.f2i(2147483648)).toBe(rt.I32_MAX);
    expect(rt.f2i(-2147483648)).toBe(rt.I32_MIN);
    expect(rt.f2i(2147483520)).toBe(2147483520);
    expect(rt.f2i(Infinity)).toBe(rt.I32_MAX);
    expect(rt.f2i(-Infinity)).toBe(rt.I32_MIN);
    expect(rt.f2i(NaN)).toBe(0);
    expect(rt.f2u(-1.5)).toBe(0);
    expect(rt.f2u(5e9)).toBe(rt.U32_MAX);
    expect(rt.f2u(4294967040)).toBe(4294967040);
    expect(rt.f2u(3.99)).toBe(3);
    expect(rt.f2u(Infinity)).toBe(rt.U32_MAX);
    expect(rt.f2u(NaN)).toBe(0);
  });

  it("convert integers to f32 with ties to even, and reinterpret between i32 and u32", () => {
    expect(rt.i2f(16777217)).toBe(16777216);
    expect(rt.i2f(16777219)).toBe(16777220);
    expect(rt.u2f(rt.U32_MAX)).toBe(4294967296);
    expect(rt.i2u(-1)).toBe(rt.U32_MAX);
    expect(rt.u2i(2147483648)).toBe(rt.I32_MIN);
    expect(rt.u2i(rt.U32_MAX)).toBe(-1);
  });

  it("clamps run-time indices and reports W8030 once per call site and context", () => {
    const warnings: [string, number][] = [];
    const ctx = { warn: (code: "W8030", spanId: number) => void warnings.push([code, spanId]) };
    expect(rt.clampIndex(2, 4, 7, ctx)).toBe(2);
    expect(warnings).toEqual([]);
    expect(rt.clampIndex(4, 4, 7, ctx)).toBe(3);
    expect(rt.clampIndex(-1, 4, 7, ctx)).toBe(0);
    expect(rt.clampIndex(rt.U32_MAX, 4, 8, ctx)).toBe(3);
    expect(rt.clampIndex(rt.I32_MIN, 1, 8, ctx)).toBe(0);
    expect(warnings).toEqual([
      ["W8030", 7],
      ["W8030", 8],
    ]);
    const other = { warn: (code: "W8030", spanId: number) => void warnings.push([code, spanId + 100]) };
    expect(rt.clampIndex(9, 4, 7, other)).toBe(3);
    expect(warnings.at(-1)).toEqual(["W8030", 107]);
  });
});

describe("f32 intrinsics", () => {
  it("round halves to even, never like Math.round", () => {
    const cases: [number, number][] = [
      [0.5, 0], [1.5, 2], [2.5, 2], [3.5, 4], [-0.5, -0], [-1.5, -2], [-2.5, -2],
      [0.49999997, 0], [2.4, 2], [2.6, 3], [-2.6, -3], [8388607.5, 8388608], [8388606.5, 8388606],
      [8388609, 8388609], [-0.25, -0], [0, 0], [-0, -0], [Infinity, Infinity], [-Infinity, -Infinity],
    ];
    for (const [x, expected] of cases) {
      expect(Object.is(rt.round(fr(x)), expected), `round(${x}) = ${rt.round(fr(x))}`).toBe(true);
    }
    expect(rt.round(NaN)).toBeNaN();
  });

  it("round agrees with an independent ties-to-even over random binary32 values", () => {
    let seed = 0x1234567;
    for (let n = 0; n < 20000; n++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      // Values in [-2^24, 2^24) with every fraction a binary32 can carry, ties included.
      const x = fr((seed / 2 ** 32 - 0.5) * 2 ** (1 + (n % 25)));
      const floor = Math.floor(x);
      const frac = x - floor;
      const expected = frac === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.floor(x + 0.5);
      const got = rt.round(x);
      expect(got === expected || (got === 0 && expected === 0), `round(${x})`).toBe(true);
    }
  });

  it("does not use Math.round anywhere in the math library", () => {
    const dir = fileURLToPath(new URL("./", import.meta.url));
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const code = readFileSync(`${dir}${name}`, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code.includes("Math.round"), name).toBe(false);
    }
  });

  it("fract, sign, floor, ceil and trunc", () => {
    expect(rt.fract(fr(1.25))).toBe(0.25);
    expect(rt.fract(fr(-1.25))).toBe(0.75);
    expect(rt.fract(fr(-1e-10))).toBe(1); // as WGSL notes: a tiny negative value gives 1
    expect(Object.is(rt.fract(-0), 0)).toBe(true);
    expect(rt.fract(Infinity)).toBeNaN();
    expect(rt.sign(-3)).toBe(-1);
    expect(rt.sign(fr(1e-40))).toBe(1);
    expect(Object.is(rt.sign(0), 0)).toBe(true);
    expect(Object.is(rt.sign(-0), 0)).toBe(true);
    expect(rt.sign(NaN)).toBeNaN();
    expect(Object.is(rt.ceil(-0.5), -0)).toBe(true);
    expect(Object.is(rt.trunc(-0.5), -0)).toBe(true);
    expect(rt.floor(-0.5)).toBe(-1);
  });

  it("min and max return the other operand for NaN; clamp and saturate compose them", () => {
    expect(rt.min(1, 2)).toBe(1);
    expect(rt.max(1, 2)).toBe(2);
    expect(rt.min(NaN, 2)).toBe(2);
    expect(rt.min(2, NaN)).toBe(2);
    expect(rt.max(NaN, 2)).toBe(2);
    expect(rt.max(NaN, NaN)).toBeNaN();
    expect(Object.is(rt.min(0, -0), 0)).toBe(true);
    expect(Object.is(rt.min(-0, 0), -0)).toBe(true);
    expect(rt.clamp(5, 0, 1)).toBe(1);
    expect(rt.clamp(0.5, 1, 0)).toBe(0); // lo > hi: min(max(x, lo), hi) = hi
    expect(rt.saturate(-2)).toBe(0);
    expect(rt.saturate(NaN)).toBe(0);
    expect(rt.saturate(Infinity)).toBe(1);
  });

  it("step takes the edge first; smoothstep and mix round each operation", () => {
    expect(rt.step(1, 0.5)).toBe(0);
    expect(rt.step(1, 1)).toBe(1);
    expect(rt.step(0.5, 1)).toBe(1);
    expect(rt.step(0, NaN)).toBe(0);
    expect(rt.smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(rt.smoothstep(0, 1, -1)).toBe(0);
    expect(rt.smoothstep(0, 1, 2)).toBe(1);
    expect(rt.smoothstep(0, 1, 0.25)).toBe(0.15625);
    const a = fr(0.1);
    const b = fr(0.7);
    const t = fr(0.3);
    expect(rt.mix(a, b, t)).toBe(fr(fr(a * fr(1 - t)) + fr(b * t)));
    expect(rt.mix(2, 4, 0.5)).toBe(3);
  });

  it("sqrt is correctly rounded; inverse_sqrt rounds once", () => {
    expect(rt.sqrt(2)).toBe(fr(Math.SQRT2));
    expect(bits(rt.sqrt(2))).toBe(0x3fb504f3);
    expect(rt.sqrt(-1)).toBeNaN();
    expect(rt.sqrt(-0)).toBe(-0);
    expect(rt.inverseSqrt(4)).toBe(0.5);
    expect(rt.inverseSqrt(0)).toBe(Infinity);
  });

  it("pow follows C99 for the cases where JavaScript differs", () => {
    expect(rt.pow(2, 10)).toBe(1024);
    expect(rt.pow(1, NaN)).toBe(1);
    expect(rt.pow(1, Infinity)).toBe(1);
    expect(rt.pow(-1, Infinity)).toBe(1);
    expect(rt.pow(-1, -Infinity)).toBe(1);
    expect(rt.pow(NaN, 0)).toBe(1);
    expect(rt.pow(-8, fr(1 / 3))).toBeNaN();
    expect(rt.pow(0, -1)).toBe(Infinity);
  });

  it("transcendental functions are the binary64 result rounded once", () => {
    const x = fr(0.7);
    expect(rt.sin(x)).toBe(fr(Math.sin(x)));
    expect(rt.cos(x)).toBe(fr(Math.cos(x)));
    expect(rt.tan(x)).toBe(fr(Math.tan(x)));
    expect(rt.asin(x)).toBe(fr(Math.asin(x)));
    expect(rt.acos(x)).toBe(fr(Math.acos(x)));
    expect(rt.atan(x)).toBe(fr(Math.atan(x)));
    expect(rt.atan2(1, -1)).toBe(fr((3 * Math.PI) / 4));
    expect(rt.exp(x)).toBe(fr(Math.exp(x)));
    expect(rt.exp2(3)).toBe(8);
    expect(rt.exp2(-149)).toBe(fromBits(1));
    expect(rt.log(x)).toBe(fr(Math.log(x)));
    expect(rt.log2(8)).toBe(3);
    expect(rt.log(0)).toBe(-Infinity);
    expect(rt.log(-1)).toBeNaN();
  });

  it("radians and degrees multiply by a binary32 constant", () => {
    expect(rt.radians(180)).toBe(fr(180 * fr(Math.PI / 180)));
    expect(rt.degrees(fr(Math.PI))).toBe(fr(fr(Math.PI) * fr(180 / Math.PI)));
    expect(rt.radians(0)).toBe(0);
  });

  it("scalar length and distance are absolute values", () => {
    expect(rt.length(-3)).toBe(3);
    expect(rt.distance(1, 4)).toBe(3);
    expect(rt.distance(fr(0.1), fr(0.3))).toBe(Math.abs(fr(fr(0.1) - fr(0.3))));
  });
});

describe("vectors", () => {
  const a = rt.v3(1, 2, 3);
  const b = rt.v3(0.5, 0.25, 0.125);

  it("operate component-wise and scale by scalars in either order", () => {
    expectSame(rt.v3add(a, b), { x: 1.5, y: 2.25, z: 3.125 });
    expectSame(rt.v3sub(a, b), { x: 0.5, y: 1.75, z: 2.875 });
    expectSame(rt.v3mul(a, b), { x: 0.5, y: 0.5, z: 0.375 });
    expectSame(rt.v3div(a, b), { x: 2, y: 8, z: 24 });
    expectSame(rt.v3scale(a, 2), { x: 2, y: 4, z: 6 });
    expectSame(rt.v3smul(2, a), { x: 2, y: 4, z: 6 });
    expectSame(rt.v3divs(a, 2), { x: 0.5, y: 1, z: 1.5 });
    expectSame(rt.v3neg(rt.v3(1, 0, -2)), { x: -1, y: -0, z: 2 });
    expectSame(rt.v2add(rt.v2(fr(0.1), 1), rt.v2(fr(0.2), 1)), { x: fr(0.3), y: 2 });
    expectSame(rt.v4divs(rt.v4(1, -1, 0, 2), 0), { x: Infinity, y: -Infinity, z: NaN, w: Infinity });
  });

  it("never modify their arguments and always return new objects", () => {
    const before = JSON.stringify([a, b]);
    const sum = rt.v3add(a, b);
    rt.v3normalize(a);
    rt.v3reflect(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
    expect(sum).not.toBe(a);
    expect(rt.v3scale(a, 1)).not.toBe(a);
  });

  it("dot, length, distance, cross, normalize and reflect", () => {
    expect(rt.v3dot(a, b)).toBe(1.375);
    expect(rt.v2dot(rt.v2(3, 4), rt.v2(3, 4))).toBe(25);
    expect(rt.v4dot(rt.v4(1, 1, 1, 1), rt.v4(1, 2, 3, 4))).toBe(10);
    expect(rt.v2length(rt.v2(3, 4))).toBe(5);
    expect(rt.v3length(rt.v3(2, 3, 6))).toBe(7);
    expect(rt.v4length(rt.v4(1, 1, 1, 1))).toBe(2);
    expect(rt.v3distance(rt.v3(1, 1, 1), rt.v3(3, 4, 7))).toBe(7);
    expectSame(rt.v3cross(rt.v3(1, 0, 0), rt.v3(0, 1, 0)), { x: 0, y: 0, z: 1 });
    expectSame(rt.v3cross(a, a), { x: 0, y: 0, z: 0 });
    expectSame(rt.v2normalize(rt.v2(3, 4)), { x: fr(0.6), y: fr(0.8) });
    expectSame(rt.v3normalize(rt.v3(0, 0, -5)), { x: 0, y: 0, z: -1 });
    expectSame(rt.v3reflect(rt.v3(1, -1, 0), rt.v3(0, 1, 0)), { x: 1, y: 1, z: 0 });
    expectSame(rt.v2reflect(rt.v2(1, -1), rt.v2(0, 1)), { x: 1, y: 1 });
    expectSame(rt.v4reflect(rt.v4(1, -1, 0, 2), rt.v4(0, 1, 0, 0)), { x: 1, y: 1, z: 0, w: 2 });
  });

  it("normalize gives the zero vector when the length is zero (CPU only)", () => {
    expectSame(rt.v2normalize(rt.v2(0, 0)), { x: 0, y: 0 });
    expectSame(rt.v3normalize(rt.v3(-0, 0, 0)), { x: 0, y: 0, z: 0 });
    expectSame(rt.v4normalize(rt.v4(0, 0, 0, 0)), { x: 0, y: 0, z: 0, w: 0 });
    // The squared length of 1e-30 underflows to 0 in binary32.
    expectSame(rt.v3normalize(rt.v3(1e-30, 0, 0)), { x: 0, y: 0, z: 0 });
  });

  it("lift every component-wise intrinsic from its scalar definition", () => {
    const v = rt.v4(-1.5, 0.5, 2.5, -0.25);
    expectSame(rt.v4round(v), { x: -2, y: 0, z: 2, w: -0 });
    expectSame(rt.v4abs(v), { x: 1.5, y: 0.5, z: 2.5, w: 0.25 });
    expectSame(rt.v4sign(v), { x: -1, y: 1, z: 1, w: -1 });
    expectSame(rt.v4fract(v), { x: 0.5, y: 0.5, z: 0.5, w: 0.75 });
    expectSame(rt.v4step(rt.v4splat(0), v), { x: 0, y: 1, z: 1, w: 0 });
    expectSame(rt.v4clamp(v, rt.v4splat(-1), rt.v4splat(1)), { x: -1, y: 0.5, z: 1, w: -0.25 });
    expectSame(rt.v2mixs(rt.v2(0, 10), rt.v2(10, 20), 0.5), { x: 5, y: 15 });
    expectSame(rt.v2mix(rt.v2(0, 10), rt.v2(10, 20), rt.v2(0, 1)), { x: 0, y: 20 });
    expectSame(rt.v3min(rt.v3(1, NaN, 3), rt.v3(2, 2, NaN)), { x: 1, y: 2, z: 3 });
    expectSame(rt.v2pow(rt.v2(2, 1), rt.v2(3, NaN)), { x: 8, y: 1 });
    expectSame(rt.v3smoothstep(rt.v3splat(0), rt.v3splat(1), rt.v3(0.5, -1, 2)), { x: 0.5, y: 0, z: 1 });
  });
});

describe("quaternions (operation order of decision 0026)", () => {
  /** An independent evaluation of the Hamilton product with the formula of decision 0026. */
  function hamilton(a: number[], b: number[]): number[] {
    const [ax = 0, ay = 0, az = 0, aw = 0] = a;
    const [bx = 0, by = 0, bz = 0, bw = 0] = b;
    const f = fr;
    return [
      f(f(f(f(aw * bx) + f(ax * bw)) + f(ay * bz)) - f(az * by)),
      f(f(f(f(aw * by) - f(ax * bz)) + f(ay * bw)) + f(az * bx)),
      f(f(f(f(aw * bz) + f(ax * by)) - f(ay * bx)) + f(az * bw)),
      f(f(f(f(aw * bw) - f(ax * bx)) - f(ay * by)) - f(az * bz)),
    ];
  }

  it("multiply with the Hamilton product; the identity is neutral exactly", () => {
    const a = rt.qaxisAngle(rt.v3(0, 0, 1), 0.4);
    const b = rt.qaxisAngle(rt.v3(1, 1, 0), 1.1);
    const ab = rt.qmul(a, b);
    expect([ab.x, ab.y, ab.z, ab.w]).toEqual(hamilton([a.x, a.y, a.z, a.w], [b.x, b.y, b.z, b.w]));
    expectSame(rt.qmul(rt.qidentity(), b), { ...b });
    expectSame(rt.qmul(b, rt.qidentity()), { ...b });
  });

  it("compose rotations: (a * b) * v == a * (b * v) within rounding", () => {
    const a = rt.qaxisAngle(rt.v3(0, 0, 1), 0.4);
    const b = rt.qaxisAngle(rt.v3(1, 1, 0), 1.1);
    const v = rt.v3(0.3, -0.7, 2);
    const left = rt.qrotate(rt.qmul(a, b), v);
    const right = rt.qrotate(a, rt.qrotate(b, v));
    for (const key of ["x", "y", "z"] as const) expect(Math.abs(left[key] - right[key])).toBeLessThan(1e-6);
    expectSame(rt.qrotate(rt.qidentity(), v), { ...v });
  });

  it("rotate +X a quarter turn about +Z to +Y", () => {
    const q = rt.qaxisAngle(rt.v3(0, 0, 1), fr(Math.PI / 2));
    const r = rt.qrotate(q, rt.v3(1, 0, 0));
    expect(Math.abs(r.x)).toBeLessThan(1e-7);
    expect(Math.abs(r.y - 1)).toBeLessThan(1e-7);
    expect(r.z).toBe(0);
  });

  it("axis_angle normalises the axis via its largest component; a zero axis is the identity", () => {
    const half = fr(0.5);
    expectSame(rt.qaxisAngle(rt.v3(0, 2, 0), 1), { x: 0, y: fr(Math.sin(half)), z: 0, w: fr(Math.cos(half)) });
    expectSame(rt.qaxisAngle(rt.v3(1e-30, 0, 0), 1), { x: fr(Math.sin(half)), y: 0, z: 0, w: fr(Math.cos(half)) });
    expectSame(rt.qaxisAngle(rt.v3(0, 0, -3e38), 1), { x: 0, y: 0, z: -fr(Math.sin(half)), w: fr(Math.cos(half)) });
    expectSame(rt.qaxisAngle(rt.v3(0, 0, 0), 1), { x: 0, y: 0, z: 0, w: 1 });
    const q = rt.qaxisAngle(rt.v3(1, 2, 3), 0.7);
    expect(Math.abs(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w - 1)).toBeLessThan(4 * 2 ** -23);
  });

  it("euler is (qy * qx) * qz: about Z first, then X, then Y", () => {
    const [x, y, z] = [0.3, -1.2, 0.8].map(fr) as [number, number, number];
    const qx = rt.qaxisAngle(rt.v3(1, 0, 0), x);
    const qy = rt.qaxisAngle(rt.v3(0, 1, 0), y);
    const qz = rt.qaxisAngle(rt.v3(0, 0, 1), z);
    expectSame(rt.qeuler(x, y, z), { ...rt.qmul(rt.qmul(qy, qx), qz) });
    const v = rt.v3(1, 2, 3);
    const stepwise: Vec3 = rt.qrotate(qy, rt.qrotate(qx, rt.qrotate(qz, v)));
    const direct = rt.qrotate(rt.qeuler(x, y, z), v);
    for (const key of ["x", "y", "z"] as const) expect(Math.abs(direct[key] - stepwise[key])).toBeLessThan(1e-5);
  });
});

describe("matrices", () => {
  const translate = rt.m4translation(rt.v3(5, 6, 7));

  it("construct column-major", () => {
    expect([...rt.m4identity()]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect([...translate]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
    expect([...rt.m4scale(rt.v3(2, 3, 4))]).toEqual([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);
    const m = rt.m4columns(rt.v4(1, 2, 3, 4), rt.v4(5, 6, 7, 8), rt.v4(9, 10, 11, 12), rt.v4(13, 14, 15, 16));
    expect([...m]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expectSame(rt.m4col(m, 2), { x: 9, y: 10, z: 11, w: 12 });
    expect([...rt.m4transpose(m)]).toEqual([1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]);
  });

  it("multiply with m * v applying to column vectors and a * b applying b first", () => {
    expectSame(rt.m4mulv(translate, rt.v4(1, 2, 3, 1)), { x: 6, y: 8, z: 10, w: 1 });
    const scale = rt.m4scale(rt.v3(2, 2, 2));
    // T * S scales first, then translates.
    expectSame(rt.m4mulv(rt.m4mul(translate, scale), rt.v4(1, 1, 1, 1)), { x: 7, y: 8, z: 9, w: 1 });
    // S * T translates first, then scales.
    expectSame(rt.m4mulv(rt.m4mul(scale, translate), rt.v4(1, 1, 1, 1)), { x: 12, y: 14, z: 16, w: 1 });
    expect([...rt.m4mul(rt.m4identity(), translate)]).toEqual([...translate]);
  });

  it("round every product and sum left to right", () => {
    const a = rt.m4columns(rt.v4(0.1, 0.2, 0.3, 0.4), rt.v4(0.5, 0.6, 0.7, 0.8), rt.v4(0.9, 1.1, 1.2, 1.3), rt.v4(1.4, 1.5, 1.6, 1.7));
    const v = rt.v4(0.3, 0.7, 1.9, 2.3);
    const r = rt.m4mulv(a, v);
    const col = (i: number) => rt.m4col(a, i);
    const expected = fr(fr(fr(fr(col(0).x * v.x) + fr(col(1).x * v.y)) + fr(col(2).x * v.z)) + fr(col(3).x * v.w));
    expect(r.x).toBe(expected);
    const ab = rt.m4mul(a, a);
    expectSame(rt.m4col(ab, 1), { ...rt.m4mulv(a, col(1)) });
  });

  it("rotation matches rotating with the quaternion", () => {
    const q = rt.qaxisAngle(rt.v3(1, 2, 3), 0.9);
    const m = rt.m4rotation(q);
    const v = rt.v3(0.3, -0.7, 2);
    const byMatrix = rt.m4mulv(m, rt.v4fromV3(v, 1));
    const byQuat = rt.qrotate(q, v);
    for (const key of ["x", "y", "z"] as const) expect(Math.abs(byMatrix[key] - byQuat[key])).toBeLessThan(1e-6);
    expect(byMatrix.w).toBe(1);
    expect([...rt.m4rotation(rt.qidentity())]).toEqual([...rt.m4identity()]);
  });
});

describe("color", () => {
  it("srgb uses the binary32 formula of decision 0024 item 6 and keeps alpha", () => {
    const c = rt.csrgb(rt.v3(0.5, 0.04, 1), 0.25);
    expect(c.r).toBe(fr(Math.pow(fr(fr(0.5 + fr(0.055)) / fr(1.055)), fr(2.4))));
    expect(c.g).toBe(fr(fr(0.04) / fr(12.92)));
    expect(c.b).toBe(1);
    expect(c.a).toBe(0.25);
    expect(rt.srgbChannelToLinear(0)).toBe(0);
    expect(rt.srgbChannelToLinear(fr(0.04045))).toBe(fr(fr(0.04045) / fr(12.92)));
  });
});
