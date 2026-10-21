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
 *
 * A texture param whose value is an image file of the `assets` table binds that file's texture instead of a
 * built-in one (`AssetTextures`, decision 0060); two instances naming the same file share one texture.
 *
 * Spawned entities (decision 0064) add and remove instances while the scene runs: `createInstance` gives a
 * new instance (its index chosen by the caller, above those of the scene) a block, `shareInstance` lets it join
 * an identical block once its values are written, and `removeInstance` leaves its block, releasing the arena
 * slot and the bind groups when it was the last user. A block is named by its lowest user, also after users
 * left, so draw order stays a function of the live instances.
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

/** The arena slot of a parameter block with its writers and bind group layout. */
interface BlockStorage {
  readonly arena: UniformArena;
  readonly slot: number;
  readonly writers: LayoutWriters;
  readonly layout: GPUBindGroupLayout;
}

/**
 * A parameter block: the slot (when the material has value params) used by `members`, the instances that share it.
 * Instances of materials with texture or sampler params only share a bind group instead of a slot.
 */
interface Block {
  readonly storage: BlockStorage | null;
  readonly members: Set<number>;
  /** The lowest member: what `blockOf` returns. */
  name: number;
  /** The group-1 bind group of a block without storage whose instances have resources; created on first use. */
  resourceGroup: GPUBindGroup | undefined;
  /** The key of the sharing bucket the block is listed in. */
  key: string | undefined;
}

/** The textures and samplers of one instance: its group-1 layout and the entries after the block. */
interface InstanceResources {
  readonly layout: GPUBindGroupLayout;
  readonly entries: readonly GPUBindGroupEntry[];
}

