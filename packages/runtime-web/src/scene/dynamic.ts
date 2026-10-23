/**
 * Spawned entities (`spec/scenes.md` sections 9 and 10, `spec/runtime-abi.md` section 4.2, decision 0064): the
 * queues of `spawn` and `destroy`, the flush points that apply them, the records of the entities that exist
 * and the GPU state they own.
 *
 * `ctx.spawn(prefabId, params, spanId)` reserves a slot and queues the creation; `ctx.destroy(ref, spanId)`
 * marks the entity as pending removal at once (`alive` false, handlers and bindings skipped, commands dropped
 * with `W8031`) and queues the removal; neither changes a collection that a handler may be iterating. The
 * scheduler calls {@link DynamicEntities.flush} before each fixed tick and after `update`: the removals first,
 * then the creations in spawn order.
 *
 * Creating an entity (the flush) makes its record, gives it a material instance (an arena slot or a shared
 * parameter block, bind group) and a place in the renderer (object block, culling and draw-list state), runs the
 * prefab's `init(ctx, self, params)` and evaluates its bindings once. Removing one releases all of that. The
 * entity table, the render side and the material side can be replaced after a device loss
 * ({@link DynamicEntities.rebuild}); the entities and their slots survive it.
 *
 * Stable instance order (`spec/scenes.md` section 10.1): the named entities, then the spawned ones in spawn
 * order: {@link DynamicEntities.live} is kept in that order.
 *
 * A subsystem that follows the life of spawned entities (physics: a body per entity that has one, removed
 * when the entity is) registers an {@link EntityLifecycleListener} and keeps what it attaches in
 * {@link DynamicEntity.attachments}. `removed` is called at the flush, never during a handler, so removing a
 * body from a collision callback does not invalidate the iteration that delivered it.
 */
import type {
  MtekProgramPrefab,
  MtekPrefabEventHandler,
  MtekEventName,
} from "../abi/program.js";
import type { MtekBinding } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase, type MtekSourceSpan } from "../diagnostics/types.js";
import type { ResolvedEntity, ResolvedInstance, ResolvedPrefab } from "./structure.js";
import { DEAD_REF, EntitySlots, type EntityRef, type RefStatus } from "./slots.js";
import { RuntimeInternalError } from "./errors.js";
import type { EntityRecord } from "./world.js";
import { describeValue } from "./values.js";

/** A prefab as the runtime runs it: the manifest's description joined to the program module's code. */
export interface PrefabRuntime {
  readonly resolved: ResolvedPrefab;
  readonly program: MtekProgramPrefab;
  /** The prefab's bindings in evaluation order (`order`, then id). */
  readonly steps: readonly BindingStep[];
  /** The prefab's handlers by event, each list in declaration order. */
  readonly handlers: ReadonlyMap<MtekEventName, readonly MtekPrefabEventHandler[]>;
}

/** One binding of a prefab: the function that computes the value and the one that applies it to an instance. */
export interface BindingStep {
  readonly binding: MtekBinding;
  readonly compute: (ctx: object, self: object) => unknown;
}

/** A spawned entity that exists (created at a flush) until the flush that removes it. */
export interface DynamicEntity {
  readonly record: EntityRecord;
  /** What the renderer and the setters know of it: `index` is its slot. */
  readonly resolved: ResolvedEntity;
  readonly ref: EntityRef;
  readonly prefab: PrefabRuntime;
  /** The prefab's `tag` (decision 0150), kept here so tag queries read it without a lookup. */
  readonly tag: string | undefined;
  /** The spawn sequence number: the order among the spawned entities (the named ones come first). */
  readonly order: number;
  /** Pending removal: `alive` is false, handlers and bindings skip it, the next flush removes it. */
  removing: boolean;
  /** What subsystems attach to the entity (a physics body), by their own key. Dropped with the entity. */
  readonly attachments: Map<string, unknown>;
}

