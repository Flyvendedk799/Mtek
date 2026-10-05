import { describe, expect, it } from "vitest";
import type { MtekLayoutRecord } from "../abi/manifest-types.js";
import type { MtekWriterMemory } from "../abi/program.js";
import { ResourceRegistry, type RegistryDevice } from "../gpu/registry.js";
import type { LayoutWriters } from "../scene/program.js";
import type { ResolvedInstance, ResolvedMaterial, SceneStructure } from "../scene/structure.js";
import { FakeBindGroup, FakeBuffer, FakeDevice, asGpu } from "../test-support/fake-gpu.js";
import { MaterialStore } from "./materials.js";
import { BindingPlan } from "./pipelines.js";

const layout = (id: string, size: number): MtekLayoutRecord => ({ id, size }) as unknown as MtekLayoutRecord;

const FRAME = layout("builtin:frame", 288);
const OBJECT = layout("builtin:object", 128);
const PULSE_LAYOUT = layout("material:src/main.mtek::Pulse", 32);
const TINT_LAYOUT = layout("material:src/main.mtek::Tint", 16);

function material(id: string, index: number, blockLayout: MtekLayoutRecord | null): ResolvedMaterial {
  return { id, index, layout: blockLayout, shader: { hash: id } as unknown as ResolvedMaterial["shader"], params: [] };
}

const PULSE = material("src/main.mtek::Pulse", 0, PULSE_LAYOUT);
const TINT = material("src/main.mtek::Tint", 1, TINT_LAYOUT);
const PLAIN = material("src/main.mtek::Plain", 2, null);

interface WriteCall {
  readonly layoutId: string;
  readonly field: string;
  readonly base: number;
  readonly value: unknown;
}

/** Writers that record their calls and store the value as one f32 at `base`, so the bytes are checkable. */
function recordingWriters(layouts: readonly MtekLayoutRecord[], calls: WriteCall[]): Map<string, LayoutWriters> {
  return new Map(
    layouts.map((record) => {
      const fields = new Map(
        ["a", "b"].map((field) => [
          field,
          (memory: MtekWriterMemory, base: number, value: unknown): void => {
            calls.push({ layoutId: record.id, field, base, value });
            memory.f32[(base >>> 2) + (field === "a" ? 0 : 1)] = value as number;
          },
        ]),
      );
      return [record.id, { all: () => undefined, fields }];
    }),
  );
}

function harness(materials: readonly ResolvedMaterial[], writerLayouts: readonly MtekLayoutRecord[] = [PULSE_LAYOUT, TINT_LAYOUT]) {
  const device = new FakeDevice();
  const registry = new ResourceRegistry(asGpu<RegistryDevice>(device));
  const plan = new BindingPlan(registry, FRAME, OBJECT);
  const instances: ResolvedInstance[] = materials.map((m, index) => ({ index, material: m, entity: index }));
  const structure = { instances } as unknown as SceneStructure;
  const calls: WriteCall[] = [];
  const store = new MaterialStore(asGpu<GPUDevice>(device), registry, plan, structure, recordingWriters(writerLayouts, calls));
  return { device, registry, store, calls, queue: asGpu<GPUQueue>(device.queue) };
}

function arenaBuffers(device: FakeDevice): FakeBuffer[] {
  return device.buffers.filter((buffer) => buffer.label?.startsWith("mtek:uniform-arena:material:") === true && !buffer.destroyed);
}

describe("MaterialStore: one arena per layout id", () => {
  it("shares an arena between instances of a layout and gives each layout its own, sized for its instances", () => {
    // Pulse, Tint, Pulse, Plain, Pulse: three instances of one layout, one of another, one without params.
    const { device, store } = harness([PULSE, TINT, PULSE, PLAIN, PULSE]);
    const buffers = arenaBuffers(device);
    expect(buffers.map((buffer) => buffer.label).sort()).toEqual([
      "mtek:uniform-arena:material:src/main.mtek::Pulse",
      "mtek:uniform-arena:material:src/main.mtek::Tint",
    ]);
    const pulse = buffers.find((buffer) => buffer.label?.endsWith("::Pulse"));
    const tint = buffers.find((buffer) => buffer.label?.endsWith("::Tint"));
    // Initial capacity is the instance count, so a static scene never grows its arena.
    expect(pulse?.size).toBe(3 * 256);
    expect(tint?.size).toBe(1 * 256);
    expect(store.ownedParamBlocks).toBe(4);
    expect(store.sharedParamBlocks).toBe(0);
  });

  it("two materials with different shaders but one layout id share the arena", () => {
    const otherShader = { ...PULSE, id: "src/main.mtek::PulseBlue", index: 3 };
    const { device, store } = harness([PULSE, otherShader]);
    expect(arenaBuffers(device)).toHaveLength(1);
    expect(store.ownedParamBlocks).toBe(2);
  });

  it("allocates nothing for scenes whose materials have no value params", () => {
    const { device, store } = harness([PLAIN, PLAIN]);
    expect(arenaBuffers(device)).toHaveLength(0);
    expect(store.ownedParamBlocks).toBe(0);
  });
});

