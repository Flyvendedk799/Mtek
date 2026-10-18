/**
 * Spawn and destroy in the frame (`spec/scenes.md` sections 9 and 10, `spec/runtime-abi.md` sections 4.2 and 7,
 * decision 0064), through a mounted application on the fake host. A synthetic program has one named entity
 * (`Cube`, slot 0) and a prefab `Spark`; every function logs its call, so the order of a frame is an array
 * derived by hand from the rules:
 *
 *   1 input handlers   2 per tick: (a) flush, (c) fixed_update   3 update   4 flush   5 bindings   6 transforms   7 render
 *
 * The manual clock decides how many ticks a frame has (the fixed step is 1/60 s): a first frame of 0.02 s
 * runs one tick, of 0.04 s two, of 0.01 s none.
 */
import { describe, expect, it } from "vitest";
import type { EntityRef } from "../scene/slots.js";
import { FakeHost } from "../test-support/fake-host.js";
import { SPARK, TARGET, draws, frame, mountSpawn, script, type Mounted, type Script } from "../test-support/spawn-fixture.js";
import type { MtekApp } from "./types.js";


describe("when a spawn takes effect", () => {
  it("is queued by the handler and created at the flush before the tick; it runs in the same frame's tick and update", async () => {
    const s = script({
      keys: {
        Space: (ctx) => {
          s.refs.push(ctx.spawn(SPARK, { n: 1 }, 1));
          s.log.push(`alive:${String(ctx.alive(s.refs[0] as EntityRef))}`);
        },
      },
    });
    const m = await mountSpawn(s);
    m.debug.pressKey("Space");
    // Phase 1: the handler (not alive yet). Tick 1: (a) flush creates the entity (init), (c) fixed. Phase 3: update.
    expect(frame(m, s, 0.02)).toEqual(["key:Space", "alive:false", "init:1", "fixed:scene", "fixed:1", "update:scene", "update:1"]);
    expect(s.refs).toEqual([{ slot: 1, gen: 0 }]);
    expect(m.debug.scene().spawned).toMatchObject([{ prefab: "Spark", slot: 1, gen: 0, alive: true }]);
  });

  it("with no tick in the frame, is created at the flush after update and first runs in the next frame", async () => {
    const s = script({ keys: { Space: (ctx) => s.refs.push(ctx.spawn(SPARK, { n: 1 }, 1)) } });
    const m = await mountSpawn(s);
    m.debug.pressKey("Space");
    // Frame 1 is 0.01 s: no tick. Phase 3: update (the spawn is not in the list). Phase 4: flush.
    expect(frame(m, s, 0.01)).toEqual(["key:Space", "update:scene", "init:1"]);
    expect(m.debug.scene().spawned).toHaveLength(1);
    // Frame 2 (0.01 s more) has a tick: it and the update now include the entity.
    expect(frame(m, s, 0.01)).toEqual(["fixed:scene", "fixed:1", "update:scene", "update:1"]);
  });

  it("spawned in update, an entity is created at the flush after it and first updates in the next frame", async () => {
    let done = false;
    const s = script({
      sceneUpdate: (ctx) => {
        if (done) return;
        done = true;
        s.refs.push(ctx.spawn(SPARK, { n: 1 }, 1));
      },
    });
    const m = await mountSpawn(s);
    expect(frame(m, s, 0.02)).toEqual(["fixed:scene", "update:scene", "init:1"]);
    // The leftover 0.00333 s and 0.02 s make one tick.
    expect(frame(m, s, 0.02)).toEqual(["fixed:scene", "fixed:1", "update:scene", "update:1"]);
  });

  it("spawned in a fixed tick, an entity is created at the flush before the next tick and runs in it", async () => {
    let done = false;
    const s = script({
      sceneFixed: (ctx) => {
        if (done) return;
        done = true;
        s.refs.push(ctx.spawn(SPARK, { n: 1 }, 1));
      },
    });
    const m = await mountSpawn(s);
    // 0.04 s: two ticks. Tick 1 spawns; tick 2 starts with the flush, so the entity's fixed update runs in it; update has it too.
    expect(frame(m, s, 0.04)).toEqual(["fixed:scene", "init:1", "fixed:scene", "fixed:1", "update:scene", "update:1"]);
  });

  it("created in order of the calls, with the named entities first in instance order", async () => {
    const s = script({
      keys: {
        Space: (ctx) => {
          for (const n of [3, 1, 2]) s.refs.push(ctx.spawn(SPARK, { n }, 1));
        },
      },
    });
    const m = await mountSpawn(s);
    m.debug.pressKey("Space");
    expect(frame(m, s, 0.02)).toEqual(["key:Space", "init:3", "init:1", "init:2", "fixed:scene", "fixed:3", "fixed:1", "fixed:2", "update:scene", "update:3", "update:1", "update:2"]);
    expect(s.refs).toEqual([
      { slot: 1, gen: 0 },
      { slot: 2, gen: 0 },
      { slot: 3, gen: 0 },
    ]);
  });
});