/** Follows the life of spawned entities (decision 0064). Named entities are not announced: they never change. */
export interface EntityLifecycleListener {
  /** After the entity's `init` ran and its bindings were evaluated, at the flush that created it. */
  created?(entity: DynamicEntity): void;
  /** At the flush that removes it, before its resources are released and its slot is reused. */
  removed?(entity: DynamicEntity): void;
}

/** What the entity table needs of the world that holds the records. */
export interface DynamicHost {
  /** The generated-code context. */
  readonly ctx: object;
  readonly phase: MtekRuntimePhase;
  /** A new record at the registry defaults (state at its zero values, material mirror, `params`). */
  makeRecord(ref: EntityRef, resolved: ResolvedEntity, prefab: PrefabRuntime, params: Readonly<Record<string, unknown>>): EntityRecord;
  /** Makes the record known to the setters under its slot; its transform is dirty. */
  register(slot: number, record: EntityRecord, resolved: ResolvedEntity): void;
  /** Forgets the record of a removed entity. */
  unregister(slot: number, record: EntityRecord): void;
  /** The source range of a span id of the manifest. */
  source(spanId: number): MtekSourceSpan | null;
  /** Delivers a run-time diagnostic. */
  readonly report: (diagnostic: MtekDiagnostic) => void;
}

/** The part of the material store that spawned entities use. */
export interface DynamicMaterials {
  /** Gives `instance` (its `index` chosen by the caller) a parameter block and its texture and sampler bindings. */
  createInstance(instance: ResolvedInstance): void;
  /** Releases the instance's block (when it was the last user), its bind groups and its place in the store. */
  removeInstance(index: number): void;
  /** Lets the instance share the block of an identical `shareable` one, once `init` wrote its values. */
  shareInstance(index: number): void;
  /** Writes `value` into the instance's block through the generated writer (a mirrored value, after a device loss). */
  writeParam(instance: number, name: string, value: unknown): void;
}

/** The part of the renderer that spawned entities use. */
export interface DynamicRender {
  addEntity(entity: ResolvedEntity): void;
  removeEntity(entity: ResolvedEntity): void;
}

/** The event names an input transition can deliver, in the order they are looked up. */
export const INPUT_EVENTS = ["key_down", "key_up", "pointer_down", "pointer_up", "pointer_move"] as const satisfies readonly MtekEventName[];

/** The events the physics step delivers (`spec/physics.md` section 6, decision 0066). */
export const COLLISION_EVENTS = ["collision_enter", "collision_exit"] as const satisfies readonly MtekEventName[];

/** Joins the prefabs of the manifest to their code in the program module (checked by `checkProgram`). */
export function buildPrefabRuntimes(prefabs: readonly ResolvedPrefab[], code: ReadonlyMap<string, MtekProgramPrefab>): Map<string, PrefabRuntime> {
  const runtimes = new Map<string, PrefabRuntime>();
  for (const resolved of prefabs) {
    const program = code.get(resolved.symbol);
    if (program === undefined) throw new RuntimeInternalError(`the program module has no code for the prefab '${resolved.symbol}'.`);
    const steps = [...resolved.bindings]
      .sort((a, b) => a.order - b.order || a.id - b.id)
      .map((binding): BindingStep => {
        const compute = program.bindings[binding.id];
        if (compute === undefined) throw new RuntimeInternalError(`binding ${String(binding.id)} of prefab '${resolved.symbol}' has no function in the program module.`);
        return { binding, compute };
      });
    const handlers = new Map<MtekEventName, readonly MtekPrefabEventHandler[]>();
    for (const event of [...INPUT_EVENTS, ...COLLISION_EVENTS]) {
      const declared = program.events[event];
      // Declaration order is kept: several handlers of one event run in the order they were written.
      if (declared !== undefined && declared.length > 0) handlers.set(event, declared);
    }
    runtimes.set(resolved.symbol, { resolved, program, steps, handlers });
  }
  return runtimes;
}

