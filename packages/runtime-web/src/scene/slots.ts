/**
 * The entity table: slots, generations and the queues of `spawn` and `destroy` (`spec/scenes.md` sections 9 and
 * 10, decision 0064). It knows nothing of GPUs, records or programs; `DynamicEntities` (`./dynamic.ts`) creates
 * and releases what lives in the slots.
 *
 * Slots `0 .. staticCount - 1` are the named entities of the scene: generation 0, alive for the whole life of
 * the scene, never destroyed (`E8030`). The slots above are spawned entities. A slot goes through
 *
 *   free -> reserved (`spawn`, queued) -> alive (flush) -> removing (`destroy`, queued) -> free (flush)
 *
 * and a reserved slot that is destroyed before the flush is *cancelled* (nothing is ever created) and goes
 * back to free at the flush. Freeing a slot increases its generation, so a reference `{ slot, gen }` made
 * before can never reach the entity that uses the slot later: slots are reused, generations are not.
 *
 * `spawn` reserves the slot and hands out the reference at once ("valid immediately", `alive` false until the
 * flush); `destroy` marks the entity as pending removal at once (`alive` false, its handlers skipped); both take
 * effect at the next flush point (`flush`), which processes the removals first and then the spawns in the order
 * of the calls. A slot that a flush frees can therefore be reserved by a spawn of the next frame, never by a
 * spawn of the same flush.
 */

/** `entity_ref` (`spec/runtime-abi.md` section 4.1). Static entities: slot = static index, generation 0. */
export interface EntityRef {
  readonly slot: number;
  readonly gen: number;
}

/** What `spawn` returns when the entity limit is reached: it is never alive and never equal to a live reference. */
export const DEAD_REF: EntityRef = Object.freeze({ slot: -1, gen: 0 });

/** A frozen reference to `slot` at generation `gen`. */
export function makeRef(slot: number, gen: number): EntityRef {
  return Object.freeze({ slot, gen });
}

const FREE = 0;
const RESERVED = 1;
const ALIVE = 2;
const REMOVING = 3;
const CANCELLED = 4;

/** What a reference stands for right now. */
export type RefStatus =
  /** A named entity of the scene: alive for the life of the scene. */
  | "static"
  /** Spawned and created. */
  | "alive"
  /** Spawned, creation queued for the next flush: `alive` is false. */
  | "pending-spawn"
  /** Destroyed, removal queued for the next flush: `alive` is false. */
  | "pending-removal"
  /** Stale (the entity was removed, its slot may be in use again), dead (`DEAD_REF`) or never valid. */
  | "dead";

/** What `destroy` did. */
export type DestroyOutcome =
  /** Queued: the entity is pending removal from now on. */
  | "queued"
  /** The entity was spawned in this flush cycle and never created; nothing will be. */
  | "cancelled"
  /** A named entity: nothing happens (`E8030`). */
  | "static"
  /** Already pending removal: nothing happens (`W8032`). */
  | "pending"
  /** Stale or dead: nothing happens (`W8032`). */
  | "dead";

/** A spawn the flush must carry out. */
export interface QueuedSpawn<P> {
  readonly ref: EntityRef;
  readonly payload: P;
}

/** What a flush did, for the owner of the slots to act on. */
export interface FlushResult<P> {
  /** The entities removed, in the order of the `destroy` calls: release what they own (their slot is free already). */
  readonly removed: readonly EntityRef[];
  /** The spawns to create, in the order of the `spawn` calls. */
  readonly spawned: readonly QueuedSpawn<P>[];
  /** Spawns cancelled by a `destroy` before the flush: nothing to create or release. */
  readonly cancelled: number;
}

export class EntitySlots<P = unknown> {
  readonly staticCount: number;
  readonly maxEntities: number;

  /** Generation per slot: the generation the slot's current (or, when free, next) entity has. */
  private readonly gens: number[] = [];
  private readonly states: number[] = [];
  /** Freed slots, the most recently freed last (reused first). */
  private free: number[] = [];
  private spawnQueue: { slot: number; payload: P }[] = [];
  private removeQueue: number[] = [];
  /** Spawned slots that are not free. */
  private dynamicInUse = 0;
  private dynamicAlive = 0;

  constructor(staticCount: number, maxEntities: number) {
    if (!Number.isInteger(staticCount) || staticCount < 0) throw new RangeError(`EntitySlots: staticCount must be a non-negative integer, got ${String(staticCount)}`);
    if (!Number.isInteger(maxEntities) || maxEntities < 1) throw new RangeError(`EntitySlots: maxEntities must be a positive integer, got ${String(maxEntities)}`);
    this.staticCount = staticCount;
    this.maxEntities = maxEntities;
    for (let slot = 0; slot < staticCount; slot += 1) {
      this.gens.push(0);
      this.states.push(ALIVE);
    }
  }

