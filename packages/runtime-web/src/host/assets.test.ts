// Startup assets end to end against the fake host (spec/assets.md section 5, decision 0060): the loader, the
// mesh and texture uploads, mount resolution and the visible failures. Every expected byte is derived by hand from
// the files of `test-support/asset-program.ts`.
import { describe, expect, it } from "vitest";
import { MtekMountError, type MtekDiagnostic } from "../diagnostics/types.js";
import { BASE_URL, FakeHost, MINIMAL_SCENE_COLOR, asDom, fakeImage, type FakeHostOptions, type InitContext } from "../test-support/fake-host.js";
import {
  IMAGE_URL,
  MESH_URL,
  TEXELS,
  assetProgram,
  imageBytes,
  installAssetProgram,
  meshBytes,
  type AssetProgramOptions,
} from "../test-support/asset-program.js";
import { mountMtekWith } from "./mount.js";
import type { MtekApp, MtekAssetStateEvent, MtekMountOptions } from "./types.js";

const MESH_LABEL = `mtek mesh asset:${MESH_URL}#0`;

function assetHost(options: AssetProgramOptions = {}, hostOptions: FakeHostOptions = {}, edit?: (manifest: Record<string, unknown>) => void): { host: FakeHost; manifest: Record<string, unknown> } {
  const host = new FakeHost(hostOptions);
  const manifest = installAssetProgram(host, options, edit);
  return { host, manifest };
}

function mount(host: FakeHost, manifest: Record<string, unknown>, options: MtekMountOptions = { test: { manualClock: true, renderTarget: { width: 16, height: 8 } } }): Promise<MtekApp> {
  return mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), assetProgram(manifest), options);
}

async function rejection(promise: Promise<unknown>): Promise<MtekMountError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MtekMountError) return error;
    throw error;
  }
  throw new Error("expected mountMtek to reject with MtekMountError");
}

function overlayText(host: FakeHost): string | undefined {
  return host.document.body.find("data-mtek-overlay")?.textContent;
}

/** The f32 values `bytes` holds, little-endian. */
function floats(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.byteLength / 4 }, (_, i) => view.getFloat32(i * 4, true));
}

function liveBuffer(host: FakeHost, label: string): Uint8Array {
  const buffer = host.device.buffers.find((candidate) => candidate.label === label && !candidate.destroyed);
  if (buffer === undefined) throw new Error(`no live buffer ${label}`);
  return buffer.contents;
}

