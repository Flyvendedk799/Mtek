// Unit tests of the binary32 helpers and the WGSL accuracy interval evaluator (task M2-08).
import { describe, expect, it } from "vitest";
import { AccuracyEvaluator, OutsideAccuracyDomain, type Tolerances, type ToleranceEntry, type Value, parseExpr } from "./numeric-accuracy.ts";
import {
  F32_MAX,
  F32_MIN_SUBNORMAL,
  f32Steps,
  nextF32Down,
  nextF32Up,
  roundDownF32,
  roundUpF32,
  ulpF32,
} from "./numeric-values.ts";
import { loadEvaluator } from "./numeric-test-data.ts";

const s = (x: number): Value => ({ shape: "scalar", comps: [{ lo: x, hi: x }] });
const v = (...xs: number[]): Value => ({ shape: "vector", comps: xs.map((x) => ({ lo: x, hi: x })) });

function entry(evaluator: AccuracyEvaluator, key: string): ToleranceEntry {
  const found = evaluator.entry(key);
  if (found === undefined) throw new Error(`no entry ${key}`);
  return found;
}

function only(value: Value): { lo: number; hi: number } {
  const c = value.comps[0];
  if (c === undefined) throw new Error("empty value");
  return c;
}

describe("binary32 helpers", () => {
  it("ULP follows the WGSL definition (the smaller gap at a power of two)", () => {
    expect(ulpF32(1)).toBe(2 ** -24);
    expect(ulpF32(1.5)).toBe(2 ** -23);
    expect(ulpF32(-3)).toBe(2 ** -22);
    expect(ulpF32(0)).toBe(F32_MIN_SUBNORMAL);
    expect(ulpF32(1e-40)).toBe(F32_MIN_SUBNORMAL);
    expect(ulpF32(1 + 2 ** -30)).toBe(2 ** -23);
    expect(ulpF32(Infinity)).toBe(F32_MAX - nextF32Down(F32_MAX));
  });

  it("rounds in both directions and steps between neighbours", () => {
    expect(roundDownF32(0.1)).toBe(Math.fround(0.1) <= 0.1 ? Math.fround(0.1) : nextF32Down(Math.fround(0.1)));
    expect(roundUpF32(0.1)).toBe(nextF32Up(roundDownF32(0.1)));
    expect(roundDownF32(1)).toBe(1);
    expect(nextF32Up(0)).toBe(F32_MIN_SUBNORMAL);
    expect(nextF32Down(0)).toBe(-F32_MIN_SUBNORMAL);
    expect(f32Steps(-0, 0)).toBe(0);
    expect(f32Steps(1, nextF32Up(1))).toBe(1);
    expect(f32Steps(-F32_MIN_SUBNORMAL, F32_MIN_SUBNORMAL)).toBe(2);
  });
});

describe("WGSL expressions", () => {
  it("parses the forms tolerances.json uses", () => {
    expect(parseExpr("x - y * trunc(x / y)")).toMatchObject({ k: "bin", op: "-" });
    expect(parseExpr("vec4<f32>(unit * sin(half), cos(half))")).toMatchObject({ k: "call", name: "vec4<f32>" });
    expect(parseExpr("select(a, b, c <= 0.04045)")).toMatchObject({ k: "call", name: "select" });
    expect(parseExpr("-q.xyz")).toMatchObject({ k: "neg", arg: { k: "member", field: "xyz" } });
    expect(() => parseExpr("x +")).toThrow();
  });
});

