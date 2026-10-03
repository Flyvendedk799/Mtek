import { describe, expect, it, vi } from "vitest";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { FakeBindGroup, FakeBuffer, FakeDevice, asGpu } from "../test-support/fake-gpu.js";
import { ResourceRegistry, type RegistryDevice } from "./registry.js";
import { UniformArena, roundUp, type BufferReplacedEvent } from "./uniform-arena.js";

const USAGE_UNIFORM = 0x40;
const USAGE_COPY_DST = 0x08;

interface Harness {
  fake: FakeDevice;
  registry: ResourceRegistry;
  queue: GPUQueue;
  failures: MtekDiagnostic[];
  layout: GPUBindGroupLayout;
  makeArena(
    size: number,
    options?: ConstructorParameters<typeof UniformArena>[3],
    id?: string,
  ): UniformArena;
}

function harness(limits: Record<string, number> = {}): Harness {
  const fake = new FakeDevice(limits);
  const failures: MtekDiagnostic[] = [];
  const registry = new ResourceRegistry(asGpu<RegistryDevice>(fake), { onAllocationFailure: (d) => failures.push(d) });
  const layout = registry.createBindGroupLayout({ entries: [] });
  return {
    fake,
    registry,
    queue: asGpu<GPUQueue>(fake.queue),
    failures,
    layout,
    makeArena: (size, options, id = "material:test::Mat") =>
      new UniformArena(asGpu<GPUDevice>(fake), registry, { id, size }, options),
  };
}

function bufferOf(b: GPUBuffer): FakeBuffer {
  return b as unknown as FakeBuffer;
}

function groupOf(g: GPUBindGroup): FakeBindGroup {
  return g as unknown as FakeBindGroup;
}

/** Writes `value` into word `word` of the slot's block through the mirror and marks the slot dirty. */
function poke(arena: UniformArena, slot: number, word: number, value: number): void {
  arena.views.u32[(arena.slotOffset(slot) >>> 2) + word] = value;
  arena.markDirty(slot);
}

describe("roundUp", () => {
  it("rounds up to a multiple", () => {
    expect(roundUp(16, 0)).toBe(0);
    expect(roundUp(16, 1)).toBe(16);
    expect(roundUp(16, 16)).toBe(16);
    expect(roundUp(256, 288)).toBe(512);
    expect(roundUp(64, 288)).toBe(320);
  });

  it("rejects a non-positive alignment", () => {
    expect(() => roundUp(0, 4)).toThrow(RangeError);
  });
});

describe("slot stride", () => {
  const cases: Array<[alignment: number, size: number, stride: number]> = [
    [256, 4, 256],
    [256, 16, 256],
    [256, 64, 256],
    [256, 288, 512],
    [64, 4, 64],
    [64, 16, 64],
    [64, 64, 64],
    [64, 288, 320],
  ];
  it.each(cases)("alignment %i, block size %i gives stride %i", (alignment, size, stride) => {
    const h = harness({ minUniformBufferOffsetAlignment: alignment });
    const arena = h.makeArena(size);
    expect(arena.slotStride).toBe(stride);
    expect(arena.size).toBe(size);
  });

  it("uses the queried device limit (default 256)", () => {
    expect(harness().makeArena(16).slotStride).toBe(256);
  });
});

describe("construction", () => {
  it("creates a UNIFORM|COPY_DST buffer for 16 slots and a zeroed mirror of the same size", () => {
    const h = harness();
    const arena = h.makeArena(64, undefined, "material:test::Pulse");
    expect(arena.capacity).toBe(16);
    const buffer = bufferOf(arena.buffer);
    expect(buffer.size).toBe(16 * 256);
    expect(buffer.usage).toBe(USAGE_UNIFORM | USAGE_COPY_DST);
    expect(buffer.label).toContain("material:test::Pulse");
    expect(arena.views.f32.buffer.byteLength).toBe(16 * 256);
    expect(arena.views.f32.every((v) => v === 0)).toBe(true);
    expect(h.registry.snapshot().buffersAllocated).toBe(1);
    expect(h.registry.snapshot().liveBuffers).toBe(1);
    expect(arena.id).toBe("material:test::Pulse");
  });

  it("honours initialCapacity", () => {
    expect(harness().makeArena(16, { initialCapacity: 4 }).capacity).toBe(4);
  });

  it("rejects invalid sizes and capacities", () => {
    const h = harness();
    expect(() => h.makeArena(0)).toThrow(RangeError);
    expect(() => h.makeArena(6)).toThrow(RangeError);
    expect(() => h.makeArena(16, { initialCapacity: 0 })).toThrow(RangeError);
    expect(() => h.makeArena(65536 + 16)).toThrow(/maxUniformBufferBindingSize/);
  });

  it("exposes views over one ArrayBuffer", () => {
    const arena = harness().makeArena(16);
    const { f32, u32, i32 } = arena.views;
    expect(u32.buffer).toBe(f32.buffer);
    expect(i32.buffer).toBe(f32.buffer);
    f32[0] = 1;
    expect(u32[0]).toBe(0x3f800000);
    i32[1] = -1;
    expect(u32[1]).toBe(0xffffffff);
  });
});

