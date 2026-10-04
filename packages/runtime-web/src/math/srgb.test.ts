/**
 * `color.srgb` at run time against the compiler's folded values (decision 0024 item 6, decision
 * 0037). The golden `tests/semantics/numeric/srgb-fold.json` is produced by the real constant folder
 * (`crates/mtek-compiler/tests/numeric_srgb_golden.rs`, which also fails when the golden is stale);
 * the sweep covers 0, the binary32 value nearest 0.04045 and its neighbours, every 8-bit channel
 * value, a grid over [0, 1], 1 and values above it, and small and negative values.
 *
 * Folding uses binary32 `libm::powf`; `rt` uses binary64 `Math.pow` rounded once, with the same
 * formula, constants and operation order. They must agree within the tolerance of
 * `spec/testing.md` 5, which for `pow` is at least the 1 ulp allowed for CPU rounding: this test
 * asserts at most 1 ulp, and bit equality on the linear segment (no `pow` involved).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { csrgb, srgbChannelToLinear, v3 } from "./rt.js";

interface Golden {
  readonly format: string;
  readonly cases: readonly (readonly [number | "-0", number | "-0"])[];
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../tests/semantics/numeric/srgb-fold.json", import.meta.url)), "utf8"),
) as Golden;

function f32(raw: number | "-0"): number {
  const v = raw === "-0" ? -0 : raw;
  if (Math.fround(v) !== v) throw new Error(`${v} is not a binary32 value`);
  return v;
}

/** The distance in binary32 steps between two finite values of the same sign class. */
function ulps(a: number, b: number): number {
  const view = new DataView(new ArrayBuffer(8));
  const ordered = (x: number): number => {
    view.setFloat32(0, x);
    const bits = view.getUint32(0);
    return bits & 0x80000000 ? 0x80000000 - bits : bits;
  };
  return a === b ? 0 : Math.abs(ordered(a) - ordered(b));
}

describe("color.srgb agrees with compiler-folded constants", () => {
  const threshold = Math.fround(0.04045);

  it("over the whole sweep, within 1 ulp, bit for bit on the linear segment", () => {
    expect(golden.format).toBe("mtek-srgb-fold/1");
    expect(golden.cases.length).toBeGreaterThan(1200);
    let maxUlps = 0;
    let maxAbs = 0;
    let exact = 0;
    for (const [rawInput, rawFolded] of golden.cases) {
      const input = f32(rawInput);
      const folded = f32(rawFolded);
      const runtime = srgbChannelToLinear(input);
      const distance = ulps(runtime, folded);
      if (input <= threshold) {
        expect(Object.is(runtime, folded), `linear segment at ${input}`).toBe(true);
      }
      expect(distance, `srgb(${input}): runtime ${runtime}, folded ${folded}`).toBeLessThanOrEqual(1);
      maxUlps = Math.max(maxUlps, distance);
      maxAbs = Math.max(maxAbs, Math.abs(runtime - folded));
      if (distance === 0) exact++;
    }
    // Recorded in the completion report of M2-06.
    console.info(
      `color.srgb vs folding: ${golden.cases.length} inputs, ${exact} bit-identical, max ${maxUlps} ulp, max abs error ${maxAbs}`,
    );
  });

  it("covers the threshold, its neighbours, 1 and values above 1", () => {
    const inputs = golden.cases.map(([i]) => f32(i));
    expect(inputs).toContain(0);
    expect(inputs).toContain(threshold);
    expect(inputs.filter((x) => x > 0.04 && x < 0.041).length).toBeGreaterThanOrEqual(17);
    expect(inputs).toContain(1);
    expect(inputs.filter((x) => x > 1).length).toBeGreaterThanOrEqual(8);
  });

  it("applies the channel function to r, g and b and keeps alpha", () => {
    const [a, b, c] = golden.cases.slice(40, 43).map(([i]) => f32(i)) as [number, number, number];
    const colour = csrgb(v3(a, b, c), 0.5);
    expect(colour).toEqual({ r: srgbChannelToLinear(a), g: srgbChannelToLinear(b), b: srgbChannelToLinear(c), a: 0.5 });
  });
});
