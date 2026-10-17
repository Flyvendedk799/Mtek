import { describe, expect, it } from "vitest";
import {
  GENERATED_TEXTURE_TEXELS,
  HAND_DECODED,
  encodePixel,
  linearToSrgbByte,
  sampleReference,
  srgbByteToLinear,
  type ReferenceTexture,
} from "./texture-reference.ts";

const SRGB: ReferenceTexture = { width: 2, height: 2, texels: GENERATED_TEXTURE_TEXELS, colorSpace: "srgb" };
const LINEAR: ReferenceTexture = { ...SRGB, colorSpace: "linear" };

describe("the sRGB transfer functions of the reference", () => {
  it.each(HAND_DECODED)("decodes byte %i to the hand-computed %f", (byte, expected) => {
    expect(srgbByteToLinear(byte)).toBeCloseTo(expected, 8);
  });

  it("is the identity on every byte after decode then encode", () => {
    for (let byte = 0; byte < 256; byte += 1) expect(linearToSrgbByte(srgbByteToLinear(byte))).toBe(byte);
  });

  it("uses the linear segment below the knee and clamps outside [0, 1]", () => {
    expect(srgbByteToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(linearToSrgbByte(0.001)).toBe(Math.round(0.001 * 12.92 * 255));
    expect(linearToSrgbByte(-1)).toBe(0);
    expect(linearToSrgbByte(7)).toBe(255);
  });
});

describe("the sampler reference", () => {
  const at = (texture: ReferenceTexture, filter: "nearest" | "linear", address: "clamp" | "repeat", u: number, v: number) =>
    encodePixel(sampleReference(texture, filter, address, u, v));

  it("returns each texel at its centre for every filter and address mode", () => {
    const centres: Array<[number, number]> = [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ];
    for (const filter of ["nearest", "linear"] as const) {
      for (const address of ["clamp", "repeat"] as const) {
        centres.forEach(([u, v], index) => {
          expect(at(SRGB, filter, address, u, v)).toEqual(GENERATED_TEXTURE_TEXELS[index]?.slice(0, 3));
        });
      }
    }
  });

  it("nearest picks the texel containing the coordinate; clamp holds the edge and repeat wraps", () => {
    expect(at(SRGB, "nearest", "clamp", 0.49, 0.25)).toEqual([188, 64, 32]);
    expect(at(SRGB, "nearest", "clamp", 0.51, 0.25)).toEqual([255, 128, 0]);
    expect(at(SRGB, "nearest", "clamp", 1.25, 0.25)).toEqual([255, 128, 0]);
    expect(at(SRGB, "nearest", "repeat", 1.25, 0.25)).toEqual([188, 64, 32]);
    expect(at(SRGB, "nearest", "clamp", -0.25, 0.75)).toEqual([16, 200, 100]);
    expect(at(SRGB, "nearest", "repeat", -0.25, 0.75)).toEqual([96, 96, 220]);
  });

  it("linear blends in linear space: the middle of two texels is the mean of their linear values", () => {
    const mean = [0, 1, 2].map((c) => (srgbByteToLinear(GENERATED_TEXTURE_TEXELS[0]?.[c] ?? 0) + srgbByteToLinear(GENERATED_TEXTURE_TEXELS[1]?.[c] ?? 0)) / 2);
    expect(sampleReference(SRGB, "linear", "clamp", 0.5, 0.25)).toEqual([mean[0], mean[1], mean[2]]);
    // Blending the encoded bytes instead would give a different, darker pixel.
    expect(at(SRGB, "linear", "clamp", 0.5, 0.25)[0]).not.toBe(Math.round((188 + 255) / 2));
  });

  it("a linear texture is read as byte / 255", () => {
    expect(sampleReference(LINEAR, "nearest", "clamp", 0.25, 0.25)).toEqual([188 / 255, 64 / 255, 32 / 255]);
    // 188 / 255 is 0.737 as a linear value, which an sRGB target shows as byte 223 (0.8741 x 255 = 222.9), not 188.
    expect(at(LINEAR, "nearest", "clamp", 0.25, 0.25)[0]).toBe(223);
  });
});
