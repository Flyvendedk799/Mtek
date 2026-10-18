// M5-06: pause and resume do not simulate the paused interval (spec/scenes.md section 10.2, spec/physics.md sections 4
// and 7, decisions 0050 and 0066 item 12). Two clocks, on `fixtures/m5/physics_drop` (a 1 m crate dropped from 3 m onto
// a static floor, impulse on Space):
//
//  - Manual clock. Run A steps 15 + 25 ticks without a break; run B steps 15, pauses, steps 100 more frames and presses
//    Space while paused (the manual clock does not advance a paused application, the key press is discarded), resumes
//    and steps 25. B must end exactly where A does: same pose, same velocity, 40 physics steps, no impulse. In
//    the middle the free-fall model gives the pose, which does not move during the pause.
//  - Real clock (requestAnimationFrame). The crate falls; the application is paused for 700 ms of wall-clock time and
//    resumed. The step counter must not move while paused, and after the resume it may advance only by the frames that
//    really elapsed (the first frame after a resume has delta 0 and a frame is never simulated for time that passed
//    while paused): a simulated jump would show as the four catch-up steps the scheduler allows, at once. At every read
//    the pose equals the free-fall pose of the number of steps taken, so the pose is a function of the steps and
//    not of the clock.
import { expect, test } from "../../support/fixtures.ts";
import { PHYSICS_DROP } from "../../support/m5-fixtures.ts";
import { GRAVITY, STEP, TARGET, freeFallHeight, openFixture, runScript, type Action, type AppLike, type DiagnosticLike } from "./physics-support.ts";

const FIXTURE = PHYSICS_DROP;

const crateY = (snapshot: { at: Record<string, { y: number }> }): number => snapshot.at["Crate"]?.y ?? Number.NaN;