/** The payload of a queued spawn. */
interface SpawnRequest {
  readonly prefab: PrefabRuntime;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The setters of `ctx` a binding is applied through. */
interface BindingContext {
  setTransform(entity: unknown, field: string, value: unknown): void;
  setVisible(entity: unknown, value: boolean): void;
  setParam(entity: unknown, name: string, value: unknown): void;
}

export interface DynamicOptions {
  readonly prefabs: ReadonlyMap<string, PrefabRuntime>;
  /** The number of named entities (`manifest.scene.entities`). */
  readonly staticCount: number;
  /** `manifest.runtimeConfig.maxEntities`. */
  readonly maxEntities: number;
  /** The first material instance index a spawned entity may use: the number of instances of the scene. */
  readonly firstInstance: number;
  readonly host: DynamicHost;
}

function isRefLike(value: unknown): value is EntityRef {
  return typeof value === "object" && value !== null && typeof (value as EntityRef).slot === "number" && typeof (value as EntityRef).gen === "number";
}

export class DynamicEntities {
  private slots: EntitySlots<SpawnRequest>;
  /** The entities that exist, in spawn order (`spec/scenes.md` section 10.1). Replaced by a flush, never edited. */
  private liveList: readonly DynamicEntity[] = [];
  /** By slot. */
  private readonly bySlot: (DynamicEntity | undefined)[] = [];
  private readonly listeners = new Set<EntityLifecycleListener>();
  private render: DynamicRender | undefined;
  private materials: DynamicMaterials | undefined;
  private nextOrder = 0;
  private nextInstance: number;
  private readonly freeInstances: number[] = [];
  private spawnedTotal = 0;
  private destroyedTotal = 0;
  private versionCounter = 0;

  constructor(private readonly options: DynamicOptions) {
    this.slots = new EntitySlots<SpawnRequest>(options.staticCount, options.maxEntities);
    this.nextInstance = options.firstInstance;
  }

  /** The spawned entities that exist, in spawn order; includes those pending removal (`removing`). */
  get live(): readonly DynamicEntity[] {
    return this.liveList;
  }

  /** Increases whenever an entity was created or removed: the draw list depends on it. */
  get version(): number {
    return this.versionCounter;
  }

  /** Entities for which `alive` is true: the named ones and the spawned ones that are not pending removal. */
  get aliveCount(): number {
    return this.slots.aliveCount;
  }

  /** The number of slots of the entity table. */
  get slotCapacity(): number {
    return this.slots.capacity;
  }

  get pendingSpawns(): number {
    return this.slots.pendingSpawns;
  }

  get pendingRemovals(): number {
    return this.slots.pendingRemovals;
  }

  /** Entities created since the scene started. */
  get spawned(): number {
    return this.spawnedTotal;
  }

  /** Entities removed since the scene started. */
  get destroyed(): number {
    return this.destroyedTotal;
  }

  /** The prefab `symbol`, if the program spawns it. */
  prefab(symbol: string): PrefabRuntime | undefined {
    return this.options.prefabs.get(symbol);
  }

  /** Every prefab the program spawns, in manifest order. */
  prefabRuntimes(): Iterable<PrefabRuntime> {
    return this.options.prefabs.values();
  }

  /** The spawned entity in `slot`, if one exists there. */
  entityAt(slot: number): DynamicEntity | undefined {
    return this.bySlot[slot];
  }

  /** What `ref` stands for right now. */
  status(ref: EntityRef): RefStatus {
    return this.slots.status(ref);
  }