describe("allocate and release", () => {
  it("hands out the lowest free index first", () => {
    const arena = harness().makeArena(16);
    expect([arena.allocate(), arena.allocate(), arena.allocate()]).toEqual([0, 1, 2]);
    arena.release(1);
    expect(arena.allocate()).toBe(1);
    arena.release(0);
    arena.release(2);
    expect(arena.allocate()).toBe(0);
    expect(arena.allocate()).toBe(2);
    expect(arena.allocate()).toBe(3);
  });

  it("computes slot offsets as slot x stride", () => {
    const arena = harness({ minUniformBufferOffsetAlignment: 64 }).makeArena(288);
    expect(arena.slotOffset(0)).toBe(0);
    expect(arena.slotOffset(3)).toBe(3 * 320);
  });

  it("zero-fills the slot's mirror bytes on release, leaving neighbours alone", () => {
    const arena = harness().makeArena(64);
    const a = arena.allocate();
    const b = arena.allocate();
    arena.views.f32.fill(1.5, arena.slotOffset(a) >>> 2, (arena.slotOffset(a) + arena.slotStride) >>> 2);
    arena.views.f32.fill(2.5, arena.slotOffset(b) >>> 2, (arena.slotOffset(b) + arena.slotStride) >>> 2);
    arena.release(a);
    const bytes = new Uint8Array(arena.views.f32.buffer);
    expect(bytes.subarray(0, arena.slotStride).every((v) => v === 0)).toBe(true);
    expect(bytes.subarray(arena.slotStride, 2 * arena.slotStride).every((v) => v === 0)).toBe(false);
  });

  it("rejects releasing a free or out-of-range slot", () => {
    const arena = harness().makeArena(16);
    const s = arena.allocate();
    arena.release(s);
    expect(() => arena.release(s)).toThrow(/not allocated/);
    expect(() => arena.release(99)).toThrow(RangeError);
    expect(() => arena.release(-1)).toThrow(RangeError);
  });

  it("rejects operations on free slots", () => {
    const arena = harness().makeArena(16);
    expect(() => arena.markDirty(0)).toThrow(/not allocated/);
    expect(() => arena.writeIfChanged(0, () => undefined)).toThrow(/not allocated/);
  });

  it("counts live slots", () => {
    const arena = harness().makeArena(16);
    arena.allocate();
    const s = arena.allocate();
    expect(arena.liveSlots).toBe(2);
    arena.release(s);
    expect(arena.liveSlots).toBe(1);
  });
});

