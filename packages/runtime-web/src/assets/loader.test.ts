import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import { BASE_URL, FakeHost, fakeImage, minimalManifestJson } from "../test-support/fake-host.js";
import { LoadedAssets, closeImages, decodeImages, loadAssets, type AssetStateEvent } from "./loader.js";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The FIPS 180-4 example: SHA-256("abc"). Written out so the digest the loader compares with is not computed by the code under test. */
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const MESH_BYTES = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
/** A 2 x 1 image: an opaque red texel then a half-transparent blue one. */
const IMAGE_BYTES = fakeImage(2, 1, [255, 0, 0, 255, 0, 0, 255, 128]);
const ABC = new TextEncoder().encode("abc");

const MESH_URL = "assets/00000000000000aa.bin";
const IMAGE_URL = "assets/00000000000000bb.png";
const TEXT_URL = "assets/00000000000000cc.png";

type Json = Record<string, unknown>;

/** The minimal manifest with an `assets` table: span 3 is `src/main.mtek:2:21`, the declaring `asset.*` call of every entry. */
function manifestWith(assets: Json[]): MtekManifest {
  const json = minimalManifestJson();
  json["assets"] = assets;
  const result = checkManifest(json);
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  return result.manifest;
}

function meshEntry(bytes: Uint8Array = MESH_BYTES, url = MESH_URL): Json {
  return { url, sha256: sha256(bytes), bytes: bytes.byteLength, kind: "mesh-data", primitives: [], preprocessing: [], span: 3 };
}
function imageEntry(bytes: Uint8Array = IMAGE_BYTES, url = IMAGE_URL, colorSpace = "srgb"): Json {
  return { url, sha256: sha256(bytes), bytes: bytes.byteLength, kind: "image", colorSpace, preprocessing: [], span: 3 };
}

function hostWith(files: Record<string, Uint8Array | number | Error>, options: { subtleCrypto?: boolean } = {}): FakeHost {
  const host = new FakeHost(options);
  for (const [url, file] of Object.entries(files)) host.files.set(new URL(url, BASE_URL).href, file);
  return host;
}

function load(host: FakeHost, manifest: MtekManifest, extra: { maxTextureDimension2D?: number; previous?: LoadedAssets; onState?: (e: AssetStateEvent) => void } = {}) {
  return loadAssets({
    manifest,
    baseUrl: new URL(BASE_URL),
    environment: host.environment,
    maxTextureDimension2D: extra.maxTextureDimension2D ?? 8192,
    ...(extra.previous === undefined ? {} : { previous: extra.previous }),
    ...(extra.onState === undefined ? {} : { onState: extra.onState }),
  });
}

describe("loadAssets: success", () => {
  it("fetches every file from baseUrl, verifies it and decodes the images", async () => {
    const host = hostWith({ [MESH_URL]: MESH_BYTES, [IMAGE_URL]: IMAGE_BYTES });
    const result = await load(host, manifestWith([meshEntry(), imageEntry()]));
    expect(result.diagnostics).toEqual([]);
    expect(host.fetched).toEqual([`${BASE_URL}${MESH_URL}`, `${BASE_URL}${IMAGE_URL}`]);
    expect([...result.assets.bytes(MESH_URL)]).toEqual([...MESH_BYTES]);
    expect([...result.assets.bytes(IMAGE_URL)]).toEqual([...IMAGE_BYTES]);
    // Only the image is decoded; the bitmap holds the texels exactly as stored (no premultiplication of the half-transparent texel).
    expect([...result.images.keys()]).toEqual([IMAGE_URL]);
    const bitmap = result.images.get(IMAGE_URL);
    expect([bitmap?.width, bitmap?.height]).toEqual([2, 1]);
    expect(host.bitmaps).toHaveLength(1);
    expect([...(host.bitmaps[0]?.data ?? [])]).toEqual([255, 0, 0, 255, 0, 0, 255, 128]);
    expect(result.assets.statuses()).toEqual([
      { url: MESH_URL, kind: "mesh-data", state: "ready", bytes: 12 },
      { url: IMAGE_URL, kind: "image", state: "ready", bytes: IMAGE_BYTES.byteLength },
    ]);
  });

  it("verifies against the published SHA-256 vector of 'abc', not only against the runtime's own digest", async () => {
    const entry = { ...meshEntry(ABC, TEXT_URL), sha256: SHA256_ABC };
    const host = hostWith({ [TEXT_URL]: ABC });
    expect((await load(host, manifestWith([entry]))).diagnostics).toEqual([]);
    // One bit of the digest differs: the same file is now altered.
    const wrong = { ...entry, sha256: `${SHA256_ABC.slice(0, 63)}e` };
    const failed = await load(host, manifestWith([wrong]));
    expect(failed.diagnostics.map((d) => d.code)).toEqual(["MTEK-E7030"]);
    expect(failed.diagnostics[0]?.actual).toBe(SHA256_ABC);
  });

  it("makes every file pending first and then ready as each finishes", async () => {
    const host = hostWith({ [MESH_URL]: MESH_BYTES, [IMAGE_URL]: IMAGE_BYTES });
    const events: string[] = [];
    await load(host, manifestWith([meshEntry(), imageEntry()]), { onState: (e) => events.push(`${e.state} ${e.kind}`) });
    expect(events.slice(0, 2)).toEqual(["pending mesh-data", "pending image"]);
    expect(events.slice(2).sort()).toEqual(["ready image", "ready mesh-data"]);
  });

  it("resolves urls relative to the program's base URL", async () => {
    const host = new FakeHost();
    host.files.set("https://cdn.example/game/v2/assets/00000000000000aa.bin", MESH_BYTES);
    const result = await loadAssets({
      manifest: manifestWith([meshEntry()]),
      baseUrl: new URL("https://cdn.example/game/v2/"),
      environment: host.environment,
      maxTextureDimension2D: 8192,
    });
    expect(result.diagnostics).toEqual([]);
    expect(host.fetched).toEqual(["https://cdn.example/game/v2/assets/00000000000000aa.bin"]);
  });

  it("loads a program without assets without touching the network", async () => {
    const host = new FakeHost();
    const result = await load(host, manifestWith([]));
    expect(result.diagnostics).toEqual([]);
    expect(result.assets.size).toBe(0);
    expect(host.fetched).toEqual([]);
  });
});