  addListener(listener: EntityLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Connects the render side and the material side: spawned entities are created and removed through them.
   * Called when the scene starts and again after a device loss, with the rebuilt stores.
   */
  attach(render: DynamicRender, materials: DynamicMaterials): void {
    this.render = render;
    this.materials = materials;
  }

  // ---- the intrinsics of the context ----

  /** `ctx.spawn(prefabId, params, spanId)` (`spec/scenes.md` section 9). */
  spawn(prefabId: unknown, params: unknown, spanId: unknown): EntityRef {
    const prefab = typeof prefabId === "string" ? this.options.prefabs.get(prefabId) : undefined;
    if (prefab === undefined) {
      throw new RuntimeInternalError(`generated code spawned ${describeValue(prefabId)}, which is not a prefab of the manifest (prefabs: ${[...this.options.prefabs.keys()].join(", ")}).`);
    }
    if (typeof params !== "object" || params === null) {
      throw new RuntimeInternalError(`ctx.spawn("${prefab.resolved.symbol}", ${describeValue(params)}) expects the object of the prefab's params.`);
    }
    for (const param of prefab.resolved.params) {
      if (!Object.hasOwn(params, param.name)) {
        throw new RuntimeInternalError(`ctx.spawn("${prefab.resolved.symbol}", …) gives no value for the param '${param.name}'.`);
      }
    }
    // Frozen: `self.params` is read-only, and the object the generated code built is not kept.
    const frozen = Object.freeze({ ...(params as Record<string, unknown>) });
    const ref = this.slots.spawn({ prefab, params: frozen });
    if (ref === undefined) {
      this.warn("E8033", spanId, `The entity limit of ${String(this.options.maxEntities)} is reached: spawn(${prefab.resolved.name} { .. }) returns a dead reference and creates nothing.`, [
        "the limit is [runtime] max_entities in mtek.toml; entities pending removal still count until the next flush",
      ]);
      return DEAD_REF;
    }
    return ref;
  }

  /** `ctx.destroy(ref, spanId)` (`spec/scenes.md` sections 4.5 and 9). */
  destroy(ref: unknown, spanId: unknown): void {
    if (!isRefLike(ref)) throw new RuntimeInternalError(`ctx.destroy got ${describeValue(ref)}; expected an entity_ref.`);
    const outcome = this.slots.destroy(ref);
    switch (outcome) {
      case "queued": {
        const entity = this.bySlot[ref.slot];
        if (entity !== undefined) entity.removing = true;
        return;
      }
      case "cancelled":
        return;
      case "static":
        this.warn("E8030", spanId, "A named entity cannot be destroyed: it lives as long as the scene. The call does nothing.", ["hide it with `visible: false`"]);
        return;
      case "pending":
        this.warn("W8032", spanId, "This entity is already pending removal: destroying it again does nothing.");
        return;
      case "dead":
        this.warn("W8032", spanId, "This entity is already destroyed (or the reference is dead): destroying it again does nothing.");
        return;
    }
  }

  /** `ctx.alive(ref)`. */
  alive(ref: unknown): boolean {
    if (!isRefLike(ref)) throw new RuntimeInternalError(`ctx.alive got ${describeValue(ref)}; expected an entity_ref.`);
    return this.slots.isAlive(ref);
  }

  /**
   * For a command aimed at an entity through a reference (body commands, `spec/physics.md` section 3): the
   * spawned entity `ref` names if it can take the command now. A command for an entity that is pending removal
   * is dropped with `W8031`, one for a pending spawn (nothing exists yet) or a dead reference likewise; named
   * entities are not spawned entities and give `undefined` silently (the caller finds them by index).
   */
  commandTarget(ref: EntityRef, spanId: number, command: string): DynamicEntity | undefined {
    const status = this.slots.status(ref);
    if (status === "alive") return this.bySlot[ref.slot];
    if (status === "static") return undefined;
    const why = status === "pending-removal" ? "pending removal" : status === "pending-spawn" ? "not created yet" : "destroyed or dead";
    this.warn("W8031", spanId, `The command ${command} was dropped: its entity is ${why}.`);
    return undefined;
  }

  // ---- flush points ----

  /**
   * A lifecycle flush point (`spec/scenes.md` section 10): removes the entities pending removal, then creates
   * the queued spawns in the order of the calls. An entity created here first runs in the next phase that starts
   * after the flush.
   */
  flush(): void {
    if (this.slots.pendingRemovals === 0 && this.slots.pendingSpawns === 0) return;
    const { removed, spawned } = this.slots.flush();
    if (removed.length > 0) {
      for (const ref of removed) this.remove(ref);
      this.liveList = this.liveList.filter((entity) => this.bySlot[entity.ref.slot] === entity);
    }
    if (spawned.length > 0) {
      const created: DynamicEntity[] = [];
      for (const request of spawned) created.push(this.create(request.ref, request.payload));
      this.liveList = [...this.liveList, ...created];
      // Announced once the list is consistent, in spawn order.
      for (const entity of created) this.announce(entity);
    }
    this.versionCounter += 1;
  }

  /** Evaluates the bindings of every spawned entity that is not pending removal, each prefab's in order. */
  evaluateBindings(): void {
    for (const entity of this.liveList) {
      if (!entity.removing) this.bind(entity);
    }
  }

  // ---- device recovery and hot reload ----

  /**
   * After a device loss (`spec/runtime-abi.md` section 9.4): the stores were rebuilt, so every entity that
   * exists gets its material instance and its place in the renderer again, under the same instance index, and
   * its mirrored material param values are written to the new store. The entities, slots and queues are kept.
   */
  rebuild(render: DynamicRender, materials: DynamicMaterials): void {
    this.attach(render, materials);
    for (const entity of this.liveList) {
      const instance = entity.resolved.instance;
      if (instance !== null) {
        materials.createInstance(instance);
        const mirror = entity.record.mat?.p ?? {};
        for (const param of instance.material.params) {
          // A texture or sampler is a binding of the group, made by `createInstance` (decision 0054).
          if (instance.material.resources.some((resource) => resource.name === param.name)) continue;
          materials.writeParam(instance.index, param.name, mirror[param.name]);
        }
        materials.shareInstance(instance.index);
      }
      render.addEntity(entity.resolved);
    }
  }

  /**
   * After a hot reload that did not restart the scene (decision 0064): this table takes over the generations of
   * `previous` and every spawned entity that exists there is created again under the same slot, generation and
   * params, by the new program's `init`; `carry` then moves what the program kept (transform, visibility, state,
   * imperative material params) from the old record to the new one. An entity whose prefab no longer exists is
   * dropped, and its references stay dead. Call it on an empty table, before the first frame.
   */
  restoreFrom(previous: DynamicEntities, carry: (before: DynamicEntity, after: DynamicEntity) => void): void {
    if (this.slots.capacity > this.options.staticCount || this.liveList.length > 0) {
      throw new RuntimeInternalError("a hot reload restored spawned entities into a table that already has some.");
    }
    const keep = previous.liveList.filter((entity) => !entity.removing && this.options.prefabs.has(entity.prefab.resolved.symbol));
    const kept = new Set(keep.map((entity) => entity.ref.slot));
    this.slots = EntitySlots.successor<SpawnRequest>(previous.slots, this.options.staticCount, this.options.maxEntities, (slot) => kept.has(slot));
    this.nextOrder = 0;
    const created: DynamicEntity[] = [];
    for (const old of keep) {
      const prefab = this.options.prefabs.get(old.prefab.resolved.symbol);
      if (prefab === undefined) continue;
      const entity = this.create(old.ref, { prefab, params: old.record.params });
      carry(old, entity);
      created.push(entity);
    }
    this.liveList = created;
    this.spawnedTotal = previous.spawnedTotal;
    this.destroyedTotal = previous.destroyedTotal;
    for (const entity of created) this.announce(entity);
    this.versionCounter += 1;
  }

  // ---- internals ----

  /** Creates the entity of `ref` (its slot is alive already): record, GPU state, `init`, bindings. */
  private create(ref: EntityRef, request: SpawnRequest): DynamicEntity {
    const { render, materials } = this.attached();
    const { prefab, params } = request;
    const slot = ref.slot;
    let instance: ResolvedInstance | null = null;
    const material = prefab.resolved.material;
    if (material !== null) {
      instance = {
        index: this.takeInstance(),
        material: material.material,
        entity: slot,
        shareable: material.shareable,
        resources: material.resources,
      };
    }
    const resolved: ResolvedEntity = {
      index: slot,
      name: prefab.resolved.name,
      symbol: prefab.resolved.symbol,
      parent: null,
      mesh: prefab.resolved.mesh,
      instance,
      ...(prefab.resolved.particles === undefined ? {} : { particles: prefab.resolved.particles }),
      ...(prefab.resolved.clip === undefined ? {} : { clip: prefab.resolved.clip }),
    };
    const host = this.options.host;
    const record = host.makeRecord(ref, resolved, prefab, params);
    const entity: DynamicEntity = { record, resolved, ref, prefab, tag: prefab.resolved.tag, order: this.nextOrder++, removing: false, attachments: new Map() };
    this.bySlot[slot] = entity;
    host.register(slot, record, resolved);
    if (instance !== null) materials.createInstance(instance);
    render.addEntity(resolved);
    prefab.program.init(host.ctx, record, params);
    this.bind(entity);
    if (instance !== null && instance.shareable) materials.shareInstance(instance.index);
    this.spawnedTotal += 1;
    return entity;
  }

  private announce(entity: DynamicEntity): void {
    for (const listener of this.listeners) listener.created?.(entity);
  }

  /** Releases everything the removed entity `ref` owns. */
  private remove(ref: EntityRef): void {
    const { render, materials } = this.attached();
    const entity = this.bySlot[ref.slot];
    if (entity === undefined) return;
    for (const listener of this.listeners) listener.removed?.(entity);
    entity.attachments.clear();
    render.removeEntity(entity.resolved);
    const instance = entity.resolved.instance;
    if (instance !== null) {
      materials.removeInstance(instance.index);
      this.freeInstances.push(instance.index);
    }
    this.options.host.unregister(ref.slot, entity.record);
    this.bySlot[ref.slot] = undefined;
    this.destroyedTotal += 1;
  }

  private takeInstance(): number {
    return this.freeInstances.pop() ?? this.nextInstance++;
  }

  /** Evaluates the bindings of one instance in order and applies each value through the context's setters. */
  private bind(entity: DynamicEntity): void {
    const steps = entity.prefab.steps;
    if (steps.length === 0) return;
    const ctx = this.options.host.ctx as BindingContext;
    const record = entity.record;
    for (const step of steps) {
      const value = step.compute(this.options.host.ctx, record);
      const target = step.binding.target;
      switch (target.kind) {
        case "transform":
          ctx.setTransform(record, target.field, value);
          break;
        case "visible":
          ctx.setVisible(record, value as boolean);
          break;
        case "param":
          ctx.setParam(record, target.name, value);
          break;
        default:
          throw new RuntimeInternalError(`binding ${String(step.binding.id)} of prefab '${entity.prefab.resolved.name}' targets a ${target.kind}, which a prefab cannot bind.`);
      }
    }
  }

  private attached(): { readonly render: DynamicRender; readonly materials: DynamicMaterials } {
    if (this.render === undefined || this.materials === undefined) {
      throw new RuntimeInternalError("a spawned entity was created before the scene's renderer and materials existed (spawn is not allowed during initialisation).");
    }
    return { render: this.render, materials: this.materials };
  }

  private warn(code: "E8030" | "W8031" | "W8032" | "E8033", spanId: unknown, message: string, notes: readonly string[] = []): void {
    this.options.host.report(
      makeRuntimeDiagnostic(code, {
        phase: this.options.host.phase,
        message,
        notes,
        source: typeof spanId === "number" && Number.isInteger(spanId) ? this.options.host.source(spanId) : null,
      }),
    );
  }
}