describe("pending removal and the combinations of spec/scenes.md section 10.3", () => {
  /** Three entities, n = 1, 2, 3, created by a first frame of 0.02 s (one tick). */
  async function three(moreKeys: Script["keys"] = {}): Promise<{ m: Mounted; s: Script }> {
    const s = script({
      keys: {
        Space: (ctx) => {
          for (const n of [1, 2, 3]) s.refs.push(ctx.spawn(SPARK, { n }, 1));
        },
        Enter: (ctx) => {
          ctx.destroy(s.refs[1] as EntityRef, 2);
          s.log.push(`alive:${String(ctx.alive(s.refs[1] as EntityRef))}`);
        },
        ...moreKeys,
      },
    });
    const m = await mountSpawn(s);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);
    expect(m.debug.scene().spawned.map((entity) => entity.slot)).toEqual([1, 2, 3]);
    return { m, s };
  }

  it("an entity destroyed in an input handler is not alive at once and its handlers are skipped for the rest of the frame", async () => {
    const { m, s } = await three();
    // Frame 2 has no tick (0.00333 + 0.01 < 1/60): input, update, flush. Enter destroys n=2; KeyK is delivered after it.
    m.debug.pressKey("Enter");
    m.debug.pressKey("KeyK");
    expect(frame(m, s, 0.01)).toEqual(["key:Enter", "alive:false", "key:1", "key:3", "update:scene", "update:1", "update:3"]);
    // The flush removed it: only n=1 and n=3 remain, slot 2 is free.
    expect(m.debug.scene().spawned.map((entity) => entity.slot)).toEqual([1, 3]);
    expect(m.debug.counters()["liveEntities"]).toBe(3);
    expect(m.debug.counters()["entitiesDestroyed"]).toBe(1);
  });

  it("with a tick in the frame, the flush before the tick removes it, so its fixed update never runs", async () => {
    const { m, s } = await three();
    m.debug.pressKey("Enter");
    // 0.04 s: acc = 0.00333 + 0.04 -> two ticks.
    expect(frame(m, s, 0.04)).toEqual(["key:Enter", "alive:false", "fixed:scene", "fixed:1", "fixed:3", "fixed:scene", "fixed:1", "fixed:3", "update:scene", "update:1", "update:3"]);
    expect(m.debug.scene().spawned.map((entity) => entity.slot)).toEqual([1, 3]);
  });

  it("destroying a later entity from an update skips it, destroying oneself lets the iteration continue", async () => {
    const { m, s } = await three();
    s.sparkUpdate = (ctx, self) => {
      if (self.params.n === 1) {
        ctx.destroy(s.refs[1] as EntityRef, 3); // n=2, later in the list
        ctx.destroy(self.ref, 3); // itself
        s.log.push(`alive-self:${String(ctx.alive(self.ref))}`);
      }
    };
    // A no-tick frame: update runs n=1 (destroys 2 and itself), skips n=2, still runs n=3.
    expect(frame(m, s, 0.01)).toEqual(["update:scene", "update:1", "alive-self:false", "update:3"]);
    expect(m.debug.scene().spawned.map((entity) => [entity.slot, entity.prefab])).toEqual([[3, "Spark"]]);
    // The next frame (a tick): only n=3 is left.
    expect(frame(m, s, 0.02)).toEqual(["fixed:scene", "fixed:3", "update:scene", "update:3"]);
  });

  it("spawn then destroy in one handler: nothing is created, init never runs, the reference is dead", async () => {
    const s = script({
      keys: {
        Space: (ctx) => {
          const ref = ctx.spawn(SPARK, { n: 7 }, 1);
          ctx.destroy(ref, 2);
          s.refs.push(ref);
          s.log.push(`alive:${String(ctx.alive(ref))}`);
        },
      },
    });
    const m = await mountSpawn(s);
    m.debug.pressKey("Space");
    expect(frame(m, s, 0.02)).toEqual(["key:Space", "alive:false", "fixed:scene", "update:scene"]);
    expect(m.debug.scene().spawned).toEqual([]);
    expect(m.debug.counters()).toMatchObject({ liveEntities: 1, entitiesSpawned: 0, entitiesDestroyed: 0, pendingSpawns: 0, pendingRemovals: 0 });
    expect(m.reported).toEqual([]);
  });

  it("destroy and spawn in one handler: the new entity gets a new slot, the freed slot is reused by the next spawn", async () => {
    const { m, s } = await three({
      KeyR: (ctx) => {
        ctx.destroy(s.refs[1] as EntityRef, 2);
        s.refs.push(ctx.spawn(SPARK, { n: 4 }, 1));
      },
      KeyS: (ctx) => {
        s.refs.push(ctx.spawn(SPARK, { n: 5 }, 1));
      },
    });
    m.debug.pressKey("KeyR");
    // No tick: update skips n=2 (pending removal); the flush after it removes n=2 and creates n=4 in a new slot (2 is taken until then).
    expect(frame(m, s, 0.01)).toEqual(["key:KeyR", "update:scene", "update:1", "update:3", "init:4"]);
    expect(m.debug.scene().spawned.map((entity) => [entity.slot, entity.gen])).toEqual([[1, 0], [3, 0], [4, 0]]);
    // The next spawn takes the slot the flush freed, under generation 1.
    m.debug.pressKey("KeyS");
    m.debug.step(1, 0.01);
    expect(s.refs.at(-1)).toEqual({ slot: 2, gen: 1 });
    expect(m.debug.scene().spawned.map((entity) => [entity.slot, entity.gen])).toEqual([[1, 0], [3, 0], [4, 0], [2, 1]]);
  });
});

