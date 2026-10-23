import { describe, expect, it } from "vitest";

import * as ease from "./ease.js";

const curves = Object.entries(ease).filter(([name]) => name.startsWith("ease")) as [string, (t: number) => number][];

describe("easing curves (decision 0135)", () => {
  it("has the ten curves of the easing namespace", () => {
    expect(curves.map(([name]) => name).sort()).toEqual(
      ["easeInCubic", "easeInOutCubic", "easeInOutQuad", "easeInOutSine", "easeInQuad", "easeOutBack", "easeOutBounce", "easeOutCubic", "easeOutElastic", "easeOutQuad"].sort(),
    );
  });
  it("starts at 0, ends at 1 and clamps its argument", () => {
    for (const [name, curve] of curves) {
      expect(curve(0), name).toBeCloseTo(0, 6);
      expect(curve(1), name).toBeCloseTo(1, 6);
      expect(curve(-3), name).toBe(curve(0));
      expect(curve(7), name).toBe(curve(1));
      expect(curve(NaN), name).toBe(curve(0));
    }
  });
  it("matches known values", () => {
    expect(ease.easeInQuad(0.5)).toBe(0.25);
    expect(ease.easeOutQuad(0.5)).toBe(0.75);
    expect(ease.easeInOutCubic(0.5)).toBe(0.5);
    expect(ease.easeOutBack(0.7)).toBeGreaterThan(1);
    expect(ease.easeOutBounce(0.5)).toBeCloseTo(0.765625, 6);
  });
  it("returns binary32 values", () => {
    for (const [, curve] of curves) expect(Math.fround(curve(0.3))).toBe(curve(0.3));
  });
});

describe("easing of infinite arguments (spec/tweens.md section 3)", () => {
  it("clamps +infinity to the end and -infinity to the start; only NaN counts as 0", () => {
    for (const [name, curve] of curves) {
      expect(curve(Infinity), name).toBe(curve(1));
      expect(curve(-Infinity), name).toBe(curve(0));
    }
    expect(ease.easeOutQuad(Infinity)).toBe(1);
  });
});