describe("a program with assets mounts and draws", () => {
  it("uploads each region of the mesh file to its own buffer, byte for byte", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    // Positions (0,0,0) (2,0,0) (0,2,0): 2.0f is 00 00 00 40.
    expect(floats(liveBuffer(host, `${MESH_LABEL} position`))).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    expect([...liveBuffer(host, `${MESH_LABEL} position`).subarray(12, 16)]).toEqual([0, 0, 0, 0x40]);
    // UVs (0,0) (1,0) (0,1): 1.0f is 00 00 80 3f.
    expect(floats(liveBuffer(host, `${MESH_LABEL} uv`))).toEqual([0, 0, 1, 0, 0, 1]);
    // Indices 0 1 2 as uint16; six bytes round up to a buffer of eight.
    expect([...liveBuffer(host, `${MESH_LABEL} index`)]).toEqual([0, 0, 1, 0, 2, 0, 0, 0]);
    // The primitive has no normal attribute, so none is created.
    expect(host.device.buffers.some((buffer) => buffer.label === `${MESH_LABEL} normal`)).toBe(false);
    // Usages: vertex | copy_dst and index | copy_dst.
    const usage = (label: string): number | undefined => host.device.buffers.find((buffer) => buffer.label === label)?.usage;
    expect(usage(`${MESH_LABEL} position`)).toBe(0x20 | 0x08);
    expect(usage(`${MESH_LABEL} index`)).toBe(0x10 | 0x08);
    app.dispose();
  });

  it("creates the texture in the declared colour space with the usages copyExternalImageToTexture needs", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    const texture = host.device.textures.find((candidate) => (candidate.descriptor as { label?: string }).label === `mtek asset ${IMAGE_URL}`);
    expect(texture).toBeDefined();
    expect(texture?.format).toBe("rgba8unorm-srgb");
    // TEXTURE_BINDING (4) | COPY_DST (2) | RENDER_ATTACHMENT (16).
    expect(texture?.usage).toBe(4 | 2 | 16);
    expect([texture?.width, texture?.height]).toEqual([2, 2]);
    expect([...(texture?.pixels ?? [])]).toEqual(TEXELS);
    const mipPass = host.device.renderPasses.find((pass) => pass.nonIndexedDraws.length > 0);
    expect([mipPass?.targetWidth, mipPass?.targetHeight]).toEqual([1, 1]);
    expect(mipPass?.nonIndexedDraws.map((draw) => draw.vertexCount)).toEqual([3]);
    // Exactly one image copy: no colour conversion or flip is requested.
    const copies = host.device.queue.externalCopies;
    expect(copies).toHaveLength(1);
    expect([copies[0]?.width, copies[0]?.height, copies[0]?.colorSpace]).toEqual([2, 2, "srgb"]);
    app.dispose();
  });

  it("creates a data texture as rgba8unorm", async () => {
    const { host, manifest } = assetHost({ colorSpace: "linear" });
    const app = await mount(host, manifest);
    const texture = host.device.textures.find((candidate) => (candidate.descriptor as { label?: string }).label === `mtek asset ${IMAGE_URL}`);
    expect(texture?.format).toBe("rgba8unorm");
    expect([...(texture?.pixels ?? [])]).toEqual(TEXELS);
    app.dispose();
  });

  it("closes every decoded bitmap once the scene started, and draws the mesh", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    expect(host.bitmaps).toHaveLength(1);
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    app.debug?.step(1, 1 / 60);
    const draw = host.device.renderPasses.at(-1)?.draws[0];
    expect(draw?.indexCount).toBe(3);
    expect(draw?.indexFormat).toBe("uint16");
    expect(draw?.vertexBuffers.map((buffer) => buffer.label)).toEqual([`${MESH_LABEL} position`, `${MESH_LABEL} uv`]);
    app.dispose();
  });

  it("fetches each asset once from baseUrl, after the manifest, and counts the uploads", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    expect(host.fetched[0]).toBe(`${BASE_URL}program.manifest.json`);
    expect(host.fetched.filter((url) => url.includes("assets/")).sort()).toEqual([`${BASE_URL}${MESH_URL}`, `${BASE_URL}${IMAGE_URL}`]);
    // Before the first frame the only uploads are the mesh regions (36 + 24 + 8 bytes) and the image copy (2 x 2 x 4).
    const counters = app.debug?.counters() ?? {};
    expect(counters["uploads"]).toBe(4);
    expect(counters["uploadBytes"]).toBe(36 + 24 + 8 + 16);
    app.dispose();
  });

  it("lists the assets as ready, in the manifest's order, and observed their states", async () => {
    const { host, manifest } = assetHost();
    const events: MtekAssetStateEvent[] = [];
    const app = await mount(host, manifest, { test: { manualClock: true, renderTarget: { width: 16, height: 8 }, onAssetState: (e) => events.push(e) } });
    expect(app.debug?.assets()).toEqual([
      { url: MESH_URL, kind: "mesh-data", state: "ready", bytes: 68 },
      { url: IMAGE_URL, kind: "image", state: "ready", bytes: imageBytes().byteLength },
    ]);
    expect(events.slice(0, 2).map((e) => `${e.state} ${e.url}`)).toEqual([`pending ${MESH_URL}`, `pending ${IMAGE_URL}`]);
    expect(events.slice(2).map((e) => e.state)).toEqual(["ready", "ready"]);
    app.dispose();
  });

  it("releases every asset buffer and texture on dispose", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    app.dispose();
    const counters = app.debug?.counters() ?? {};
    expect(counters["liveBuffers"]).toBe(0);
    expect(counters["liveTextures"]).toBe(0);
    expect(host.device.textures.every((texture) => texture.destroyed)).toBe(true);
    expect(host.device.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });
});