describe("flush", () => {
  it("uploads each dirty slot once, covering only `size` bytes, ascending", () => {
    const h = harness();
    const arena = h.makeArena(64);
    const slots = [arena.allocate(), arena.allocate(), arena.allocate()];
    h.fake.queue.writes.length = 0;
    // Allocation dirties the slot; flush everything first, then dirty slots 2 and 0 in that order.
    arena.flush(h.queue);
    h.fake.queue.writes.length = 0;
    poke(arena, 2, 0, 0xdeadbeef);
    poke(arena, 0, 3, 7);
    poke(arena, 2, 1, 9); // same slot twice -> still one upload
    arena.flush(h.queue);
    expect(slots).toEqual([0, 1, 2]);
    expect(h.fake.queue.writes.map((w) => [w.bufferOffset, w.size])).toEqual([
      [0, 64],
      [2 * 256, 64],
    ]);
    const gpu = bufferOf(arena.buffer).contents;
    const view = new DataView(gpu.buffer, gpu.byteOffset, gpu.byteLength);
    expect(view.getUint32(2 * 256, true)).toBe(0xdeadbeef);
    expect(view.getUint32(2 * 256 + 4, true)).toBe(9);
    expect(view.getUint32(3 * 4, true)).toBe(7);
  });

  it("updates uploads and uploadBytes and clears the dirty flags", () => {
    const h = harness();
    const arena = h.makeArena(288);
    arena.allocate();
    arena.allocate();
    const before = h.registry.snapshot();
    expect(arena.flush(h.queue)).toBe(2);
    const after = h.registry.snapshot();
    expect(after.uploads - before.uploads).toBe(2);
    expect(after.uploadBytes - before.uploadBytes).toBe(2 * 288);
    expect(arena.dirtySlotCount).toBe(0);
    expect(arena.flush(h.queue)).toBe(0);
    expect(h.registry.snapshot().uploads).toBe(after.uploads);
  });

  it("only issues writeBuffer calls whose offsets and sizes are multiples of 4 (the fake enforces the real contract)", () => {
    const h = harness({ minUniformBufferOffsetAlignment: 64 });
    const arena = h.makeArena(20);
    for (let i = 0; i < 5; i++) arena.allocate();
    expect(() => arena.flush(h.queue)).not.toThrow();
    for (const w of h.fake.queue.writes) {
      expect(w.bufferOffset % 4).toBe(0);
      expect(w.size % 4).toBe(0);
    }
  });

  it("marks a newly allocated slot dirty so stale GPU bytes of a recycled slot are overwritten with zeros", () => {
    const h = harness();
    const arena = h.makeArena(16);
    const s = arena.allocate();
    poke(arena, s, 0, 0x11223344);
    arena.flush(h.queue);
    expect(bufferOf(arena.buffer).contents[s * 256]).toBe(0x44);
    arena.release(s);
    expect(arena.isDirty(s)).toBe(false); // free slots are never uploaded
    const again = arena.allocate();
    expect(again).toBe(s);
    expect(arena.isDirty(again)).toBe(true);
    arena.flush(h.queue);
    expect(bufferOf(arena.buffer).contents.subarray(s * 256, s * 256 + 16).every((v) => v === 0)).toBe(true);
  });
});

describe("writeIfChanged", () => {
  it("copies and marks dirty when the bytes differ", () => {
    const h = harness();
    const arena = h.makeArena(32);
    const s = arena.allocate();
    arena.flush(h.queue);
    const changed = arena.writeIfChanged(s, (m, base) => {
      m.f32[(base >>> 2) + 1] = 2.5;
    });
    expect(changed).toBe(true);
    expect(arena.isDirty(s)).toBe(true);
    expect(arena.views.f32[(arena.slotOffset(s) >>> 2) + 1]).toBe(2.5);
  });

  it("skips identical bytes: no mirror change, no dirty flag, no upload", () => {
    const h = harness();
    const arena = h.makeArena(32);
    const s = arena.allocate();
    arena.writeIfChanged(s, (m, base) => {
      m.f32[(base >>> 2) + 1] = 2.5;
    });
    arena.flush(h.queue);
    const uploads = h.registry.snapshot().uploads;
    const changed = arena.writeIfChanged(s, (m, base) => {
      m.f32[(base >>> 2) + 1] = 2.5;
    });
    expect(changed).toBe(false);
    expect(arena.isDirty(s)).toBe(false);
    arena.flush(h.queue);
    expect(h.registry.snapshot().uploads).toBe(uploads);
  });

  it("gives the writer a scratch block at base 0 that starts as a copy of the slot, so partial field writers keep other fields", () => {
    const arena = harness().makeArena(32);
    const s = arena.allocate();
    arena.writeIfChanged(s, (m, base) => {
      expect(base).toBe(0);
      m.u32[0] = 1;
      m.u32[1] = 2;
    });
    arena.writeIfChanged(s, (m) => {
      expect(m.u32[0]).toBe(1);
      m.u32[1] = 3;
    });
    const base = arena.slotOffset(s) >>> 2;
    expect([arena.views.u32[base], arena.views.u32[base + 1]]).toEqual([1, 3]);
  });

  it("does not touch the mirror while the writer runs (a throwing writer leaves the slot unchanged)", () => {
    const arena = harness().makeArena(16);
    const s = arena.allocate();
    arena.writeIfChanged(s, (m) => {
      m.u32[0] = 5;
    });
    expect(() =>
      arena.writeIfChanged(s, (m) => {
        m.u32[0] = 6;
        throw new Error("writer failed");
      }),
    ).toThrow("writer failed");
    expect(arena.views.u32[arena.slotOffset(s) >>> 2]).toBe(5);
  });

  it("compares bits, so identical NaN payloads count as unchanged and -0 differs from +0", () => {
    const arena = harness().makeArena(16);
    const s = arena.allocate();
    const writeNan = (m: { u32: Uint32Array }): void => {
      m.u32[0] = 0x7fc00001;
    };
    expect(arena.writeIfChanged(s, writeNan)).toBe(true);
    expect(arena.writeIfChanged(s, writeNan)).toBe(false);
    arena.writeIfChanged(s, (m) => {
      m.f32[0] = 0;
    });
    expect(
      arena.writeIfChanged(s, (m) => {
        m.f32[0] = -0;
      }),
    ).toBe(true);
  });
});

