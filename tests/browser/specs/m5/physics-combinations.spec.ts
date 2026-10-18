// M5-06: the same-frame combinations of spec/scenes.md section 10.3, with the real physics engine under them
// (spec/testing.md section 6.5, decisions 0064, 0066 and 0068). `fixtures/m5/physics_combos` has one key per
// combination (its header lists them); every expectation below is derived from the documented order of one frame
// (input, then ticks that each flush, apply commands, run fixed_update, step, write back and deliver, then update, flush):
//   - a Probe that is spawned by Space (flushed in tick 1), launched by its own fixed_update (the velocity is queued in
//     tick 1 and applied at the start of tick 2) and flies at 5 m/s from x = 2 at the Pad (face at x = 4.9, radius 0.25)
//     is first moved in tick 2; after m moves the surface gap is 2.65 - m / 12 and the engine sees the contact once it is
//     under the prediction distance (20 mm) and reports it one step later (decision 0063 item 5): the Pad's handler runs
//     in tick K = 2 + ceil(2.63 * 12) = 34. The control run measures K and compares it with this derivation;
//     the combinations then place their input around the measured K.
//   - a destroy is a flag at once (the entity's handlers and deliveries stop) and a removal at the next flush: the start
//     of the next tick, or the end of the frame.
import { expect, test } from "../../support/fixtures.ts";
import { STEP, runScript, type Action, type ScriptRun, type Snapshot } from "./physics-support.ts";

const FIXTURE = "physics_combos";
/** 2 + ceil((4.9 - 2.25 - 0.02) / (5 / 60)): see the header. */
const DERIVED_K = 34;

const launch: Action[] = [{ op: "press", key: "Space" }, { op: "step", frames: 1 }, { op: "release", key: "Space" }];

function snap(run: ScriptRun, label: string): Snapshot {
  const found = run.snaps.find((candidate) => candidate.label === label);
  if (found === undefined) throw new Error(`no snapshot '${label}'`);
  return found;
}

const num = (snapshot: Snapshot, name: string): number => snapshot.state[name] as number;
const marks = (snapshot: Snapshot): number => snapshot.spawned.filter((entity) => entity.prefab === "Mark").length;
const prefabs = (snapshot: Snapshot): string[] => snapshot.spawned.map((entity) => entity.prefab);

/** The tick in which the Pad saw the Probe, measured by a run in which nothing interferes. */
async function measureK(page: Parameters<typeof runScript>[0]): Promise<{ k: number; control: Snapshot }> {
  const control = await runScript(page, FIXTURE, [...launch, { op: "step", frames: 59 }, { op: "snap", label: "control" }]);
  const done = snap(control, "control");
  expect(control.reported).toEqual([]);
  expect(num(done, "pad_hits"), "control: the Probe hits the Pad once").toBe(1);
  expect(marks(done), "control: the Probe's own handler ran once").toBe(1);
  const k = num(done, "pad_tick");
  expect(Math.abs(k - DERIVED_K), `the Pad saw the Probe in tick ${String(k)}, derived ${String(DERIVED_K)}`).toBeLessThanOrEqual(1);
  return { k, control: done };
}