describe("a stale entity_ref never reaches a newer entity in the same slot", () => {
  it("reuses the slot under a new generation; the old reference is dead, equal to nothing, and destroying it does nothing", async () => {
    let phase = 0;
    const s = script({
      keys: {
        Space: (ctx) => {
          if (phase === 0) {
            s.refs.push(ctx.spawn(SPARK, { n: 1 }, 1));
          } else {
            s.refs.push(ctx.spawn(SPARK, { n: 2 }, 1));
          }
        },
        Enter: (ctx) => {
          ctx.destroy(s.refs[0] as EntityRef, 2);
        },
        KeyD: (ctx) => {
          // The stale reference: dead, and destroying it must not touch the entity that took its slot.
          s.log.push(`stale-alive:${String(ctx.alive(s.refs[0] as EntityRef))}`);
          s.log.push(`new-alive:${String(ctx.alive(s.refs[1] as EntityRef))}`);
          ctx.destroy(s.refs[0] as EntityRef, 3);
        },
      },
    });
    const m = await mountSpawn(s);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);
    m.debug.releaseKey("Space");
    m.debug.pressKey("Enter");
    m.debug.step(1, 0.02);
    expect(m.debug.scene().spawned).toEqual([]);
    phase = 1;
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);
    expect(s.refs).toEqual([
      { slot: 1, gen: 0 },
      { slot: 1, gen: 1 },
    ]);
    m.debug.pressKey("KeyD");
    expect(frame(m, s, 0.02).filter((line) => line.endsWith("alive:false") || line.endsWith("alive:true"))).toEqual(["stale-alive:false", "new-alive:true"]);
    // The new entity survived the stale destroy (W8032 was reported).
    expect(m.debug.scene().spawned).toMatchObject([{ prefab: "Spark", slot: 1, gen: 1, alive: true }]);
    expect(m.reported.map((d) => [d.code, d.severity])).toEqual([["MTEK-W8032", "warning"]]);
  });
});

