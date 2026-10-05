import { describe, expect, it } from "vitest";
import { Xoshiro128 } from "./xoshiro.js";

/** xoshiro128** and splitmix32 written independently with BigInt (the published reference algorithms). */
function reference(seed: number, count: number): number[] {
  const M = 0xffffffffn;
  let x = BigInt(seed >>> 0);
  const split = (): bigint => {
    x = (x + 0x9e3779b9n) & M;
    let z = x;
    z = ((z ^ (z >> 16n)) * 0x85ebca6bn) & M;
    z = ((z ^ (z >> 13n)) * 0xc2b2ae35n) & M;
    return (z ^ (z >> 16n)) & M;
  };
  const s = [split(), split(), split(), split()] as [bigint, bigint, bigint, bigint];
  const rotl = (v: bigint, k: bigint): bigint => ((v << k) | (v >> (32n - k))) & M;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Number((rotl((s[1] * 5n) & M, 7n) * 9n) & M));
    const t = (s[1] << 9n) & M;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11n);
  }
  return out;
}

describe("Xoshiro128 (random(), spec/stdlib.md section 4)", () => {
  it.each([0, 1, 42, 0xdeadbeef, 0xffffffff])("matches the reference algorithm for seed %d", (seed) => {
    const generator = new Xoshiro128(seed);
    expect(Array.from({ length: 64 }, () => generator.nextU32())).toEqual(reference(seed, 64));
  });

  it("gives equal sequences for equal seeds and different sequences for different seeds", () => {
    const take = (g: Xoshiro128): number[] => Array.from({ length: 16 }, () => g.nextF32());
    expect(take(new Xoshiro128(7))).toEqual(take(new Xoshiro128(7)));
    expect(take(new Xoshiro128(7))).not.toEqual(take(new Xoshiro128(8)));
  });

  it("returns f32 values in [0, 1)", () => {
    const generator = new Xoshiro128(123);
    for (let i = 0; i < 10_000; i += 1) {
      const value = generator.nextF32();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(Math.fround(value)).toBe(value);
    }
  });

  it("turns the seed 0 into a live state (not stuck at zero)", () => {
    const generator = new Xoshiro128(0);
    const values = new Set(Array.from({ length: 32 }, () => generator.nextU32()));
    expect(values.size).toBeGreaterThan(30);
  });

  it("treats the seed as an unsigned 32-bit integer", () => {
    expect(new Xoshiro128(-1).nextU32()).toBe(new Xoshiro128(0xffffffff).nextU32());
  });
});
