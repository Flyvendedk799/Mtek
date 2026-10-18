// The texture helper without a GPU or a browser: how the options of `loadTexture` / `configureTexture` map to three.js's texture
// fields (the counterpart of Mtek's `asset.texture` / `asset.linear_texture` and the sampler presets), and how `loadTexture` fetches
// and decodes (the browser's `fetch` and `createImageBitmap` are replaced by stubs here; the real ones run in the task's Playwright spec).
import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearSRGBColorSpace,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureTexture, loadTexture } from "../src/texture.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("configureTexture", () => {
  it("maps the Mtek presets nearest_clamp, nearest_repeat, linear_clamp and linear_repeat", () => {
    const cases = [
      { filter: "nearest", wrap: "clamp", expectedFilter: NearestFilter, expectedWrap: ClampToEdgeWrapping },
      { filter: "nearest", wrap: "repeat", expectedFilter: NearestFilter, expectedWrap: RepeatWrapping },
      { filter: "linear", wrap: "clamp", expectedFilter: LinearFilter, expectedWrap: ClampToEdgeWrapping },
      { filter: "linear", wrap: "repeat", expectedFilter: LinearFilter, expectedWrap: RepeatWrapping },
    ] as const;
    for (const { filter, wrap, expectedFilter, expectedWrap } of cases) {
      const texture = configureTexture(new Texture(), { filter, wrap });
      // Magnification and minification use the same filter and there are no mip-maps (Mtek v0.1 has one level).
      expect([texture.magFilter, texture.minFilter, texture.generateMipmaps]).toEqual([expectedFilter, expectedFilter, false]);
      expect([texture.wrapS, texture.wrapT]).toEqual([expectedWrap, expectedWrap]);
    }
  });

  it("is sRGB by default (asset.texture) and linear on request (asset.linear_texture)", () => {
    expect(configureTexture(new Texture(), { filter: "nearest", wrap: "clamp" }).colorSpace).toBe(SRGBColorSpace);
    expect(configureTexture(new Texture(), { colorSpace: "srgb", filter: "nearest", wrap: "clamp" }).colorSpace).toBe(SRGBColorSpace);
    expect(configureTexture(new Texture(), { colorSpace: "linear", filter: "nearest", wrap: "clamp" }).colorSpace).toBe(LinearSRGBColorSpace);
  });

  it("returns the same texture and marks it for upload", () => {
    const texture = new Texture();
    const version = texture.version;
    expect(configureTexture(texture, { filter: "linear", wrap: "repeat" })).toBe(texture);
    expect(texture.version).toBe(version + 1);
  });
});

describe("loadTexture", () => {
  const BITMAP = { width: 4, height: 4 } as unknown as ImageBitmap;

  it("fetches the URL, decodes without colour conversion and returns a configured texture", async () => {
    const blob = new Blob(["png bytes"]);
    const fetchStub = vi.fn(() => Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(blob) }));
    const decodeStub = vi.fn(() => Promise.resolve(BITMAP));
    vi.stubGlobal("fetch", fetchStub);
    vi.stubGlobal("createImageBitmap", decodeStub);

    const texture = await loadTexture("assets/swatch.png", { filter: "nearest", wrap: "repeat" });
    expect(fetchStub).toHaveBeenCalledWith("assets/swatch.png");
    // As the runtime decodes an image (spec/assets.md section 5): no colour-space conversion, no premultiplication; the bitmap
    // is flipped so that the picture is upright on three.js's own geometries (v grows upwards), so the texture must not flip it again.
    expect(decodeStub).toHaveBeenCalledWith(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "flipY" });
    expect(texture.image).toBe(BITMAP);
    expect(texture.flipY).toBe(false);
    expect([texture.colorSpace, texture.magFilter, texture.wrapS]).toEqual([SRGBColorSpace, NearestFilter, RepeatWrapping]);
  });

  it("rejects with the URL when the file cannot be fetched", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404, blob: () => Promise.resolve(new Blob()) }));
    await expect(loadTexture("assets/missing.png", { filter: "linear", wrap: "clamp" })).rejects.toThrow("cannot load the image 'assets/missing.png': HTTP 404");
  });

  it("rejects with the URL and the cause when the bytes are not an image", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["not an image"])) }));
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("The source image could not be decoded.")));
    await expect(loadTexture("assets/broken.png", { filter: "linear", wrap: "clamp" })).rejects.toThrow(
      "cannot decode the image 'assets/broken.png': The source image could not be decoded.",
    );
  });
});
