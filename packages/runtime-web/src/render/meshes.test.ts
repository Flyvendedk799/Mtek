import { describe, expect, it } from "vitest";
import { LoadedAssets } from "../assets/loader.js";
import { ResourceRegistry } from "../gpu/registry.js";
import { generateBox, generateSphere } from "../mesh/primitives.js";
import type { ResolvedMesh } from "../scene/structure.js";
import { FakeBuffer, FakeDevice, asGpu } from "../test-support/fake-gpu.js";
import { MeshStore, uploadBuffer, vertexBufferOf } from "./meshes.js";

const COPY_DST = 0x08;
const INDEX = 0x10;
const VERTEX = 0x20;

function setup(): { device: FakeDevice; registry: ResourceRegistry; store: MeshStore } {
  const device = new FakeDevice();
  const registry = new ResourceRegistry(asGpu<GPUDevice>(device));
  const store = new MeshStore(registry, asGpu<GPUQueue>(device.queue));
  return { device, registry, store };
}

function fake(buffer: GPUBuffer): FakeBuffer {
  if (!(buffer instanceof FakeBuffer)) throw new Error("not a fake buffer");
  return buffer;
}

function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

const box: ResolvedMesh = { id: "mesh:0", descriptor: { kind: "box", size: [1, 2, 3] } };

describe("MeshStore", () => {
  it("uploads a box as three non-interleaved vertex buffers and a uint16 index buffer", () => {
    const { store, registry } = setup();
    store.upload([box]);
    const mesh = store.get("mesh:0");
    const data = generateBox([1, 2, 3]);
    expect(mesh.vertexCount).toBe(24);
    expect(mesh.indexCount).toBe(36);
    expect(mesh.indexFormat).toBe("uint16");
    expect(mesh.boundingRadius).toBe(data.boundingRadius);
    const expected = [
      [vertexBufferOf(mesh, "position"), data.positions, VERTEX, 24 * 12],
      [vertexBufferOf(mesh, "normal"), data.normals, VERTEX, 24 * 12],
      [vertexBufferOf(mesh, "uv"), data.uvs, VERTEX, 24 * 8],
      [mesh.indexBuffer, data.indices, INDEX, 36 * 2],
    ] as const;
    for (const [buffer, source, usage, size] of expected) {
      const gpu = fake(buffer);
      expect(gpu.usage).toBe(usage | COPY_DST);
      expect(gpu.size).toBe(size);
      expect(gpu.contents).toEqual(bytesOf(source));
    }
    expect(registry.snapshot()).toMatchObject({ uploads: 4, buffersAllocated: 4, liveBuffers: 4, uploadBytes: 288 + 288 + 192 + 72 });
  });

  it("uses uint32 indices above 65 535 vertices", () => {
    const { store } = setup();
    store.upload([{ id: "mesh:0", descriptor: { kind: "sphere", radius: 1, segments: 256, rings: 256 } }]);
    const mesh = store.get("mesh:0");
    expect(mesh.vertexCount).toBe(257 * 257);
    expect(mesh.indexFormat).toBe("uint32");
    const expected = bytesOf(generateSphere(1, 256, 256).indices);
    const contents = fake(mesh.indexBuffer).contents;
    // A plain loop: a deep equality of 1.5 MB is slow.
    expect(contents.length).toBe(expected.length);
    expect(contents.every((byte, i) => byte === expected[i])).toBe(true);
  });

  it("pads data whose byte length is not a multiple of 4 (writeBuffer needs multiples of 4)", () => {
    const { registry, device } = setup();
    const odd = new Uint16Array([1, 2, 3]);
    const buffer = fake(uploadBuffer(registry, asGpu<GPUQueue>(device.queue), "odd", INDEX, odd));
    expect(buffer.size).toBe(8);
    expect(Array.from(buffer.contents)).toEqual([1, 0, 2, 0, 3, 0, 0, 0]);
    // A view into a larger buffer is copied from its own range only.
    const big = new Float32Array([9, 8, 7, 6]);
    const tail = fake(uploadBuffer(registry, asGpu<GPUQueue>(device.queue), "tail", VERTEX, big.subarray(2)));
    expect(new Float32Array(tail.contents.buffer)).toEqual(new Float32Array([7, 6]));
  });

  it("uploads each canonical descriptor once and numbers meshes in upload order", () => {
    const { store, registry } = setup();
    store.upload([
      box,
      { id: "mesh:1", descriptor: { kind: "box", size: [1, 2, 3] } },
      { id: "mesh:2", descriptor: { kind: "plane", size: [1, 1] } },
    ]);
    expect(store.size).toBe(2);
    expect(store.get("mesh:1")).toBe(store.get("mesh:0"));
    expect([store.get("mesh:0").order, store.get("mesh:2").order]).toEqual([0, 1]);
    store.upload([box]);
    expect(registry.snapshot().buffersAllocated).toBe(8);
    expect(() => store.get("mesh:9")).toThrow(/mesh:9/);
  });
});