  /**
   * The table that follows `previous` after a hot reload (decision 0064): the same generations, so references
   * the program kept in its state stay stale, and the spawned entities that were alive stay alive in the same
   * slots (the caller creates their records again), except those `keep` rejects. Anything queued or pending
   * removal, and what `keep` rejects, is dropped: its slot is free again, one generation later.
   */
  static successor<P>(
    previous: EntitySlots<unknown>,
    staticCount: number,
    maxEntities: number,
    keep: (slot: number) => boolean = () => true,
  ): EntitySlots<P> {
    const table = new EntitySlots<P>(staticCount, maxEntities);
    for (let slot = staticCount; slot < previous.gens.length; slot += 1) {
      const state = previous.states[slot] ?? FREE;
      const gen = previous.gens[slot] ?? 0;
      const alive = state === ALIVE && keep(slot);
      table.gens.push(alive || state === FREE ? gen : gen + 1);
      table.states.push(alive ? ALIVE : FREE);
      if (alive) {
        table.dynamicInUse += 1;
        table.dynamicAlive += 1;
      } else {
        table.free.push(slot);
      }
    }
    return table;
  }

  /** The number of slots the table has (static plus every spawned slot ever used). */
  get capacity(): number {
    return this.gens.length;
  }

  /** Entities that count against the limit: named, alive, pending spawn and pending removal. */
  get inUse(): number {
    return this.staticCount + this.dynamicInUse;
  }

  /** Entities for which `alive` is true: the named ones and the spawned ones that are created and not pending removal. */
  get aliveCount(): number {
    return this.staticCount + this.dynamicAlive;
  }

  get pendingSpawns(): number {
    return this.spawnQueue.length;
  }

  get pendingRemovals(): number {
    return this.removeQueue.length;
  }

  /** The generation `slot` has now, or `undefined` outside the table. */
  generation(slot: number): number | undefined {
    return this.gens[slot];
  }

  /**
   * Reserves a slot for a spawn queued with `payload` and returns its reference, or `undefined` when the limit
   * (`maxEntities`) is reached. The entity does not exist until the next `flush`.
   */
  spawn(payload: P): EntityRef | undefined {
    if (this.inUse >= this.maxEntities) return undefined;
    let slot = this.free.pop();
    if (slot === undefined) {
      slot = this.gens.length;
      this.gens.push(0);
      this.states.push(FREE);
    }
    this.states[slot] = RESERVED;
    this.dynamicInUse += 1;
    this.spawnQueue.push({ slot, payload });
    return makeRef(slot, this.gens[slot] ?? 0);
  }

  status(ref: EntityRef): RefStatus {
    const slot = ref.slot;
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.gens.length) return "dead";
    if (this.gens[slot] !== ref.gen) return "dead";
    if (slot < this.staticCount) return "static";
    switch (this.states[slot]) {
      case RESERVED:
        return "pending-spawn";
      case ALIVE:
        return "alive";
      case REMOVING:
      case CANCELLED:
        return "pending-removal";
      default:
        return "dead";
    }
  }

  /** `alive(ref)`: true for a named entity and for a spawned one that exists and is not pending removal. */
  isAlive(ref: EntityRef): boolean {
    const status = this.status(ref);
    return status === "static" || status === "alive";
  }

  /** `destroy(ref)`: the entity is pending removal from now on; the flush removes it. */
  destroy(ref: EntityRef): DestroyOutcome {
    switch (this.status(ref)) {
      case "static":
        return "static";
      case "dead":
        return "dead";
      case "pending-removal":
        return "pending";
      case "pending-spawn":
        this.states[ref.slot] = CANCELLED;
        return "cancelled";
      case "alive":
        this.states[ref.slot] = REMOVING;
        this.dynamicAlive -= 1;
        this.removeQueue.push(ref.slot);
        return "queued";
    }
  }

  /**
   * A flush point (`spec/scenes.md` section 10): the removals first, each slot freed with a new generation, then
   * the spawns in the order of the calls. Returns what the owner has to release and create.
   */
  flush(): FlushResult<P> {
    const removed: EntityRef[] = [];
    for (const slot of this.removeQueue) {
      removed.push(makeRef(slot, this.gens[slot] ?? 0));
      this.release(slot);
    }
    this.removeQueue = [];
    const spawned: QueuedSpawn<P>[] = [];
    let cancelled = 0;
    for (const { slot, payload } of this.spawnQueue) {
      if (this.states[slot] === CANCELLED) {
        cancelled += 1;
        this.release(slot);
        continue;
      }
      this.states[slot] = ALIVE;
      this.dynamicAlive += 1;
      spawned.push({ ref: makeRef(slot, this.gens[slot] ?? 0), payload });
    }
    this.spawnQueue = [];
    return { removed, spawned, cancelled };
  }

  /** Frees `slot` under the next generation. */
  private release(slot: number): void {
    this.gens[slot] = (this.gens[slot] ?? 0) + 1;
    this.states[slot] = FREE;
    this.dynamicInUse -= 1;
    this.free.push(slot);
  }
}
