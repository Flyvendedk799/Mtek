// The texture helper of the baseline support module: what Mtek's `asset.texture(path)` / `asset.linear_texture(path)` together
// with a `sampler.<filter>_<wrap>()` preset give a material (spec/assets.md section 2, spec/materials.md section 5), so that
// the three.js baseline is not charged for loading and configuring an image by hand (spec/ai-and-benchmarks.md section 6.3).
// Each function is a thin wrapper of the plain three.js API; nothing here changes what three.js does with the result: the
// texture is an ordinary `Texture` for the `map` of any material.
//
// How a task project delivers an image: the file `assets/<name>` of the baseline project is copied beside the built page
// (`test/build.ts`), so `loadTexture("assets/swatch.png", ...)` finds it. `startTask` waits for the promise its `build`
// callback returns, so the application may load images before it creates the scene.
import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearSRGBColorSpace,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three/webgpu";

/** `srgb` is Mtek's `asset.texture` (a colour picture: sampled as linear values), `linear` is `asset.linear_texture` (data, sampled as stored). */
export type TextureColorSpace = "srgb" | "linear";
/** Mtek's `nearest_*` and `linear_*` sampler presets: the texel containing the point, or bilinear interpolation of the four nearest texels. */
export type TextureFilter = "nearest" | "linear";
/** Mtek's `*_repeat` and `*_clamp` presets: coordinates outside 0 to 1 wrap around, or hold the edge texel. */
export type TextureWrap = "repeat" | "clamp";

export interface TextureOptions {
  /** Default `srgb`, like `asset.texture`. */
  readonly colorSpace?: TextureColorSpace;
  readonly filter: TextureFilter;
  readonly wrap: TextureWrap;
}

/**
 * Sets the colour space, the filtering (both magnification and minification, with no mip-maps, as Mtek v0.1 has none) and the
 * wrapping of both axes of `texture`, and marks it for upload. Returns the same texture.
 */
export function configureTexture<T extends Texture>(texture: T, options: TextureOptions): T {
  texture.colorSpace = (options.colorSpace ?? "srgb") === "srgb" ? SRGBColorSpace : LinearSRGBColorSpace;
  const filter = options.filter === "nearest" ? NearestFilter : LinearFilter;
  texture.magFilter = filter;
  texture.minFilter = filter;
  texture.generateMipmaps = false;
  const wrap = options.wrap === "repeat" ? RepeatWrapping : ClampToEdgeWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Fetches and decodes the image at `url` (relative to the page) as the runtime does, without any colour conversion
 * (`createImageBitmap` with `colorSpaceConversion: "none"` and `premultiplyAlpha: "none"`, spec/assets.md section 5), and returns it
 * as a texture configured by `options`. The picture is upright on three.js's own geometries (`PlaneGeometry`, `BoxGeometry`,
 * `SphereGeometry`), like one made by `TextureLoader`. Rejects with the URL in the message when the file cannot be fetched or decoded.
 * One call per sampler configuration: the image is decoded again each time.
 */
export async function loadTexture(url: string, options: TextureOptions): Promise<Texture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cannot load the image '${url}': HTTP ${String(response.status)}`);
  const blob = await response.blob();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "flipY" });
  } catch (error) {
    throw new Error(`cannot decode the image '${url}': ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const texture = new Texture(bitmap);
  // The bitmap is already flipped (`imageOrientation: "flipY"`), which is the orientation three.js's geometries expect (v grows upwards).
  texture.flipY = false;
  return configureTexture(texture, options);
}
