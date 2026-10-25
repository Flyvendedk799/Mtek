/**
 * Built-in textures and samplers (`spec/materials.md` section 5, `spec/gpu-layout.md` section 6,
 * decision 0054): the GPU objects behind `texture.white()`, `texture.black()` and the four
 * `sampler.*` presets of a program's material instances.
 *
 *  - A built-in texture is 1x1, opaque, `rgba8unorm-srgb` (colour textures are created with an `-srgb`
 *    format, so `sample` returns linear values), one mip level, `TEXTURE_BINDING | COPY_DST`, filled with
 *    one `writeTexture`. `texture.white()` is `(255, 255, 255, 255)`, `texture.black()` `(0, 0, 0, 255)`.
 *  - A sampler preset is a filtering sampler: `linear_*` use linear magnification and minification,
 *    `nearest_*` nearest; `*_repeat` wrap and `*_clamp` clamp to the edge in both directions. There is a
 *    single mip level in v0.1, so the mip filter is never observable.
 *  - Every object is created at most once per scene, on first use, through the resource registry
 *    (`texturesAllocated`, `liveTextures`, `liveSamplers`), shared by every instance that names it and
 *    released with the scene.
 *
 * A test program may replace the pixels of a built-in texture (`options.test.textures`, `spec/runtime-abi.md`
 * section 10.2): the same creation path with other dimensions, data and colour space, so tests can sample
 * a generated texture without an asset. Textures of image files (`asset.texture`, a GLB's base colour images)
 * are `AssetTextures`, below.
 */
import type { MtekBuiltinResourceName, MtekImageAsset } from "../abi/manifest-types.js";
import type { DecodedImages } from "../assets/loader.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { MtekTestTexture } from "../host/types.js";
import {mipLevelCount,type MipmapGenerator} from "./mipmaps.js";

// WebGPU texture usage flags (constants of the standard).
const USAGE_COPY_DST = 0x02;
const USAGE_TEXTURE_BINDING = 0x04;
const USAGE_RENDER_ATTACHMENT = 0x10;

/** The format of a colour texture (`srgb`, the default) and of a data texture (`linear`). */
const TEXTURE_FORMATS = { srgb: "rgba8unorm-srgb", linear: "rgba8unorm" } as const satisfies Record<"srgb" | "linear", GPUTextureFormat>;

/** The descriptors of the sampler presets, by the manifest's name. */
export const SAMPLER_PRESETS: Readonly<Record<string, GPUSamplerDescriptor>> = {
  "sampler.linear_repeat": { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" },
  "sampler.linear_clamp": { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
  "sampler.nearest_repeat": { magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest", addressModeU: "repeat", addressModeV: "repeat" },
  "sampler.nearest_clamp": { magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
};

/** The pixels of the built-in textures: one opaque RGBA8 texel. */
const BUILTIN_TEXELS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  "texture.white": [255, 255, 255, 255],
  "texture.black": [0, 0, 0, 255],
};

export type TextureOverrides = Readonly<Partial<Record<"texture.white" | "texture.black", MtekTestTexture>>>;

/** A texture's validated source: its size, bytes and colour space. */
export interface TexturePixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly colorSpace: "srgb" | "linear";
}

function checkedPixels(name: string, texture: MtekTestTexture): TexturePixels {
  const { width, height, data, colorSpace = "srgb" } = texture;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`test.textures['${name}']: width and height must be positive integers, got ${String(width)} x ${String(height)}`);
  }
  if (colorSpace !== "srgb" && colorSpace !== "linear") {
    throw new TypeError(`test.textures['${name}']: colorSpace must be "srgb" or "linear", got ${String(colorSpace)}`);
  }
  if (!(data instanceof Uint8Array) || data.byteLength !== width * height * 4) {
    throw new RangeError(`test.textures['${name}']: data must be a Uint8Array of width x height x 4 = ${String(width * height * 4)} bytes`);
  }
  return { width, height, data, colorSpace };
}

/** Validates `options.test.textures`: built-in texture names, positive sizes and byte counts that match. Throws on a mistake. */
export function checkTestTextures(overrides: TextureOverrides): ReadonlyMap<string, TexturePixels> {
  const checked = new Map<string, TexturePixels>();
  for (const [name, texture] of Object.entries(overrides)) {
    if (!(name in BUILTIN_TEXELS)) throw new RangeError(`test.textures: '${name}' is not a built-in texture`);
    checked.set(name, checkedPixels(name, texture));
  }
  return checked;
}

