/**
 * The entity table (`spec/scenes.md` sections 9 and 10, decision 0064): slots, generations, the queues of
 * `spawn` and `destroy` and the flush that applies them. Every expectation is derived by hand from the rules:
 *
 *   free -> reserved (spawn) -> alive (flush) -> removing (destroy) -> free (flush, generation + 1)
 *
 * Two named entities occupy the slots 0 and 1 (generation 0, never destroyed); the first spawned entity gets slot 2.
 */
import { describe, expect, it } from "vitest";
import { DEAD_REF, EntitySlots, makeRef } from "./slots.js";

function table(maxEntities = 10): EntitySlots<string> {
  return new EntitySlots<string>(2, maxEntities);
}

/** Spawns and returns the reference, failing the test when the limit refused. */
function spawn(slots: EntitySlots<string>, payload: string) {
  const ref = slots.spawn(payload);
  if (ref === undefined) throw new Error(`spawn(${payload}) was refused`);
  return ref;
}

describe("the named entities", () => {
  it("are slots 0..n-1 at generation 0, alive for ever, and cannot be destroyed", () => {
    const slots = table();
    for (const slot of [0, 1]) {
      const ref = makeRef(slot, 0);
      expect(slots.status(ref)).toBe("static");
      expect(slots.isAlive(ref)).toBe(true);
      expect(slots.destroy(ref)).toBe("static");
      expect(slots.status(ref)).toBe("static");
    }
    expect(slots.pendingRemovals).toBe(0);
    expect(slots.aliveCount).toBe(2);
    expect(slots.inUse).toBe(2);
  });

  it("are not reached by a reference of another generation, nor by an index outside the table", () => {
    const slots = table();
    expect(slots.status(makeRef(0, 1))).toBe("dead");
    expect(slots.status(makeRef(2, 0))).toBe("dead");
    expect(slots.status(makeRef(7, 0))).toBe("dead");
  });
});

describe("spawn", () => {
  it("returns a reference at once; the entity is not alive until the flush", () => {
    const slots = table();
    const ref = spawn(slots, "a");
    expect(ref).toEqual({ slot: 2, gen: 0 });
    expect(slots.status(ref)).toBe("pending-spawn");
    expect(slots.isAlive(ref)).toBe(false);
    expect(slots.aliveCount).toBe(2);
    expect(slots.inUse).toBe(3);
    expect(slots.pendingSpawns).toBe(1);

    const flushed = slots.flush();
    expect(flushed.spawned).toEqual([{ ref: { slot: 2, gen: 0 }, payload: "a" }]);
    expect(flushed.removed).toEqual([]);
    expect(slots.status(ref)).toBe("alive");
    expect(slots.isAlive(ref)).toBe(true);
    expect(slots.aliveCount).toBe(3);
    expect(slots.pendingSpawns).toBe(0);
  });

  it("creates in the order of the calls", () => {
    const slots = table();
    const a = spawn(slots, "a");
    const b = spawn(slots, "b");
    const c = spawn(slots, "c");
    expect([a.slot, b.slot, c.slot]).toEqual([2, 3, 4]);
    expect(slots.flush().spawned.map((s) => s.payload)).toEqual(["a", "b", "c"]);
  });

  it("returns refs that are frozen", () => {
    const ref = spawn(table(), "a");
    expect(Object.isFrozen(ref)).toBe(true);
    expect(Object.isFrozen(DEAD_REF)).toBe(true);
  });
});