describe("a failed asset rejects the mount with asset-failed, visibly", () => {
  /** What every failed startup leaves behind: nothing on the GPU, no listeners, no decoded image open. */
  function expectClean(host: FakeHost): void {
    expect(host.pendingFrames).toBe(0);
    expect(host.document.listenerCount).toBe(0);
    expect(host.device.destroyed).toBe(true);
    expect(host.device.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(host.device.textures.every((texture) => texture.destroyed)).toBe(true);
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    expect(host.device.queue.submits).toBe(0);
  }

  it("a missing file: E7030 at the declaration, the overlay names the file", async () => {
    const { host, manifest } = assetHost();
    host.files.delete(`${BASE_URL}${MESH_URL}`);
    const reported: MtekDiagnostic[] = [];
    const error = await rejection(mount(host, manifest, { onDiagnostic: (d) => reported.push(d) }));
    expect(error.kind).toBe("asset-failed");
    expect(error.diagnostics.map((d) => d.code)).toEqual(["MTEK-E7030"]);
    const [diagnostic] = error.diagnostics;
    expect(diagnostic?.message).toContain(MESH_URL);
    expect(diagnostic?.message).toContain("models/tri.glb");
    expect(diagnostic?.message).toContain("HTTP 404");
    expect(diagnostic?.source).toMatchObject({ file: "src/main.mtek", startLine: 2, startColumn: 21 });
    expect(reported.map((d) => d.code)).toEqual(["MTEK-E7030"]);
    const text = overlayText(host);
    expect(text).toContain("MTEK-E7030");
    expect(text).toContain(MESH_URL);
    expect(text).toContain("models/tri.glb");
    expect(text).toContain("src/main.mtek:2:21");
    expectClean(host);
  });

  it("a corrupted image: E7031 at the declaration", async () => {
    // Header intact, texels cut off. The manifest records this very file, so integrity passes and decoding does not.
    const corrupt = fakeImage(2, 2, TEXELS).slice(0, 12);
    const { host, manifest } = assetHost({ image: corrupt });
    const error = await rejection(mount(host, manifest));
    expect(error.kind).toBe("asset-failed");
    expect(error.diagnostics.map((d) => d.code)).toEqual(["MTEK-E7031"]);
    expect(error.diagnostics[0]?.message).toContain(IMAGE_URL);
    expect(overlayText(host)).toContain("MTEK-E7031");
    expect(overlayText(host)).toContain("src/main.mtek:2:21");
    expectClean(host);
  });

  it("an altered file of the right length: E7030 with both digests", async () => {
    const { host, manifest } = assetHost();
    const altered = meshBytes();
    altered[0] = 1;
    host.files.set(`${BASE_URL}${MESH_URL}`, altered);
    const error = await rejection(mount(host, manifest));
    expect(error.kind).toBe("asset-failed");
    expect(error.diagnostics[0]?.code).toBe("MTEK-E7030");
    expect(error.diagnostics[0]?.expected).toHaveLength(64);
    expect(error.diagnostics[0]?.actual).toHaveLength(64);
    expect(error.diagnostics[0]?.expected).not.toBe(error.diagnostics[0]?.actual);
    expectClean(host);
  });

  it("a file of the wrong length: E7030", async () => {
    const { host, manifest } = assetHost();
    host.files.set(`${BASE_URL}${MESH_URL}`, meshBytes().subarray(0, 64));
    const error = await rejection(mount(host, manifest));
    expect(error.kind).toBe("asset-failed");
    expect(error.diagnostics[0]?.message).toContain("has 64 bytes, but the build recorded 68");
    expectClean(host);
  });

  it("reports every failed file, and the overlay lists them all", async () => {
    const { host, manifest } = assetHost();
    host.files.delete(`${BASE_URL}${MESH_URL}`);
    host.files.set(`${BASE_URL}${IMAGE_URL}`, 503);
    const error = await rejection(mount(host, manifest));
    expect(error.diagnostics.map((d) => d.code)).toEqual(["MTEK-E7030", "MTEK-E7030"]);
    expect(overlayText(host)).toContain(MESH_URL);
    expect(overlayText(host)).toContain(IMAGE_URL);
    expect(overlayText(host)).toContain("HTTP 503");
    expectClean(host);
  });

  it("an image the device cannot hold is E8002 (device-failed), found after decoding", async () => {
    const wide = fakeImage(8193, 1, new Array<number>(8193 * 4).fill(0));
    const { host, manifest } = assetHost({ image: wide });
    const error = await rejection(mount(host, manifest));
    expect(error.kind).toBe("device-failed");
    expect(error.diagnostics[0]?.code).toBe("MTEK-E8002");
    expect(error.diagnostics[0]?.message).toContain("8193 x 1");
    expectClean(host);
  });

  it("a manifest whose primitive does not fit its file is E8006, before anything is fetched", async () => {
    const { host, manifest } = assetHost({}, {}, (m) => {
      const mesh = (m["assets"] as Record<string, unknown>[])[0] ?? {};
      mesh["bytes"] = 60;
    });
    const error = await rejection(mount(host, manifest));
    expect(error.kind).toBe("manifest-invalid");
    expect(host.fetched.filter((url) => url.includes("assets/"))).toEqual([]);
  });

  it("reports a shader and an asset failure together", async () => {
    const { host, manifest } = assetHost();
    host.files.delete(`${BASE_URL}${MESH_URL}`);
    host.files.set(`${BASE_URL}shaders/0051ea5af5b8066c.wgsl`, "// generated\n    let x = 1; @@error unexpected token\n");
    const error = await rejection(mount(host, manifest));
    expect(error.diagnostics.map((d) => d.code).sort()).toEqual(["MTEK-E7030", "MTEK-E8051"]);
    expect(error.kind).toBe("shader-failed");
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
  });
});

// ---------------------------------------------------------------- culling, instancing and hot reload

/** An `init` that puts the camera at (0, 0, 10) looking at the origin (fov 0.9) and the one entity at (x, 0, 0), unscaled. */
function initAt(x: number): (ctx: object) => void {
  return (context) => {
    const ctx = context as InitContext;
    ctx.setCamera("position", { x: 0, y: 0, z: 10 });
    ctx.setCamera("target", { x: 0, y: 0, z: 0 });
    ctx.setCamera("projection.fov_y", Math.fround(0.9));
    ctx.setCamera("projection.near", Math.fround(0.1));
    ctx.setCamera("projection.far", 1000);
    for (const entity of ctx.e) {
      ctx.setTransform(entity, "position", { x, y: 0, z: 0 });
      ctx.setTransform(entity, "rotation", { x: 0, y: 0, z: 0, w: 1 });
      ctx.setTransform(entity, "scale", { x: 1, y: 1, z: 1 });
      ctx.setVisible(entity, true);
      ctx.setParam(entity, "color", MINIMAL_SCENE_COLOR);
    }
  };
}

describe("frustum culling uses the manifest's bounding sphere, which is not centred at the mesh origin", () => {
  // The camera looks along -Z from (0, 0, 10) with fov_y = 0.9 into a 16 x 8 target (aspect 2): in the z = 0 plane the
  // view is |x| <= 10 tan(0.45) * 2 = 9.667, and the distance of a point (x, 0, 0) to the right plane is
  // (9.667 - x) * 0.719 (the plane through the eye and (9.667, 0, 0): normal (-10, 0, -9.667) / 13.91). A sphere is culled
  // when that distance is below minus its radius.
  async function culledWith(x: number, center: [number, number, number]): Promise<{ culled: number; drawCalls: number }> {
    const { host, manifest } = assetHost({ boundingSphere: { center, radius: 1.5 } });
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), assetProgram(manifest, initAt(x)), {
      test: { manualClock: true, renderTarget: { width: 16, height: 8 } },
    });
    app.debug?.step(1, 1 / 60);
    const counters = app.debug?.counters() ?? {};
    app.dispose();
    return { culled: counters["culledObjects"] ?? -1, drawCalls: counters["drawCalls"] ?? -1 };
  }

  it("draws a mesh whose origin is outside the view but whose sphere reaches in", async () => {
    // Origin at x = 12: distance (9.667 - 12) * 0.719 = -1.68 < -1.5, so a sphere around the origin would be culled.
    // The sphere is centred (-3, 0, 0) from the origin, i.e. at x = 9: distance 0.48 > -1.5: inside.
    expect(await culledWith(12, [-3, 0, 0])).toEqual({ culled: 0, drawCalls: 1 });
    // Control: the same entity with its sphere around the origin is outside.
    expect(await culledWith(12, [0, 0, 0])).toEqual({ culled: 1, drawCalls: 0 });
  });

  it("culls a mesh whose origin is in view but whose sphere lies far outside", async () => {
    // Centre (-20, 0, 0): left plane distance (9.667 - 20) * 0.719 = -7.43 < -1.5.
    expect(await culledWith(0, [-20, 0, 0])).toEqual({ culled: 1, drawCalls: 0 });
    expect(await culledWith(0, [0, 0, 0])).toEqual({ culled: 0, drawCalls: 1 });
  });
});