/**
 * The textures made from the image files of the `assets` table (`spec/assets.md` section 5, decision 0060): one
 * `rgba8unorm-srgb` (`srgb`) or `rgba8unorm` (`linear`) texture per file, created on first use through the
 * registry and filled by `copyExternalImageToTexture` from the decoded bitmap. `copyExternalImageToTexture`
 * requires `COPY_DST | RENDER_ATTACHMENT` besides `TEXTURE_BINDING`. One mip level in v0.1. The bitmaps belong to
 * the caller (`startScene` closes none; mount, recovery and reload close theirs after the scene started).
 */
export class AssetTextures {
  private readonly textures = new Map<string, { readonly texture: GPUTexture; readonly view: GPUTextureView }>();

  constructor(
    private readonly registry: ResourceRegistry,
    private readonly queue: GPUQueue,
    private readonly images: DecodedImages,
    private readonly mipmaps?:MipmapGenerator,
  ) {}

  /** The view of the texture of image file `asset`, created and filled on first use. */
  textureView(asset: MtekImageAsset): GPUTextureView {
    let found = this.textures.get(asset.url);
    if (found === undefined) {
      const bitmap = this.images.get(asset.url);
      if (bitmap === undefined) throw new Error(`internal error: the image '${asset.url}' was not decoded`);
      const texture = this.registry.createTexture({
        label: `mtek asset ${asset.url}`,
        size: [bitmap.width, bitmap.height],
        format: TEXTURE_FORMATS[asset.colorSpace],
        mipLevelCount:this.mipmaps===undefined?1:mipLevelCount(bitmap.width,bitmap.height),
        usage: USAGE_TEXTURE_BINDING | USAGE_COPY_DST | USAGE_RENDER_ATTACHMENT,
      });
      this.registry.copyExternalImage(this.queue, bitmap, texture);
      this.mipmaps?.generate(texture,TEXTURE_FORMATS[asset.colorSpace],bitmap.width,bitmap.height);
      found = { texture, view: texture.createView() };
      this.textures.set(asset.url, found);
    }
    return found.view;
  }

  /** Releases every texture this scene created. */
  dispose(): void {
    for (const { texture } of this.textures.values()) this.registry.release(texture);
    this.textures.clear();
  }
}

/** The built-in textures and samplers of one scene. */
export class BuiltinResources {
  private readonly textures = new Map<string, { readonly texture: GPUTexture; readonly view: GPUTextureView }>();
  private readonly samplers = new Map<string, GPUSampler>();
  private readonly overrides: ReadonlyMap<string, TexturePixels>;

  constructor(
    private readonly registry: ResourceRegistry,
    private readonly queue: GPUQueue,
    overrides: TextureOverrides = {},
  ) {
    this.overrides = checkTestTextures(overrides);
  }

  /** The view of the built-in texture `name` (`texture.white`, `texture.black`), created on first use. */
  textureView(name: MtekBuiltinResourceName): GPUTextureView {
    let found = this.textures.get(name);
    if (found === undefined) {
      const texel = BUILTIN_TEXELS[name];
      if (texel === undefined) throw new RangeError(`'${name}' is not a built-in texture`);
      const pixels = this.overrides.get(name) ?? { width: 1, height: 1, data: Uint8Array.from(texel), colorSpace: "srgb" as const };
      const texture = this.registry.createTexture({
        label: `mtek ${name}`,
        size: [pixels.width, pixels.height],
        format: TEXTURE_FORMATS[pixels.colorSpace],
        usage: USAGE_TEXTURE_BINDING | USAGE_COPY_DST,
      });
      this.registry.writeTexture(this.queue, texture, pixels.data, pixels.width * 4, pixels.width, pixels.height);
      found = { texture, view: texture.createView() };
      this.textures.set(name, found);
    }
    return found.view;
  }

  /** The built-in sampler `name` (`sampler.linear_repeat`, ...), created on first use. */
  sampler(name: MtekBuiltinResourceName): GPUSampler {
    let found = this.samplers.get(name);
    if (found === undefined) {
      const preset = SAMPLER_PRESETS[name];
      if (preset === undefined) throw new RangeError(`'${name}' is not a built-in sampler`);
      found = this.registry.createSampler({ label: `mtek ${name}`, ...preset });
      this.samplers.set(name, found);
    }
    return found;
  }

  /** Releases every texture and sampler this scene created. */
  dispose(): void {
    for (const { texture } of this.textures.values()) this.registry.release(texture);
    for (const sampler of this.samplers.values()) this.registry.release(sampler);
    this.textures.clear();
    this.samplers.clear();
  }
}