test.describe("pause and resume with physics (M5-06)", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  test("manual clock: a paused interval is never stepped, input during it is discarded, and the run ends where an uninterrupted one does", async ({ page }) => {
    const uninterrupted = await runScript(page, FIXTURE, [{ op: "step", frames: 15 }, { op: "snap", label: "mid" }, { op: "step", frames: 25 }, { op: "snap", label: "end" }]);
    const paused: Action[] = [
      { op: "step", frames: 15 },
      { op: "snap", label: "mid" },
      { op: "pause" },
      { op: "snap", label: "paused" },
      { op: "step", frames: 100 },
      { op: "press", key: "Space" },
      { op: "step", frames: 5 },
      { op: "release", key: "Space" },
      { op: "step", frames: 100 },
      { op: "snap", label: "after the pause" },
      { op: "resume" },
      { op: "step", frames: 25 },
      { op: "snap", label: "end" },
    ];
    const interrupted = await runScript(page, FIXTURE, paused);
    expect(uninterrupted.reported).toEqual([]);
    expect(interrupted.reported).toEqual([]);
    const get = (run: typeof uninterrupted, label: string) => run.snaps.find((snapshot) => snapshot.label === label);
    const [midA, endA] = [get(uninterrupted, "mid"), get(uninterrupted, "end")];
    const [midB, atPause, afterPause, endB] = [get(interrupted, "mid"), get(interrupted, "paused"), get(interrupted, "after the pause"), get(interrupted, "end")];
    if (midA === undefined || endA === undefined || midB === undefined || atPause === undefined || afterPause === undefined || endB === undefined) throw new Error("missing snapshots");

    // The model: after n ticks of free fall the crate is at 3 - g dt^2 (n^2 / 2 + n / 8) (decision 0063 item 5).
    expect(crateY(midA)).toBeCloseTo(freeFallHeight(3, 15), 3);
    // (40 ticks of free fall end at 3 - g dt^2 (800 + 5) = 0.81 m: the crate has not reached the floor, whose contact is at 0.5 m.)
    expect(crateY(endA)).toBeCloseTo(freeFallHeight(3, 40), 3);
    expect(midA.counters["physicsSteps"]).toBe(15);
    expect(endA.counters["physicsSteps"]).toBe(40);

    // Before the pause both runs are the same; during it nothing moves, nothing is stepped, nothing is delivered.
    expect(crateY(midB)).toBe(crateY(midA));
    expect(atPause.appState).toBe("paused");
    expect(afterPause.appState).toBe("paused");
    expect(afterPause.counters["physicsSteps"], "no step during the pause").toBe(15);
    expect(crateY(afterPause), "no movement during the pause").toBe(crateY(midB));
    expect(afterPause.state).toEqual(midB.state);
    expect(afterPause.counters["discardedSteps"]).toBe(0);

    // After the resume and 25 ticks the run is the uninterrupted one: same pose (bit for bit: the simulation is deterministic
    // within a run), same steps, same state, and the Space of the pause gave no impulse (the crate is still in free fall at
    // 0.81 m; the impulse of 8 N s would have thrown it upwards).
    expect(endB.appState).toBe("running");
    expect(endB.counters["physicsSteps"]).toBe(40);
    expect(crateY(endB)).toBe(crateY(endA));
    expect(endB.state).toEqual(endA.state);
    expect(crateY(endB)).toBeCloseTo(freeFallHeight(3, 40), 3);
    // `rise` is read by fixed_update, so in tick 40 it holds the velocity tick 39 left: exactly g * 39 * dt downwards.
    expect(endB.state["rise"], "the velocity of the last tick the handler could see: free fall, no impulse").toBeCloseTo(-GRAVITY * 39 * STEP, 3);
    expect(endB.state["landings"]).toBe(0);
  });

  test("real clock: 700 ms of wall-clock time paused advance the simulation by nothing, and the resume does not catch up", async ({ page }) => {
    await openFixture(page, FIXTURE);
    const run = await page.evaluate(
      async ({ target, step }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const reported: DiagnosticLike[] = [];
        // No manual clock: frames come from requestAnimationFrame. The offscreen target keeps the page's canvas out of it.
        const app = await w.__mtekMount({ test: { renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
        const read = (): { steps: number; y: number; at: number } => ({
          steps: app.debug.counters()["physicsSteps"] ?? Number.NaN,
          y: app.debug.scene().entities.find((entity) => entity.name === "Crate")?.position.y ?? Number.NaN,
          at: performance.now(),
        });
        const until = async (done: () => boolean, what: string): Promise<void> => {
          const limit = performance.now() + 5000;
          while (!done()) {
            if (performance.now() > limit) throw new Error(`timed out waiting for ${what}`);
            await new Promise((resolve) => setTimeout(resolve, 4));
          }
        };
        await until(() => (app.debug.counters()["physicsSteps"] ?? 0) >= 8, "8 steps");
        // Pause and read in one task: nothing can run in between.
        app.pause();
        const atPause = read();
        const duringState = app.state;
        await new Promise((resolve) => setTimeout(resolve, 700));
        const beforeResume = read();
        // Resume and read in one task, then wait for three more steps and read each time the count changed.
        app.resume();
        const resumedAt = performance.now();
        const reads: Array<{ steps: number; y: number; at: number }> = [];
        let last = beforeResume.steps;
        await until(() => {
          const now = read();
          if (now.steps !== last) {
            reads.push(now);
            last = now.steps;
          }
          return now.steps >= beforeResume.steps + 3;
        }, "3 steps after the resume");
        const counters = { ...app.debug.counters() };
        app.dispose();
        return { reported, atPause, beforeResume, reads, resumedAt, counters, duringState, step };
      },
      { target: TARGET, step: STEP },
    );
    expect(run.reported).toEqual([]);
    expect(run.duringState).toBe("paused");
    // Falling: the crate is far from the floor (a fall from 3 m takes 43 ticks), so the free-fall model holds below.
    expect(run.beforeResume.steps).toBeLessThan(30);

    // Paused for 700 ms of wall-clock time: not one step, not one millimetre.
    expect(run.beforeResume.steps, "steps during the pause").toBe(run.atPause.steps);
    expect(run.beforeResume.y, "pose during the pause").toBe(run.atPause.y);
    expect(run.beforeResume.at - run.atPause.at, "the pause really lasted").toBeGreaterThanOrEqual(650);

    // After the resume: every read has the pose of the free fall of its step count, and the steps taken since the resume
    // never exceed those that the frames since then allow (one tick per elapsed fixed step, plus the one in flight). Had the
    // 700 ms been simulated, the first frame would have run four catch-up steps at once.
    expect(run.reads.length).toBeGreaterThan(0);
    for (const read of run.reads) {
      expect(read.y, `pose at ${String(read.steps)} steps`).toBeCloseTo(freeFallHeight(3, read.steps), 3);
      const allowed = Math.floor(((read.at - run.resumedAt) / 1000) / run.step) + 1;
      expect(read.steps - run.atPause.steps, `steps since the resume after ${(read.at - run.resumedAt).toFixed(1)} ms`).toBeLessThanOrEqual(allowed);
    }
    expect(run.counters["discardedSteps"], "no backlog was dropped: there was none").toBe(0);
  });
});
