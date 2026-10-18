/**
 * Material instance parameter storage (`spec/gpu-layout.md` section 8, `spec/materials.md` section 4):
 * one `UniformArena` per material parameter block layout, one slot per parameter block with a
 * static-offset bind group (group 1), values written through the generated field writers of the
 * layout. A material without value params uses the shared empty group-1 bind group.
 *
 * Every instance starts with a slot of its own. Once `init` has run, `shareIdentical` lets instances
 * whose manifest entry is `shareable` (every param class `initial` or `resource`) and whose block bytes
 * and resources are identical share the slot (and the bind group) of the lowest-indexed one, as
 * `spec/gpu-layout.md` section 8.2 allows (decision 0059). The shared block is what compatible instancing
 * (`spec/runtime-abi.md` section 8.4) calls "the same parameter block": `blockOf` names it. A write that
 * would change a shared block (only a test hook can make one: nothing in a program writes a `shareable`
 * instance) first gives the written instance a block of its own, copy on write, so the others never see it.
 * `ownedParamBlocks` counts the blocks used by one instance, `sharedParamBlocks` those used by several.
 *
 * The textures and samplers of an instance (decision 0054) are bindings of the same group 1, after the
 * block: the instance's bind group holds the block at binding 0 (when the material has value params) and
 * the built-in texture views and samplers its resource params name, created once per instance. A
 * material with resources and no value params has no arena; its instances still get a bind group (one
 * per block, shared by identical `shareable` instances like a block).
 */
import type { ArenaDevice, ArenaWriter } from "../gpu/uniform-arena.js";
import { UniformArena } from "../gpu/uniform-arena.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { LayoutWriters } from "../scene/program.js";
import type { ResolvedInstance, SceneStructure } from "../scene/structure.js";
import type { ParamSink } from "../scene/world.js";
import type { BindingPlan } from "./pipelines.js";
import type { DecodedImages } from "../assets/loader.js";
import { AssetTextures, BuiltinResources, type TextureOverrides } from "./resources.js";

/** One parameter block: a slot of an arena, used by `users` instances (more than one when shared). */
interface InstanceStorage {
  readonly arena: UniformArena;
  readonly slot: number;
  readonly writers: LayoutWriters;
  readonly layout: GPUBindGroupLayout;
  users: number;
}

/** The textures and samplers of one instance: its group-1 layout and the entries after the block. */
interface InstanceResources {
  readonly layout: GPUBindGroupLayout;
  readonly entries: readonly GPUBindGroupEntry[];
}

/** FNV-1a over the words of a block: the bucket key of `shareIdentical` (equal blocks are then compared word by word). */
function hashWords(words: Uint32Array): number {
  let hash = 0x811c9dc5;
  for (const word of words) hash = Math.imul(hash ^ word, 0x01000193) >>> 0;
  return hash;
}

