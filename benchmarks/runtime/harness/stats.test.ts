import { describe, expect, it } from "vitest";
import { median, percentOver, percentileSorted, round, summarize } from "./stats.ts";

describe("percentileSorted (nearest rank)", () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns the sample of rank ceil(p/100 * n)", () => {
    expect(percentileSorted(ten, 50)).toBe(5);
    expect(percentileSorted(ten, 95)).toBe(10);
    expect(percentileSorted(ten, 99)).toBe(10);
    expect(percentileSorted(ten, 10)).toBe(1);
    expect(percentileSorted(ten, 11)).toBe(2);
    expect(percentileSorted(ten, 100)).toBe(10);
  });

  it("returns observed values only, never an interpolation", () => {
    const sorted = [1, 100];
    for (const p of [1, 25, 50, 51, 75, 99, 100]) expect(sorted).toContain(percentileSorted(sorted, p));
  });

  it("is monotone in p", () => {
    const samples = Array.from({ length: 600 }, (_, i) => (i * 37) % 101).sort((a, b) => a - b);
    let last = -Infinity;
    for (let p = 1; p <= 100; p += 1) {
      const value = percentileSorted(samples, p);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it("picks the 570th of 600 sorted samples for p95 and the 594th for p99", () => {
    const samples = Array.from({ length: 600 }, (_, i) => i + 1);
    expect(percentileSorted(samples, 95)).toBe(570);
    expect(percentileSorted(samples, 99)).toBe(594);
    expect(percentileSorted(samples, 50)).toBe(300);
  });

  it("rejects an empty sample and a percentile outside (0, 100]", () => {
    expect(() => percentileSorted([], 50)).toThrow(RangeError);
    expect(() => percentileSorted(ten, 0)).toThrow(RangeError);
    expect(() => percentileSorted(ten, 101)).toThrow(RangeError);
  });
});

describe("summarize", () => {
  it("sorts numerically (not as text) and reports count, extremes, mean and the three percentiles", () => {
    const s = summarize([10, 9, 100, 1, 2, 3, 4, 5, 6, 7]);
    expect(s.count).toBe(10);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.mean).toBe(14.7);
    expect(s.p50).toBe(5);
    expect(s.p95).toBe(100);
    expect(s.p99).toBe(100);
  });

  it("does not modify its input", () => {
    const input = [3, 1, 2];
    summarize(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("accepts typed arrays", () => {
    expect(summarize(Float64Array.from([2, 1, 3])).p50).toBe(2);
  });
});

describe("median, percentOver, round", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(RangeError);
  });

  it("measures how far above the reference a value is", () => {
    expect(percentOver(120, 100)).toBeCloseTo(20, 12);
    expect(percentOver(80, 100)).toBeCloseTo(-20, 12);
    expect(() => percentOver(1, 0)).toThrow(RangeError);
  });

  it("rounds to a number of decimals", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.235, 0)).toBe(1);
  });
});