describe("growth", () => {
  function fill(arena: UniformArena, slots: number[]): void {
    for (const s of slots) {
      const base = arena.slotOffset(s) >>> 2;
      arena.views.u32[base] = 0x1000 + s;
      arena.views.u32[base + 3] = 0x2000 + s;
      arena.markDirty(s);
    }
  }

  it("doubles capacity when full, preserving every slot's bytes in the mirror and on the GPU", () => {
    const h = harness();
    const arena = h.makeArena(16, { initialCapacity: 2 });
    const first = arena.allocate();
    const second = arena.allocate();
    fill(arena, [first, second]);
    arena.flush(h.queue);
    const oldBuffer = arena.buffer;

    const third = arena.allocate();
    expect(third).toBe(2);
    expect(arena.capacity).toBe(4);
    expect(arena.buffer).not.toBe(oldBuffer);
    expect(bufferOf(arena.buffer).size).toBe(4 * 256);
    for (const s of [first, second]) {
      expect(arena.views.u32[(arena.slotOffset(s) >>> 2)]).toBe(0x1000 + s);
      expect(arena.views.u32[(arena.slotOffset(s) >>> 2) + 3]).toBe(0x2000 + s);
      const gpu = bufferOf(arena.buffer).contents;
      const view = new DataView(gpu.buffer, gpu.byteOffset, gpu.byteLength);
      expect(view.getUint32(s * 256, true)).toBe(0x1000 + s);
      expect(view.getUint32(s * 256 + 12, true)).toBe(0x2000 + s);
    }
    expect(arena.views.f32.buffer.byteLength).toBe(4 * 256);
  });

  it("uploads the whole mirror to the new buffer in one write and leaves nothing dirty", () => {
    const h = harness();
    const arena = h.makeArena(16, { initialCapacity: 2 });
    fill(arena, [arena.allocate(), arena.allocate()]); // dirty, not yet flushed
    h.fake.queue.writes.length = 0;
    const before = h.registry.snapshot();
    arena.allocate();
    expect(h.fake.queue.writes).toHaveLength(1);
    expect(h.fake.queue.writes[0]).toMatchObject({ bufferOffset: 0, size: 4 * 256 });
    expect(h.fake.queue.writes[0]?.buffer).toBe(bufferOf(arena.buffer));
    expect(arena.flush(h.queue)).toBe(1); // only the newly allocated slot 2 is dirty
    const after = h.registry.snapshot();
    expect(after.uploadBytes - before.uploadBytes).toBe(4 * 256 + 16);
    // The not-yet-flushed data reached the new buffer through the whole-mirror upload.
    const gpu = bufferOf(arena.buffer).contents;
    expect(new DataView(gpu.buffer, gpu.byteOffset).getUint32(256, true)).toBe(0x1001);
  });

  it("keeps doubling: 16 -> 32 -> 64 with all 40 slots intact", () => {
    const h = harness();
    const arena = h.makeArena(16);
    const slots: number[] = [];
    for (let i = 0; i < 40; i++) slots.push(arena.allocate());
    expect(slots).toEqual([...slots.keys()]);
    expect(arena.capacity).toBe(64);
  });

  it("notifies onBufferReplaced listeners before the old buffer is destroyed, then destroys it through the registry", () => {
    const h = harness();
    const arena = h.makeArena(16, { initialCapacity: 1 });
    arena.allocate();
    const oldBuffer = arena.buffer;
    const seen: BufferReplacedEvent[] = [];
    let oldWasDestroyedDuringListener: boolean | undefined;
    let liveBuffersDuringListener: number | undefined;
    arena.onBufferReplaced((e) => {
      seen.push(e);
      h.fake.events.push("listener");
      oldWasDestroyedDuringListener = bufferOf(e.oldBuffer).destroyed;
      liveBuffersDuringListener = h.registry.snapshot().liveBuffers;
    });
    arena.allocate();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.oldBuffer).toBe(oldBuffer);
    expect(seen[0]?.newBuffer).toBe(arena.buffer);
    expect(seen[0]?.capacity).toBe(2);
    expect(oldWasDestroyedDuringListener).toBe(false);
    expect(liveBuffersDuringListener).toBe(2);
    expect(bufferOf(oldBuffer).destroyed).toBe(true);
    const order = h.fake.events.filter((e) => e === "listener" || e.startsWith("destroy:"));
    expect(order[0]).toBe("listener");
    expect(order[1]).toMatch(/^destroy:/);
    expect(h.registry.snapshot().liveBuffers).toBe(1);
    expect(h.registry.snapshot().buffersAllocated).toBe(2);
  });

  it("lets a listener rebuild bind groups against the new buffer (the old one is still valid at that point)", () => {
    const h = harness();
    const arena = h.makeArena(16, { initialCapacity: 1 });
    const slot = arena.allocate();
    const rebuilt: GPUBindGroup[] = [];
    arena.onBufferReplaced(() => {
      rebuilt.push(arena.bindGroupForSlot(slot, h.layout));
    });
    arena.allocate();
    expect(rebuilt).toHaveLength(1);
    const [group] = rebuilt;
    expect(group).toBeDefined();
    expect(groupOf(group as GPUBindGroup).descriptor.entries[0]?.resource.buffer).toBe(bufferOf(arena.buffer));
    expect(arena.bindGroupForSlot(slot, h.layout)).toBe(group);
  });

  it("invalidates cached bind groups: new objects referencing the new buffer, old ones released", () => {
    const h = harness();
    const arena = h.makeArena(16, { initialCapacity: 1 });
    const slot = arena.allocate();
    const stale = arena.bindGroupForSlot(slot, h.layout);
    expect(arena.bindGroupForSlot(slot, h.layout)).toBe(stale);
    expect(h.registry.snapshot().liveBindGroups).toBe(1);
    const oldBuffer = arena.buffer;

    arena.allocate(); // growth

    const fresh = arena.bindGroupForSlot(slot, h.layout);
    expect(fresh).not.toBe(stale);
    expect(groupOf(stale).descriptor.entries[0]?.resource.buffer).toBe(bufferOf(oldBuffer));
    expect(groupOf(fresh).descriptor.entries[0]?.resource.buffer).toBe(bufferOf(arena.buffer));
    expect(bufferOf(oldBuffer).destroyed).toBe(true);
    expect(h.registry.snapshot().liveBindGroups).toBe(1);
    expect(h.registry.snapshot().bindGroupsCreated).toBe(2);
  });

  it("invalidates the dynamic-offset bind group as well", () => {
    const h = harness();
    const arena = h.makeArena(16, { initialCapacity: 1, dynamicOffset: true });
    arena.allocate();
    const stale = arena.bindGroupDynamic(h.layout);
    arena.allocate();
    const fresh = arena.bindGroupDynamic(h.layout);
    expect(fresh).not.toBe(stale);
    expect(groupOf(fresh).descriptor.entries[0]?.resource.buffer).toBe(bufferOf(arena.buffer));
  });

  it("replaces the views object (consumers must not cache views across growth)", () => {
    const arena = harness().makeArena(16, { initialCapacity: 1 });
    arena.allocate();
    const before = arena.views;
    arena.allocate();
    expect(arena.views).not.toBe(before);
  });

  it("destroys the old buffer even if a listener throws, and propagates the error", () => {
    const h = harness();
    const arena = h.makeArena(16, { initialCapacity: 1 });
    arena.allocate();
    const oldBuffer = arena.buffer;
    arena.onBufferReplaced(() => {
      throw new Error("listener failed");
    });
    expect(() => arena.allocate()).toThrow("listener failed");
    expect(bufferOf(oldBuffer).destroyed).toBe(true);
    expect(arena.capacity).toBe(2);
  });

  it("supports unsubscribing a listener", () => {
    const arena = harness().makeArena(16, { initialCapacity: 1 });
    arena.allocate();
    const listener = vi.fn();
    const off = arena.onBufferReplaced(listener);
    off();
    arena.allocate();
    expect(listener).not.toHaveBeenCalled();
  });

  it("refuses to grow past maxBufferSize: reports E8063, throws, and leaves the arena usable", () => {
    const h = harness({ maxBufferSize: 512 });
    const arena = h.makeArena(16, { initialCapacity: 2 }); // 2 x 256 = 512, the limit
    arena.allocate();
    arena.allocate();
    const buffer = arena.buffer;
    expect(() => arena.allocate()).toThrow(RangeError);
    expect(h.failures.map((f) => f.code)).toEqual(["MTEK-E8063"]);
    expect(arena.buffer).toBe(buffer);
    expect(arena.capacity).toBe(2);
    expect(arena.liveSlots).toBe(2);
    arena.release(0);
    expect(arena.allocate()).toBe(0);
  });

  it("rejects an initial capacity beyond maxBufferSize", () => {
    const h = harness({ maxBufferSize: 256 });
    expect(() => h.makeArena(16, { initialCapacity: 2 })).toThrow(RangeError);
    expect(h.failures.map((f) => f.code)).toEqual(["MTEK-E8063"]);
  });
});

