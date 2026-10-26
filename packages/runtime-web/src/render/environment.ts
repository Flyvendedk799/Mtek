import type { LinearEnvironment, MtekRenderingOptions, LightingQuality, EnvironmentLightingOptions } from "./options.js";

export const ENVIRONMENT_QUALITY = {
  low: { size: 64, samples: 32 }, medium: { size: 128, samples: 64 }, high: { size: 256, samples: 128 },
} as const;
export const SHADOW_QUALITY = {
  low: { size: 512, radius: 0 }, medium: { size: 1024, radius: 1 }, high: { size: 2048, radius: 2 },
} as const;

function quality(value: LightingQuality | undefined): void {
  if (value !== undefined && !Object.hasOwn(ENVIRONMENT_QUALITY, value)) throw new RangeError("Lighting quality must be low, medium or high");
}
function finite(value: number | undefined, name: string, minimum = 0): void {
  if (value !== undefined && (!Number.isFinite(Math.fround(value)) || value < minimum)) throw new RangeError(`${name} must fit a finite f32 and be at least ${String(minimum)}`);
}

/** Validate and copy once: mutation by a host must not change recovery or hot reload output. */
export function snapshotRendering(options: MtekRenderingOptions | undefined): MtekRenderingOptions | undefined {
  if (options === undefined) return undefined;
  const { environment: env, shadows: shadow } = options;
  let environment: EnvironmentLightingOptions | undefined;
  if (shadow !== undefined) {
    quality(shadow.quality);
    if (typeof shadow.light !== "string" || shadow.light.length === 0) throw new RangeError("A shadow light name is required");
    for (const name of ["size", "distance", "near", "far"] as const) finite(shadow[name], `shadows.${name}`, 1e-6);
    finite(shadow.bias, "shadows.bias"); finite(shadow.normalBias, "shadows.normalBias");
    if ((shadow.far ?? 40) <= (shadow.near ?? 0.1)) throw new RangeError("shadows.far must exceed near");
    if (shadow.center !== undefined && (shadow.center.length !== 3 || shadow.center.some(x => !Number.isFinite(Math.fround(x))))) throw new RangeError("shadows.center must have three finite f32 coordinates");
  }
  if (env !== undefined) {
    quality(env.quality); finite(env.intensity, "environment.intensity");
    if (env.rotation !== undefined && !Number.isFinite(env.rotation)) throw new RangeError("environment.rotation must be finite");
    if (!Number.isInteger(env.width) || !Number.isInteger(env.height) || env.width < 1 || env.height < 1 || env.width > 4096 || env.height > 2048) throw new RangeError("Environment dimensions must be positive integers, at most 4096 x 2048");
    if (!(env.data instanceof Float32Array) || env.data.length !== env.width * env.height * 4) throw new RangeError("Environment data must be width * height * 4 linear RGBA floats");
    const data = env.data.slice();
    for (let i = 0; i < data.length; i++) {
      const value = data[i]!;
      if (!Number.isFinite(value) || value < 0 || value > 65504) throw new RangeError("Environment components must be finite, nonnegative and at most 65504 (RGBA16F range)");
    }
    environment = { ...env, data };
  }
  return { ...options,
    ...(shadow === undefined ? {} : { shadows: { ...shadow, ...(shadow.center === undefined ? {} : { center: [...shadow.center] as [number, number, number] }) } }),
    ...(environment === undefined ? {} : { environment }),
  };
}