describe("asset meshes group and instance like any other mesh (decision 0059)", () => {
  /** Three entities share the asset mesh, the material and (identical `initial`/`resource` params) one parameter block. */
  function threeEntities(manifest: Record<string, unknown>): void {
    ((manifest["shaders"] as Record<string, unknown>[])[0] ?? {})["instancedVertexEntry"] = "mtek_vs_instanced";
    const scene = manifest["scene"] as { entities: Record<string, unknown>[]; materialInstances: Record<string, unknown>[] };
    const entity = scene.entities[0] ?? {};
    const instance = scene.materialInstances[0] ?? {};
    for (const index of [1, 2]) {
      scene.entities.push({ ...entity, index, name: `Cube${String(index)}`, symbol: `src/main.mtek::Demo.Cube${String(index)}`, material: { id: "std/materials.mtek::Unlit", instance: index } });
      scene.materialInstances.push({ ...structuredClone(instance), index, entity: index });
    }
  }

  it("draws three entities of one asset mesh with one instanced draw, and one buffer set", async () => {
    const { host, manifest } = assetHost({}, {}, threeEntities);
    const app = await mount(host, manifest);
    app.debug?.step(1, 1 / 60);
    const counters = app.debug?.counters() ?? {};
    expect([counters["drawCalls"], counters["instancedDraws"], counters["sharedParamBlocks"]]).toEqual([1, 1, 1]);
    const draw = host.device.renderPasses.at(-1)?.draws[0];
    expect([draw?.instanceCount, draw?.indexCount]).toEqual([3, 3]);
    // One mesh upload (three buffers), however many entities draw it; the texture is shared by the three instances.
    expect(host.device.buffers.filter((b) => b.label.startsWith("mtek mesh asset"))).toHaveLength(3);
    expect(host.device.textures.filter((t) => (t.descriptor as { label?: string }).label?.startsWith("mtek asset") === true)).toHaveLength(1);
    app.dispose();
  });

  it("one draw call per entity with test.disableInstancing", async () => {
    const { host, manifest } = assetHost({}, {}, threeEntities);
    const app = await mount(host, manifest, { test: { manualClock: true, renderTarget: { width: 16, height: 8 }, disableInstancing: true } });
    app.debug?.step(1, 1 / 60);
    expect([app.debug?.counters()["drawCalls"], app.debug?.counters()["instancedDraws"]]).toEqual([3, 0]);
    app.dispose();
  });
});