/** The arena of a layout that no instance of the scene uses at mount starts with this many slots. */
const SPAWNED_ARENA_CAPACITY = 16;

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
  /** The live instances by index (the scene's, then the spawned ones). */
  private readonly instances = new Map<number, ResolvedInstance>();
  /** By material instance index: the block it uses. Instances that share a block hold the same object. */
  private readonly blocks: (Block | undefined)[] = [];
  /** Blocks that were offered for sharing, by `(material, hash of the bytes, resources)`. */
  private readonly buckets = new Map<string, Block[]>();
  private blockChanges = 0;
  /** Textures and samplers by instance index; absent for instances without resources. */
  private readonly resources = new Map<number, InstanceResources>();
  private readonly builtins: BuiltinResources;
  private readonly assetTextures: AssetTextures;

  /** `images`: the decoded image files that instances' texture params may name (`spec/assets.md` section 5). */
  constructor(
    private readonly device: ArenaDevice,
    private readonly registry: ResourceRegistry,
    private readonly plan: BindingPlan,
    structure: SceneStructure,
    private readonly writers: ReadonlyMap<string, LayoutWriters>,
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
      // Sized for every instance of the layout, so a static scene never grows the arena.
      this.add(instance, counts.get(instance.material.layout?.id ?? "") ?? 1);
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

  /** Counts the distinct blocks with a slot that are used by `min` to `max` instances. */
  private countBlocks(min: number, max: number): number {
    let count = 0;
    for (const block of new Set(this.blocks)) {
      if (block !== undefined && block.storage !== null && block.members.size >= min && block.members.size <= max) count += 1;
    }
    return count;
  }

  /**
   * The parameter block of an instance, named by the lowest instance index that uses it: two instances have
   * "the same parameter block" (`spec/runtime-abi.md` section 8.4) exactly when this is equal.
   */
  blockOf(instance: number): number {
    const block = this.blocks[instance];
    if (block === undefined) throw new Error(`internal error: no material instance ${String(instance)}`);
    return block.name;
  }

  /** Increases whenever `blockOf` changes for some instance (`shareIdentical`, copy on write, an instance added or removed). */
  get blockVersion(): number {
    return this.blockChanges;
  }

  /** Instances whose `color` or `base_color` alpha is below 1 (decision 0138). */
  /** The colour params with an alpha below 1, by instance (decision 0138). */
  private readonly translucent = new Map<number, Set<string>>();

  /** Whether the instance is drawn in the translucent pass: one of its colour params has an alpha below 1. */
  isTranslucent(instance: number): boolean {
    return this.translucent.has(instance);
  }

  /** Tracks the alpha of a colour param; a change of translucency rebuilds the draw list (via `blockVersion`). */
  private trackAlpha(instance: number, name: string, value: unknown): void {
    if (typeof value !== "object" || value === null || !("r" in value) || !("a" in value)) return;
    const alpha = (value as { readonly a?: unknown }).a;
    const translucent = typeof alpha === "number" && alpha < 1;
    const before = this.translucent.has(instance);
    let names = this.translucent.get(instance);
    if (translucent) {
      if (names === undefined) this.translucent.set(instance, (names = new Set()));
      names.add(name);
    } else if (names !== undefined) {
      names.delete(name);
      if (names.size === 0) this.translucent.delete(instance);
    }
    if (before !== this.translucent.has(instance)) this.blockChanges += 1;
  }

  /** The number of live material instances. */
  get instanceCount(): number {
    return this.instances.size;
  }

  /** Gives `instance` a block of its own, and its texture and sampler bindings. `capacity`: arena slots to start with. */
  private add(instance: ResolvedInstance, capacity: number): void {
    if (this.instances.has(instance.index)) throw new Error(`internal error: material instance ${String(instance.index)} exists already`);
    const layout = instance.material.layout;
    const kinds = instance.material.resources;
    if (instance.resources.length > 0) {
      this.resources.set(instance.index, {
        layout: this.plan.material(layout, kinds),
        entries: instance.resources.map((resource) => ({
          binding: resource.binding,
          resource: "asset" in resource ? this.assetTextures.textureView(resource.asset) : resource.kind === "texture" ? this.builtins.textureView(resource.value) : this.builtins.sampler(resource.value),
        })),
      });
    }
    let storage: BlockStorage | null = null;
    if (layout !== null) {
      let arena = this.arenas.get(layout.id);
      if (arena === undefined) {
        arena = new UniformArena(this.device, this.registry, layout, { initialCapacity: capacity });
        this.arenas.set(layout.id, arena);
      }
      const layoutWriters = this.writers.get(layout.id);
      if (layoutWriters === undefined) throw new Error(`internal error: no writers for the layout '${layout.id}'`);
      storage = { arena, slot: arena.allocate(), writers: layoutWriters, layout: this.plan.material(layout, kinds) };
    }
    this.instances.set(instance.index, instance);
    this.blocks[instance.index] = { storage, members: new Set([instance.index]), name: instance.index, resourceGroup: undefined, key: undefined };
  }

  /**
   * A spawned entity's material instance (decision 0064): `instance.index` is chosen by the caller, above the
   * scene's, and free. The instance starts with a block of its own at zero bytes; the entity's `init` writes the
   * values, then {@link MaterialStore.shareInstance} may let it join an identical block.
   */
  createInstance(instance: ResolvedInstance): void {
    this.add(instance, SPAWNED_ARENA_CAPACITY);
    this.blockChanges += 1;
  }

  /** Removes a spawned entity's instance: leaves its block, releasing the slot and the bind groups with the last user. */
  removeInstance(index: number): void {
    if (!this.instances.has(index)) throw new Error(`internal error: no material instance ${String(index)}`);
    this.leave(index);
    this.instances.delete(index);
    this.translucent.delete(index);
    this.blocks[index] = undefined;
    this.resources.delete(index);
    this.blockChanges += 1;
  }

  /** Takes `index` out of its block; frees the block when it was the last user, renames it when it was the lowest. */
  private leave(index: number): void {
    const block = this.blocks[index];
    if (block === undefined) return;
    block.members.delete(index);
    if (block.members.size === 0) {
      this.free(block);
      return;
    }
    if (block.name === index) block.name = Math.min(...block.members);
  }

  /** Releases a block nobody uses. */
  private free(block: Block): void {
    if (block.storage !== null) block.storage.arena.release(block.storage.slot);
    if (block.resourceGroup !== undefined) {
      this.registry.release(block.resourceGroup);
      block.resourceGroup = undefined;
    }
    if (block.key !== undefined) {
      const bucket = this.buckets.get(block.key);
      if (bucket !== undefined) {
        const at = bucket.indexOf(block);
        if (at >= 0) bucket.splice(at, 1);
        if (bucket.length === 0) this.buckets.delete(block.key);
      }
      block.key = undefined;
    }
  }

  /**
   * Lets identical `shareable` instances share their block, once every instance holds its initial values
   * (after `init`, or after the world refilled the store on device recovery). Candidates are bucketed by
   * `(material, hash of the block bytes, resources)`; a hash hit is confirmed word by word, so a collision
   * never shares different blocks. The lowest-indexed instance keeps its slot; the others release theirs.
   */
  shareIdentical(): void {
    for (const index of [...this.instances.keys()].sort((a, b) => a - b)) this.shareInstance(index);
  }

  /** {@link MaterialStore.shareIdentical} for one instance, which joins the first identical block offered before it. */
  shareInstance(index: number): void {
    const instance = this.instances.get(index);
    const block = this.blocks[index];
    // A block that is shared already, or was offered already, has nothing to do.
    if (instance === undefined || block === undefined || !instance.shareable || block.members.size !== 1 || block.key !== undefined) return;
    const hash = block.storage === null ? 0 : hashWords(block.storage.arena.slotWords(block.storage.slot));
    const key = `${instance.material.id}\0${String(hash)}\0${resourceSignature(instance)}`;
    const candidates = this.buckets.get(key);
    if (candidates === undefined) {
      this.buckets.set(key, [block]);
      block.key = key;
      return;
    }
    const match = candidates.find((candidate) => candidate !== block && this.identical(candidate, block));
    if (match === undefined) {
      candidates.push(block);
      block.key = key;
      return;
    }
    this.join(index, block, match);
  }

  /** Same bytes (when the material has a block). Both blocks belong to `shareable` instances of one material and resources. */
  private identical(a: Block, b: Block): boolean {
    if (a.storage === null || b.storage === null) return a.storage === b.storage;
    return a.storage.arena === b.storage.arena && sameWords(a.storage.arena.slotWords(a.storage.slot), b.storage.arena.slotWords(b.storage.slot));
  }

  /** Makes instance `index`, the only user of `own`, use `target`. */
  private join(index: number, own: Block, target: Block): void {
    own.members.delete(index);
    this.free(own);
    target.members.add(index);
    if (index < target.name) target.name = index;
    this.blocks[index] = target;
    this.blockChanges += 1;
  }

  /**
   * Writes `value` through the generated field writer of `name` into the instance's slot. The slot is
   * marked dirty only when its bytes change (`spec/gpu-layout.md` section 8.2). An instance that shares
   * its block gets a block of its own first when the write would change the bytes.
   */
  writeParam(instance: number, name: string, value: unknown): void {
    this.trackAlpha(instance, name, value);
    let block = this.blockOfInstance(instance);
    let storage = block.storage;
    if (storage === null) throw new Error(`internal error: material instance ${String(instance)} has no value params`);
    const writer = storage.writers.fields.get(name);
    if (writer === undefined) throw new Error(`internal error: the layout '${storage.arena.id}' has no field '${name}'`);
    if (block.members.size > 1) {
      // Rare (a test hook can write a shareable instance): copy on write when the bytes would change.
      const write: ArenaWriter = (views, base) => {
        writer(views, base, value);
      };
      if (!storage.arena.wouldChange(storage.slot, write)) return;
      block = this.detach(instance, block, storage);
      storage = block.storage;
      if (storage === null) throw new Error(`internal error: material instance ${String(instance)} lost its block`);
    }
    storage.arena.writeFieldIfChanged(storage.slot, writer, value);
  }

  /** Copy on write: a new block holding the bytes of `shared`, used by `instance` alone. */
  private detach(instance: number, shared: Block, storage: BlockStorage): Block {
    const { arena } = storage;
    const slot = arena.allocate();
    // Read after `allocate()`: growth replaces the mirror.
    const source = arena.slotWords(storage.slot);
    arena.writeIfChanged(slot, (views, base) => {
      views.u32.set(source, base >>> 2);
    });
    const own: Block = {
      storage: { arena, slot, writers: storage.writers, layout: storage.layout },
      members: new Set([instance]),
      name: instance,
      resourceGroup: undefined,
      key: undefined,
    };
    // The users that stay keep the block, named by the lowest of them.
    shared.members.delete(instance);
    if (shared.name === instance) shared.name = Math.min(...shared.members);
    this.blocks[instance] = own;
    this.blockChanges += 1;
    return own;
  }

  /** The group-1 bind group of an instance (cached by its arena, or by its block when it has no slot). */
  bindGroup(instance: number): GPUBindGroup {
    const block = this.blockOfInstance(instance);
    const resources = this.resources.get(instance);
    if (block.storage !== null) return block.storage.arena.bindGroupForSlot(block.storage.slot, block.storage.layout, resources?.entries);
    if (resources === undefined) return this.plan.emptyMaterialGroup();
    block.resourceGroup ??= this.registry.createBindGroup({
      label: `mtek material instance ${String(block.name)} resources`,
      layout: resources.layout,
      entries: [...resources.entries],
    });
    return block.resourceGroup;
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
    for (const block of new Set(this.blocks)) {
      if (block?.resourceGroup !== undefined) this.registry.release(block.resourceGroup);
    }
    this.blocks.length = 0;
    this.instances.clear();
    this.buckets.clear();
    this.resources.clear();
    this.builtins.dispose();
    this.assetTextures.dispose();
  }

  private blockOfInstance(instance: number): Block {
    const block = this.blocks[instance];
    if (block === undefined) throw new Error(`internal error: no material instance ${String(instance)}`);
    return block;
  }
}