describe("destroy and pending removal", () => {
  it("makes the entity not alive at once; the flush removes it and gives the slot a new generation", () => {
    const slots = table();
    const ref = spawn(slots, "a");
    slots.flush();

    expect(slots.destroy(ref)).toBe("queued");
    // From the call on: not alive, pending removal, the table still holds it until the flush.
    expect(slots.isAlive(ref)).toBe(false);
    expect(slots.status(ref)).toBe("pending-removal");
    expect(slots.aliveCount).toBe(2);
    expect(slots.inUse).toBe(3);
    expect(slots.pendingRemovals).toBe(1);

    // A second destroy of the same entity does nothing (W8032).
    expect(slots.destroy(ref)).toBe("pending");
    expect(slots.pendingRemovals).toBe(1);

    const flushed = slots.flush();
    expect(flushed.removed).toEqual([{ slot: 2, gen: 0 }]);
    expect(slots.status(ref)).toBe("dead");
    expect(slots.generation(2)).toBe(1);
    expect(slots.inUse).toBe(2);
    // Destroying what is removed does nothing either.
    expect(slots.destroy(ref)).toBe("dead");
  });

  it("removes in the order of the destroy calls", () => {
    const slots = table();
    const a = spawn(slots, "a");
    const b = spawn(slots, "b");
    const c = spawn(slots, "c");
    slots.flush();
    slots.destroy(c);
    slots.destroy(a);
    slots.destroy(b);
    expect(slots.flush().removed).toEqual([c, a, b]);
  });

  it("cancels a spawn that is destroyed before the flush: nothing is created, the reference stays dead", () => {
    // Spawn then destroy in one handler (spec/scenes.md section 10.3).
    const slots = table();
    const ref = spawn(slots, "a");
    expect(slots.destroy(ref)).toBe("cancelled");
    expect(slots.isAlive(ref)).toBe(false);
    expect(slots.status(ref)).toBe("pending-removal");
    expect(slots.pendingRemovals).toBe(0);

    const flushed = slots.flush();
    expect(flushed.spawned).toEqual([]);
    expect(flushed.removed).toEqual([]);
    expect(flushed.cancelled).toBe(1);
    expect(slots.status(ref)).toBe("dead");
    expect(slots.generation(2)).toBe(1);
    expect(slots.inUse).toBe(2);
  });

  it("destroying the reference of a dead or foreign entity changes nothing", () => {
    const slots = table();
    expect(slots.destroy(DEAD_REF)).toBe("dead");
    expect(slots.destroy(makeRef(9, 0))).toBe("dead");
    expect(slots.pendingRemovals).toBe(0);
  });
});

describe("generations: a stale reference never reaches a newer entity in the same slot", () => {
  it("a slot is reused after its entity was removed, under the next generation", () => {
    const slots = table();
    const first = spawn(slots, "first");
    slots.flush();
    slots.destroy(first);
    slots.flush();

    const second = spawn(slots, "second");
    // The freed slot is reused, with generation 1.
    expect(second).toEqual({ slot: 2, gen: 1 });
    slots.flush();

    // The old reference is stale: not alive, not equal to the new one, and destroying it does nothing.
    expect(slots.isAlive(first)).toBe(false);
    expect(slots.status(first)).toBe("dead");
    expect(first).not.toEqual(second);
    expect(slots.destroy(first)).toBe("dead");
    // The newer entity is untouched.
    expect(slots.isAlive(second)).toBe(true);
    expect(slots.status(second)).toBe("alive");
    expect(slots.pendingRemovals).toBe(0);
    // And it is the new reference that destroys it.
    expect(slots.destroy(second)).toBe("queued");
  });

  it("holds over many cycles through one slot, and the table does not grow", () => {
    const slots = table();
    const refs = [];
    for (let cycle = 0; cycle < 1000; cycle += 1) {
      const ref = spawn(slots, `e${String(cycle)}`);
      slots.flush();
      refs.push(ref);
      slots.destroy(ref);
      slots.flush();
    }
    // Always slot 2; generations 0..999, so every reference differs and every old one is dead.
    expect(refs.every((ref, cycle) => ref.slot === 2 && ref.gen === cycle)).toBe(true);
    expect(refs.every((ref) => slots.status(ref) === "dead")).toBe(true);
    expect(slots.capacity).toBe(3);
    expect(slots.generation(2)).toBe(1000);
    expect(slots.inUse).toBe(2);
  });

  it("a cancelled spawn leaves its reference stale too", () => {
    const slots = table();
    const cancelled = spawn(slots, "a");
    slots.destroy(cancelled);
    slots.flush();
    const next = spawn(slots, "b");
    slots.flush();
    expect(next).toEqual({ slot: 2, gen: 1 });
    expect(slots.isAlive(cancelled)).toBe(false);
    expect(slots.isAlive(next)).toBe(true);
  });

  it("a slot freed by a flush is reused by the next spawn, not by one of the same flush", () => {
    const slots = table();
    const a = spawn(slots, "a");
    slots.flush();
    slots.destroy(a);
    // Pending removal: the slot is still taken, so this spawn gets a new one.
    const b = spawn(slots, "b");
    expect(b).toEqual({ slot: 3, gen: 0 });
    const flushed = slots.flush();
    expect(flushed.removed).toEqual([{ slot: 2, gen: 0 }]);
    expect(flushed.spawned).toEqual([{ ref: { slot: 3, gen: 0 }, payload: "b" }]);
    const c = spawn(slots, "c");
    expect(c).toEqual({ slot: 2, gen: 1 });
  });
});

