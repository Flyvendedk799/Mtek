// M5-06: the high-speed limitation of v0.1, measured on the real physics engine and the real GPU
// (spec/physics.md sections 5.1 and 7, decision 0068). The engine runs without continuous collision detection
// (the adapter enables none), so a body that moves farther in one fixed step than a thin obstacle is deep may
// skip it. `fixtures/m5/physics_tunnel` flies 17 small balls (radius 0.05) at a thin wall (0.1 m thick, midplane
// x = 5), at speeds from 3 to 240 m/s, each ball with its own starting position, in two groups of lanes: against one
// long STATIC wall and against a DYNAMIC plate of 10 000 kg.
//
// The model (derived here, before any measurement; the lane table is read from the fixture source):
//   The engine looks for contacts once per fixed step, at the poses the previous step left, so the ball is
//   "seen" by the wall at the samples x_k = x0 + k * v * step, k = 0, 1, 2, ... A contact is made when the surface
//   distance is below the prediction distance (20 mm, decision 0063 item 5). The ball is pushed back when its centre is
//   still on the near side of the wall's midplane and pushed through when it is past it, so the ball is stopped
//   exactly when some sample lies in the window
//       [ wall - thickness / 2 - radius - prediction , wall )  =  [4.88, 5.0)
//   whose length is thickness / 2 + radius + prediction = 0.12 m. Consequences:
//     - a step displacement v * step <= 0.12 m, i.e. v <= 7.2 m/s, can never skip the window: no tunnelling
//       whatever the phase of x0 (the threshold speed is 0.12 / (1/60) = 7.2 m/s);
//     - above it the outcome depends on the phase of the samples against the window, and a ball that is not stopped
//       flies on at its own speed: x_end = x0 + v * ticks * step.
//   Each lane is predicted from this window alone and the prediction is compared with what the engine did.
//
// What was measured (and what this spec asserts):
//   - Against a DYNAMIC plate the model holds lane by lane: the lanes with v <= 7.2 m/s are all stopped, the lanes
//     above it are stopped or pass exactly as the window says, from 9 m/s (0.15 m per step) to 240 m/s (4 m per step).
//   - Against a STATIC wall nothing passes: every ball is stopped at the face (x = 4.9), up to 240 m/s here and up to
//     100 000 m/s in the adapter's own sweep (packages/physics-rapier/src/tunnelling.test.ts). The engine protects the
//     pair of a dynamic body and a fixed one; the limitation concerns pairs of moving bodies (decision 0068).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../../support/fixtures.ts";
import { M5_FIXTURES_DIR, PHYSICS_TUNNEL } from "../../support/m5-fixtures.ts";
import { STEP, TARGET, openFixture, type AppLike, type DiagnosticLike } from "./physics-support.ts";

const FIXTURE = PHYSICS_TUNNEL;
const WALL = 5;
const THICKNESS = 0.1;
const RADIUS = 0.05;
/** Decision 0063 item 5: the prediction distance of the engine, 20 mm. */
const PREDICTION = 0.02;
/** The ball is stopped when a sample lies in [WINDOW_START, WALL). */
const WINDOW_START = WALL - THICKNESS / 2 - RADIUS - PREDICTION;
const WINDOW = WALL - WINDOW_START;
/** The speed whose displacement per step equals the window: slower balls can never skip it. */
const THRESHOLD_SPEED = WINDOW / STEP;
const TICKS = 120;

interface Lane {
  index: number;
  x0: number;
  speed: number;
}

/** The lane table of the fixture: `entity Snn: Shot { lane: ..; x0: ..; speed: ..; }` (the D group repeats it). */
function readLanes(): Lane[] {
  const source = readFileSync(join(M5_FIXTURES_DIR, FIXTURE, "src", "main.mtek"), "utf8");
  const lanes: Lane[] = [];
  for (const match of source.matchAll(/entity S(\d\d): Shot \{ lane: [\d.]+; x0: ([\d.]+); speed: ([\d.]+); \}/g)) {
    lanes.push({ index: Number(match[1]), x0: Number(match[2]), speed: Number(match[3]) });
  }
  return lanes;
}

/** The samples the engine sees: x0 + k * v * step up to the far side of the wall. */
function samples(lane: Lane): number[] {
  const out: number[] = [];
  for (let k = 0; lane.x0 + k * lane.speed * STEP < WALL + 1; k += 1) out.push(lane.x0 + k * lane.speed * STEP);
  return out;
}

/** The model: the ball is stopped when some sample lies in the window [4.88, 5.0). */
function predictedStopped(lane: Lane): boolean {
  return samples(lane).some((x) => x >= WINDOW_START && x < WALL);
}