describe("diagnostics at run time", () => {
  it("E8030 for a named entity, W8032 for a destroyed one (at the destroy call), each once per span", async () => {
    const s = script({
      keys: {
        Space: (ctx) => {
          s.refs.push(ctx.spawn(SPARK, { n: 1 }, 1));
        },
        Enter: (ctx) => {
          ctx.destroy(ctx.e[0]?.ref as EntityRef, 2); // the named Cube
          ctx.destroy(s.refs[0] as EntityRef, 3);
          ctx.destroy(s.refs[0] as EntityRef, 3); // pending: same span, not reported twice
        },
      },
    });
    const m = await mountSpawn(s);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);
    m.debug.pressKey("Enter");
    m.debug.step(1, 0.02);
    m.debug.releaseKey("Enter");
    m.debug.pressKey("Enter");
    m.debug.step(1, 0.02);
    const seen = m.reported.map((d) => [d.code, d.severity, d.source?.startByte]);
    // First Enter: E8030 at span 2 (byte 40), the destroy at span 3 (byte 60) is fine, the second one is W8032 at span 3.
    // Second Enter: both destroys repeat spans already reported (E8030 span 2, W8032 span 3) and are not delivered again.
    expect(seen).toEqual([
      ["MTEK-E8030", "error", 40],
      ["MTEK-W8032", "warning", 60],
    ]);
    expect(m.reported[0]?.source).toMatchObject({ file: "src/main.mtek", startLine: 2, startColumn: 1 });
    // The named Cube is still there.
    expect(m.debug.scene().entities.map((entity) => entity.name)).toEqual(["Cube"]);
    expect(m.debug.counters()["liveEntities"]).toBe(1);
  });

  it("E8033 at the spawn that exceeds max_entities: a dead reference, no entity, the program keeps running", async () => {
    const s = script({
      keys: {
        Space: (ctx) => {
          for (const n of [1, 2, 3]) s.refs.push(ctx.spawn(SPARK, { n }, 1));
          s.log.push(`third-alive:${String(ctx.alive(s.refs[2] as EntityRef))}`);
        },
      },
    });
    // max_entities 3: the Cube and two spawned entities.
    const m = await mountSpawn(s, { edit: (manifest) => ((manifest["runtimeConfig"] as Record<string, unknown>)["maxEntities"] = 3) });
    m.debug.pressKey("Space");
    expect(frame(m, s, 0.02).filter((line) => line.startsWith("init:") || line.startsWith("third"))).toEqual(["third-alive:false", "init:1", "init:2"]);
    expect(s.refs[2]).toEqual({ slot: -1, gen: 0 });
    expect(m.reported.map((d) => [d.code, d.severity, d.source?.startByte])).toEqual([["MTEK-E8033", "error", 20]]);
    expect(m.app.state).toBe("running");
    expect(m.debug.scene().spawned.map((entity) => entity.slot)).toEqual([1, 2]);
  });
});

describe("resources: repeated spawn and destroy return to a bounded steady state", () => {
  /** The counters that must not grow with the number of cycles. */
  const STEADY = ["liveBuffers", "liveBindGroups", "liveTextures", "liveSamplers", "ownedParamBlocks", "sharedParamBlocks", "liveEntities", "entitySlots", "livePipelines"] as const;

  function pick(m: Mounted): Record<string, number> {
    const counters = m.debug.counters();
    return Object.fromEntries(STEADY.map((name) => [name, counters[name] ?? Number.NaN]));
  }

  it("a cycle of eight entities, thirty times: nothing accumulates; with all destroyed the baseline is back", async () => {
    const s = script({
      keys: {
        Space: (ctx) => {
          // n = 1..8: the colour blue channel is 1 for multiples of 3, so there are two distinct blocks.
          for (let n = 1; n <= 8; n += 1) s.refs.push(ctx.spawn(SPARK, { n }, 1));
        },
        Enter: (ctx) => {
          for (const ref of s.refs.splice(0)) ctx.destroy(ref, 2);
        },
      },
    });
    const m = await mountSpawn(s);
    m.debug.step(1, 0.02);
    const baseline = pick(m);
    expect(baseline).toMatchObject({ liveEntities: 1, ownedParamBlocks: 1, sharedParamBlocks: 0, entitySlots: 1 });

    const cycle = (): void => {
      m.debug.pressKey("Space");
      m.debug.step(1, 0.02);
      m.debug.releaseKey("Space");
      m.debug.pressKey("Enter");
      m.debug.step(1, 0.02);
      m.debug.releaseKey("Enter");
    };
    cycle();
    const afterFirst = pick(m);
    // Eight entities exist in the middle of a cycle; by its end they are gone and the slots are free.
    expect(afterFirst).toMatchObject({ liveEntities: 1, ownedParamBlocks: 1, sharedParamBlocks: 0, entitySlots: 9 });
    for (let i = 0; i < 30; i += 1) cycle();
    expect(pick(m)).toEqual(afterFirst);
    // The arenas keep the capacity they grew to (their buffers are replaced, not added): liveBuffers is unchanged,
    // and the GPU has no more live buffers than after the first cycle.
    expect(m.host.device.buffers.filter((buffer) => !buffer.destroyed)).toHaveLength(afterFirst["liveBuffers"] ?? Number.NaN);
    // Entities that came and went: 31 cycles of eight.
    expect(m.debug.counters()).toMatchObject({ entitiesSpawned: 31 * 8, entitiesDestroyed: 31 * 8, pendingSpawns: 0, pendingRemovals: 0 });
    // Same bind groups as at the start: only the Cube's, the frame's and the object's.
    expect(afterFirst["liveBindGroups"]).toBe(baseline["liveBindGroups"]);
  });

  it("with eight alive, two blocks are shared (identical colours) and the draw list has one draw per entity", async () => {
    const s = script({
      keys: {
        Space: (ctx) => {
          for (let n = 1; n <= 8; n += 1) s.refs.push(ctx.spawn(SPARK, { n }, 1));
        },
        Enter: (ctx) => {
          for (const ref of s.refs.splice(0)) ctx.destroy(ref, 2);
        },
      },
    });
    const m = await mountSpawn(s);
    m.debug.step(1, 0.02);
    m.debug.pressKey("Space");
    m.debug.step(1, 0.02);
    // n = 3 and 6 have the blue channel 1 and share a block; the other six (0.5, 0.25, 0) share another. The Cube's
    // block (0.25, 0.5, 0.75) differs from both: three blocks, shared are the two of the spawned.
    expect(m.debug.counters()).toMatchObject({ liveEntities: 9, ownedParamBlocks: 1, sharedParamBlocks: 2 });
    // One draw per entity: the minimal shader has no instanced entry point.
    expect(draws(m.host)).toBe(9);
    // Destroyed entities are forgotten by the draw list, the Cube stays.
    m.debug.pressKey("Enter");
    m.debug.step(1, 0.02);
    expect(draws(m.host)).toBe(1);
    expect(m.debug.counters()).toMatchObject({ liveEntities: 1, ownedParamBlocks: 1, sharedParamBlocks: 0 });
  });

  it("a spawned entity outside the frustum is culled like a named one", async () => {
    const s = script({ keys: { Space: (ctx) => s.refs.push(ctx.spawn(SPARK, { n: 50 }, 1)) } });
    const m = await mountSpawn(s);
    m.debug.pressKey("Space");
    // n = 50 puts the entity at x = 50: far outside the frustum of the minimal scene (|x| < 6 at the origin plane).
    m.debug.step(2, 0.02);
    expect(m.debug.counters()["culledObjects"]).toBe(1);
    expect(draws(m.host)).toBe(1);
  });
});

