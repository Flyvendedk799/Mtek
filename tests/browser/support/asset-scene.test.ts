import { describe, expect, it } from "vitest";
import {
  AMBIENT_INTENSITY,
  CELL,
  CORNER_INSIDE,
  CORNER_OUTSIDE,
  FIGURE_HALF,
  GREY_LEVEL,
  LACQUER,
  LACQUER_OFFSETS,
  MASK_PIXELS,
  MASK_TEXELS,
  OAK_LINEAR,
  OAK_PIXEL,
  QUADRANTS,
  ROOF_INSIDE,
  ROOF_OUTSIDE,
  SLATE_LINEAR,
  SLATE_PIXEL,
  SQUARE_INSIDE,
  cellCentre,
  lacquerLinear,
  lacquerPixel,
  pixelToWorld,
} from "./asset-scene.ts";
import { linearRgbToSrgb8 } from "./reference-shading.ts";
import { linearToSrgbByte } from "./texture-reference.ts";

describe("the pixel grid of fixtures/m4/assets_scene", () => {
  it("has nine cells of 32 pixels whose centres are 16, 48 and 80", () => {
    expect(CELL).toBe(32);
    expect([cellCentre(0, 0), cellCentre(1, 2), cellCentre(2, 1)]).toEqual([[16, 16], [48, 80], [80, 48]]);
  });

  it("maps a pixel to the world as a 16 pixels per unit orthographic view with the origin in the middle", () => {
    expect(pixelToWorld(80, 16)).toEqual([2.03125, 1.96875, 0]);
    expect(pixelToWorld(47, 47)).toEqual([-0.03125, 0.03125, 0]);
  });

  it("samples every quadrant of a panel well inside the quadrant and inside the 12.8 pixel rim", () => {
    for (const [dx, dy] of QUADRANTS) {
      expect(Math.abs(dx)).toBeLessThan(FIGURE_HALF);
      expect(Math.abs(dy)).toBeLessThan(FIGURE_HALF);
      expect(Math.abs(dx)).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("the hand-worked colours agree with the sRGB transfer function of the oracle", () => {
  it("Oak and Slate", () => {
    expect(linearRgbToSrgb8(OAK_LINEAR)).toEqual(OAK_PIXEL);
    expect(linearRgbToSrgb8(SLATE_LINEAR)).toEqual(SLATE_PIXEL);
  });

  it("the mask, a linear texture, shows the sRGB encoding of byte / 255", () => {
    expect(MASK_TEXELS.map((texel) => texel.map((byte) => linearToSrgbByte(byte / 255)))).toEqual(MASK_PIXELS.map((pixel) => [...pixel]));
    expect(MASK_PIXELS.map((pixel) => pixel[0])).toEqual([255, 188, 137, 0]);
    // The wrong reading (as sRGB data) would be 128 and 64.
    expect(MASK_TEXELS.map((texel) => texel[0])).toEqual([255, 128, 64, 0]);
  });

  it("the JPEG grey: DC coefficient 36 with quantiser 16 reconstructs to 36 * 16 / 8 + 128", () => {
    expect((36 * 16) / 8 + 128).toBe(GREY_LEVEL);
    // And the encoder of make-glb.mjs: dc = round(8 (level - 128) / 16).
    expect(Math.round((8 * (GREY_LEVEL - 128)) / 16)).toBe(36);
  });
});

describe("the figures", () => {
  it("Corner: (-6, +6) is inside the triangle below the diagonal dy = dx, (+6, -6) outside, both 8.5 pixels from it", () => {
    const [ix, iy] = CORNER_INSIDE;
    const [ox, oy] = CORNER_OUTSIDE;
    expect(iy).toBeGreaterThan(ix);
    expect(oy).toBeLessThan(ox);
    expect(Math.abs(iy - ix) / Math.SQRT2).toBeCloseTo(8.485, 3);
  });

  it("Roof: the half width at dy is 12.8 (dy + 12.8) / 25.6", () => {
    const halfWidth = (dy: number): number => (FIGURE_HALF * (dy + FIGURE_HALF)) / (2 * FIGURE_HALF);
    for (const [dx, dy] of ROOF_INSIDE) expect(Math.abs(dx)).toBeLessThan(halfWidth(dy));
    for (const [dx, dy] of ROOF_OUTSIDE) expect(Math.abs(dx)).toBeGreaterThan(halfWidth(dy));
    expect(halfWidth(8)).toBeCloseTo(10.4, 6);
    expect(halfWidth(-10)).toBeCloseTo(1.4, 6);
  });

  it("Square: its sampled corners are inside the square", () => {
    for (const [dx, dy] of SQUARE_INSIDE) expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeLessThan(FIGURE_HALF);
  });
});

describe("Lacquer under the sun", () => {
  it("is lit: the sun shines on the +Z face (L = -travel has a positive z), so every sample exceeds the ambient term", () => {
    for (const [dx, dy] of LACQUER_OFFSETS) {
      const [cx, cy] = cellCentre(2, 0);
      const linear = lacquerLinear(cx + dx, cy + dy);
      LACQUER.baseColor.forEach((base, channel) => {
        expect(linear[channel] ?? 0, `channel ${String(channel)} at offset ${String(dx)},${String(dy)}`).toBeGreaterThan(base * AMBIENT_INTENSITY);
      });
      // The target stores the sRGB encoding of the clamped linear value.
      expect(lacquerPixel(cx + dx, cy + dy)).toEqual(linearRgbToSrgb8(linear));
    }
  });
});