describe("MaterialStore: generated writers are found by layout id", () => {
  it("writes an instance through the writers of its own layout, at its own slot", () => {
    const { store, calls, device, queue } = harness([PULSE, TINT, PULSE]);
    store.writeParam(0, "a", 1.5);
    store.writeParam(1, "b", 2.5);
    store.writeParam(2, "a", 3.5);
    expect(calls).toEqual([
      { layoutId: PULSE_LAYOUT.id, field: "a", base: 0, value: 1.5 },
      { layoutId: TINT_LAYOUT.id, field: "b", base: 0, value: 2.5 },
      // Writers fill a scratch block at base 0 (spec/gpu-layout.md 8.2: compare, then copy if different);
      // the slot decides where the bytes land, checked below.
      { layoutId: PULSE_LAYOUT.id, field: "a", base: 0, value: 3.5 },
    ]);

    expect(store.flush(queue)).toBe(3);
    const pulse = arenaBuffers(device).find((buffer) => buffer.label?.endsWith("::Pulse"));
    const bytes = new Float32Array(pulse?.contents.buffer.slice(0, 512) ?? new ArrayBuffer(0));
    // The second Pulse instance is slot 1 of the Pulse arena: one slot stride (256) further on.
    expect(bytes[0]).toBe(1.5);
    expect(bytes[256 / 4]).toBe(3.5);
  });

  it("uploads only the slots whose bytes changed", () => {
    const { store, queue } = harness([PULSE, PULSE]);
    store.writeParam(0, "a", 1);
    store.writeParam(1, "a", 2);
    expect(store.flush(queue)).toBe(2);
    store.writeParam(0, "a", 1); // same bytes: not dirty
    store.writeParam(1, "a", 5);
    expect(store.flush(queue)).toBe(1);
    expect(store.flush(queue)).toBe(0);
  });

  it("fails with an internal error naming the layout when the program has no writers for it", () => {
    expect(() => harness([PULSE, TINT], [PULSE_LAYOUT])).toThrow(`no writers for the layout '${TINT_LAYOUT.id}'`);
  });

  it("fails with an internal error for a field the layout does not have, and for an instance without value params", () => {
    const { store } = harness([PULSE, PLAIN]);
    expect(() => {
      store.writeParam(0, "nope", 1);
    }).toThrow(`the layout '${PULSE_LAYOUT.id}' has no field 'nope'`);
    expect(() => {
      store.writeParam(1, "a", 1);
    }).toThrow("material instance 1 has no value params");
    expect(() => {
      store.writeParam(9, "a", 1);
    }).toThrow("no material instance 9");
  });
});

describe("MaterialStore: bind groups per instance", () => {
  it("gives every instance its own static-offset bind group, cached after the first request", () => {
    const { store, registry } = harness([PULSE, TINT, PULSE]);
    const groups = [0, 1, 2].map((instance) => store.bindGroup(instance));
    expect(new Set(groups).size).toBe(3);
    const created = registry.snapshot().bindGroupsCreated;
    expect(created).toBe(3);

    const labels = groups.map((group) => (group as unknown as FakeBindGroup).descriptor.label);
    expect(labels).toEqual([`${PULSE_LAYOUT.id}#0`, `${TINT_LAYOUT.id}#0`, `${PULSE_LAYOUT.id}#1`]);
    // Static offsets: the second Pulse instance's group binds its slot's range of the shared buffer.
    const entry = (groups[2] as unknown as FakeBindGroup).descriptor.entries[0];
    expect(entry?.resource).toMatchObject({ offset: 256, size: PULSE_LAYOUT.size });

    expect([0, 1, 2].map((instance) => store.bindGroup(instance))).toEqual(groups);
    expect(registry.snapshot().bindGroupsCreated).toBe(created);
  });

  it("gives every instance of a material without value params the one shared empty group", () => {
    const { store, registry } = harness([PLAIN, PULSE, PLAIN]);
    expect(store.bindGroup(0)).toBe(store.bindGroup(2));
    expect(store.bindGroup(0)).not.toBe(store.bindGroup(1));
    // One empty group and one Pulse group.
    expect(registry.snapshot().bindGroupsCreated).toBe(2);
  });

  it("writing a param never creates a bind group", () => {
    const { store, registry, queue } = harness([PULSE]);
    store.bindGroup(0);
    const created = registry.snapshot().bindGroupsCreated;
    store.writeParam(0, "a", 7);
    store.flush(queue);
    expect(store.bindGroup(0)).toBe(store.bindGroup(0));
    expect(registry.snapshot().bindGroupsCreated).toBe(created);
  });
});