describe("static-offset bind groups", () => {
  it("binds { buffer, offset: slot x stride, size } at binding 0 and caches per (layout, slot)", () => {
    const h = harness();
    const arena = h.makeArena(64);
    arena.allocate();
    const slot = arena.allocate();
    const group = arena.bindGroupForSlot(slot, h.layout);
    expect(groupOf(group).descriptor.layout).toBe(h.layout);
    expect(groupOf(group).descriptor.entries).toEqual([
      { binding: 0, resource: { buffer: bufferOf(arena.buffer), offset: 256, size: 64 } },
    ]);
    expect(arena.bindGroupForSlot(slot, h.layout)).toBe(group);
    const otherLayout = h.registry.createBindGroupLayout({ entries: [] });
    expect(arena.bindGroupForSlot(slot, otherLayout)).not.toBe(group);
    expect(arena.bindGroupForSlot(0, h.layout)).not.toBe(group);
  });

  it("honours the binding option", () => {
    const h = harness();
    const arena = h.makeArena(16, { binding: 3 });
    const s = arena.allocate();
    expect(groupOf(arena.bindGroupForSlot(s, h.layout)).descriptor.entries[0]?.binding).toBe(3);
  });

  it("drops a slot's cached bind groups when the slot is released", () => {
    const h = harness();
    const arena = h.makeArena(16);
    const s = arena.allocate();
    arena.bindGroupForSlot(s, h.layout);
    expect(h.registry.snapshot().liveBindGroups).toBe(1);
    arena.release(s);
    expect(h.registry.snapshot().liveBindGroups).toBe(0);
  });

  it("is unavailable in dynamic-offset mode", () => {
    const h = harness();
    const arena = h.makeArena(16, { dynamicOffset: true });
    const s = arena.allocate();
    expect(() => arena.bindGroupForSlot(s, h.layout)).toThrow(/dynamic/);
  });
});

