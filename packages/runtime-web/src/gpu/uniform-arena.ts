import type { ResourceRegistry } from "./registry.js";

/** Rounds `value` up to the next multiple of `alignment` (`alignment` must be a positive integer). */
export function roundUp(alignment: number, value: number): number {
  if (!Number.isInteger(alignment) || alignment <= 0) {
    throw new RangeError(`roundUp: alignment must be a positive integer, got ${String(alignment)}`);
  }
  return Math.ceil(value / alignment) * alignment;
}

/** The part of `GPUDevice` an arena reads. */
export type ArenaDevice = Pick<GPUDevice, "limits" | "queue">;

/** The block layout an arena stores: `size` comes from the layout record (`spec/gpu-layout.md` section 5). */
export interface UniformArenaLayout {
  /** Layout id, e.g. `material:src/main.mtek::Pulse`; used in buffer labels and diagnostics. */
  readonly id: string;
  /** Block size in bytes (a multiple of 4; layout records give multiples of 16). */
  readonly size: number;
}

export interface UniformArenaOptions {
  /** Initial number of slots. Default 16. */
  readonly initialCapacity?: number;
  /**
   * Dynamic-offset mode: one bind group per arena buffer (`bindGroupDynamic`), the slot chosen per draw
   * through the dynamic offset `slotOffset(slot)`. Default: static offsets (`bindGroupForSlot`).
   */
  readonly dynamicOffset?: boolean;
  /** Binding index of the block in the bind groups this arena creates. Default 0 (`spec/gpu-layout.md` section 6). */
  readonly binding?: number;
}

/** Typed views over one `ArrayBuffer`: the `m` argument of the generated writers (`spec/gpu-layout.md` section 7). */
export interface ArenaViews {
  readonly f32: Float32Array;
  readonly u32: Uint32Array;
  readonly i32: Int32Array;
}

/** A generated writer call: write the block's fields at byte offset `base` (a multiple of 4) of `views`. */
export type ArenaWriter = (views: ArenaViews, base: number) => void;

export interface BufferReplacedEvent {
  /** Still alive while listeners run; destroyed right after the last listener returned. */
  readonly oldBuffer: GPUBuffer;
  readonly newBuffer: GPUBuffer;
  /** The new capacity in slots. */
  readonly capacity: number;
}

const USAGE_COPY_DST = 0x08;
const USAGE_UNIFORM = 0x40;
const DEFAULT_INITIAL_CAPACITY = 16;

function makeViews(buffer: ArrayBuffer): ArenaViews {
  return { f32: new Float32Array(buffer), u32: new Uint32Array(buffer), i32: new Int32Array(buffer) };
}

/**
 * Owns the GPU buffer, the authoritative CPU mirror, the slots and the uploads of one uniform block
 * layout (`spec/gpu-layout.md` section 8.1 and 8.2).
 *
 * Slots are handed out lowest index first. Writes go to the mirror (`views`, `writeIfChanged`) and mark
 * the slot dirty; `flush` uploads every dirty slot's `size` bytes with one `writeBuffer` each. Growth
 * doubles the capacity eagerly inside `allocate()`, so the owner of the bind groups is told through
 * `onBufferReplaced` before the current frame's encoding begins.
 */
export class UniformArena {
  readonly id: string;
  /** Block size in bytes. */
  readonly size: number;
  /** Distance between slots: block size rounded up to 16 and to the device's `minUniformBufferOffsetAlignment`. */
  readonly slotStride: number;
  readonly dynamicOffset: boolean;

  private readonly device: ArenaDevice;
  private readonly registry: ResourceRegistry;
  private readonly binding: number;
  private readonly maxBufferSize: number;

  private gpuBuffer: GPUBuffer;
  private mirror: ArrayBuffer;
  private mirrorViews: ArenaViews;
  private slotCapacity: number;
  private used: Uint8Array;
  private dirty: Uint8Array;
  private dirtySlots: number[] = [];
  private nextFree = 0;
  private liveSlotCount = 0;
  private disposed = false;

  private readonly scratch: ArenaViews;
  private readonly scratchBytes: Uint8Array;

