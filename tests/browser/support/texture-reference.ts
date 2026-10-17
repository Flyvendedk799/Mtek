// A CPU reference of texture sampling for the M4-04 browser spec (spec/materials.md section 5): the sRGB
// transfer function written out from its definition, and a sampler for small RGBA8 textures with nearest or
// linear filtering and clamped or repeated coordinates (the WebGPU rules, one mip level). It shares no code with the
// runtime or the compiler, so the expected values of the spec are derived independently of what they test.

export type Texel = readonly [number, number, number, number];
export type Rgb = readonly [number, number, number];

export interface ReferenceTexture {
  readonly width: number;
  readonly height: number;
  /** Row-major, top row first; 8-bit RGBA. */
  readonly texels: readonly Texel[];
  /** `srgb`: the bytes are sRGB-encoded and sampled as linear values. `linear`: sampled as `byte / 255`. */
  readonly colorSpace: "srgb" | "linear";
}

export type Filter = "nearest" | "linear";
export type Address = "clamp" | "repeat";

/** The sRGB EOTF of one 8-bit channel (IEC 61966-2-1), in binary64. */
export function srgbByteToLinear(byte: number): number {
  const s = byte / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** The inverse transfer function: a linear value in [0, 1] to the nearest 8-bit sRGB code. */
export function linearToSrgbByte(linear: number): number {
  const l = Math.min(1, Math.max(0, linear));
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** The value of one channel byte as the texture format decodes it. */
function decode(byte: number, colorSpace: "srgb" | "linear"): number {
  return colorSpace === "srgb" ? srgbByteToLinear(byte) : byte / 255;
}

function addressIndex(index: number, size: number, address: Address): number {
  if (address === "clamp") return Math.min(size - 1, Math.max(0, index));
  return ((index % size) + size) % size;
}

function texelAt(texture: ReferenceTexture, x: number, y: number, address: Address): Rgb {
  const texel = texture.texels[addressIndex(y, texture.height, address) * texture.width + addressIndex(x, texture.width, address)];
  if (texel === undefined) throw new Error("texture has fewer texels than width x height");
  return [decode(texel[0], texture.colorSpace), decode(texel[1], texture.colorSpace), decode(texel[2], texture.colorSpace)];
}

/** The linear RGB the sampler returns for the coordinate `(u, v)` (`(0, 0)` is the top-left corner). */
export function sampleReference(texture: ReferenceTexture, filter: Filter, address: Address, u: number, v: number): Rgb {
  if (filter === "nearest") return texelAt(texture, Math.floor(u * texture.width), Math.floor(v * texture.height), address);
  const x = u * texture.width - 0.5;
  const y = v * texture.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const top = mix(texelAt(texture, x0, y0, address), texelAt(texture, x0 + 1, y0, address), fx);
  const bottom = mix(texelAt(texture, x0, y0 + 1, address), texelAt(texture, x0 + 1, y0 + 1, address), fx);
  return mix(top, bottom, fy);
}

/** The 8-bit sRGB pixel an `rgba8unorm-srgb` target holds for the linear colour `rgb`. */
export function encodePixel(rgb: Rgb): [number, number, number] {
  return [linearToSrgbByte(rgb[0]), linearToSrgbByte(rgb[1]), linearToSrgbByte(rgb[2])];
}

/** The generated texture of the spec: four texels whose sRGB and linear readings differ a lot. */
export const GENERATED_TEXTURE_TEXELS: readonly Texel[] = [
  [188, 64, 32, 255], // top left, uv (0.25, 0.25)
  [255, 128, 0, 255], // top right, uv (0.75, 0.25)
  [16, 200, 100, 255], // bottom left, uv (0.25, 0.75)
  [96, 96, 220, 255], // bottom right, uv (0.75, 0.75)
];

/** The bytes of `texels` as `test.textures` takes them. */
export function texelBytes(texels: readonly Texel[]): Uint8Array {
  return Uint8Array.from(texels.flat());
}

/**
 * Linear values of the channel bytes the generated texture uses, written out once by hand (evaluated
 * to 9 digits in binary64 and checked against the formula by a unit test), so the expected values do not
 * rest on this file's own functions alone.
 */
export const HAND_DECODED: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [16, 0.0051815167],
  [32, 0.0144438436],
  [64, 0.0512694584],
  [96, 0.116970668],
  [100, 0.12743768],
  [128, 0.2158605],
  [188, 0.502886458],
  [200, 0.57758044],
  [220, 0.715693501],
  [255, 1],
];
