/**
 * Tag queries (decision 0150) over a stand-in world: instance order (named, then spawned in spawn order), entities
 * pending removal, ties of `nearest_tagged`, the lazy `tagged` loop and `destroy_tagged`.
 */
import { describe, expect, it } from "vitest";
import { RuntimeInternalError } from "./errors.js";
import { DEAD_REF, makeRef, type EntityRef } from "./slots.js";
import { TagQueries, type TagWorld, type TaggedSpawn } from "./tags.js";

interface Spawn extends TaggedSpawn {
  removing: boolean;
  readonly at: { x: number; y: number; z: number };
}

function world(staticTags: (string | undefined)[], staticAt: { x: number; y: number; z: number }[], spawns: Spawn[]) {
  const destroyed: EntityRef[] = [];
  const stand: TagWorld = {
    staticTags,
    staticRef: (index) => makeRef(index, 0),
    spawned: () => spawns,
    worldPosition: (slot) => (slot < staticTags.length ? staticAt[slot] : spawns.find((s) => s.ref.slot === slot)?.at) ?? { x: 0, y: 0, z: 0 },
    alive: (ref) => (ref.slot >= 0 && ref.slot < staticTags.length) || spawns.some((s) => s.ref.slot === ref.slot && s.ref.gen === ref.gen && !s.removing),
    destroy: (ref) => {
      destroyed.push(ref);
      const entity = spawns.find((s) => s.ref.slot === ref.slot);
      if (entity !== undefined) entity.removing = true;
    },
  };
  return { queries: new TagQueries(stand), destroyed };
}

const spawn = (slot: number, tag: string | undefined, x: number, gen = 1): Spawn => ({ ref: makeRef(slot, gen), removing: false, tag, at: { x, y: 0, z: 0 } });

describe("tag queries", () => {
  it("count and visit the named entities first, then the spawned ones in spawn order", () => {
    const rocks = [spawn(5, "rock", 1), spawn(3, "coin", 2), spawn(4, "rock", 3)];
    const { queries } = world(["player", "rock", undefined], [{ x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], rocks);
    expect(queries.countTagged("rock")).toBe(3);
    expect([...queries.tagged("rock")].map((r) => r.slot)).toEqual([1, 5, 4]);
    expect(queries.firstTagged("rock")).toEqual(makeRef(1, 0));
    expect(queries.firstTagged("none")).toBe(DEAD_REF);
    expect(queries.countTagged("none")).toBe(0);
  });

  it("skip entities pending removal, also those destroyed during a loop", () => {
    const spawns = [spawn(2, "rock", 1), spawn(3, "rock", 2), spawn(4, "rock", 3)];
    (spawns[1] as Spawn).removing = true;
    const { queries } = world([], [], spawns);
    expect(queries.countTagged("rock")).toBe(2);
    const visited: number[] = [];
    for (const ref of queries.tagged("rock")) {
      visited.push(ref.slot);
      // Destroying the last one before its turn: the loop skips it.
      (spawns[2] as Spawn).removing = true;
    }
    expect(visited).toEqual([2]);
  });

  it("find the nearest by world position; a tie keeps the first in instance order", () => {
    const { queries } = world(["rock"], [{ x: -2, y: 0, z: 0 }], [spawn(1, "rock", 2), spawn(2, "rock", 0.5)]);
    expect(queries.nearestTagged("rock", { x: 0, y: 0, z: 0 })).toEqual(makeRef(2, 1));
    expect(queries.nearestTagged("rock", { x: 0, y: 0, z: 0.0 })).toEqual(makeRef(2, 1));
    expect(queries.nearestTagged("rock", { x: 0, y: 0, z: 0 }).slot).toBe(2);
    // -2 and 2 are both 2 away from 0 when the 0.5 one is gone: the named one comes first.
    const tie = world(["rock"], [{ x: -2, y: 0, z: 0 }], [spawn(1, "rock", 2)]);
    expect(tie.queries.nearestTagged("rock", { x: 0, y: 0, z: 0 })).toEqual(makeRef(0, 0));
    expect(tie.queries.nearestTagged("none", { x: 0, y: 0, z: 0 })).toBe(DEAD_REF);
  });

  it("answer has_tag for live entities only", () => {
    const spawns = [spawn(2, "rock", 0)];
    const { queries } = world(["player", undefined], [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], spawns);
    expect(queries.hasTag(makeRef(0, 0), "player")).toBe(true);
    expect(queries.hasTag(makeRef(1, 0), "player")).toBe(false);
    expect(queries.hasTag(makeRef(2, 1), "rock")).toBe(true);
    expect(queries.hasTag(makeRef(2, 7), "rock")).toBe(false);
    expect(queries.hasTag(DEAD_REF, "rock")).toBe(false);
    (spawns[0] as Spawn).removing = true;
    expect(queries.hasTag(makeRef(2, 1), "rock")).toBe(false);
  });

  it("destroy_tagged queues the removal of the live spawned entities with the tag", () => {
    const spawns = [spawn(2, "rock", 0), spawn(3, "coin", 0), spawn(4, "rock", 0)];
    (spawns[2] as Spawn).removing = true;
    const { queries, destroyed } = world(["rock"], [{ x: 0, y: 0, z: 0 }], spawns);
    queries.destroyTagged("rock");
    expect(destroyed).toEqual([makeRef(2, 1)]);
    expect(queries.countTagged("rock")).toBe(1);
  });

  it("reject a tag that is not a string", () => {
    const { queries } = world([], [], []);
    expect(() => queries.countTagged(3)).toThrow(RuntimeInternalError);
    expect(() => queries.nearestTagged("rock", null)).toThrow(RuntimeInternalError);
  });
});
