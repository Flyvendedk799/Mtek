/**
 * The opaque entity IDs of the host boundary (`inspectScene`, `readTransforms`, `writeTransforms`, the physics API of
 * decision 0217). An ID is the scene generation plus the declaration symbol of a named entity, or plus the slot and
 * generation of a spawned one, so a stale ID never names another entity. One `EntityIds` per application keeps the
 * generation numbers the same for every user of the boundary.
 */
import type { EntityRecord, World } from "../scene/world.js";

export class EntityIds {
  private readonly epochs = new WeakMap<World, number>();
  private nextEpoch = 0;

  constructor(private readonly getWorld: () => World) {}

  private prefix(world: World): string {
    let epoch = this.epochs.get(world);
    if (epoch === undefined) {
      epoch = ++this.nextEpoch;
      this.epochs.set(world, epoch);
    }
    return `scene:${String(epoch)}:`;
  }

  /** Every live entity of the current world by ID (named entities, then spawned ones not pending removal). */
  records(): Map<string, EntityRecord> {
    const world = this.getWorld();
    const entries = new Map<string, EntityRecord>();
    const prefix = this.prefix(world);
    for (let slot = 0; slot < world.entities.length; slot++) {
      const entity = world.resolvedAt(slot);
      const record = world.recordAt(slot);
      if (entity !== undefined && record !== undefined) entries.set(prefix + entity.symbol, record);
    }
    for (const entity of world.dynamic.live) {
      if (!entity.removing) entries.set(`${prefix}spawn:${String(entity.ref.slot)}:${String(entity.ref.gen)}`, entity.record);
    }
    return entries;
  }

  /**
   * The ID of the entity in `slot` of the current world, also when it is pending removal (a physics body leaves the
   * simulation at the next flush, so a query can still hit it); `undefined` for a slot without an entity.
   */
  idOfSlot(slot: number): string | undefined {
    const world = this.getWorld();
    const record = world.recordAt(slot);
    if (record === undefined) return undefined;
    const prefix = this.prefix(world);
    if (slot < world.entities.length) {
      const entity = world.resolvedAt(slot);
      return entity === undefined ? undefined : prefix + entity.symbol;
    }
    return `${prefix}spawn:${String(slot)}:${String(record.ref.gen)}`;
  }
}
