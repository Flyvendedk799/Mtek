import { describe, expect, it } from "vitest";
import type { MtekLayoutRecord } from "../abi/manifest-types.js";
import type { MtekWriterMemory } from "../abi/program.js";
import { ResourceRegistry, type RegistryDevice } from "../gpu/registry.js";
import type { LayoutWriters } from "../scene/program.js";
import type { ResolvedInstance, ResolvedMaterial, SceneStructure } from "../scene/structure.js";
import { FakeBindGroup, FakeBuffer, FakeDevice, asGpu } from "../test-support/fake-gpu.js";
import { MaterialStore } from "./materials.js";
import { BindingPlan } from "./pipelines.js";
import { SAMPLER_PRESETS } from "./resources.js";

const layout = (id: string, size: number): MtekLayoutRecord => ({ id, size }) as unknown as MtekLayoutRecord;

const FRAME = layout("builtin:frame", 288);
const OBJECT = layout("builtin:object", 128);
const PULSE_LAYOUT = layout("material:src/main.mtek::Pulse", 32);
const TINT_LAYOUT = layout("material:src/main.mtek::Tint", 16);

function material(id: string, index: number, blockLayout: MtekLayoutRecord | null, resources: ResolvedMaterial["resources"] = []): ResolvedMaterial {
  return { id, index, layout: blockLayout, shader: { hash: id } as unknown as ResolvedMaterial["shader"], params: [], resources };
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
  const instances: ResolvedInstance[] = materials.map((m, index) => ({ index, material: m, entity: index, shareable: false, resources: [] }));
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

describe("MaterialStore: textures and samplers (decision 0054)", () => {
  /** A material with one texture (binding 1) and one sampler (binding 2) after an optional block. */
  const RESOURCES: ResolvedMaterial["resources"] = [
    { name: "map", kind: "texture", binding: 1 },
    { name: "filter", kind: "sampler", binding: 2 },
  ];
  const TEXTURED = material("src/main.mtek::Textured", 3, PULSE_LAYOUT, RESOURCES);
  const SKIN = material("src/main.mtek::Skin", 4, null, RESOURCES);

  type Texture = "texture.white" | "texture.black";
  type Sampler = "sampler.linear_repeat" | "sampler.linear_clamp" | "sampler.nearest_repeat" | "sampler.nearest_clamp";
  type Values = ReadonlyArray<readonly [Texture, Sampler]>;

  function resourceInstances(materials: readonly ResolvedMaterial[], values: Values): ResolvedInstance[] {
    return materials.map((m, index) => {
      const [texture, sampler] = values[index] ?? (["texture.white", "sampler.linear_repeat"] as const);
      return {
        index,
        material: m,
        entity: index,
        shareable: false,
        resources: [
          { name: "map", kind: "texture", binding: 1, value: texture },
          { name: "filter", kind: "sampler", binding: 2, value: sampler },
        ],
      };
    });
  }

  function resourceHarness(materials: readonly ResolvedMaterial[], values: Values = [], textures?: ConstructorParameters<typeof MaterialStore>[5]) {
    const device = new FakeDevice();
    const registry = new ResourceRegistry(asGpu<RegistryDevice>(device));
    const plan = new BindingPlan(registry, FRAME, OBJECT);
    const structure = { instances: resourceInstances(materials, values) } as unknown as SceneStructure;
    const store = new MaterialStore(asGpu<GPUDevice>(device), registry, plan, structure, recordingWriters([PULSE_LAYOUT, TINT_LAYOUT], []), textures);
    return { device, registry, store, plan };
  }

  it("creates the built-in texture and sampler once, and shares them between instances", () => {
    const { device, registry } = resourceHarness([TEXTURED, SKIN, TEXTURED]);
    const counters = registry.snapshot();
    // One white texture and one sampler for three instances; the 1x1 texel is uploaded once.
    expect(counters.texturesAllocated).toBe(1);
    expect(counters.liveTextures).toBe(1);
    expect(counters.liveSamplers).toBe(1);
    expect(device.queue.textureWrites).toHaveLength(1);
    const texture = device.textures[0];
    expect(texture?.format).toBe("rgba8unorm-srgb");
    expect(texture?.width).toBe(1);
    expect([...(texture?.pixels ?? [])]).toEqual([255, 255, 255, 255]);
  });

  it("a black texture is opaque black and a different sampler preset is a different sampler", () => {
    const { device, registry } = resourceHarness(
      [TEXTURED, SKIN],
      [
        ["texture.black", "sampler.nearest_clamp"],
        ["texture.white", "sampler.linear_clamp"],
      ],
    );
    const counters = registry.snapshot();
    expect(counters.texturesAllocated).toBe(2);
    expect(counters.liveSamplers).toBe(2);
    expect([...(device.textures[0]?.pixels ?? [])]).toEqual([0, 0, 0, 255]);
  });

  it("describes the four sampler presets: nearest versus linear, repeat versus clamp", () => {
    expect(SAMPLER_PRESETS["sampler.nearest_repeat"]).toMatchObject({ magFilter: "nearest", minFilter: "nearest", addressModeU: "repeat", addressModeV: "repeat" });
    expect(SAMPLER_PRESETS["sampler.nearest_clamp"]).toMatchObject({ magFilter: "nearest", minFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    expect(SAMPLER_PRESETS["sampler.linear_repeat"]).toMatchObject({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
    expect(SAMPLER_PRESETS["sampler.linear_clamp"]).toMatchObject({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    expect(Object.keys(SAMPLER_PRESETS)).toHaveLength(4);
  });

  it("an instance with a block and resources has one bind group: the block at binding 0, then the resources", () => {
    const { store, registry } = resourceHarness([TEXTURED]);
    const group = store.bindGroup(0) as unknown as FakeBindGroup;
    expect(group.descriptor.entries.map((entry) => entry.binding)).toEqual([0, 1, 2]);
    expect(group.descriptor.entries[0]?.resource).toMatchObject({ offset: 0, size: PULSE_LAYOUT.size });
    expect(store.bindGroup(0)).toBe(group);
    expect(registry.snapshot().bindGroupsCreated).toBe(1);
  });

  it("an instance with resources and no block gets its own bind group, created once", () => {
    const { store, registry } = resourceHarness([SKIN, SKIN]);
    const first = store.bindGroup(0) as unknown as FakeBindGroup;
    const second = store.bindGroup(1) as unknown as FakeBindGroup;
    expect(first).not.toBe(second);
    expect(first.descriptor.entries.map((entry) => entry.binding)).toEqual([1, 2]);
    expect(store.bindGroup(0)).toBe(first);
    expect(registry.snapshot().bindGroupsCreated).toBe(2);
  });

  it("group-1 layouts depend on the block size and the resource kinds only, and are shared", () => {
    const { plan } = resourceHarness([TEXTURED]);
    expect(plan.material(PULSE_LAYOUT, RESOURCES)).toBe(plan.material(PULSE_LAYOUT, RESOURCES));
    expect(plan.material(PULSE_LAYOUT, RESOURCES)).not.toBe(plan.material(PULSE_LAYOUT));
    expect(plan.material(null, RESOURCES)).not.toBe(plan.material(null));
    expect(plan.pipelineLayout(null, RESOURCES)).toBe(plan.pipelineLayout(null, RESOURCES));
    const layout = plan.material(PULSE_LAYOUT, RESOURCES) as unknown as { descriptor: { entries: unknown[] } };
    expect(layout.descriptor.entries).toEqual([
      { binding: 0, visibility: 2, buffer: { type: "uniform", hasDynamicOffset: false, minBindingSize: 32 } },
      { binding: 1, visibility: 2, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
      { binding: 2, visibility: 2, sampler: { type: "filtering" } },
    ]);
  });

  it("a test texture replaces the pixels and the colour space of a built-in texture", () => {
    const data = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255]);
    const { device } = resourceHarness([TEXTURED], [], { "texture.white": { width: 2, height: 2, data } });
    const texture = device.textures[0];
    expect([texture?.width, texture?.height, texture?.format]).toEqual([2, 2, "rgba8unorm-srgb"]);
    expect([...(texture?.pixels ?? [])]).toEqual([...data]);
    const linear = resourceHarness([TEXTURED], [], { "texture.white": { width: 2, height: 2, data, colorSpace: "linear" } });
    expect(linear.device.textures[0]?.format).toBe("rgba8unorm");
  });

  it("rejects a test texture of the wrong size, name or colour space", () => {
    const bad = (textures: unknown) => () => resourceHarness([TEXTURED], [], textures as never);
    expect(bad({ "texture.white": { width: 2, height: 2, data: new Uint8Array(15) } })).toThrow("width x height x 4 = 16 bytes");
    expect(bad({ "texture.white": { width: 0, height: 2, data: new Uint8Array(0) } })).toThrow("positive integers");
    expect(bad({ "texture.pink": { width: 1, height: 1, data: new Uint8Array(4) } })).toThrow("'texture.pink' is not a built-in texture");
    expect(bad({ "texture.white": { width: 1, height: 1, data: new Uint8Array(4), colorSpace: "hdr" } })).toThrow('colorSpace must be "srgb" or "linear"');
  });

  it("dispose releases the textures, samplers and bind groups it made", () => {
    const { store, registry } = resourceHarness([TEXTURED, SKIN]);
    store.bindGroup(0);
    store.bindGroup(1);
    store.dispose();
    const counters = registry.snapshot();
    expect([counters.liveTextures, counters.liveSamplers, counters.liveBindGroups, counters.liveBuffers]).toEqual([0, 0, 0, 0]);
  });

  it("a scene without textures creates none", () => {
    const { registry } = harness([PULSE, PLAIN]);
    expect(registry.snapshot().texturesAllocated).toBe(0);
  });
});
