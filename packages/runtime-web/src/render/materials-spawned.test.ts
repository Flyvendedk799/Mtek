/**
 * The material store under spawned entities (`spec/scenes.md` section 9, decision 0064): instances created
 * and removed while the scene runs, parameter blocks shared by identical instances and released with the
 * last one, arenas made on demand, and the steady state after churn.
 */
import { describe, expect, it } from "vitest";
import type { MtekLayoutRecord } from "../abi/manifest-types.js";
import type { MtekWriterMemory } from "../abi/program.js";
import { ResourceRegistry, type RegistryDevice } from "../gpu/registry.js";
import type { LayoutWriters } from "../scene/program.js";
import type { ResolvedInstance, ResolvedMaterial, SceneStructure } from "../scene/structure.js";
import { FakeDevice, asGpu, type FakeBuffer } from "../test-support/fake-gpu.js";
import { MaterialStore } from "./materials.js";
import { BindingPlan } from "./pipelines.js";

const layout = (id: string, size: number): MtekLayoutRecord => ({ id, size }) as unknown as MtekLayoutRecord;

const FRAME = layout("builtin:frame", 288);
const OBJECT = layout("builtin:object", 128);
const PULSE_LAYOUT = layout("material:src/main.mtek::Pulse", 32);

function material(id: string, blockLayout: MtekLayoutRecord | null, resources: ResolvedMaterial["resources"] = []): ResolvedMaterial {
  return { id, index: 0, layout: blockLayout, shader: { hash: id } as unknown as ResolvedMaterial["shader"], params: [], resources };
}

const PULSE = material("src/main.mtek::Pulse", PULSE_LAYOUT);

/** Writers that store the value as one f32 at `base`, so the bytes are checkable. */
function writers(): Map<string, LayoutWriters> {
  const field = (memory: MtekWriterMemory, base: number, value: unknown): void => {
    memory.f32[base >>> 2] = value as number;
  };
  return new Map([[PULSE_LAYOUT.id, { all: () => undefined, fields: new Map([["a", field]]) }]]);
}

/** A store of a scene without material instances: everything below is spawned. */
function emptyStore() {
  const device = new FakeDevice();
  const registry = new ResourceRegistry(asGpu<RegistryDevice>(device));
  const plan = new BindingPlan(registry, FRAME, OBJECT);
  const store = new MaterialStore(asGpu<GPUDevice>(device), registry, plan, { instances: [] } as unknown as SceneStructure, writers());
  return { device, registry, store, queue: asGpu<GPUQueue>(device.queue) };
}

const spawned = (m: ResolvedMaterial, index: number, shareable = true): ResolvedInstance => ({ index, material: m, entity: index, shareable, resources: [] });

function pulseBuffer(device: FakeDevice): FakeBuffer | undefined {
  return device.buffers.find((buffer) => buffer.label?.endsWith("::Pulse") === true && !buffer.destroyed);
}

describe("an instance of a spawned entity", () => {
  it("gets a slot of its own in an arena made on demand, and a bind group", () => {
    const { store, device, registry, queue } = emptyStore();
    expect(pulseBuffer(device)).toBeUndefined();
    store.createInstance(spawned(PULSE, 0));
    // A layout no instance of the scene used gets an arena of 16 slots (stride 256).
    expect(pulseBuffer(device)?.size).toBe(16 * 256);
    expect(store.blockOf(0)).toBe(0);
    expect(store.ownedParamBlocks).toBe(1);
    expect(store.instanceCount).toBe(1);
    store.bindGroup(0);
    expect(registry.snapshot().liveBindGroups).toBe(1);
    store.writeParam(0, "a", 3);
    expect(store.flush(queue)).toBe(1);
  });

  it("releases its slot and bind group when removed; the next instance reuses the slot", () => {
    const { store, registry, device, queue } = emptyStore();
    store.createInstance(spawned(PULSE, 0));
    store.bindGroup(0);
    store.removeInstance(0);
    expect(store.ownedParamBlocks).toBe(0);
    expect(store.instanceCount).toBe(0);
    expect(registry.snapshot().liveBindGroups).toBe(0);
    expect(() => store.blockOf(0)).toThrow("no material instance 0");

    store.createInstance(spawned(PULSE, 1));
    store.writeParam(1, "a", 5);
    store.flush(queue);
    // Slot 0 again: the new instance's bytes are at the start of the buffer.
    expect(new Float32Array(pulseBuffer(device)?.contents.buffer.slice(0, 4) ?? new ArrayBuffer(0))[0]).toBe(5);
  });

  it("rejects a duplicate index and an unknown one", () => {
    const { store } = emptyStore();
    store.createInstance(spawned(PULSE, 0));
    expect(() => {
      store.createInstance(spawned(PULSE, 0));
    }).toThrow("exists already");
    expect(() => {
      store.removeInstance(3);
    }).toThrow("no material instance 3");
  });
});

