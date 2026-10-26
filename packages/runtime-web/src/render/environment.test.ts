import { describe, expect, it } from "vitest";
import { decodeRadiance, diffuseEnvironment, samplePanorama, shBasis, snapshotRendering } from "./environment.js";

describe("linear environment sources", () => {
  it("preserves constant irradiance in every direction", () => {
    const env = { width: 2, height: 1, data: new Float32Array([2, 0.25, 0.5, 1, 2, 0.25, 0.5, 1]) };
    const sh = diffuseEnvironment(env);
    for (const direction of [[1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [-1, 0, 0]]) {
      const basis = shBasis(direction[0]!, direction[1]!, direction[2]!);
      for (let c = 0; c < 3; c++) {
        const irradiance = basis.reduce((sum, value, k) => sum + value * sh[k * 4 + c]!, 0);
        expect(irradiance).toBeCloseTo(env.data[c]!, 3);
      }
    }
  });
  it("preserves the energy of a tiny bright feature between the quadrature samples", () => {
    const width = 512, height = 256, data = new Float32Array(width * height * 4), x = 16, y = 80;
    data[(y * width + x) * 4] = 128;
    const sh = diffuseEnvironment({ width, height, data });
    const solidAngle = (Math.cos(y * Math.PI / height) - Math.cos((y + 1) * Math.PI / height)) * 2 * Math.PI / width;
    expect(sh[0]).toBeCloseTo(128 * solidAngle * 0.282095, 7);
    expect(sh[1]).toBe(0); expect(sh[2]).toBe(0);
  });
  it("conserves constant illumination when only one panorama axis needs reducing", () => {
    for (const [width, height] of [[512, 1], [1, 128]]) {
      const data = new Float32Array(width! * height! * 4);
      for (let i = 0; i < data.length; i += 4) data.set([1, 1, 1, 1], i);
      const sh = diffuseEnvironment({ width: width!, height: height!, data });
      for (const direction of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1]]) {
        const basis = shBasis(direction[0]!, direction[1]!, direction[2]!);
        expect(basis.reduce((sum, value, i) => sum + value * sh[i * 4]!, 0)).toBeCloseTo(1, 3);
      }
    }
  });
  it("wraps the panorama seam, clamps the poles and interpolates linear components", () => {
    const env = { width: 2, height: 1, data: new Float32Array([2, 0, 0, 1, 0, 0, 2, 1]) };
    expect(samplePanorama(env, 0, -1)).toEqual([1, 0, 1]);
    expect(samplePanorama(env, 1, 2)).toEqual([1, 0, 1]);
    expect(samplePanorama(env, 0.25, 0.5)).toEqual([2, 0, 0]);
  });
  it("snapshots host pixels and shadow coordinates for deterministic recovery", () => {
    const data = new Float32Array([1, 2, 3, 1]), center = [1, 2, 3] as [number, number, number];
    const out = snapshotRendering({ environment: { width: 1, height: 1, data }, shadows: { light: "Sun", center } })!;
    data.fill(0); center[0] = 9;
    expect(Array.from(out.environment!.data)).toEqual([1, 2, 3, 1]); expect(out.shadows!.center).toEqual([1, 2, 3]);
  });
  it("rejects malformed dimensions, values, quality and shadow ranges before allocation", () => {
    for (const [width, height, data] of [[0, 1, new Float32Array(0)], [1, 1, new Float32Array([NaN, 0, 0, 1])],
      [1, 1, new Float32Array([Infinity, 0, 0, 1])], [1, 1, new Float32Array([-1, 0, 0, 1])],
      [1, 1, new Float32Array([65505, 0, 0, 1])], [1, 1, new Float32Array(3)]] as const) {
      expect(() => snapshotRendering({ environment: { width, height, data } })).toThrow(RangeError);
    }
    expect(() => snapshotRendering({ shadows: { light: "Sun", near: 2, far: 1 } })).toThrow(/far/);
    expect(() => snapshotRendering({ shadows: { light: "Sun", size: 0 } })).toThrow(/size/);
    expect(() => snapshotRendering({ shadows: { light: "Sun", center: [0, NaN, 0] } })).toThrow(/center/);
    expect(() => snapshotRendering({ environment: { width: 1, height: 1, data: new Float32Array(4), quality: "ultra" as never } })).toThrow(/quality/);
  });
});

describe("Radiance RGBE import", () => {
  const header = (resolution: string) => new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n${resolution}\n`);
  it("decodes flat HDR values and axis orientation", () => {
    const bytes = new Uint8Array([...header("+Y 2 -X 1"), 128, 64, 32, 130, 64, 128, 32, 129]);
    expect(Array.from(decodeRadiance(bytes).data)).toEqual([0.5, 1, 0.25, 1, 2, 1, 0.5, 1]);
  });
  it("decodes modern scanline RLE, both literal and repeated channels", () => {
    const bytes = new Uint8Array([...header("-Y 1 +X 8"), 2, 2, 0, 8, 136, 128, 8, 0, 16, 32, 48, 64, 80, 96, 112, 136, 64, 136, 129]);
    const env = decodeRadiance(bytes);
    expect(env.width).toBe(8); expect(env.height).toBe(1);
    expect(Array.from(env.data.slice(0, 8))).toEqual([1, 0, 0.5, 1, 1, 0.125, 0.5, 1]);
  });
  it("rejects truncated runs, invalid lengths and allocation bombs", () => {
    for (const tail of [[2, 2, 0, 8, 0], [2, 2, 0, 8, 137, 128], [2, 2, 0, 7], [2, 2, 0, 8, 136]]) {
      expect(() => decodeRadiance(new Uint8Array([...header("-Y 1 +X 8"), ...tail]))).toThrow(RangeError);
    }
    expect(() => decodeRadiance(header("-Y 2048 +X 65536"))).toThrow(/dimensions/);
    expect(() => decodeRadiance(new Uint8Array([1, 2, 3]))).toThrow(RangeError);
  });
});