describe("device recovery with spawned entities (spec/runtime-abi.md section 9.4)", () => {
  async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 500; i += 1) {
      if (condition()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  async function recover(host: FakeHost, app: MtekApp): Promise<void> {
    host.latestDevice.loseDevice("unknown", "the GPU process crashed");
    await until(() => app.state === "recovering", "state recovering");
    if (!host.timers.runNext()) throw new Error("no recovery timer is waiting");
    await until(() => app.state !== "recovering", "the end of the recovery");
  }

  it("keeps the spawned entities, rebuilds their resources, draws them again and lets later spawns through", async () => {
    const s = script({
      keys: {
        Space: (ctx) => {
          for (const n of [1, 2, 3]) s.refs.push(ctx.spawn(SPARK, { n }, 1));
        },
        Enter: (ctx) => {
          s.refs.push(ctx.spawn(SPARK, { n: 4 }, 1));
        },
        KeyD: (ctx) => {
          ctx.destroy(s.refs[0] as EntityRef, 2);
        },
      },
    });
    const m = await mountSpawn(s, { mount: { test: { manualClock: true, renderTarget: TARGET, recovery: { delaysMs: [0, 0, 0] } } } });
    m.debug.pressKey("Space");
    m.debug.step(2, 0.02);
    const before = m.debug.scene().spawned;
    const countersBefore = m.debug.counters();
    expect(draws(m.host)).toBe(4);

    await recover(m.host, m.app);
    expect(m.app.state).toBe("running");
    expect(m.reported.map((d) => d.code)).toEqual(["MTEK-W8060", "MTEK-W8061"]);
    // The same entities, in the same slots, with the state the program had.
    expect(m.debug.scene().spawned).toEqual(before);
    m.debug.step(1, 0.02);
    expect(draws(m.host)).toBe(4);
    // On the new device the resources are those of the same population.
    const after = m.debug.counters();
    for (const name of ["liveBuffers", "liveBindGroups", "ownedParamBlocks", "sharedParamBlocks", "liveEntities", "entitySlots"] as const) {
      expect(after[name], name).toBe(countersBefore[name]);
    }
    // Spawn and destroy keep working on the rebuilt stores.
    m.debug.pressKey("Enter");
    m.debug.pressKey("KeyD");
    m.debug.step(1, 0.02);
    expect(m.debug.scene().spawned.map((entity) => entity.slot)).toEqual([2, 3, 4]);
    expect(draws(m.host)).toBe(4);
  });
});