describe("loadAssets: failures are E7030 at the declaration, naming the file", () => {
  it("a missing file (HTTP 404)", async () => {
    const host = hostWith({});
    const events: string[] = [];
    const result = await load(host, manifestWith([meshEntry()]), { onState: (e) => events.push(e.state) });
    expect(events).toEqual(["pending", "failed"]);
    const [d] = result.diagnostics;
    expect(result.diagnostics).toHaveLength(1);
    expect(d?.code).toBe("MTEK-E7030");
    expect(d?.title).toBe("asset fetch or integrity failure");
    expect(d?.severity).toBe("error");
    expect(d?.phase).toBe("runtime:mount");
    expect(d?.message).toContain(`'${MESH_URL}'`);
    expect(d?.message).toContain("HTTP 404");
    expect(d?.source).toEqual({ file: "src/main.mtek", startByte: 60, endByte: 71, startLine: 2, startColumn: 21, endLine: 2, endColumn: 32 });
    expect(d?.notes).toContain(`asset file: ${MESH_URL}`);
    expect(result.assets.size).toBe(0);
  });

  it("a mesh-data file names the GLB it was packed from", async () => {
    const entry = meshEntry();
    entry["primitives"] = [
      {
        source: { file: "models/chair.glb", mesh: "Seat", primitive: 0 },
        vertexCount: 3,
        indexCount: 3,
        indexFormat: "uint16",
        attributes: ["position"],
        offsets: { position: 0, indices: 36 },
        boundingSphere: { center: [0, 0, 0], radius: 1 },
      },
    ];
    const result = await load(hostWith({}), manifestWith([entry]));
    expect(result.diagnostics[0]?.message).toContain("mesh data of 'models/chair.glb'");
  });

  it("a network failure", async () => {
    const host = hostWith({ [IMAGE_URL]: new Error("net::ERR_CONNECTION_RESET") });
    const result = await load(host, manifestWith([imageEntry()]));
    expect(result.diagnostics.map((d) => d.code)).toEqual(["MTEK-E7030"]);
    expect(result.diagnostics[0]?.message).toContain("net::ERR_CONNECTION_RESET");
  });

  it("a byte length that differs from the manifest's", async () => {
    const host = hostWith({ [MESH_URL]: MESH_BYTES.subarray(0, 11) });
    const result = await load(host, manifestWith([meshEntry()]));
    const [d] = result.diagnostics;
    expect(d?.code).toBe("MTEK-E7030");
    expect(d?.expected).toBe("12 bytes");
    expect(d?.actual).toBe("11 bytes");
    expect(d?.message).toContain("has 11 bytes, but the build recorded 12");
  });

  it("a SHA-256 mismatch at the right length (one bit flipped), with both digests", async () => {
    const altered = MESH_BYTES.slice();
    altered[5] = (altered[5] ?? 0) ^ 1;
    const host = hostWith({ [MESH_URL]: altered });
    const result = await load(host, manifestWith([meshEntry()]));
    const [d] = result.diagnostics;
    expect(d?.code).toBe("MTEK-E7030");
    expect(d?.expected).toBe(sha256(MESH_BYTES));
    expect(d?.actual).toBe(sha256(altered));
    expect(d?.message).toContain("does not match the SHA-256");
    // The altered bytes are never kept.
    expect(result.assets.has(MESH_URL)).toBe(false);
  });

  it("without crypto.subtle only the byte length is verified", async () => {
    const altered = MESH_BYTES.slice();
    altered[5] = (altered[5] ?? 0) ^ 1;
    const host = hostWith({ [MESH_URL]: altered, [IMAGE_URL]: IMAGE_BYTES.subarray(0, 10) }, { subtleCrypto: false });
    expect(host.environment.sha256).toBeUndefined();
    const result = await load(host, manifestWith([meshEntry(), imageEntry()]));
    expect(result.assets.has(MESH_URL)).toBe(true); // the altered file passed: only its length could be checked
    expect(result.assets.has(IMAGE_URL)).toBe(false);
    expect(result.diagnostics.map((d) => d.message.includes("has 10 bytes"))).toEqual([true]);
    // With the image served in full the load succeeds, altered mesh data included.
    const fixed = hostWith({ [MESH_URL]: altered, [IMAGE_URL]: IMAGE_BYTES }, { subtleCrypto: false });
    expect((await load(fixed, manifestWith([meshEntry(), imageEntry()]))).diagnostics).toEqual([]);
  });

  it("reports every failed file, in manifest order, and keeps no bitmap of a failed load", async () => {
    const host = hostWith({ [TEXT_URL]: IMAGE_BYTES, [IMAGE_URL]: IMAGE_BYTES });
    const result = await load(host, manifestWith([meshEntry(), imageEntry(IMAGE_BYTES, TEXT_URL), imageEntry()]));
    expect(result.diagnostics.map((d) => d.notes[0])).toEqual([`asset file: ${MESH_URL}`]);
    expect(result.images.size).toBe(0);
    // Both images decoded before the mesh data failed was known: all of them were closed.
    expect(host.bitmaps).toHaveLength(2);
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    const several = await load(hostWith({}), manifestWith([meshEntry(), imageEntry()]));
    expect(several.diagnostics.map((d) => d.notes[0])).toEqual([`asset file: ${MESH_URL}`, `asset file: ${IMAGE_URL}`]);
  });
});