describe("hot reload with assets (replaceProgram)", () => {
  it("closes decoded candidate images when its physics module cannot load", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    const candidate = structuredClone(manifest);
    candidate["subsystems"] = { ...(candidate["subsystems"] as object), physics: true, physicsModule: "physics/0123456789abcdef.js" };
    host.files.set(`${BASE_URL}program.manifest.json`, JSON.stringify(candidate));
    const result = await app.replaceProgram?.(assetProgram(candidate));
    expect(result?.ok).toBe(false);
    if (result?.ok === false) expect(result.diagnostics[0]?.code).toBe("MTEK-E8102");
    expect(host.bitmaps).toHaveLength(2);
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    app.debug?.step(1, 1 / 60);
    expect(host.device.renderPasses.at(-1)?.draws).toHaveLength(1);
    app.dispose();
  });

  it("releases partial candidate GPU resources after repeated initializer failures", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    const live = (): number[] => [
      host.device.buffers.filter((buffer) => !buffer.destroyed).length,
      host.device.textures.filter((texture) => !texture.destroyed).length,
    ];
    const before = live();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await app.replaceProgram?.(assetProgram(manifest, () => { throw new Error("candidate init failed"); }));
      expect(result?.ok).toBe(false);
      expect(live()).toEqual(before);
    }
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    app.debug?.step(1, 1 / 60);
    expect(app.state).toBe("running");
    expect(host.device.renderPasses.at(-1)?.draws).toHaveLength(1);
    app.dispose();
  });

  it("does not fetch unchanged files again, and swaps in a scene with its own asset buffers", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    app.debug?.step(1, 1 / 60);
    const assetFetches = host.fetched.filter((url) => url.includes("assets/")).length;
    const firstMesh = host.device.buffers.filter((b) => b.label.startsWith("mtek mesh asset")).length;
    const result = await app.replaceProgram?.(assetProgram(manifest));
    expect(result).toEqual({ ok: true });
    // Nothing new was fetched; the candidate made its own buffers and texture from the retained bytes, bitmaps closed.
    expect(host.fetched.filter((url) => url.includes("assets/"))).toHaveLength(assetFetches);
    expect(host.bitmaps).toHaveLength(2);
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    app.debug?.step(1, 1 / 60); // the swap happens at the start of this frame and releases the retired scene
    const live = host.device.buffers.filter((b) => b.label.startsWith("mtek mesh asset") && !b.destroyed);
    expect(firstMesh).toBe(3);
    expect(live).toHaveLength(3);
    expect(host.device.textures.filter((t) => (t.descriptor as { label?: string }).label?.startsWith("mtek asset") === true && !t.destroyed)).toHaveLength(1);
    expect(host.device.renderPasses.at(-1)?.draws).toHaveLength(1);
    app.dispose();
  });

  it("a candidate whose asset is missing is refused as E7030 (phase runtime:reload) and the running scene is untouched", async () => {
    const { host, manifest } = assetHost();
    const app = await mount(host, manifest);
    app.debug?.step(1, 1 / 60);
    const candidate = structuredClone(manifest);
    const image = (candidate["assets"] as Record<string, unknown>[])[1] ?? {};
    const scene = candidate["scene"] as { materialInstances: { params: { value?: { asset?: string } }[] }[] };
    image["url"] = "assets/00000000000000b2.png";
    for (const param of scene.materialInstances[0]?.params ?? []) if (param.value?.asset === IMAGE_URL) param.value.asset = "assets/00000000000000b2.png";
    host.files.set(`${BASE_URL}program.manifest.json`, JSON.stringify(candidate));
    const result = await app.replaceProgram?.(assetProgram(candidate));
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(["MTEK-E7030"]);
      expect(result.diagnostics[0]?.phase).toBe("runtime:reload");
    }
    expect(app.state).toBe("running");
    app.debug?.step(1, 1 / 60);
    expect(host.device.renderPasses.at(-1)?.draws).toHaveLength(1);
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    app.dispose();
  });
});