/** How far the decisive samples are from the window's edges (the lanes are chosen so that none is closer than 12 mm). */
function margin(lane: Lane): number {
  const inside = samples(lane).filter((x) => x >= WINDOW_START && x < WALL);
  if (inside.length > 0) return Math.max(...inside.map((x) => Math.min(x - WINDOW_START, WALL - x)));
  const before = samples(lane).filter((x) => x < WINDOW_START).at(-1) ?? Number.NEGATIVE_INFINITY;
  const after = samples(lane).find((x) => x >= WALL) ?? Number.POSITIVE_INFINITY;
  return Math.min(WINDOW_START - before, after - WALL);
}

test.describe("high-speed limitation on the real engine (M5-06)", () => {
  test("the model: stopped exactly when a sample lies in the window; static walls stop everything", async ({ page, gpu }, testInfo) => {
    void gpu;
    const lanes = readLanes();
    expect(lanes, "the lane table of the fixture").toHaveLength(17);
    expect(THRESHOLD_SPEED).toBeCloseTo(7.2, 3);

    await openFixture(page, FIXTURE);
    const run = await page.evaluate(
      async ({ target, dt, ticks }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const reported: DiagnosticLike[] = [];
        const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
        app.debug.pressKey("Space");
        app.debug.step(1, dt);
        app.debug.releaseKey("Space");
        app.debug.step(ticks - 1, dt);
        const x = Object.fromEntries(app.debug.scene().entities.map((entity) => [entity.name, entity.position.x]));
        const counters = { ...app.debug.counters() };
        app.dispose();
        return { reported, x, counters };
      },
      { target: TARGET, dt: STEP, ticks: TICKS },
    );
    expect(run.reported, "no runtime diagnostics").toEqual([]);
    expect(run.counters).toMatchObject({ physicsSteps: TICKS, physicsBodies: 1 + 17 + 17 + 17, physicsFrozenBodies: 0 });

    const table: string[] = [];
    let passed = 0;
    for (const lane of lanes) {
      const name = String(lane.index).padStart(2, "0");
      const stoppedByModel = predictedStopped(lane);
      expect(margin(lane), `lane ${name}: the decisive samples are at least 12 mm from the edges of the window`).toBeGreaterThanOrEqual(0.0125);

      // A static wall: stopped at the face in every lane, with no exception (ball centre 0.05 from the face at 4.95).
      const stat = run.x[`S${name}`] ?? Number.NaN;
      expect(Math.abs(stat - (WALL - THICKNESS / 2 - RADIUS)), `static, lane ${name} (${String(lane.speed)} m/s): x = ${String(stat)}`).toBeLessThan(0.02);

      // A dynamic plate: the model decides.
      const dyn = run.x[`D${name}`] ?? Number.NaN;
      if (stoppedByModel) {
        // Stopped on the near side; the plate (10 000 kg) gives way by less than the ball's momentum allows: 4 cm at most.
        expect(dyn, `dynamic, lane ${name} (${String(lane.speed)} m/s from ${String(lane.x0)}): predicted stopped`).toBeLessThan(WALL - THICKNESS / 2);
        expect(dyn).toBeGreaterThan(WALL - THICKNESS / 2 - RADIUS - 0.05);
      } else {
        passed += 1;
        // Not stopped: the ball flew through and on at its own speed for every tick.
        const flown = lane.x0 + lane.speed * TICKS * STEP;
        expect(Math.abs(dyn - flown) / flown, `dynamic, lane ${name} (${String(lane.speed)} m/s from ${String(lane.x0)}): predicted to pass, x = ${String(dyn)}, flown ${String(flown)}`).toBeLessThan(1e-3);
      }
      table.push(`${String(lane.speed)} m/s (${(lane.speed * STEP).toFixed(4)} m/step) x0=${String(lane.x0)}: model ${stoppedByModel ? "stopped" : "passes"}, dynamic plate x=${dyn.toFixed(3)}, static wall x=${stat.toFixed(3)}`);
    }

    // The table spans the threshold: slower lanes are all stopped, and above it both outcomes occur.
    const slow = lanes.filter((lane) => lane.speed <= THRESHOLD_SPEED);
    const fast = lanes.filter((lane) => lane.speed > THRESHOLD_SPEED);
    expect(slow.length).toBeGreaterThanOrEqual(5);
    expect(slow.every(predictedStopped), "at or below 7.2 m/s no phase gets past the window").toBe(true);
    expect(fast.some(predictedStopped) && fast.some((lane) => !predictedStopped(lane))).toBe(true);
    expect(passed, "balls that passed through a dynamic plate").toBe(fast.filter((lane) => !predictedStopped(lane)).length);
    expect(passed).toBeGreaterThanOrEqual(6);

    testInfo.annotations.push({ type: "m5-tunnelling", description: `window ${WINDOW.toFixed(3)} m = ${THRESHOLD_SPEED.toFixed(2)} m/s per step ${String(STEP)}; ${table.join("; ")}` });
  });
});