  private readonly staticGroups = new Map<GPUBindGroupLayout, Map<number, GPUBindGroup>>();
  private readonly dynamicGroups = new Map<GPUBindGroupLayout, GPUBindGroup>();
  private readonly replacedListeners = new Set<(event: BufferReplacedEvent) => void>();

  constructor(device: ArenaDevice, registry: ResourceRegistry, layout: UniformArenaLayout, options: UniformArenaOptions = {}) {
    const { size } = layout;
    if (!Number.isInteger(size) || size <= 0 || size % 4 !== 0) {
      throw new RangeError(`UniformArena '${layout.id}': block size must be a positive multiple of 4, got ${String(size)}`);
    }
    const maxBinding = device.limits.maxUniformBufferBindingSize;
    if (size > maxBinding) {
      throw new RangeError(
        `UniformArena '${layout.id}': block size ${String(size)} exceeds the device limit maxUniformBufferBindingSize (${String(maxBinding)})`,
      );
    }
    const capacity = options.initialCapacity ?? DEFAULT_INITIAL_CAPACITY;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`UniformArena '${layout.id}': initialCapacity must be a positive integer, got ${String(capacity)}`);
    }

    this.id = layout.id;
    this.size = size;
    this.device = device;
    this.registry = registry;
    this.dynamicOffset = options.dynamicOffset ?? false;
    this.binding = options.binding ?? 0;
    this.maxBufferSize = device.limits.maxBufferSize;
    this.slotStride = roundUp(device.limits.minUniformBufferOffsetAlignment, roundUp(16, size));

    this.slotCapacity = capacity;
    this.checkBufferSize(capacity);
    this.gpuBuffer = this.createGpuBuffer(capacity);
    this.mirror = new ArrayBuffer(capacity * this.slotStride);
    this.mirrorViews = makeViews(this.mirror);
    this.used = new Uint8Array(capacity);
    this.dirty = new Uint8Array(capacity);

    const scratchBuffer = new ArrayBuffer(size);
    this.scratch = makeViews(scratchBuffer);
    this.scratchBytes = new Uint8Array(scratchBuffer);
  }

  /** Current capacity in slots. */
  get capacity(): number {
    return this.slotCapacity;
  }

  /** The current GPU buffer. Changes on growth: do not cache it across `onBufferReplaced`. */
  get buffer(): GPUBuffer {
    return this.gpuBuffer;
  }

  /**
   * Typed views over the CPU mirror. The object (and its `ArrayBuffer`) is replaced on growth, so read
   * `views` again after every `allocate()` instead of caching it.
   */
  get views(): ArenaViews {
    return this.mirrorViews;
  }

  /** Number of allocated slots. */
  get liveSlots(): number {
    return this.liveSlotCount;
  }

  get dirtySlotCount(): number {
    return this.dirtySlots.length;
  }

  isDirty(slot: number): boolean {
    this.checkRange(slot);
    return this.dirty[slot] === 1;
  }

  /** Byte offset of a slot in the buffer and in the mirror; also the dynamic offset in dynamic-offset mode. */
  slotOffset(slot: number): number {
    this.checkRange(slot);
    return slot * this.slotStride;
  }

  /**
   * Returns the lowest free slot index, growing the arena first if every slot is taken. The slot's
   * mirror bytes are zero; it is marked dirty so the GPU copy of a recycled slot is overwritten too.
   */
  allocate(): number {
    this.checkLive();
    let slot = this.nextFree;
    while (slot < this.slotCapacity && this.used[slot] === 1) slot += 1;
    if (slot >= this.slotCapacity) {
      this.grow();
      // Growth keeps every used slot; the first new slot is the lowest free one.
      slot = this.slotCapacity / 2;
    }
    this.used[slot] = 1;
    this.liveSlotCount += 1;
    this.nextFree = slot + 1;
    this.markDirty(slot);
    return slot;
  }

  /** Frees a slot: zero-fills its mirror bytes (padding stays zero for deterministic comparison) and drops its cached bind groups. */
  release(slot: number): void {
    this.checkLive();
    this.checkRange(slot);
    if (this.used[slot] !== 1) throw new Error(`UniformArena '${this.id}': slot ${String(slot)} is not allocated`);
    new Uint8Array(this.mirror, slot * this.slotStride, this.slotStride).fill(0);
    this.used[slot] = 0;
    this.liveSlotCount -= 1;
    if (slot < this.nextFree) this.nextFree = slot;
    if (this.dirty[slot] === 1) {
      this.dirty[slot] = 0;
      const index = this.dirtySlots.indexOf(slot);
      if (index >= 0) this.dirtySlots.splice(index, 1);
    }
    for (const bySlot of this.staticGroups.values()) {
      const group = bySlot.get(slot);
      if (group !== undefined) {
        bySlot.delete(slot);
        this.registry.release(group);
      }
    }
  }

  /** Marks an allocated slot for upload at the next `flush`. */
  markDirty(slot: number): void {
    this.checkLive();
    this.checkAllocated(slot);
    if (this.dirty[slot] === 0) {
      this.dirty[slot] = 1;
      this.dirtySlots.push(slot);
    }
  }

  /**
   * Runs `write` against a scratch block holding a copy of the slot's current bytes (`views` over the
   * scratch, `base` 0), compares the result bit for bit and only if it differs copies it into the mirror
   * and marks the slot dirty (`spec/gpu-layout.md` section 8.2). Returns whether the slot changed. If
   * `write` throws, the mirror is untouched.
   */
  writeIfChanged(slot: number, write: ArenaWriter): boolean {
    this.checkLive();
    this.checkAllocated(slot);
    const offset = slot * this.slotStride;
    const mirror = new Uint32Array(this.mirror, offset, this.size >>> 2);
    this.scratch.u32.set(mirror);
    write(this.scratch, 0);
    const scratchWords = this.scratch.u32;
    let changed = false;
    for (let i = 0; i < scratchWords.length; i++) {
      if (scratchWords[i] !== mirror[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    new Uint8Array(this.mirror, offset, this.size).set(this.scratchBytes);
    this.markDirty(slot);
    return true;
  }

  /**
   * Uploads every dirty slot's `[slot x stride, + size)` range, one `writeBuffer` each in ascending slot
   * order, and clears the dirty flags. Returns the number of uploads.
   */
  flush(queue: GPUQueue): number {
    this.checkLive();
    if (this.dirtySlots.length === 0) return 0;
    const slots = this.dirtySlots.sort((a, b) => a - b);
    for (const slot of slots) {
      const offset = slot * this.slotStride;
      this.registry.writeBuffer(queue, this.gpuBuffer, offset, this.mirror, offset, this.size);
      this.dirty[slot] = 0;
    }
    this.dirtySlots = [];
    return slots.length;
  }

  /**
   * Registers a listener called after growth replaced the buffer and before the old buffer is destroyed,
   * so bind groups can be rebuilt. Returns a function that unsubscribes it.
   */
  onBufferReplaced(listener: (event: BufferReplacedEvent) => void): () => void {
    this.replacedListeners.add(listener);
    return () => {
      this.replacedListeners.delete(listener);
    };
  }

  /**
   * Static-offset bind group of one slot: `{ buffer, offset: slot x stride, size }` at this arena's binding
   * (`spec/gpu-layout.md` section 8.1). Cached per (layout, slot) until the slot is released or the arena grows.
   * `layout` must declare the binding without `hasDynamicOffset`.
   */
  bindGroupForSlot(slot: number, layout: GPUBindGroupLayout): GPUBindGroup {
    this.checkLive();
    if (this.dynamicOffset) {
      throw new Error(`UniformArena '${this.id}' is in dynamic-offset mode; use bindGroupDynamic()`);
    }
    this.checkAllocated(slot);
    let bySlot = this.staticGroups.get(layout);
    if (bySlot === undefined) {
      bySlot = new Map();
      this.staticGroups.set(layout, bySlot);
    }
    let group = bySlot.get(slot);
    if (group === undefined) {
      group = this.registry.createBindGroup({
        label: `${this.id}#${String(slot)}`,
        layout,
        entries: [{ binding: this.binding, resource: { buffer: this.gpuBuffer, offset: slot * this.slotStride, size: this.size } }],
      });
      bySlot.set(slot, group);
    }
    return group;
  }

  /**
   * Dynamic-offset bind group: the whole arena at offset 0 with `size` = block size; the caller passes
   * `slotOffset(slot)` as the dynamic offset in `setBindGroup`. Cached per layout until the arena grows.
   * `layout` must declare the binding with `hasDynamicOffset: true`.
   */
  bindGroupDynamic(layout: GPUBindGroupLayout): GPUBindGroup {
    this.checkLive();
    if (!this.dynamicOffset) {
      throw new Error(`UniformArena '${this.id}' is in static-offset mode; use bindGroupForSlot()`);
    }
    let group = this.dynamicGroups.get(layout);
    if (group === undefined) {
      group = this.registry.createBindGroup({
        label: `${this.id}:dynamic`,
        layout,
        entries: [{ binding: this.binding, resource: { buffer: this.gpuBuffer, offset: 0, size: this.size } }],
      });
      this.dynamicGroups.set(layout, group);
    }
    return group;
  }

  /** Releases the buffer and every cached bind group. The arena cannot be used afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dropBindGroups();
    this.replacedListeners.clear();
    this.registry.release(this.gpuBuffer);
  }

  private checkLive(): void {
    if (this.disposed) throw new Error(`UniformArena '${this.id}' is disposed`);
  }

  private checkRange(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.slotCapacity) {
      throw new RangeError(`UniformArena '${this.id}': slot ${String(slot)} is outside 0..${String(this.slotCapacity - 1)}`);
    }
  }

  private checkAllocated(slot: number): void {
    this.checkRange(slot);
    if (this.used[slot] !== 1) throw new Error(`UniformArena '${this.id}': slot ${String(slot)} is not allocated`);
  }

  private checkBufferSize(capacity: number): void {
    const bytes = capacity * this.slotStride;
    if (bytes > this.maxBufferSize) {
      const message = `The uniform arena '${this.id}' needs a ${String(bytes)}-byte buffer for ${String(capacity)} slots, above the device limit maxBufferSize (${String(this.maxBufferSize)}).`;
      this.registry.reportAllocationFailure(message);
      throw new RangeError(message);
    }
  }

  private createGpuBuffer(capacity: number): GPUBuffer {
    return this.registry.createBuffer({
      label: `mtek:uniform-arena:${this.id}`,
      size: capacity * this.slotStride,
      usage: USAGE_UNIFORM | USAGE_COPY_DST,
    });
  }

  private dropBindGroups(): void {
    for (const bySlot of this.staticGroups.values()) {
      for (const group of bySlot.values()) this.registry.release(group);
    }
    this.staticGroups.clear();
    for (const group of this.dynamicGroups.values()) this.registry.release(group);
    this.dynamicGroups.clear();
  }

  /**
   * Doubles the capacity: new buffer, whole-mirror upload (so nothing is dirty afterwards), cached bind
   * groups invalidated, `onBufferReplaced` listeners notified, and only then the old buffer destroyed
   * (`spec/gpu-layout.md` section 8.1). Growth happens before the frame's encoding begins, so no
   * command references the old buffer.
   */
  private grow(): void {
    const newCapacity = this.slotCapacity * 2;
    this.checkBufferSize(newCapacity);

    const newMirror = new ArrayBuffer(newCapacity * this.slotStride);
    new Uint8Array(newMirror).set(new Uint8Array(this.mirror));
    const newBuffer = this.createGpuBuffer(newCapacity);
    this.registry.writeBuffer(this.device.queue, newBuffer, 0, newMirror, 0, newMirror.byteLength);

    const oldBuffer = this.gpuBuffer;
    this.gpuBuffer = newBuffer;
    this.mirror = newMirror;
    this.mirrorViews = makeViews(newMirror);
    const used = new Uint8Array(newCapacity);
    used.set(this.used);
    this.used = used;
    this.dirty = new Uint8Array(newCapacity);
    this.dirtySlots = [];
    this.slotCapacity = newCapacity;
    this.dropBindGroups();

    try {
      const event: BufferReplacedEvent = { oldBuffer, newBuffer, capacity: newCapacity };
      for (const listener of [...this.replacedListeners]) listener(event);
    } finally {
      this.registry.release(oldBuffer);
    }
  }
}
