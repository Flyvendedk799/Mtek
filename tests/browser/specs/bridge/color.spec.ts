// M0 bridge test 4 (spec/testing.md section 6.2): a full-viewport triangle whose fragment colour is
// computed from the mixed block (`f.rgb * a`) renders into an `rgba8unorm-srgb` target; the centre
// pixel equals the CPU-computed sRGB-encoded value within 1/255 per channel. The expectation uses
// the exact sRGB OETF in f64 and rounds to 8 bits; the shader never sees the CPU result.
import { type CpuValue, srgbEncode8, toJson } from "../../support/bridge-values.ts";
import { expect, test } from "../../support/bridge-fixtures.ts";

/** A `mixed` block value; only `a` and `f` take part in the colour, the rest is filler. */
function mixed(a: number, f: { r: number; g: number; b: number; a: number }): CpuValue {
  return {
    a,
    b: { x: 1, y: 2, z: 3 },
    c: 7,
    d: { x: 4, y: 5 },
    e: true,
    f,
  };
}

const TOLERANCE = 1; // of 255, per channel

const CASES = [
  { a: 0.5, f: { r: 0.8, g: 0.4, b: 0.2, a: 0.3 } },
  { a: 1, f: { r: 0.05, g: 0.25, b: 0.9, a: 1 } },
  { a: 0.25, f: { r: 1, g: 0.6, b: 0.02, a: 0.7 } },
] as const;

/** The expected RGBA bytes: sRGB-encoded `f.rgb * a` (computed from the binary32 inputs); alpha is 1.0. */
function expectedColour(a: number, f: { r: number; g: number; b: number }): [number, number, number, number] {
  const scale = Math.fround(a);
  return [
    srgbEncode8(Math.fround(f.r) * scale),
    srgbEncode8(Math.fround(f.g) * scale),
    srgbEncode8(Math.fround(f.b) * scale),
    255,
  ];
}

test("mixed: the rendered colour matches the CPU sRGB encoding of f.rgb * a", async ({ bridge }) => {
  const centres: number[][] = [];
  for (const { a, f } of CASES) {
    const expected = expectedColour(a, f);
    const result = await bridge.renderColor(toJson(mixed(a, f)));
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
    expect(result.pixels).toHaveLength(16 * 16 * 4);

    const label = `a=${a} f=(${f.r}, ${f.g}, ${f.b}): got ${result.centre.join(",")}, expected ${expected.join(",")}`;
    result.centre.forEach((channel, index) => {
      expect(Math.abs(channel - (expected[index] ?? 0)), `${label} (channel ${index})`).toBeLessThanOrEqual(TOLERANCE);
    });
    // The triangle covers the whole viewport with one colour: every pixel agrees.
    for (let pixel = 0; pixel < 16 * 16; pixel++) {
      for (let channel = 0; channel < 4; channel++) {
        const read = result.pixels[pixel * 4 + channel] ?? -1;
        expect(Math.abs(read - (expected[channel] ?? 0)), `${label} (pixel ${pixel}, channel ${channel})`).toBeLessThanOrEqual(
          TOLERANCE,
        );
      }
    }
    centres.push([...result.centre]);
  }
  // Different inputs rendered different colours (the shader really read the block).
  expect(new Set(centres.map((centre) => centre.join(","))).size).toBe(CASES.length);

  // Changing the block values created no pipeline and no shader module (spec/gpu-layout.md section 8.2).
  const counters = await bridge.counters();
  expect(counters.pipelinesCreated).toBe(1);
  expect(counters.shaderModulesCreated).toBe(1);
});