// ---------------------------------------------------------------- device loss with assets

/** Polls until `condition` holds; every step of a rebuild is a promise or a zero timeout. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The labels, usages and bytes of every live mesh buffer of a device, and the format and pixels of every live asset texture. */
function gpuContents(device: FakeHost["device"]): { buffers: [string, number, number[]][]; textures: [string, string, number[]][] } {
  return {
    buffers: device.buffers.filter((b) => !b.destroyed && b.label.startsWith("mtek mesh")).map((b): [string, number, number[]] => [b.label, b.usage, [...b.contents]]),
    textures: device.textures
      .filter((t) => !t.destroyed && (t.descriptor as { label?: string }).label?.startsWith("mtek asset") === true)
      .map((t): [string, string, number[]] => [(t.descriptor as { label: string }).label, t.format, [...t.pixels]]),
  };
}

describe("device loss with assets (decisions 0056 and 0060)", () => {
  it("rebuilds the asset meshes and textures on the new device from the retained bytes, without any request", async () => {
    const { host, manifest } = assetHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mount(host, manifest, { onDiagnostic: (d) => seen.push(d), test: { manualClock: true, renderTarget: { width: 16, height: 8 } } });
    app.debug?.step(2, 1 / 60);
    const before = gpuContents(host.device);
    const draws = host.device.renderPasses.at(-1)?.draws.length;
    const assetFetches = host.fetched.filter((url) => url.includes("assets/")).length;
    expect(before.buffers).toHaveLength(3);
    expect(before.textures).toHaveLength(1);
    expect(host.bitmaps).toHaveLength(1);

    host.latestDevice.loseDevice("unknown", "the GPU process crashed");
    await until(() => app.state === "recovering", "state recovering");
    expect(host.timers.runNext()).toBe(true);
    await until(() => app.state !== "recovering" || host.timers.pending.length > 0, "the end of the attempt");
    expect(host.timers.pending.map((t) => t.delayMs)).toEqual([]);
    expect(app.state).toBe("running");

    expect(seen.map((diagnostic) => diagnostic.code), JSON.stringify(seen)).toEqual(["MTEK-W8060", "MTEK-W8061"]);
    // The rebuild used the bytes the mount verified: not one more request for an asset file.
    expect(host.fetched.filter((url) => url.includes("assets/"))).toHaveLength(assetFetches);
    expect(host.adapter?.hostDevices).toHaveLength(2);
    // Same buffers and texture, same bytes, on the new device; the image was decoded again and the bitmap closed.
    expect(gpuContents(host.latestDevice)).toEqual(before);
    expect(host.latestDevice.queue.externalCopies).toHaveLength(1);
    expect(host.bitmaps).toHaveLength(2);
    expect(host.bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    // And it draws the same.
    app.debug?.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)?.draws.length).toBe(draws);
    expect(app.debug?.assets().map((asset) => asset.state)).toEqual(["ready", "ready"]);
    app.dispose();
  });
});
