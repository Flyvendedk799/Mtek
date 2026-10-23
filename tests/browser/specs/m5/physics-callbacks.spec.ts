// M5-06: removal and creation inside collision callbacks on the real engine (spec/physics.md section 6,
// spec/scenes.md section 9, decisions 0064 and 0066 item 8, decision 0068). `fixtures/m5/physics_callbacks` flies
// balls into static walls and into each other without gravity; their handlers destroy themselves, their partners or
// both, and spawn marks and bodies, all inside the delivery of the collision events of one tick. The expectations are
// counted from the program (see its header):
//   3 Mines hit the Pad in one tick      Pad: 3 enters, 0 exits;  3 Mark{1};  Mines gone
//   1 Victim hits the Killer             Killer destroys it first, so its own handler never runs: 0 Mark{2}
//   2 Twins hit each other head on       one delivery spawns Mark{3} and destroys both: exactly 1 Mark{3}
//   1 Breeder hits the Nursery           1 Mark{4} and 3 Sparks (new bodies); the Breeder is gone
// Every spawn and every destroy of the callbacks takes effect at the flush that follows (decision 0064 item 10), so
// after the frame that delivered them no entity is pending and the world holds exactly what the counting predicts.
// When a pair is delivered follows from the flight: a ball that starts at x0 with speed v is first moved by the
// second tick (the spawn is flushed in tick 1, its fixed_update queues the velocity, tick 2 applies it); after m moves
// it is at x0 + m v dt and the engine sees the contact once the surface gap is under the prediction distance (20 mm), and
// reports it one step later (decision 0063 item 5): delivery in tick 2 + m.
import { expect, test } from "../../support/fixtures.ts";
import { PHYSICS_CALLBACKS } from "../../support/m5-fixtures.ts";
import { STEP, TARGET, openFixture, type AppLike, type DiagnosticLike } from "./physics-support.ts";

const FIXTURE = PHYSICS_CALLBACKS;
const TICKS = 120;
const PREDICTION = 0.02;
const RADIUS = 0.25;
/** The wall's face is at 4.9 (a 0.2 m thick wall with its midplane at 5). */
const FACE = 4.9;
const FIRST_MOVING_TICK = 2;

/** The tick in which a contact is delivered, `gap` being the distance between the surfaces at the start and `closing` the closing speed. */
function deliveryTick(gap: number, closing: number): number {
  return FIRST_MOVING_TICK + Math.ceil((gap - PREDICTION) / (closing * STEP));
}

interface Frame {
  bodies: number;
  colliders: number;
  live: number;
  pendingSpawns: number;
  pendingRemovals: number;
  /** How many Marks of each kind (index = kind) exist. */
  marks: number[];
  sparks: number;
  others: string[];
}