function sameWords(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The built-in texture or sampler each resource param of an instance names, in a form two instances can be compared by. */
function resourceSignature(instance: ResolvedInstance): string {
  return instance.resources.map((resource) => `${String(resource.binding)}=${resource.value}`).join(",");
}

export class MaterialStore implements ParamSink {
  private readonly arenas = new Map<string, UniformArena>();
  /** By material instance index; `null` for instances of materials without value params. Instances that share a block hold the same object. */
  private readonly storage: (InstanceStorage | null)[] = [];
  /** By material instance index: the lowest-indexed instance that uses the same parameter block (itself when not shared). */
  private readonly blocks: number[] = [];
  private blockChanges = 0;
  /** Textures and samplers by instance index; absent for instances without resources. */
  private readonly resources = new Map<number, InstanceResources>();
  /** Bind groups of instances that have resources but no block, by block (see `blockOf`), created on first use. */
  private readonly resourceGroups = new Map<number, GPUBindGroup>();
  private readonly builtins: BuiltinResources;
  private readonly assetTextures: AssetTextures;

  /** `images`: the decoded image files that instances' texture params may name (`spec/assets.md` section 5). */
  constructor(
    device: ArenaDevice,
    private readonly registry: ResourceRegistry,
    private readonly plan: BindingPlan,
    private readonly structure: SceneStructure,
    writers: ReadonlyMap<string, LayoutWriters>,
    textures?: TextureOverrides,
    images: DecodedImages = new Map(),
  ) {
    this.builtins = new BuiltinResources(registry, device.queue, textures);
    this.assetTextures = new AssetTextures(registry, device.queue, images);
    const counts = new Map<string, number>();
    for (const instance of structure.instances) {
      const layout = instance.material.layout;
      if (layout !== null) counts.set(layout.id, (counts.get(layout.id) ?? 0) + 1);
    }
    for (const instance of structure.instances) {
      this.blocks[instance.index] = instance.index;
      const layout = instance.material.layout;
      const kinds = instance.material.resources;
      if (instance.resources.length > 0) {
        this.resources.set(instance.index, {
          layout: plan.material(layout, kinds),
          entries: instance.resources.map((resource) => ({
            binding: resource.binding,
            resource: "asset" in resource ? this.assetTextures.textureView(resource.asset) : resource.kind === "texture" ? this.builtins.textureView(resource.value) : this.builtins.sampler(resource.value),
          })),
        });
      }
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
      this.storage[instance.index] = { arena, slot: arena.allocate(), writers: layoutWriters, layout: plan.material(layout, kinds), users: 1 };
    }
  }

  /** Parameter blocks used by exactly one instance. */
  get ownedParamBlocks(): number {
    return this.countBlocks(1, 1);
  }

  /** Parameter blocks shared by several identical immutable instances (`spec/gpu-layout.md` section 8.2). */
  get sharedParamBlocks(): number {
    return this.countBlocks(2, Infinity);
  }

  /** Counts the distinct blocks used by `min` to `max` instances. */
  private countBlocks(min: number, max: number): number {
    let count = 0;
    for (const storage of new Set(this.storage)) if (storage !== null && storage !== undefined && storage.users >= min && storage.users <= max) count += 1;
    return count;
  }

  /**
   * The parameter block of an instance, named by the lowest instance index that uses it: two instances have
   * "the same parameter block" (`spec/runtime-abi.md` section 8.4) exactly when this is equal.
   */
  blockOf(instance: number): number {
    const block = this.blocks[instance];
    if (block === undefined) throw new Error(`internal error: no material instance ${String(instance)}`);
    return block;
  }

  /** Increases whenever `blockOf` changes for some instance (`shareIdentical`, copy on write). */
  get blockVersion(): number {
    return this.blockChanges;
  }

  /**
   * Lets identical `shareable` instances share their block, once every instance holds its initial values
   * (after `init`, or after the world refilled the store on device recovery). Candidates are bucketed by
   * `(material, hash of the block bytes, resources)`; a hash hit is confirmed word by word, so a collision
   * never shares different blocks. The lowest-indexed instance keeps its slot; the others release theirs.
   */
  shareIdentical(): void {
    const buckets = new Map<string, number[]>();
    for (const instance of this.structure.instances) {
      if (!instance.shareable || this.blocks[instance.index] !== instance.index) continue;
      const storage = this.storage[instance.index];
      const hash = storage === null || storage === undefined ? 0 : hashWords(storage.arena.slotWords(storage.slot));
      const key = `${instance.material.id}\0${String(hash)}\0${resourceSignature(instance)}`;
      const candidates = buckets.get(key);
      if (candidates === undefined) {
        buckets.set(key, [instance.index]);
        continue;
      }
      const match = candidates.find((candidate) => this.identical(candidate, instance.index));
      if (match === undefined) candidates.push(instance.index);
      else this.join(instance.index, match);
    }
  }

  /** Same bytes (when the material has a block). Both instances are `shareable`, of the same material and resources, and unshared. */
  private identical(a: number, b: number): boolean {
    const left = this.storage[a];
    const right = this.storage[b];
    if (left === undefined || right === undefined) return false;
    if (left === null || right === null) return left === right;
    return left.arena === right.arena && sameWords(left.arena.slotWords(left.slot), right.arena.slotWords(right.slot));
  }

  /** Makes `member` use the block of `representative`. */
  private join(member: number, representative: number): void {
    const own = this.storage[member];
    const shared = this.storage[representative];
    if (own !== null && own !== undefined && shared !== null && shared !== undefined) {
      own.arena.release(own.slot);
      shared.users += 1;
      this.storage[member] = shared;
    }
    const group = this.resourceGroups.get(member);
    if (group !== undefined) {
      this.registry.release(group);
      this.resourceGroups.delete(member);
    }
    this.blocks[member] = representative;
    this.blockChanges += 1;
  }

  /**
   * Writes `value` through the generated field writer of `name` into the instance's slot. The slot is
   * marked dirty only when its bytes change (`spec/gpu-layout.md` section 8.2). An instance that shares
   * its block gets a block of its own first when the write would change the bytes.
   */
  writeParam(instance: number, name: string, value: unknown): void {
    let storage = this.storageOf(instance);
    if (storage === null) throw new Error(`internal error: material instance ${String(instance)} has no value params`);
    const writer = storage.writers.fields.get(name);
    if (writer === undefined) throw new Error(`internal error: the layout '${storage.arena.id}' has no field '${name}'`);
    const write: ArenaWriter = (views, base) => {
      writer(views, base, value);
    };
    if (storage.users > 1) {
      if (!storage.arena.wouldChange(storage.slot, write)) return;
      storage = this.detach(instance, storage);
    }
    storage.arena.writeIfChanged(storage.slot, write);
  }

  /** Copy on write: a new block holding the bytes of `shared`, used by `instance` alone. */
  private detach(instance: number, shared: InstanceStorage): InstanceStorage {
    const { arena } = shared;
    const slot = arena.allocate();
    // Read after `allocate()`: growth replaces the mirror.
    const source = arena.slotWords(shared.slot);
    arena.writeIfChanged(slot, (views, base) => {
      views.u32.set(source, base >>> 2);
    });
    const own: InstanceStorage = { arena, slot, writers: shared.writers, layout: shared.layout, users: 1 };
    shared.users -= 1;
    this.storage[instance] = own;
    // The lowest-indexed user names a block: name them again for the users of the old block and of the new one.
    const first = new Map<InstanceStorage, number>();
    for (const candidate of this.structure.instances) {
      const storage = this.storage[candidate.index];
      if (storage === null || storage === undefined) continue;
      const known = first.get(storage);
      if (known === undefined) first.set(storage, candidate.index);
      this.blocks[candidate.index] = known ?? candidate.index;
    }
    this.blockChanges += 1;
    return own;
  }

  /** The group-1 bind group of an instance (cached by its arena, or by this store when it has no block). */
  bindGroup(instance: number): GPUBindGroup {
    const storage = this.storageOf(instance);
    const resources = this.resources.get(instance);
    if (storage !== null) return storage.arena.bindGroupForSlot(storage.slot, storage.layout, resources?.entries);
    if (resources === undefined) return this.plan.emptyMaterialGroup();
    const block = this.blockOf(instance);
    let group = this.resourceGroups.get(block);
    if (group === undefined) {
      group = this.registry.createBindGroup({ label: `mtek material instance ${String(block)} resources`, layout: resources.layout, entries: [...resources.entries] });
      this.resourceGroups.set(block, group);
    }
    return group;
  }

  /** Uploads every dirty slot; returns the number of uploads. */
  flush(queue: GPUQueue): number {
    let uploads = 0;
    for (const arena of this.arenas.values()) uploads += arena.flush(queue);
    return uploads;
  }

  /** Releases every arena (hot reload: discard a retired scene). */
  dispose(): void {
    for (const arena of this.arenas.values()) arena.dispose();
    this.arenas.clear();
    this.storage.length = 0;
    for (const group of this.resourceGroups.values()) this.registry.release(group);
    this.resourceGroups.clear();
    this.resources.clear();
    this.builtins.dispose();
    this.assetTextures.dispose();
  }

  private storageOf(instance: number): InstanceStorage | null {
    const storage = this.storage[instance];
    if (storage === undefined) throw new Error(`internal error: no material instance ${String(instance)}`);
    return storage;
  }
}
