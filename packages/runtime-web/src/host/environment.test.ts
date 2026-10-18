// The browser-backed seams of the asset loader (spec/assets.md section 5): SHA-256 through `crypto.subtle` (absent in an
// insecure context) and image decoding through `createImageBitmap` with every implicit conversion switched off.
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDecodeImage, browserSha256, defaultEnvironment } from "./environment.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** FIPS 180-4: SHA-256("abc"). */
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
/** SHA-256 of the empty message. */
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("browserSha256", () => {
  it("is the lowercase hex SHA-256 of the bytes", async () => {
    const sha256 = browserSha256();
    expect(sha256).toBeDefined();
    expect(await sha256?.(new TextEncoder().encode("abc"))).toBe(SHA256_ABC);
    expect(await sha256?.(new Uint8Array(0))).toBe(SHA256_EMPTY);
  });

  it("hashes only the bytes of a view into a larger buffer", async () => {
    const backing = new TextEncoder().encode("xxabcyy");
    expect(await browserSha256()?.(backing.subarray(2, 5))).toBe(SHA256_ABC);
  });

  it("does not exist without crypto.subtle, as in an insecure context", () => {
    vi.stubGlobal("crypto", {});
    expect(browserSha256()).toBeUndefined();
    vi.stubGlobal("crypto", undefined);
    expect(browserSha256()).toBeUndefined();
    expect(defaultEnvironment().sha256).toBeUndefined();
  });
});

describe("browserDecodeImage", () => {
  it("decodes the raw bytes with no colour space conversion and no premultiplication", async () => {
    const calls: { blob: Blob; options: unknown }[] = [];
    const bitmap = { width: 2, height: 1, close: () => undefined };
    vi.stubGlobal("createImageBitmap", (blob: Blob, options: unknown) => {
      calls.push({ blob, options });
      return Promise.resolve(bitmap);
    });
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(await browserDecodeImage(bytes.subarray(1, 5))).toBe(bitmap);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({ colorSpaceConversion: "none", premultiplyAlpha: "none" });
    // The blob holds exactly the bytes of the view, and carries no MIME type (the browser sniffs the format).
    const blob = calls[0]?.blob;
    if (blob === undefined) throw new Error("createImageBitmap was not called");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x50, 0x4e, 0x47, 1]);
    expect(blob.type).toBe("");
  });

  it("rejects when the browser cannot decode", async () => {
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new DOMException("The source image could not be decoded.", "InvalidStateError")));
    await expect(browserDecodeImage(new Uint8Array(4))).rejects.toThrow(/could not be decoded/);
  });
});

describe("defaultEnvironment", () => {
  it("wires the asset seams", async () => {
    const environment = defaultEnvironment();
    expect(typeof environment.fetchBytes).toBe("function");
    expect(typeof environment.decodeImage).toBe("function");
    expect(await environment.sha256?.(new TextEncoder().encode("abc"))).toBe(SHA256_ABC);
  });
});