describe("dynamic-offset bind group", () => {
  it("binds the whole arena at offset 0 with size = block size, cached per layout", () => {
    const h = harness();
    const arena = h.makeArena(128, { dynamicOffset: true });
    const group = arena.bindGroupDynamic(h.layout);
    expect(groupOf(group).descriptor.entries).toEqual([
      { binding: 0, resource: { buffer: bufferOf(arena.buffer), offset: 0, size: 128 } },
    ]);
    expect(arena.bindGroupDynamic(h.layout)).toBe(group);
    expect(h.registry.snapshot().bindGroupsCreated).toBe(1);
  });

  it("is unavailable in static-offset mode", () => {
    const h = harness();
    expect(() => h.makeArena(16).bindGroupDynamic(h.layout)).toThrow(/static/);
  });
});

describe("dispose", () => {
  it("releases the buffer and cached bind groups and stops further use", () => {
    const h = harness();
    const arena = h.makeArena(16);
    const s = arena.allocate();
    arena.bindGroupForSlot(s, h.layout);
    const buffer = arena.buffer;
    arena.dispose();
    expect(bufferOf(buffer).destroyed).toBe(true);
    expect(h.registry.snapshot().liveBuffers).toBe(0);
    expect(h.registry.snapshot().liveBindGroups).toBe(0);
    expect(() => arena.allocate()).toThrow(/disposed/);
    expect(() => arena.dispose()).not.toThrow();
  });
});