describe("sharing blocks between spawned instances", () => {
  it("lets identical shareable instances share one block; the lowest names it, and the last to leave releases it", () => {
    const { store, registry } = emptyStore();
    for (const index of [4, 7, 9]) {
      store.createInstance(spawned(PULSE, index));
      store.writeParam(index, "a", 1);
      store.shareInstance(index);
    }
    // Instance 4 keeps its slot and names the block; 7 and 9 joined it.
    expect([4, 7, 9].map((i) => store.blockOf(i))).toEqual([4, 4, 4]);
    expect([store.ownedParamBlocks, store.sharedParamBlocks]).toEqual([0, 1]);
    store.bindGroup(4);
    expect(store.bindGroup(7)).toBe(store.bindGroup(4));
    expect(registry.snapshot().liveBindGroups).toBe(1);

    // The instance that names the block leaves: the others keep the block, now named 7.
    store.removeInstance(4);
    expect([7, 9].map((i) => store.blockOf(i))).toEqual([7, 7]);
    expect([store.ownedParamBlocks, store.sharedParamBlocks]).toEqual([0, 1]);
    store.removeInstance(9);
    expect([store.ownedParamBlocks, store.sharedParamBlocks]).toEqual([1, 0]);
    store.removeInstance(7);
    expect([store.ownedParamBlocks, store.sharedParamBlocks]).toEqual([0, 0]);
    expect(registry.snapshot().liveBindGroups).toBe(0);
  });

  it("shares only identical bytes of one material, and never an instance that is not shareable", () => {
    const { store } = emptyStore();
    [1, 2, 1, 2].forEach((value, i) => {
      store.createInstance(spawned(PULSE, i));
      store.writeParam(i, "a", value);
      store.shareInstance(i);
    });
    expect([0, 1, 2, 3].map((i) => store.blockOf(i))).toEqual([0, 1, 0, 1]);
    expect([store.ownedParamBlocks, store.sharedParamBlocks]).toEqual([0, 2]);
    store.createInstance(spawned(PULSE, 4, false));
    store.writeParam(4, "a", 1);
    store.shareInstance(4);
    expect(store.blockOf(4)).toBe(4);
  });

  it("shares the bind group of instances with resources and no block, and releases it with the last", () => {
    const skin = material("src/main.mtek::Skin", null, [{ name: "map", kind: "texture", binding: 1 }]);
    const device = new FakeDevice();
    const registry = new ResourceRegistry(asGpu<RegistryDevice>(device));
    const plan = new BindingPlan(registry, FRAME, OBJECT);
    const store = new MaterialStore(asGpu<GPUDevice>(device), registry, plan, { instances: [] } as unknown as SceneStructure, writers());
    const instance = (index: number): ResolvedInstance => ({
      index,
      material: skin,
      entity: index,
      shareable: true,
      resources: [{ name: "map", kind: "texture", binding: 1, value: "texture.white" }],
    });
    store.createInstance(instance(3));
    store.createInstance(instance(4));
    store.shareInstance(3);
    store.shareInstance(4);
    expect(store.blockOf(4)).toBe(3);
    expect(store.bindGroup(4)).toBe(store.bindGroup(3));
    expect(registry.snapshot().liveBindGroups).toBe(1);
    store.removeInstance(3);
    expect(store.blockOf(4)).toBe(4);
    // The group was made for the shared block and still serves the remaining instance.
    expect(registry.snapshot().liveBindGroups).toBe(1);
    store.removeInstance(4);
    expect(registry.snapshot().liveBindGroups).toBe(0);
  });
});

describe("arenas and churn", () => {
  it("grows past its first capacity without losing a block", () => {
    const { store, device, queue } = emptyStore();
    for (let i = 0; i < 40; i += 1) {
      store.createInstance(spawned(PULSE, i, false));
      store.writeParam(i, "a", i + 1);
    }
    store.flush(queue);
    // 16 slots grew to 32, then 64.
    const buffer = pulseBuffer(device);
    expect(buffer?.size).toBe(64 * 256);
    const words = new Float32Array(buffer?.contents.buffer.slice(0, 64 * 256) ?? new ArrayBuffer(0));
    expect(Array.from({ length: 40 }, (_, slot) => words[(slot * 256) / 4])).toEqual(Array.from({ length: 40 }, (_, slot) => slot + 1));
  });

  it("returns to a steady state under churn: buffers and bind groups do not accumulate", () => {
    const { store, registry } = emptyStore();
    const live: number[] = [];
    const add = (index: number, value: number): void => {
      store.createInstance(spawned(PULSE, index));
      store.writeParam(index, "a", value);
      store.shareInstance(index);
      store.bindGroup(index);
    };
    // Ten instances alive, three distinct values.
    for (let i = 0; i < 10; i += 1) {
      add(i, i % 3);
      live.push(i);
    }
    const before = registry.snapshot();
    for (let cycle = 0; cycle < 200; cycle += 1) {
      const gone = live.shift() ?? 0;
      store.removeInstance(gone);
      add(gone, cycle % 3);
      live.push(gone);
    }
    const after = registry.snapshot();
    expect([after.liveBuffers, after.liveBindGroups]).toEqual([before.liveBuffers, before.liveBindGroups]);
    expect(store.instanceCount).toBe(10);
    // Values 0, 1, 2 give three blocks, all shared by several instances.
    expect([store.ownedParamBlocks, store.sharedParamBlocks]).toEqual([0, 3]);
    expect(after.liveBindGroups).toBe(3);
  });
});