describe("MeshStore: meshes from asset files (decision 0060)", () => {
  /**
   * One file, two primitives, laid out as the compiler packs them (spec/runtime-abi.md section 5.5):
   *   primitive 0: 4 vertices with position, normal and uv, 6 `uint16` indices;
   *       position bytes 0..48, normal 48..96, uv 96..128, indices 128..140 (12 bytes, a multiple of 4).
   *   primitive 1: 3 vertices with position only, 3 `uint16` indices;
   *       position bytes 140..176, indices 176..182, padded to 184.
   */
  const FILE_BYTES = 184;
  const file = new Uint8Array(FILE_BYTES).map((_, i) => i % 251);
  const layout0 = {
    source: { file: "m.glb", mesh: "Quad", primitive: 0 },
    vertexCount: 4,
    indexCount: 6,
    indexFormat: "uint16" as const,
    attributes: ["position", "normal", "uv"] as const,
    offsets: { position: 0, normal: 48, uv: 96, indices: 128 },
    boundingSphere: { center: [0.5, 0.25, -1] as [number, number, number], radius: 2 },
  };
  const layout1 = {
    source: { file: "m.glb", mesh: "Tri", primitive: 0 },
    vertexCount: 3,
    indexCount: 3,
    indexFormat: "uint16" as const,
    attributes: ["position"] as const,
    offsets: { position: 140, indices: 176 },
    boundingSphere: { center: [0, 0, 0] as [number, number, number], radius: 1 },
  };
  const quad: ResolvedMesh = { id: "mesh:0", descriptor: { kind: "asset", asset: "assets/f.bin", primitive: 0, layout: layout0 } };
  const tri: ResolvedMesh = { id: "mesh:1", descriptor: { kind: "asset", asset: "assets/f.bin", primitive: 1, layout: layout1 } };

  function loaded(): LoadedAssets {
    const asset = { url: "assets/f.bin", sha256: "0".repeat(64), bytes: FILE_BYTES, kind: "mesh-data" as const, primitives: [layout0, layout1], preprocessing: [], span: 0 };
    return new LoadedAssets(new Map([["assets/f.bin", { asset, bytes: file }]]));
  }

  it("makes one buffer per region of the primitive, holding exactly the file's bytes of that region", () => {
    const { store, registry } = setup();
    store.upload([quad, tri], loaded());
    const mesh = store.get("mesh:0");
    expect(Object.keys(mesh.vertexBuffers)).toEqual(["position", "normal", "uv"]);
    expect([...fake(vertexBufferOf(mesh, "position")).contents]).toEqual([...file.subarray(0, 48)]);
    expect([...fake(vertexBufferOf(mesh, "normal")).contents]).toEqual([...file.subarray(48, 96)]);
    expect([...fake(vertexBufferOf(mesh, "uv")).contents]).toEqual([...file.subarray(96, 128)]);
    expect([...fake(mesh.indexBuffer).contents]).toEqual([...file.subarray(128, 140)]);
    expect([mesh.vertexCount, mesh.indexCount, mesh.indexFormat]).toEqual([4, 6, "uint16"]);
    // Usages as for the generated meshes.
    expect(fake(vertexBufferOf(mesh, "position")).usage).toBe(VERTEX | COPY_DST);
    expect(fake(mesh.indexBuffer).usage).toBe(INDEX | COPY_DST);
    // The second primitive has no normal or uv buffer; its six index bytes round up to eight.
    const second = store.get("mesh:1");
    expect(Object.keys(second.vertexBuffers)).toEqual(["position"]);
    expect([...fake(vertexBufferOf(second, "position")).contents]).toEqual([...file.subarray(140, 176)]);
    expect([...fake(second.indexBuffer).contents]).toEqual([...file.subarray(176, 182), 0, 0]);
    expect(() => vertexBufferOf(second, "uv")).toThrow(/no 'uv' attribute/);
    // 4 + 2 buffers, 4 + 2 writes.
    expect(registry.snapshot()).toMatchObject({ buffersAllocated: 6, uploads: 6 });
  });

  it("reads 32-bit indices (more than 65 535 vertices) as uint32: four bytes each, no padding needed", () => {
    const { store } = setup();
    // Three vertices at byte 0 (36 bytes), then 3 uint32 indices at byte 36: 12 bytes. Only the layout is under test.
    const layout = { ...layout1, indexFormat: "uint32" as const, offsets: { position: 0, indices: 36 } };
    const bytes = new Uint8Array(48).map((_, i) => i);
    const asset = { url: "assets/w.bin", sha256: "0".repeat(64), bytes: 48, kind: "mesh-data" as const, primitives: [layout], preprocessing: [], span: 0 };
    const files = new LoadedAssets(new Map([["assets/w.bin", { asset, bytes }]]));
    store.upload([{ id: "mesh:5", descriptor: { kind: "asset", asset: "assets/w.bin", primitive: 0, layout } }], files);
    const mesh = store.get("mesh:5");
    expect([mesh.indexFormat, mesh.indexCount]).toEqual(["uint32", 3]);
    expect(fake(mesh.indexBuffer).size).toBe(12);
    expect([...fake(mesh.indexBuffer).contents]).toEqual([...bytes.subarray(36, 48)]);
  });

  it("keeps the manifest's bounding sphere: the centre is in the mesh's local space", () => {
    const { store } = setup();
    store.upload([quad, tri, { ...box, id: "mesh:9" }], loaded());
    expect([store.get("mesh:0").boundingCenter, store.get("mesh:0").boundingRadius]).toEqual([[0.5, 0.25, -1], 2]);
    expect(store.get("mesh:1").boundingCenter).toEqual([0, 0, 0]);
    // A generated shape is centred at its origin.
    expect(store.get("mesh:9").boundingCenter).toEqual([0, 0, 0]);
  });

  it("uploads each primitive once however many manifest meshes name it, and releases every buffer", () => {
    const { store, registry } = setup();
    store.upload([quad, { id: "mesh:7", descriptor: quad.descriptor }], loaded());
    expect(store.size).toBe(1);
    expect(store.get("mesh:7")).toBe(store.get("mesh:0"));
    expect(registry.snapshot().liveBuffers).toBe(4);
    store.dispose();
    expect(registry.snapshot().liveBuffers).toBe(0);
  });

  it("reports a region above the device's maxBufferSize as E8063 before creating anything", () => {
    const device = new FakeDevice();
    const failures: string[] = [];
    const registry = new ResourceRegistry(asGpu<GPUDevice>(device), { onAllocationFailure: (d) => failures.push(`${d.code} ${d.message}`) });
    const store = new MeshStore(registry, asGpu<GPUQueue>(device.queue), undefined, 40);
    // The position region of the quad is 48 bytes, above 40.
    expect(() => store.upload([quad], loaded())).toThrow(RangeError);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("MTEK-E8063");
    expect(failures[0]).toContain("position");
    expect(failures[0]).toContain("maxBufferSize (40)");
    expect(registry.snapshot().buffersAllocated).toBe(0);
  });

  it("reports an out-of-memory error scope result for an asset buffer as E8063", async () => {
    const device = new FakeDevice();
    const failures: string[] = [];
    const registry = new ResourceRegistry(asGpu<GPUDevice>(device), { onAllocationFailure: (d) => failures.push(d.code) });
    const store = new MeshStore(registry, asGpu<GPUQueue>(device.queue));
    device.failNextAllocations(1);
    store.upload([tri], loaded());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(failures).toEqual(["MTEK-E8063"]);
    // Every creation was inside an out-of-memory scope: two buffers, two scopes, none left open.
    expect(device.events.filter((e) => e === "pushErrorScope:out-of-memory")).toHaveLength(2);
    expect(device.openErrorScopes).toBe(0);
  });

  it("needs the loaded files: an asset mesh without them is an internal error", () => {
    const { store } = setup();
    expect(() => store.upload([quad])).toThrow(/no assets were loaded/);
  });
});
