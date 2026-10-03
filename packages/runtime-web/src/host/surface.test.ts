import { describe, expect, it } from "vitest";
import { DEPTH_FORMAT, OFFSCREEN_FORMAT, backingSize, paddedBytesPerRow, srgbViewFormat } from "./surface.js";

describe("srgbViewFormat", () => {
  it("maps the two WebGPU preferred canvas formats to their sRGB views", () => {
    expect(srgbViewFormat("bgra8unorm")).toBe("bgra8unorm-srgb");
    expect(srgbViewFormat("rgba8unorm")).toBe("rgba8unorm-srgb");
  });

  it("has no view for anything else", () => {
    expect(srgbViewFormat("rgba16float")).toBeUndefined();
    expect(srgbViewFormat("bgra8unorm-srgb")).toBeUndefined();
    expect(srgbViewFormat("")).toBeUndefined();
  });
});

describe("backingSize", () => {
  it("is round(client x dpr) per axis (spec/runtime-abi.md 8.2)", () => {
    expect(backingSize(200, 100, 1, 8192)).toEqual({ width: 200, height: 100 });
    expect(backingSize(200, 101, 1.5, 8192)).toEqual({ width: 300, height: 152 });
    expect(backingSize(333, 333, 1.25, 8192)).toEqual({ width: 416, height: 416 }); // 416.25 rounds down
    expect(backingSize(100, 100, 0.5, 8192)).toEqual({ width: 50, height: 50 });
  });

  it("is zero for a zero-sized canvas and never negative", () => {
    expect(backingSize(0, 100, 2, 8192)).toEqual({ width: 0, height: 200 });
    expect(backingSize(-5, 0, 2, 8192)).toEqual({ width: 0, height: 0 });
  });

  it("is clamped to the device's maximum texture dimension", () => {
    expect(backingSize(10_000, 10, 2, 8192)).toEqual({ width: 8192, height: 20 });
  });
});

describe("paddedBytesPerRow", () => {
  it("rounds 4 bytes per pixel up to a multiple of 256", () => {
    expect(paddedBytesPerRow(1)).toBe(256);
    expect(paddedBytesPerRow(64)).toBe(256);
    expect(paddedBytesPerRow(65)).toBe(512);
    expect(paddedBytesPerRow(50)).toBe(256);
    expect(paddedBytesPerRow(128)).toBe(512);
  });
});

describe("formats", () => {
  it("uses the fixed offscreen and depth formats of the spec", () => {
    expect(OFFSCREEN_FORMAT).toBe("rgba8unorm-srgb");
    expect(DEPTH_FORMAT).toBe("depth24plus");
  });
});
