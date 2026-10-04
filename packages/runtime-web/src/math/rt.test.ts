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

