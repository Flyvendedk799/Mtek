/**
 * Material instance parameter storage (`spec/gpu-layout.md` section 8, `spec/materials.md` section 4):
 * one `UniformArena` per material parameter block layout, one slot per material instance with a
 * static-offset bind group (group 1), values written through the generated field writers of the
 * layout. A material without value params uses the shared empty group-1 bind group.
 *
 * Every instance owns its slot in M1 (decision 0031): sharing identical immutable blocks is allowed by
 * `spec/gpu-layout.md` section 8.2 but optional; `sharedParamBlocks` stays 0 and `ownedParamBlocks`
 * counts the slots.
 */
import type { ArenaDevice } from "../gpu/uniform-arena.js";
import { UniformArena } from "../gpu/uniform-arena.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { LayoutWriters } from "../scene/program.js";
import type { SceneStructure } from "../scene/structure.js";
import type { ParamSink } from "../scene/world.js";
import type { BindingPlan } from "./pipelines.js";

interface InstanceStorage {
  readonly arena: UniformArena;
  readonly slot: number;
  readonly writers: LayoutWriters;
  readonly layout: GPUBindGroupLayout;
}

export class MaterialStore implements ParamSink {
  private readonly arenas = new Map<string, UniformArena>();
  /** By material instance index; `null` for instances of materials without value params. */
  private readonly storage: (InstanceStorage | null)[] = [];

  constructor(
    device: ArenaDevice,
    registry: ResourceRegistry,
    private readonly plan: BindingPlan,
    structure: SceneStructure,
    writers: ReadonlyMap<string, LayoutWriters>,
  ) {
    const counts = new Map<string, number>();
    for (const instance of structure.instances) {
      const layout = instance.material.layout;
      if (layout !== null) counts.set(layout.id, (counts.get(layout.id) ?? 0) + 1);
    }
    for (const instance of structure.instances) {
      const layout = instance.material.layout;
      if (layout === null) {
        this.storage[instance.index] = null;
        continue;
      }
      let arena = this.arenas.get(layout.id);
      if (arena === undefined) {
        // Sized for every instance of the layout, so a static scene never grows the arena.
        arena = new UniformArena(device, registry, layout, { initialCapacity: counts.get(layout.id) ?? 1 });
        this.arenas.set(layout.id, arena);
      }
      const layoutWriters = writers.get(layout.id);
      if (layoutWriters === undefined) throw new Error(`internal error: no writers for the layout '${layout.id}'`);
      this.storage[instance.index] = { arena, slot: arena.allocate(), writers: layoutWriters, layout: plan.material(layout) };
    }
  }

  /** Parameter blocks owned by exactly one instance. */
  get ownedParamBlocks(): number {
    let count = 0;
    for (const arena of this.arenas.values()) count += arena.liveSlots;
    return count;
  }

  /** Parameter blocks shared by several identical immutable instances: none in M1. */
  get sharedParamBlocks(): number {
    return 0;
  }

  /**
   * Writes `value` through the generated field writer of `name` into the instance's slot. The slot is
   * marked dirty only when its bytes change (`spec/gpu-layout.md` section 8.2).
   */
  writeParam(instance: number, name: string, value: unknown): void {
    const storage = this.storageOf(instance);
    if (storage === null) throw new Error(`internal error: material instance ${String(instance)} has no value params`);
    const writer = storage.writers.fields.get(name);
    if (writer === undefined) throw new Error(`internal error: the layout '${storage.arena.id}' has no field '${name}'`);
    storage.arena.writeIfChanged(storage.slot, (views, base) => {
      writer(views, base, value);
    });
  }

  /** The group-1 bind group of an instance (cached by its arena). */
  bindGroup(instance: number): GPUBindGroup {
    const storage = this.storageOf(instance);
    return storage === null ? this.plan.emptyMaterialGroup() : storage.arena.bindGroupForSlot(storage.slot, storage.layout);
  }

  /** Uploads every dirty slot; returns the number of uploads. */
  flush(queue: GPUQueue): number {
    let uploads = 0;
    for (const arena of this.arenas.values()) uploads += arena.flush(queue);
    return uploads;
  }

  private storageOf(instance: number): InstanceStorage | null {
    const storage = this.storage[instance];
    if (storage === undefined) throw new Error(`internal error: no material instance ${String(instance)}`);
    return storage;
  }
}