describe("accuracy intervals", () => {
  const evaluator = loadEvaluator();

  it("a correctly rounded operation allows rounding up or down (15.7.4)", () => {
    const tie = only(evaluator.allowed(entry(evaluator, "+ (float)"), [s(1), s(2 ** -24)]));
    expect(tie).toEqual({ lo: 1, hi: 1 + 2 ** -23 });
    const exact = only(evaluator.allowed(entry(evaluator, "* (float)"), [s(1.5), s(2)]));
    expect(exact).toEqual({ lo: 3, hi: 3 });
  });

  it("division allows 2.5 ULP and nothing beyond", () => {
    const third = only(evaluator.allowed(entry(evaluator, "/ (float)"), [s(1), s(3)]));
    const exact = 1 / 3;
    expect(third.lo).toBeLessThanOrEqual(Math.fround(exact));
    expect(third.hi).toBeGreaterThanOrEqual(Math.fround(exact));
    expect(exact - third.lo).toBeLessThanOrEqual(2.5 * ulpF32(exact));
    expect(third.hi - exact).toBeLessThanOrEqual(2.5 * ulpF32(exact));
    // 5 ULP of width hold 4 or 5 grid steps, depending on where the exact value lies.
    expect(f32Steps(third.lo, third.hi)).toBeGreaterThanOrEqual(4);
    expect(f32Steps(third.lo, third.hi)).toBeLessThanOrEqual(5);
    expect(() => evaluator.allowed(entry(evaluator, "/ (float)"), [s(1), s(2 ** -127)])).toThrow(OutsideAccuracyDomain);
  });

  it("adds one binary32 step for CPU rounding", () => {
    const narrow = only(evaluator.allowed(entry(evaluator, "/ (float)"), [s(1), s(3)]));
    const wide = only(evaluator.allowedWithCpuRounding(entry(evaluator, "/ (float)"), [s(1), s(3)]));
    expect(wide).toEqual({ lo: nextF32Down(narrow.lo), hi: nextF32Up(narrow.hi) });
  });

  it("states no bound outside the input range of the accuracy statement", () => {
    expect(() => evaluator.allowed(entry(evaluator, "sin"), [s(4)])).toThrow(/x in \[/);
    expect(() => evaluator.allowed(entry(evaluator, "sin"), [s(Math.fround(Math.PI))])).toThrow(OutsideAccuracyDomain);
    expect(only(evaluator.allowed(entry(evaluator, "sin"), [s(nextF32Down(Math.fround(Math.PI)))])).hi).toBeLessThan(0.001);
    expect(() => evaluator.allowed(entry(evaluator, "sqrt"), [s(0)])).toThrow(/inverseSqrt/);
    expect(() => evaluator.allowed(entry(evaluator, "atan2"), [s(0), s(1)])).toThrow(/normal/);
    expect(() => evaluator.allowed(entry(evaluator, "asin"), [s(0)])).toThrow(OutsideAccuracyDomain);
    expect(() => evaluator.allowed(entry(evaluator, "normalize"), [v(0, 0, 0)])).toThrow(/zero vector/);
  });

  it("sin and cos are bounded absolutely by 2^-11 on [-pi, pi]", () => {
    const c = only(evaluator.allowed(entry(evaluator, "cos"), [s(0)]));
    expect(c).toEqual({ lo: 1 - 2 ** -11, hi: 1 + 2 ** -11 });
  });

  it("exp allows 3 + 2|x| ULP", () => {
    const e = only(evaluator.allowed(entry(evaluator, "exp"), [s(2)]));
    const exact = Math.exp(2);
    expect(exact - e.lo).toBeGreaterThan(6.5 * ulpF32(exact));
    expect(exact - e.lo).toBeLessThanOrEqual(7 * ulpF32(exact) + 1e-12);
  });

  it("inherited sqrt is 1.0 / inverseSqrt(x): a few ULP, not correctly rounded", () => {
    const r = only(evaluator.allowed(entry(evaluator, "sqrt"), [s(4)]));
    expect(r.lo).toBeLessThan(2);
    expect(r.hi).toBeGreaterThan(2);
    expect(f32Steps(r.lo, 2)).toBeLessThanOrEqual(6);
    expect(f32Steps(r.hi, 2)).toBeLessThanOrEqual(6);
  });

  it("subnormal inputs and outputs may be flushed to zero (15.7.2)", () => {
    const sum = only(evaluator.allowed(entry(evaluator, "+ (float)"), [s(F32_MIN_SUBNORMAL), s(F32_MIN_SUBNORMAL)]));
    expect(sum.lo).toBe(0);
    expect(sum.hi).toBe(2 * F32_MIN_SUBNORMAL);
  });

  it("sums of three or more terms allow any association order (15.7.5)", () => {
    const tolerances: Tolerances = {
      ...evaluator.tolerances,
      entries: [
        ...evaluator.tolerances.entries,
        {
          key: "chain", wgsl: "chain", params: ["x", "y", "z"], compare: "tolerance",
          accuracy: { kind: "inherited", expr: "x + y - z" }, cite: [],
        },
      ],
    };
    const local = new AccuracyEvaluator(tolerances);
    const chained = only(local.allowed(entry(local, "chain"), [s(1e8), s(1), s(1e8)]));
    // Left to right gives 0 (1e8 + 1 rounds to 1e8); x + (y - z) or (x - z) + y gives 1 or 0.
    expect(chained.lo).toBeLessThanOrEqual(0);
    expect(chained.hi).toBeGreaterThanOrEqual(1);
  });

  it("fails when an intermediate may overflow", () => {
    expect(() => evaluator.allowed(entry(evaluator, "+ (float)"), [s(F32_MAX), s(F32_MAX)])).toThrow(/overflow/);
  });

  it("matrix products are bounded through dot products (8.8)", () => {
    const identity = { shape: "matrix" as const, comps: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map((x) => ({ lo: x, hi: x })) };
    const result = evaluator.allowed(entry(evaluator, "* (mat4, vec4)"), [identity, v(1, 2, 3, 4)]);
    result.comps.forEach((c, i) => {
      expect(c.lo).toBeLessThanOrEqual(i + 1);
      expect(c.hi).toBeGreaterThanOrEqual(i + 1);
      expect(f32Steps(c.lo, c.hi)).toBeLessThanOrEqual(16);
    });
  });
});