describe("the entity limit", () => {
  it("refuses a spawn beyond max_entities and accepts one again after a flush freed a slot", () => {
    const slots = table(4); // 2 named + 2 spawned
    const a = spawn(slots, "a");
    spawn(slots, "b");
    expect(slots.spawn("c")).toBeUndefined();
    expect(slots.pendingSpawns).toBe(2);

    slots.flush();
    expect(slots.spawn("c")).toBeUndefined();
    slots.destroy(a);
    // Pending removal still counts until the flush.
    expect(slots.spawn("c")).toBeUndefined();
    slots.flush();
    expect(slots.spawn("c")).toEqual({ slot: 2, gen: 1 });
  });

  it("counts a reservation and frees it when it is cancelled", () => {
    const slots = table(3);
    const a = spawn(slots, "a");
    expect(slots.spawn("b")).toBeUndefined();
    slots.destroy(a);
    // The cancelled reservation holds its slot until the flush, like any pending removal.
    expect(slots.spawn("b")).toBeUndefined();
    slots.flush();
    expect(slots.spawn("b")).toEqual({ slot: 2, gen: 1 });
  });

  it("the dead reference is never alive and never equal to a live one", () => {
    const slots = table();
    expect(slots.isAlive(DEAD_REF)).toBe(false);
    expect(slots.status(DEAD_REF)).toBe("dead");
    expect(DEAD_REF.slot).toBeLessThan(0);
  });
});

describe("the successor table of a hot reload", () => {
  it("keeps the generations, so references stay stale, and the entities that were alive", () => {
    const old = table();
    const stale = spawn(old, "a");
    old.flush();
    old.destroy(stale);
    old.flush();
    const live = spawn(old, "b"); // slot 2, gen 1
    const other = spawn(old, "c"); // slot 3, gen 0
    old.flush();

    const next = EntitySlots.successor<string>(old, 2, 10);
    expect(next.status(stale)).toBe("dead");
    expect(next.status(live)).toBe("alive");
    expect(next.status(other)).toBe("alive");
    expect(next.aliveCount).toBe(4);
    expect(next.capacity).toBe(4);
    // A new spawn takes a free slot under its next generation, never a stale generation.
    next.destroy(other);
    next.flush();
    expect(next.spawn("d")).toEqual({ slot: 3, gen: 1 });
  });

  it("drops what was queued or pending removal and what the caller does not keep, one generation later", () => {
    const old = table();
    const a = spawn(old, "a");
    const b = spawn(old, "b");
    const c = spawn(old, "c");
    old.flush();
    old.destroy(b);
    const queued = spawn(old, "queued");

    const next = EntitySlots.successor<string>(old, 2, 10, (slot) => slot !== c.slot);
    expect(next.status(a)).toBe("alive");
    expect(next.status(b)).toBe("dead");
    expect(next.status(c)).toBe("dead");
    expect(next.status(queued)).toBe("dead");
    expect(next.pendingSpawns).toBe(0);
    expect(next.pendingRemovals).toBe(0);
    expect(next.aliveCount).toBe(3);
  });
});
