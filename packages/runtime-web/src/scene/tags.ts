/**
 * Tag queries (`spec/scenes.md` section 17, decision 0150): `count_tagged`, `first_tagged`, `nearest_tagged`,
 * `has_tag`, `tagged` and `destroy_tagged` over the entities for which `alive` is true, in stable instance order:
 * the named entities by static index, then the spawned ones in spawn order. A spawned entity pending removal is
 * not alive, so it is not found; one spawned in this frame does not exist before the next flush, so neither is it.
 */
import { RuntimeInternalError } from "./errors.js";
import { DEAD_REF, type EntityRef } from "./slots.js";
import { describeValue, type Vec3 } from "./values.js";

/** A spawned entity, as far as the tag queries need it. */
export interface TaggedSpawn {
  readonly ref: EntityRef;
  readonly removing: boolean;
  readonly tag: string | undefined;
}

/** What the tag queries need of the world. */
export interface TagWorld {
  /** The tag of every named entity, by static index (`undefined`: none). */
  readonly staticTags: readonly (string | undefined)[];
  /** The ref of the named entity with static index `index`. */
  staticRef(index: number): EntityRef;
  /** The spawned entities that exist, in spawn order (including those pending removal). The list is not copied per call. */
  spawned(): readonly TaggedSpawn[];
  /** The spawned entity in `slot`, if there is one: `has_tag` looks a slot up instead of searching. */
  spawnedAt?(slot: number): TaggedSpawn | undefined;
  /** The world position of the entity in `slot`, current as of the call. */
  worldPosition(slot: number): Vec3;
  alive(ref: EntityRef): boolean;
  destroy(ref: EntityRef): void;
}

function tagArgument(tag: unknown, member: string): string {
  if (typeof tag !== "string") throw new RuntimeInternalError(`ctx.${member} got ${describeValue(tag)}; expected a tag string.`);
  return tag;
}

/** The context members of the tag queries. */
export class TagQueries {
  constructor(private readonly world: TagWorld) {}

  /** The live entities with `tag`, lazily: one destroyed before its turn is skipped. */
  *entities(tag: string): Generator<EntityRef, void, undefined> {
    const { staticTags } = this.world;
    for (let index = 0; index < staticTags.length; index++) {
      if (staticTags[index] === tag) yield this.world.staticRef(index);
    }
    // A snapshot of the spawned entities: one spawned during the loop exists only after the next flush anyway.
    for (const entity of this.world.spawned().slice()) {
      if (entity.tag === tag && !entity.removing) yield entity.ref;
    }
  }

  countTagged(tag: unknown): number {
    let count = 0;
    for (const ref of this.entities(tagArgument(tag, "countTagged"))) {
      void ref;
      count += 1;
    }
    return count;
  }

  firstTagged(tag: unknown): EntityRef {
    for (const ref of this.entities(tagArgument(tag, "firstTagged"))) return ref;
    return DEAD_REF;
  }

  nearestTagged(tag: unknown, point: unknown): EntityRef {
    const name = tagArgument(tag, "nearestTagged");
    if (typeof point !== "object" || point === null) throw new RuntimeInternalError(`ctx.nearestTagged got the point ${describeValue(point)}; expected a vec3.`);
    const { x, y, z } = point as Vec3;
    let best: EntityRef = DEAD_REF;
    let bestDistance = Infinity;
    for (const ref of this.entities(name)) {
      const at = this.world.worldPosition(ref.slot);
      const distance = (at.x - x) ** 2 + (at.y - y) ** 2 + (at.z - z) ** 2;
      // Strictly nearer: a tie keeps the first in instance order.
      if (distance < bestDistance || best === DEAD_REF) {
        best = ref;
        bestDistance = distance;
      }
    }
    return best;
  }

  hasTag(ref: unknown, tag: unknown): boolean {
    const name = tagArgument(tag, "hasTag");
    const target = ref as EntityRef;
    if (!this.world.alive(target)) return false;
    const { staticTags } = this.world;
    if (target.slot < staticTags.length) return staticTags[target.slot] === name;
    const entity =
      this.world.spawnedAt === undefined
        ? this.world.spawned().find((e) => e.ref.slot === target.slot && e.ref.gen === target.gen)
        : this.world.spawnedAt(target.slot);
    return entity !== undefined && entity.ref.gen === target.gen && entity.tag === name;
  }

  tagged(tag: unknown): Iterable<EntityRef> {
    return this.entities(tagArgument(tag, "tagged"));
  }

  destroyTagged(tag: unknown): void {
    const name = tagArgument(tag, "destroyTagged");
    for (const entity of this.world.spawned().slice()) {
      if (entity.tag === name && !entity.removing) this.world.destroy(entity.ref);
    }
  }
}