describe("loadAssets: image decoding", () => {
  it("a file the browser cannot decode is E7031 at the declaration", async () => {
    const garbage = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const host = hostWith({ [IMAGE_URL]: garbage });
    const events: string[] = [];
    const result = await load(host, manifestWith([imageEntry(garbage)]), { onState: (e) => events.push(e.state) });
    expect(events).toEqual(["pending", "failed"]);
    const [d] = result.diagnostics;
    expect(d?.code).toBe("MTEK-E7031");
    expect(d?.title).toBe("image decode failure");
    expect(d?.message).toContain(`'${IMAGE_URL}'`);
    expect(d?.message).toContain("could not be decoded");
    expect(d?.source?.file).toBe("src/main.mtek");
    expect(d?.source?.startLine).toBe(2);
    expect(result.images.size).toBe(0);
  });

  it("an image larger than the device's maxTextureDimension2D is E8002, and its bitmap is closed", async () => {
    const wide = fakeImage(5, 1, new Array<number>(20).fill(255));
    const host = hostWith({ [IMAGE_URL]: wide });
    const result = await load(host, manifestWith([imageEntry(wide)]), { maxTextureDimension2D: 4 });
    const [d] = result.diagnostics;
    expect(d?.code).toBe("MTEK-E8002");
    expect(d?.message).toContain("5 x 1 pixels");
    expect(d?.message).toContain("maxTextureDimension2D (4)");
    expect(host.bitmaps[0]?.closed).toBe(true);
    // The same image on a device that allows it.
    expect((await load(host, manifestWith([imageEntry(wide)]), { maxTextureDimension2D: 5 })).diagnostics).toEqual([]);
  });
});

describe("loadAssets: reuse and re-decoding", () => {
  it("does not fetch a file again when its url, hash and length are unchanged", async () => {
    const host = hostWith({ [MESH_URL]: MESH_BYTES, [IMAGE_URL]: IMAGE_BYTES });
    const manifest = manifestWith([meshEntry(), imageEntry()]);
    const first = await load(host, manifest);
    closeImages(first.images);
    host.fetched.length = 0;
    const second = await load(host, manifest, { previous: first.assets });
    expect(second.diagnostics).toEqual([]);
    expect(host.fetched).toEqual([]);
    // The image is decoded again for the new scene.
    expect(second.images.size).toBe(1);
    // A file with another hash is fetched.
    const changed = Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    host.files.set(`${BASE_URL}${MESH_URL}`, changed);
    const third = await load(host, manifestWith([meshEntry(changed), imageEntry()]), { previous: first.assets });
    expect(third.diagnostics).toEqual([]);
    expect(host.fetched).toEqual([`${BASE_URL}${MESH_URL}`]);
  });

  it("decodes the images again from the retained bytes without any request", async () => {
    const host = hostWith({ [MESH_URL]: MESH_BYTES, [IMAGE_URL]: IMAGE_BYTES });
    const manifest = manifestWith([meshEntry(), imageEntry()]);
    const first = await load(host, manifest);
    closeImages(first.images);
    host.fetched.length = 0;
    const again = await decodeImages({ manifest, baseUrl: new URL(BASE_URL), environment: host.environment, maxTextureDimension2D: 8192, assets: first.assets });
    expect(again.diagnostics).toEqual([]);
    expect(host.fetched).toEqual([]);
    expect([...again.images.keys()]).toEqual([IMAGE_URL]);
    expect(again.images.get(IMAGE_URL)).not.toBe(first.images.get(IMAGE_URL));
  });
});