/** Nine real SH basis values in the order used by the lighting uniform. */
export function shBasis(x: number, y: number, z: number): number[] {
  return [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y,
    1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
}

/** Wrapped longitude, clamped latitude, bilinear linear-light sampling (texel centres). */
export function samplePanorama(env: LinearEnvironment, u: number, v: number): readonly [number, number, number] {
  const fx = u * env.width - 0.5, fy = v * env.height - 0.5;
  const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
  const texel = (a: number, b: number, c: number): number => env.data[(Math.max(0, Math.min(env.height - 1, b)) * env.width + (a % env.width + env.width) % env.width) * 4 + c]!;
  return [0, 1, 2].map(c => (texel(x, y, c) * (1 - tx) + texel(x + 1, y, c) * tx) * (1 - ty)
    + (texel(x, y + 1, c) * (1 - tx) + texel(x + 1, y + 1, c) * tx) * ty) as unknown as readonly [number, number, number];
}

/** Irradiance / pi SH coefficients. Large panoramas are energy-conservatively reduced first. */
export function diffuseEnvironment(env: LinearEnvironment): Float32Array {
  const out = new Float64Array(36), width = 128, height = 64;
  // Preserve small bright HDR features instead of missing them between quadrature samples.
  // The reduction visits each input texel once; only the small grid evaluates all nine bases.
  let energy: Float64Array | undefined;
  if (env.width > width || env.height > height) {
    energy = new Float64Array(width * height * 3);
    const columns: Array<Array<readonly [number, number]>> = [];
    for (let x = 0; x < env.width; x++) {
      const start = x / env.width, end = (x + 1) / env.width;
      const overlaps: Array<readonly [number, number]> = [];
      for (let column = Math.floor(start * width); column < Math.min(width, Math.ceil(end * width)); column++) {
        overlaps.push([column, (Math.min(end, (column + 1) / width) - Math.max(start, column / width)) * 2 * Math.PI]);
      }
      columns.push(overlaps);
    }
    for (let y = 0; y < env.height; y++) {
      const start = y / env.height, end = (y + 1) / env.height;
      for (let row = Math.floor(start * height); row < Math.min(height, Math.ceil(end * height)); row++) {
        const latitude = Math.cos(Math.max(start, row / height) * Math.PI) - Math.cos(Math.min(end, (row + 1) / height) * Math.PI);
        for (let x = 0; x < env.width; x++) for (const [column, longitude] of columns[x]!) {
          const from = (y * env.width + x) * 4, to = (row * width + column) * 3, weight = latitude * longitude;
          for (let c = 0; c < 3; c++) energy[to + c] = energy[to + c]! + env.data[from + c]! * weight;
        }
      }
    }
  }
  let weightSum = 0;
  for (let j = 0; j < height; j++) {
    const theta = (j + 0.5) * Math.PI / height, sin = Math.sin(theta), y = Math.cos(theta);
    // Exact solid angle of a latitude band, shared equally by its longitude samples.
    const weight = (Math.cos(j * Math.PI / height) - Math.cos((j + 1) * Math.PI / height)) * 2 * Math.PI / width;
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
      const basis = shBasis(sin * Math.cos(phi), y, sin * Math.sin(phi));
      const rgb = energy === undefined ? samplePanorama(env, (i + 0.5) / width, (j + 0.5) / height)
        : [energy[(j * width + i) * 3]! / weight, energy[(j * width + i) * 3 + 1]! / weight, energy[(j * width + i) * 3 + 2]! / weight];
      for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) out[k * 4 + c] = out[k * 4 + c]! + rgb[c]! * basis[k]! * weight;
      weightSum += weight;
    }
  }
  for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) out[k * 4 + c] = out[k * 4 + c]! * (4 * Math.PI / weightSum) * (k === 0 ? 1 : k < 4 ? 2 / 3 : 1 / 4);
  return new Float32Array(out);
}

/** Decode Radiance RGBE panoramas (flat or modern scanline RLE), without a network dependency. */
export function decodeRadiance(bytes: Uint8Array): LinearEnvironment {
  let offset = 0;
  const line = (): string => {
    const start = offset;
    while (offset < bytes.length && bytes[offset] !== 10) offset++;
    if (offset >= bytes.length) throw new RangeError("Truncated Radiance header");
    return new TextDecoder().decode(bytes.subarray(start, offset++)).trim();
  };
  if (!["#?RADIANCE", "#?RGBE"].includes(line())) throw new RangeError("Not a Radiance RGBE file");
  let format = false, header = line();
  while (header !== "") { if (header === "FORMAT=32-bit_rle_rgbe") format = true; header = line(); }
  if (!format) throw new RangeError("Radiance requires FORMAT=32-bit_rle_rgbe");
  const resolution = /^([+-])Y (\d+) ([+-])X (\d+)$/.exec(line());
  if (resolution === null) throw new RangeError("Radiance requires Y-major panorama orientation");
  const width = Number(resolution[4]), height = Number(resolution[2]);
  if (width < 1 || height < 1 || width > 4096 || height > 2048) throw new RangeError("Radiance dimensions exceed 4096 x 2048");
  const data = new Float32Array(width * height * 4), scan = new Uint8Array(width * 4);
  const take = (): number => { if (offset >= bytes.length) throw new RangeError("Truncated Radiance pixel data"); return bytes[offset++]!; };
  for (let row = 0; row < height; row++) {
    const first = [take(), take(), take(), take()];
    if (width >= 8 && width <= 32767 && first[0] === 2 && first[1] === 2 && (first[2]! & 128) === 0) {
      if (first[2]! * 256 + first[3]! !== width) throw new RangeError("Radiance scanline width mismatch");
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          const code = take(), count = code > 128 ? code - 128 : code;
          if (count === 0 || x + count > width) throw new RangeError("Invalid Radiance RLE run");
          const value = code > 128 ? take() : 0;
          for (let i = 0; i < count; i++) scan[(x++ * 4) + c] = code > 128 ? value : take();
        }
      }
    } else {
      scan.set(first);
      for (let i = 4; i < scan.length; i++) scan[i] = take();
      for (let x = 0; x < width; x++) if (scan[x * 4] === 1 && scan[x * 4 + 1] === 1 && scan[x * 4 + 2] === 1) throw new RangeError("Legacy Radiance RLE is unsupported; re-encode as scanline RLE");
    }
    const y = resolution[1] === "-" ? row : height - 1 - row;
    for (let x = 0; x < width; x++) {
      const target = (y * width + (resolution[3] === "+" ? x : width - 1 - x)) * 4;
      const exponent = scan[x * 4 + 3]!, scale = exponent === 0 ? 0 : 2 ** (exponent - 136);
      for (let c = 0; c < 3; c++) data[target + c] = scan[x * 4 + c]! * scale;
      data[target + 3] = 1;
    }
  }
  return { width, height, data };
}
