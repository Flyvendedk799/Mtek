// The random helpers of decision 0149: `random_range`, `random_int` and `chance`, each one draw of `random()`.
import { describe, expect, it } from "vitest";
import { randomInt, randomRange } from "./world.js";

describe("random_range", () => {
  it("maps [0, 1) onto [lo, hi), rounded to f32", () => {
    expect(randomRange(0, 2, 6)).toBe(2);
    expect(randomRange(0.5, 2, 6)).toBe(4);
    expect(randomRange(0.1, 0, 1)).toBe(Math.fround(0.1));
    expect(randomRange(0.999999, -1, 1)).toBeLessThan(1);
  });

  it("follows the formula when hi < lo", () => {
    expect(randomRange(0.25, 4, 0)).toBe(3);
  });
});

describe("random_int", () => {
  it("is an i32 in [lo, hi)", () => {
    expect(randomInt(0, 0, 3)).toBe(0);
    expect(randomInt(0.34, 0, 3)).toBe(1);
    expect(randomInt(0.9999999, 0, 3)).toBe(2);
    expect(randomInt(0.5, -5, 5)).toBe(0);
    // The whole i32 range: the f64 arithmetic does not overflow.
    expect(randomInt(1 - 2 ** -32, -2147483648, 2147483647)).toBe(2147483646);
    expect(randomInt(0, -2147483648, 2147483647)).toBe(-2147483648);
  });

  it("is lo when hi <= lo", () => {
    expect(randomInt(0.7, 3, 3)).toBe(3);
    expect(randomInt(0.7, 5, 1)).toBe(5);
  });
});