test.describe("removal and creation inside collision callbacks on the real engine (M5-06)", () => {
  test("destroying one or both of a pair and spawning bodies in handlers: no lost or doubled event, a consistent world", async ({ page, gpu }, testInfo) => {
    void gpu;
    await openFixture(page, FIXTURE);
    const run = await page.evaluate(
      async ({ target, dt, ticks }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const reported: DiagnosticLike[] = [];
        const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
        const frames: Array<{
          bodies: number;
          colliders: number;
          live: number;
          pendingSpawns: number;
          pendingRemovals: number;
          marks: number[];
          sparks: number;
          others: string[];
        }> = [];
        const snapshot = (): void => {
          const counters = app.debug.counters();
          const spawned = app.debug.scene().spawned;
          const marks = [0, 0, 0, 0, 0];
          for (const entity of spawned) {
            if (entity.prefab === "Mark") marks[entity.state["mark_kind"] ?? 0] = (marks[entity.state["mark_kind"] ?? 0] ?? 0) + 1;
          }
          frames.push({
            bodies: counters["physicsBodies"] ?? -1,
            colliders: counters["physicsColliders"] ?? -1,
            live: counters["liveEntities"] ?? -1,
            pendingSpawns: counters["pendingSpawns"] ?? -1,
            pendingRemovals: counters["pendingRemovals"] ?? -1,
            marks,
            sparks: spawned.filter((entity) => entity.prefab === "Spark").length,
            others: spawned.filter((entity) => entity.prefab !== "Mark" && entity.prefab !== "Spark").map((entity) => entity.prefab),
          });
        };
        // Frame 1 spawns everything (one press of Space), then one tick per frame.
        app.debug.pressKey("Space");
        app.debug.step(1, dt);
        app.debug.releaseKey("Space");
        snapshot();
        for (let i = 1; i < ticks; i += 1) {
          app.debug.step(1, dt);
          snapshot();
        }
        const state = JSON.parse(JSON.stringify(app.debug.scene().state)) as Record<string, number | number[]>;
        const counters = { ...app.debug.counters() };
        const spawned = app.debug.scene().spawned.map((entity) => ({ prefab: entity.prefab, slot: entity.slot, gen: entity.gen, alive: entity.alive }));
        const runState = app.state;
        app.dispose();
        return { reported, frames, state, counters, spawned, runState };
      },
      { target: TARGET, dt: STEP, ticks: TICKS },
    );
    const frames: Frame[] = run.frames;
    expect(run.runState).toBe("running");
    expect(run.reported, "no runtime diagnostics (no iteration error, no W8032 from a doubled destroy)").toEqual([]);
    expect(frames).toHaveLength(TICKS);

    // Before anything happens (frame 1): everything spawned in the press is alive and has its body: 3 Mines, the Victim, 2 Twins, the Breeder; plus the 3 static bodies.
    expect(frames[0]).toMatchObject({ bodies: 3 + 7, live: 3 + 7, pendingSpawns: 0, pendingRemovals: 0, sparks: 0 });

    // The Mines, the Victim and the Breeder reach the walls in the derived tick (2 + ceil((2.65 - 0.02) / (5 / 60)) = 34), all in one tick.
    const wallTick = deliveryTick(FACE - (2 + RADIUS), 5);
    expect(wallTick).toBe(34);
    const padTicks = (run.state["pad_tick"] as number[]).slice(0, 3);
    expect(padTicks[0], "the three Mines hit the Pad in the same tick").toBe(padTicks[1]);
    expect(padTicks[1]).toBe(padTicks[2]);
    expect(Math.abs((padTicks[0] ?? Number.NaN) - wallTick), `the Pad saw the Mines in tick ${String(padTicks[0])}, derived ${String(wallTick)}`).toBeLessThanOrEqual(1);

    // After that frame: the callbacks' spawns exist (4 Marks, 3 Sparks) and the removals are done; nothing is pending.
    const eventFrame = (padTicks[0] ?? 0) - 1;
    const before = frames[eventFrame - 1];
    const after = frames[eventFrame];
    expect(before, "the frame before the contact").toMatchObject({ bodies: 3 + 7, pendingRemovals: 0, pendingSpawns: 0, sparks: 0 });
    expect(before?.marks).toEqual([0, 0, 0, 0, 0]);
    // 3 Mines, the Victim and the Breeder are gone; 3 Sparks were created; the Twins are still flying.
    expect(after).toMatchObject({ bodies: 3 + 2 + 3, colliders: 3 + 2 + 3, live: 3 + 2 + 4 + 3, pendingRemovals: 0, pendingSpawns: 0, sparks: 3 });
    expect(after?.marks, "Mark{1} x3 (one per Mine), Mark{2} none (the Victim was destroyed before its own delivery), Mark{4} x1").toEqual([0, 3, 0, 0, 1]);
    expect(after?.others).toEqual(["Twin", "Twin"]);

    // The Twins meet (closing speed 8 m/s over a 6 m centre distance, 0.5 m of radii): one delivery, one Mark{3}, both gone.
    const twinTick = deliveryTick(6 - 2 * RADIUS, 8);
    expect(twinTick).toBe(44);
    const firstMark3 = frames.findIndex((frame) => (frame.marks[3] ?? 0) > 0) + 1;
    expect(Math.abs(firstMark3 - twinTick), `Mark{3} appeared in tick ${String(firstMark3)}, derived ${String(twinTick)}`).toBeLessThanOrEqual(1);
    const last = frames[TICKS - 1];
    expect(last?.marks, "exactly one Mark{3}: the second delivery of the pair was skipped").toEqual([0, 3, 0, 1, 1]);
    expect(last?.others, "no Mine, Victim, Twin or Breeder left").toEqual([]);

    // Nothing is ever pending at the end of a frame, Mark{2} never exists, no Mark is made twice or lost, and the
    // bodies are the three static ones plus the Sparks once the balls are gone.
    expect(frames.every((frame) => frame.pendingRemovals === 0 && frame.pendingSpawns === 0)).toBe(true);
    expect(frames.every((frame) => (frame.marks[2] ?? 0) === 0), "Mark{2} never exists").toBe(true);
    expect(frames.every((frame) => frame.colliders === frame.bodies)).toBe(true);
    expect(last).toMatchObject({ bodies: 3 + 3, colliders: 3 + 3, live: 3 + 3 + 5, sparks: 3 });

    // Each handler ran the derived number of times.
    expect(run.state).toMatchObject({ pad_hits: 3, pad_exits: 0, killer_hits: 1, nursery_hits: 1 });
    // 7 balls and 5 Marks and 3 Sparks were spawned; the 7 balls were destroyed; nothing else.
    expect(run.counters).toMatchObject({ entitiesSpawned: 15, entitiesDestroyed: 7, liveEntities: 3 + 8, pendingSpawns: 0, pendingRemovals: 0, physicsSteps: TICKS, physicsFrozenBodies: 0 });
    expect(run.spawned.every((entity) => entity.alive)).toBe(true);
    expect(run.spawned).toHaveLength(8);

    testInfo.annotations.push({
      type: "m5-callbacks",
      description: `Pad saw the Mines in tick ${String(padTicks[0])} (derived ${String(wallTick)}); Mark{3} first seen in tick ${String(firstMark3)} (derived ${String(twinTick)}); bodies ${String(before?.bodies)} -> ${String(after?.bodies)} -> ${String(last?.bodies)}`,
    });
  });
});
