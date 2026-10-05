/**
 * The `random()` generator (`spec/stdlib.md` section 4: xoshiro128**, seeded from the mount options).
 * The 32-bit seed is expanded to the 128-bit state with splitmix32, so every seed (including 0) gives a
 * valid, non-zero state, and equal seeds give equal sequences on every platform.
 */
export class Xoshiro128 {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    let x = seed >>> 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  /** The next 32 random bits. */
  nextU32(): number {
    const rotl = (v: number, k: number): number => ((v << k) | (v >>> (32 - k))) >>> 0;
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** `random()`: an f32 in `[0, 1)`; the top 24 bits, so every value is exactly representable. */
  nextF32(): number {
    return (this.nextU32() >>> 8) / 16777216;
  }
}