test.describe("same-frame combinations on the real engine (spec/scenes.md section 10.3, M5-06)", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  test("spawn then destroy in one handler: nothing is created, no body appears, nothing is reported", async ({ page }) => {
    const run = await runScript(page, FIXTURE, [{ op: "step", frames: 1 }, { op: "snap", label: "before" }, { op: "press", key: "KeyA" }, { op: "step", frames: 2 }, { op: "snap", label: "after" }]);
    expect(run.reported).toEqual([]);
    const before = snap(run, "before");
    const after = snap(run, "after");
    // The Pad and the Ball are the only bodies; the cancelled Block never became one, never counted as spawned or destroyed.
    expect(after.counters).toMatchObject({ physicsBodies: 2, physicsColliders: 2, entitiesSpawned: 0, entitiesDestroyed: 0, liveEntities: 2, pendingSpawns: 0, pendingRemovals: 0, physicsSteps: 3 });
    expect(after.spawned).toEqual([]);
    expect(after.counters["buffersAllocated"], "no GPU resource was made for it").toBe(before.counters["buffersAllocated"]);
  });

  test("destroy then a collision involving the entity in the same tick: destroyed before the tick, in the tick, or after the delivery", async ({ page }) => {
    const { k } = await measureK(page);
    // Ticks 1..K-1 have run when the key of case ii or iii is pressed; the frame of the key is tick K, the tick of the collision.
    const toBeforeK: Action[] = [...launch, { op: "step", frames: k - 2 }];
    const rest: Action[] = [{ op: "step", frames: 15 }, { op: "snap", label: "end" }];
    const cases: Array<{ name: string; script: Action[]; hits: number }> = [
      // (ii) destroy from a key handler in phase 1 of frame K: removed at the flush at the start of tick K, so there is no contact at all.
      { name: "key before the tick", script: [...toBeforeK, { op: "press", key: "KeyD" }, { op: "step", frames: 1 }, { op: "release", key: "KeyD" }, ...rest], hits: 0 },
      // (iii) destroy from fixed_update of tick K (armed by the key): pending when the step produces the contact; the event is not delivered.
      { name: "fixed_update of the tick", script: [...toBeforeK, { op: "press", key: "KeyF" }, { op: "step", frames: 1 }, { op: "release", key: "KeyF" }, ...rest], hits: 0 },
      // (iv) destroy from fixed_update of tick K + 1: the collision of tick K was delivered first.
      { name: "fixed_update of the next tick", script: [...toBeforeK, { op: "step", frames: 1 }, { op: "press", key: "KeyF" }, { op: "step", frames: 1 }, { op: "release", key: "KeyF" }, ...rest], hits: 1 },
      // (v) destroy from a key handler in phase 1 of frame K + 1: the same.
      { name: "key after the tick", script: [...toBeforeK, { op: "step", frames: 1 }, { op: "press", key: "KeyD" }, { op: "step", frames: 1 }, { op: "release", key: "KeyD" }, ...rest], hits: 1 },
    ];
    for (const { name, script, hits } of cases) {
      const run = await runScript(page, FIXTURE, script);
      expect(run.reported, `${name}: no diagnostics`).toEqual([]);
      const end = snap(run, "end");
      expect(num(end, "pad_hits"), `${name}: Pad deliveries`).toBe(hits);
      expect(marks(end), `${name}: the Probe's own handler ran`).toBe(hits);
      // In every case the Probe is gone by the end and nothing is pending; the Drifter, the Pad and the Ball remain.
      expect(prefabs(end).filter((prefab) => prefab !== "Mark"), name).toEqual(["Drifter"]);
      expect(end.counters, name).toMatchObject({ physicsBodies: 3, physicsColliders: 3, entitiesDestroyed: 1, pendingRemovals: 0, pendingSpawns: 0 });
      if (hits === 1) expect(num(end, "pad_tick"), name).toBe(k);
    }
  });

  test("key down and key up within one frame: both delivered, in order, and the later command of a lane wins", async ({ page }) => {
    const run = await runScript(page, FIXTURE, [
      { op: "press", key: "KeyQ" },
      { op: "release", key: "KeyQ" },
      { op: "step", frames: 1 },
      { op: "snap", label: "one frame" },
      { op: "step", frames: 29 },
      { op: "snap", label: "30 ticks" },
    ]);
    expect(run.reported).toEqual([]);
    const first = snap(run, "one frame");
    // Both handlers ran, down first: the log is [1, 2].
    expect(num(first, "q_len")).toBe(2);
    expect((first.state["q_log"] as number[]).slice(0, 2)).toEqual([1, 2]);
    // Both commands are in the velocity lane and are applied in issue order at the start of tick 1: the velocity is
    // the up handler's, (0, 0, 3). After one tick the Ball has moved 3 * step along +z and not at all along +x.
    expect(first.at["Ball"]?.x).toBeCloseTo(0, 6);
    expect(first.at["Ball"]?.z).toBeCloseTo(-20 + 3 * STEP, 4);
    const later = snap(run, "30 ticks");
    expect(later.at["Ball"]?.x).toBeCloseTo(0, 6);
    expect(later.at["Ball"]?.z).toBeCloseTo(-20 + 3 * 30 * STEP, 3);
    expect(later.counters["physicsSteps"]).toBe(30);
  });

  test("input during a pause is discarded; the held key is released at the next frame, as after a focus loss", async ({ page }) => {
    const run = await runScript(page, FIXTURE, [
      { op: "press", key: "KeyW" },
      { op: "step", frames: 1 },
      { op: "snap", label: "held" },
      { op: "pause" },
      { op: "release", key: "KeyW" },
      { op: "press", key: "KeyE" },
      { op: "step", frames: 3 },
      { op: "snap", label: "paused" },
      { op: "resume" },
      { op: "snap", label: "resumed" },
      { op: "step", frames: 1 },
      { op: "snap", label: "next frame" },
      { op: "step", frames: 1 },
      { op: "snap", label: "later" },
    ]);
    expect(run.reported).toEqual([]);
    const held = snap(run, "held");
    expect(held.state).toMatchObject({ w_down: 1, w_up: 0, w_held: 1, e_down: 0 });
    // While paused nothing runs (not even the manual clock) and the release of W and the press of E are discarded.
    const paused = snap(run, "paused");
    expect(paused.appState).toBe("paused");
    expect(paused.state).toMatchObject({ w_down: 1, w_up: 0, w_held: 1, e_down: 0, ticks: 1 });
    expect(paused.counters["physicsSteps"]).toBe(1);
    expect(snap(run, "resumed").state).toMatchObject({ w_up: 0, w_held: 1, ticks: 1 });
    // The first frame after the resume delivers the synthesised release of W (the key-up of the paused interval was never
    // seen), no key-down of E, and one tick.
    const next = snap(run, "next frame");
    expect(next.appState).toBe("running");
    expect(next.state).toMatchObject({ w_down: 1, w_up: 1, w_held: 0, e_down: 0, ticks: 2 });
    expect(snap(run, "later").state).toMatchObject({ w_down: 1, w_up: 1, e_down: 0, ticks: 3 });
  });

  test("spawn, destroy, input and a collision in one frame of three ticks, each with its documented outcome", async ({ page }) => {
    const { k } = await measureK(page);
    // Ticks 1..K-2 as single frames, then one frame of three ticks: K-1, K (the collision) and K+1. 3.5 steps leave
    // half a step in the accumulator, so the frame runs exactly three ticks whatever the rounding of the step.
    const run = await runScript(page, FIXTURE, [
      ...launch,
      { op: "step", frames: k - 3 },
      { op: "snap", label: "before" },
      { op: "press", key: "KeyX" },
      { op: "step", frames: 1, dt: 3.5 * STEP },
      { op: "release", key: "KeyX" },
      { op: "snap", label: "frame" },
      // The next frame: Space spawns again, and the freed slots are reused under a new generation.
      { op: "press", key: "Space" },
      { op: "step", frames: 1 },
      { op: "release", key: "Space" },
      { op: "snap", label: "next" },
    ]);
    expect(run.reported, "no diagnostics: not W8031, not W8032").toEqual([]);

    const before = snap(run, "before");
    expect(before.counters).toMatchObject({ physicsSteps: k - 2, physicsBodies: 4, entitiesSpawned: 2, entitiesDestroyed: 0, pendingSpawns: 0, pendingRemovals: 0 });
    expect(num(before, "pad_hits")).toBe(0);
    expect(prefabs(before)).toEqual(["Probe", "Drifter"]);
    const probeSlot = before.spawned[0]?.slot ?? Number.NaN;
    const drifterSlot = before.spawned[1]?.slot ?? Number.NaN;
    // Named entities (Pad, Ball) take slots 0 and 1; the first spawn gets the next one.
    expect([probeSlot, drifterSlot]).toEqual([2, 3]);

    const frame = snap(run, "frame");
    // Exactly three ticks ran: K-1 (flush: the Drifter's body is removed, the Runner's created; fixed_update: the Runner's
    // velocity is queued), K (it is applied; the Probe reaches the Pad: one delivery, whose handler spawns a Mark), K+1.
    expect(frame.counters["physicsSteps"]).toBe(k + 1);
    expect(num(frame, "ticks")).toBe(k + 1);
    expect(num(frame, "pad_hits"), "the collision of tick K was delivered once").toBe(1);
    expect(num(frame, "pad_tick")).toBe(k);
    // The world after the frame: Drifter gone, Runner and Mark exist, the cancelled Block never did.
    expect(prefabs(frame)).toEqual(["Probe", "Runner", "Mark"]);
    expect(frame.counters).toMatchObject({ physicsBodies: 4, physicsColliders: 4, liveEntities: 2 + 3, entitiesSpawned: 4, entitiesDestroyed: 1, pendingSpawns: 0, pendingRemovals: 0 });
    const [probe, runner, mark] = frame.spawned;
    // The Runner took a new slot (the Drifter's was still occupied when it was reserved), generation 0; the Mark, reserved
    // after the flush, took one of the two slots that flush freed (the Drifter's and the cancelled Block's) under generation 1.
    expect([runner?.slot, runner?.gen]).toEqual([4, 0]);
    expect(mark?.gen).toBe(1);
    expect([drifterSlot, 5]).toContain(mark?.slot);
    expect(probe?.slot).toBe(probeSlot);
    // The Runner was created at the flush of tick K-1, first moved by tick K and moved again by tick K+1: two moves of 6 / 60.
    expect(runner?.position.x).toBeCloseTo(2 * 6 * STEP, 4);
    expect(runner?.position.z).toBeCloseTo(5, 6);

    // The next frame's spawn reuses the slots under generation 1 and never revives a destroyed entity's reference.
    const next = snap(run, "next");
    const reused = next.spawned.filter((entity) => entity.prefab === "Probe" || entity.prefab === "Drifter").filter((entity) => entity.gen === 1);
    expect(reused.length).toBeGreaterThanOrEqual(1);
    expect(next.spawned.filter((entity) => entity.slot === drifterSlot && entity.gen === 0)).toEqual([]);
    expect(next.counters).toMatchObject({ pendingSpawns: 0, pendingRemovals: 0 });
  });
});
