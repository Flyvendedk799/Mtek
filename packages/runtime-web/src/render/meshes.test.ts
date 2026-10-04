import { describe, expect, it } from "vitest";
import { ResourceRegistry } from "../gpu/registry.js";
import { generateBox, generateSphere } from "../mesh/primitives.js";
import type { ResolvedMesh } from "../scene/structure.js";
import { FakeBuffer, FakeDevice, asGpu } from "../test-support/fake-gpu.js";
import { MeshStore, uploadBuffer } from "./meshes.js";

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
      [mesh.vertexBuffers.position, data.positions, VERTEX, 24 * 12],
      [mesh.vertexBuffers.normal, data.normals, VERTEX, 24 * 12],
      [mesh.vertexBuffers.uv, data.uvs, VERTEX, 24 * 8],
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
