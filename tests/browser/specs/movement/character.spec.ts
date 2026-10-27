// Decision 0218: the character movement example (`examples/character-movement`, decisions 0214 to 0217) on the real
// engine, on the hardware and the software WebGPU configurations, with the manual clock and scripted keys.
//
// Every expected number is derived from the program's source and the geometry it declares (support/movement-example.ts,
// whose transcribed lines a unit test finds in the source) or from the published operating ranges of spec/physics.md
// 7.2, never read back from the runtime:
//   rest         a capsule of height 1.8 m rests half a height plus the skin (0.01 m) above the surface: 0.91 m on the floor
//   stairs       six risers of 0.2 m, step_height 0.3 m: climbed at about walking speed; the landing is 1.2 m high
//   ledge        0.6 m, twice the step height: the character stops a radius and a skin from its face (3 - 0.3 - 0.01) and
//                has to jump
//   slopes       30 degrees is under max_slope (45): climbed, ground normal y = cos 30; 60 degrees is over: not climbed
//   jump         v = 5 m/s, the program integrates gravity itself: the height after each tick is the sum of the program's
//                own discrete velocities (jumpModel below), grounded is false from the first tick of the rise to the landing
//   platforms    carried within the published 1 mm (spec/physics.md 7.2, "Platforms") plus a margin, for 10 to 12 s
//   corner       the walls are at x = 26 and z = 16: the capsule stops a radius and a skin away from both
//   display rate the fixed tick makes the tick sequence independent of the frame times: equality, not a tolerance
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { drive, hold, plan, tap, wait, type DriveResult, type PatternName, type Quat, type Sample, type Step, type Vec3 } from "../../support/movement-drive.ts";
import { encodePng, writeResult } from "../../support/m5-playground.ts";
import { hostApi } from "../../support/movement-host.ts";
import {
  GENTLE,
  LEDGE,
  LIFT,
  MOVEMENT_URL,
  RADIUS,
  REST_ABOVE_SURFACE,
  SKIN,
  SLIDER,
  SPAWN,
  STAIRS,
  STEEP,
  STEP,
  TURNTABLE,
  WALL_EAST_INNER_X,
  WALL_SOUTH_INNER_Z,
  movementConstant,
} from "../../support/movement-example.ts";

const TARGET = { width: 160, height: 80 } as const;
const GRAVITY = movementConstant("GRAVITY");
const JUMP_SPEED = movementConstant("JUMP_SPEED");
const WALK_SPEED = movementConstant("WALK_SPEED");
/** The published carry tolerance of spec/physics.md 7.2 ("drift below 1 mm") and the margin this spec adds for the page's f32 poses read at x up to 20 m. */
const PUBLISHED_DRIFT = 0.001;
const DRIFT_MARGIN = 0.0005;
const RELEASED_COUNTERS = ["liveBuffers", "liveTextures", "livePipelines", "liveBindGroups", "liveShaderModules", "liveListeners", "physicsBodies", "physicsColliders"] as const;

const REST_Y = REST_ABOVE_SURFACE;

test.describe("character movement on the real engine (decision 0218)", () => {
  let problems: string[] = [];

  test.beforeEach(({ page, gpu }) => {
    void gpu;
    problems = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
    });
  });

  test.afterEach(() => {
    expect(problems, "no page errors and no console errors").toEqual([]);
  });

  async function run(page: Page, steps: readonly Step[], options: { pattern?: PatternName; sample?: "every" | "boundary"; seed?: number } = {}): Promise<DriveResult> {
    await page.goto(MOVEMENT_URL);
    const result = await page.evaluate(drive, {
      frames: plan(steps, options.pattern ?? "tick", options.seed ?? 1),
      target: TARGET,
      sample: options.sample ?? "every",
      idNames: [],
    });
    expect(result.diagnostics, "no runtime diagnostics").toEqual([]);
    expect(result.stateAfter).toBe("running");
    for (const key of RELEASED_COUNTERS) expect(result.disposed[key], `${key} after dispose`).toBe(0);
    return result;
  }

  const yawOf = (q: Quat): number => 2 * Math.atan2(q.y, q.w);
  const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
  const rotateY = (v: Vec3, angle: number): Vec3 => ({ x: v.x * Math.cos(angle) + v.z * Math.sin(angle), y: v.y, z: -v.x * Math.sin(angle) + v.z * Math.cos(angle) });
  const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const norm = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
  const grounded = (s: Sample): boolean => s.state["on_ground"] === true;

  test("stands on the floor at the start: grounded, at the derived rest height, ground normal up", async ({ page }) => {
    const result = await run(page, [wait(60)]);
    const last = result.samples.at(-1);
    expect(last?.ticks).toBe(60);
    expect(last?.player.position.x).toBeCloseTo(SPAWN.x, 3);
    expect(last?.player.position.z).toBeCloseTo(SPAWN.z, 3);
    expect(Math.abs((last?.player.position.y ?? Number.NaN) - REST_Y)).toBeLessThan(0.005);
    expect(last?.state["on_ground"]).toBe(true);
    expect(last?.state["ground_up"]).toBeCloseTo(1, 4);
    expect(last?.state["ticks"]).toBe(60);
  });

  test("the stairs are climbed at walking speed and the ledge above step_height blocks until the character jumps", async ({ page }) => {
    // Stairs: from the foot (x = 0) 90 ticks of ArrowRight, 6 m of walking, end on the landing at 1.2 m.
    const stairs = await run(page, [wait(30), tap("Digit1"), wait(30), hold(["ArrowRight"], 90), wait(1)]);
    const walk = stairs.samples.slice(30 + 1 + 30);
    const landingY = STAIRS.riser * STAIRS.steps + REST_Y;
    const start = walk[0];
    expect(Math.abs((start?.player.position.y ?? Number.NaN) - REST_Y)).toBeLessThan(0.005);
    expect(start?.player.position.x).toBeCloseTo(0, 2);
    expect(start?.player.position.z).toBeCloseTo(STAIRS.z, 2);
    const end = walk.at(-1);
    expect(Math.abs((end?.player.position.y ?? Number.NaN) - landingY), "on the landing").toBeLessThan(0.01);
    expect(end?.player.position.x).toBeGreaterThan(STAIRS.landingFromX + 1);
    expect(end?.player.position.x).toBeLessThan(STAIRS.landingToX);
    expect(end?.state["on_ground"]).toBe(true);
    // Never off the ground on the way up, and the height only rises (within the published resting-height variation): each step is taken, none is a jump.
    expect(walk.every((s, i) => i < 2 || grounded(s)), "grounded on every tick of the climb").toBe(true);
    const heights = walk.map((s) => s.player.position.y);
    writeProbe("stairs", { x: walk.map((s) => s.player.position.x), heights, grounded: walk.map(grounded) });
    // Resting height varies by up to 9 mm between ticks (spec/physics.md 7.2, "Not claimed"); a drop larger than 10 mm would be a step lost.
    const largestDrop = Math.max(...heights.map((y, i) => (i === 0 ? 0 : (heights[i - 1] ?? 0) - y)));
    expect(largestDrop, "largest drop of the height between two ticks").toBeLessThan(0.01);
    // At about walking speed: the unobstructed walk from x = 0 to the first step's far end (x = 4, the sixth step) takes 1 s;
    // 1.3 times that is the corpus's own definition of a clean climb (spec/physics.md 7.2).
    const reachedAt = walk.findIndex((s) => s.player.position.y >= landingY - 0.01);
    const unobstructed = STAIRS.landingFromX / WALK_SPEED / STEP;
    expect(reachedAt, "tick at which the landing is reached").toBeGreaterThan(0);
    expect(reachedAt, "tick at which the landing is reached").toBeLessThanOrEqual(1.3 * unobstructed + 4);

    // Ledge: 120 ticks of ArrowRight against a face 0.6 m high stop a radius and a skin in front of it, on the floor.
    const ledge = await run(page, [wait(30), tap("Digit2"), wait(30), hold(["ArrowRight"], 120), hold(["ArrowRight", "Space"], 14), wait(90)]);
    const blocked = ledge.samples[30 + 1 + 30 + 120 - 1];
    expect(blocked?.player.position.x ?? Number.NaN).toBeCloseTo(LEDGE.frontX - RADIUS - SKIN, 2);
    expect(Math.abs((blocked?.player.position.y ?? Number.NaN) - REST_Y)).toBeLessThan(0.005);
    expect(blocked?.state["on_ground"]).toBe(true);
    const approach = ledge.samples.slice(30 + 1 + 30, 30 + 1 + 30 + 120);
    expect(Math.max(...approach.map((s) => s.player.position.y)), "never above the floor while walking into it").toBeLessThan(REST_Y + 0.02);
    expect(Math.max(...approach.map((s) => s.player.position.x)), "never past the face").toBeLessThanOrEqual(LEDGE.frontX - RADIUS - SKIN + 0.005);
    // With a jump it is climbed: the character ends on top of the ledge.
    const top = ledge.samples.at(-1);
    expect(Math.abs((top?.player.position.y ?? Number.NaN) - (LEDGE.height + REST_Y))).toBeLessThan(0.01);
    expect(top?.player.position.x ?? Number.NaN).toBeGreaterThan(LEDGE.frontX);
    expect(top?.state["on_ground"]).toBe(true);
  });

  test("the slope of 30 degrees is climbed with the ground normal of its angle and the one of 60 degrees is not", async ({ page }) => {
    const gentle = await run(page, [wait(30), tap("Digit3"), wait(30), hold(["ArrowRight"], 150), wait(1)]);
    const walkG = gentle.samples.slice(30 + 1 + 30);
    const topY = GENTLE.length * Math.sin(GENTLE.angle) + REST_Y;
    const endG = walkG.at(-1);
    expect(Math.abs((endG?.player.position.y ?? Number.NaN) - topY), "on the landing at the top of the slope").toBeLessThan(0.01);
    expect(endG?.state["on_ground"]).toBe(true);
    // On the slope the ground normal is the slope's: every sample whose character stands on the inclined face.
    const onRamp = walkG.filter((s) => s.player.position.x > GENTLE.startX + 1 && s.player.position.x < GENTLE.startX + GENTLE.length * Math.cos(GENTLE.angle) - 1);
    expect(onRamp.length, "ticks on the ramp").toBeGreaterThan(40);
    for (const s of onRamp) {
      expect(s.state["on_ground"]).toBe(true);
      expect(Math.abs(Number(s.state["ground_up"]) - Math.cos(GENTLE.angle)), "ground normal y").toBeLessThan(0.002);
    }
    // The height gained follows the slope: between two samples on the ramp, dy / dx = tan(angle) (within 2 %).
    const a = onRamp[0];
    const b = onRamp.at(-1);
    const slopeMeasured = ((b?.player.position.y ?? 0) - (a?.player.position.y ?? 0)) / ((b?.player.position.x ?? 1) - (a?.player.position.x ?? 0));
    expect(Math.abs(slopeMeasured / Math.tan(GENTLE.angle) - 1)).toBeLessThan(0.02);

    const steep = await run(page, [wait(30), tap("Digit4"), wait(30), hold(["ArrowRight"], 240), wait(1)]);
    const walkS = steep.samples.slice(30 + 1 + 30);
    // The character walks into the foot of the ramp and stays there: never past the start of the ramp (its radius earlier), never above the floor.
    expect(Math.max(...walkS.map((s) => s.player.position.x)), "x").toBeLessThan(STEEP.startX);
    expect(Math.max(...walkS.map((s) => s.player.position.y)), "y").toBeLessThan(REST_Y + 0.03);
    expect(walkS.every(grounded), "grounded on the floor throughout").toBe(true);
  });

  /** The program's own discrete jump: velocity v_i = JUMP - g dt (i - 1), the height after the m-th tick of the jump is dt * sum of v_1..v_m. */
  function jumpModel(m: number): number {
    let y = 0;
    for (let i = 1; i <= m; i += 1) y += STEP * (JUMP_SPEED - GRAVITY * STEP * (i - 1));
    return y;
  }

  test("grounded is true standing and false from the first tick of a jump to the landing, and the jump follows the program's own integration", async ({ page }) => {
    const result = await run(page, [wait(60), hold(["Space"], 1), wait(110)]);
    const pressTick = 61;
    const at = (m: number): Sample => result.samples[pressTick - 1 + m] as Sample;
    const y0 = at(0).player.position.y;
    expect(Math.abs(y0 - REST_Y)).toBeLessThan(0.005);
    expect(grounded(at(0)), "standing").toBe(true);
    let landing = 1;
    while (jumpModel(landing) > 0) landing += 1;
    // The model's apex and flight time (about 31 and 62 ticks for 5 m/s at 1/60 s).
    let apex = 0;
    for (let m = 1; m < landing; m += 1) if (jumpModel(m) > jumpModel(apex)) apex = m;
    expect(apex).toBeGreaterThanOrEqual(30);
    expect(apex).toBeLessThanOrEqual(32);
    expect(jumpModel(apex)).toBeGreaterThan((JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY) - 0.1);
    for (let m = 1; m <= landing - 2; m += 1) {
      expect(grounded(at(m)), `airborne after ${String(m)} ticks`).toBe(false);
      expect(Math.abs(at(m).player.position.y - y0 - jumpModel(m)), `height after ${String(m)} ticks`).toBeLessThan(0.002);
    }
    // The measured apex is the model's, and the character is grounded again by the landing tick (+3 for the snap and the program's one-tick lag).
    const heights = Array.from({ length: 80 }, (_, m) => at(m).player.position.y - y0);
    const measuredApex = heights.indexOf(Math.max(...heights));
    expect(measuredApex).toBe(apex);
    expect(Math.max(...heights)).toBeCloseTo(jumpModel(apex), 2);
    expect(grounded(at(landing + 3)), "grounded again").toBe(true);
    expect(Math.abs(at(landing + 3).player.position.y - y0)).toBeLessThan(0.005);
    // Airborne for the whole flight and no longer: the number of airborne samples is the model's within the landing lag.
    const airborne = result.samples.slice(pressTick - 1).filter((s) => !grounded(s)).length;
    expect(Math.abs(airborne - (landing - 1))).toBeLessThanOrEqual(3);
    // The program's own counter agrees with the samples; it also counts the first tick of the run, in which the character, spawned 4 cm above the floor, had not yet been moved.
    expect(result.samples.at(-1)?.state["air_ticks"]).toBe(result.samples.filter((s) => !grounded(s)).length);
  });

  /** Index of the first sample after a teleport tap and `settle` ticks. */
  const afterTap = (prefix: number, settle: number): number => prefix + 1 + settle;

  test("the sliding platform carries the character for a full period: it stays on it within the published drift", async ({ page }) => {
    const settle = 30;
    const duration = Math.round(SLIDER.period / STEP) + 60;
    const result = await run(page, [wait(30), tap("Digit5"), wait(settle + duration)]);
    const ride = result.samples.slice(afterTap(30, settle));
    const rel0 = sub(ride[0]?.player.position as Vec3, ride[0]?.platforms.Slider.position as Vec3);
    expect(rel0.y, "standing on the deck: half the deck and the rest height").toBeCloseTo(0.2 + REST_Y, 2);
    let drift = 0;
    for (const s of ride) drift = Math.max(drift, norm(sub(sub(s.player.position, s.platforms.Slider.position), rel0)));
    const xs = ride.map((s) => s.platforms.Slider.position.x);
    writeProbe("slider", { drift, rel0, minX: Math.min(...xs), maxX: Math.max(...xs) });
    expect(Math.min(...xs), "the platform reaches the near end of its travel").toBeLessThan(SLIDER.x - SLIDER.range + 0.05);
    expect(Math.max(...xs), "and the far end").toBeGreaterThan(SLIDER.x + SLIDER.range - 0.05);
    expect(ride.every(grounded), "grounded on every tick").toBe(true);
    expect(drift, "drift").toBeLessThanOrEqual(PUBLISHED_DRIFT + DRIFT_MARGIN);
  });

  test("the lift carries the character up and down a full period within the published drift", async ({ page }) => {
    const settle = 30;
    const duration = Math.round(LIFT.period / STEP) + 60;
    const result = await run(page, [wait(30), tap("Digit6"), wait(settle + duration)]);
    const ride = result.samples.slice(afterTap(30, settle));
    const rel0 = sub(ride[0]?.player.position as Vec3, ride[0]?.platforms.Lift.position as Vec3);
    expect(rel0.y, "standing on the deck").toBeCloseTo(0.2 + REST_Y, 2);
    let drift = 0;
    for (const s of ride) drift = Math.max(drift, norm(sub(sub(s.player.position, s.platforms.Lift.position), rel0)));
    const ys = ride.map((s) => s.platforms.Lift.position.y);
    const playerYs = ride.map((s) => s.player.position.y);
    writeProbe("lift", { drift, rel0, minY: Math.min(...ys), maxY: Math.max(...ys) });
    expect(Math.max(...ys) - Math.min(...ys), "the lift travels most of its 3 m").toBeGreaterThan(LIFT.travel - 0.1);
    expect(Math.max(...playerYs) - Math.min(...playerYs), "and the character with it").toBeGreaterThan(LIFT.travel - 0.1);
    expect(ride.every(grounded), "grounded on every tick, rising and descending").toBe(true);
    expect(drift, "drift").toBeLessThanOrEqual(PUBLISHED_DRIFT + DRIFT_MARGIN);
  });

  test("the turntable carries the character round and turns it with the platform within the published drift", async ({ page }) => {
    const settle = 30;
    const duration = Math.round(12 / STEP);
    const result = await run(page, [wait(30), tap("Digit7"), wait(settle + duration)]);
    const ride = result.samples.slice(afterTap(30, settle));
    const first = ride[0] as Sample;
    const frame = (s: Sample): Vec3 => rotateY(sub(s.player.position, s.platforms.Turntable.position), -yawOf(s.platforms.Turntable.rotation));
    const rel0 = frame(first);
    expect(Math.hypot(rel0.x, rel0.z), "on the bar, 1.5 m from the centre").toBeCloseTo(TURNTABLE.radius, 2);
    let drift = 0;
    let yawDrift = 0;
    let unwrapped = 0;
    let previous = yawOf(first.platforms.Turntable.rotation);
    for (const s of ride) {
      drift = Math.max(drift, norm(sub(frame(s), rel0)));
      const platformYaw = yawOf(s.platforms.Turntable.rotation);
      unwrapped += wrap(platformYaw - previous);
      previous = platformYaw;
      const playerTurn = wrap(yawOf(s.player.rotation) - yawOf(first.player.rotation));
      yawDrift = Math.max(yawDrift, Math.abs(wrap(playerTurn - unwrapped)));
    }
    writeProbe("turntable-yaw", { player: ride.filter((_, i) => i % 20 === 0).map((s) => yawOf(s.player.rotation)), platform: ride.filter((_, i) => i % 20 === 0).map((s) => yawOf(s.platforms.Turntable.rotation)) });
    writeProbe("turntable", { drift, yawDrift, turned: unwrapped, radius: Math.hypot(rel0.x, rel0.z) });
    // 12 s at 0.5 rad/s: the platform turned about 6 rad (the clock starts at mount, so a little more than the ride).
    expect(unwrapped, "the platform turned").toBeGreaterThan(TURNTABLE.speed * 11.5);
    expect(ride.every(grounded), "grounded on every tick").toBe(true);
    expect(drift, "drift in the platform's frame").toBeLessThanOrEqual(PUBLISHED_DRIFT + DRIFT_MARGIN);
    // The character's facing follows the platform's yaw: 1 mrad is 1.5 mm at the radius, the same budget.
    expect(yawDrift, "yaw drift (rad)").toBeLessThanOrEqual((PUBLISHED_DRIFT + DRIFT_MARGIN) / TURNTABLE.radius);
  });

  test("walking diagonally into the corner of the arena stops a radius and a skin from both walls without jitter", async ({ page }) => {
    const result = await run(page, [wait(30), tap("Digit8"), wait(30), hold(["ArrowRight", "ArrowDown"], 180), wait(1)]);
    const walk = result.samples.slice(afterTap(30, 30));
    const wantX = WALL_EAST_INNER_X - RADIUS - SKIN;
    const wantZ = WALL_SOUTH_INNER_Z - RADIUS - SKIN;
    expect(Math.max(...walk.map((s) => s.player.position.x)), "never inside the east wall").toBeLessThanOrEqual(wantX + 0.001);
    expect(Math.max(...walk.map((s) => s.player.position.z)), "never inside the south wall").toBeLessThanOrEqual(wantZ + 0.001);
    const last = walk.slice(-60);
    for (const s of last) {
      expect(Math.abs(s.player.position.x - wantX)).toBeLessThan(0.005);
      expect(Math.abs(s.player.position.z - wantZ)).toBeLessThan(0.005);
    }
    const spread = (axis: "x" | "y" | "z"): number => Math.max(...last.map((s) => s.player.position[axis])) - Math.min(...last.map((s) => s.player.position[axis]));
    expect(spread("x"), "jitter x over the last second").toBeLessThan(0.004);
    expect(spread("z"), "jitter z").toBeLessThan(0.004);
    expect(spread("y"), "jitter y").toBeLessThan(0.004);
    expect(last.every(grounded)).toBe(true);
  });

  test("the same scripted input gives bit-for-bit equal results at every display rate", async ({ page }) => {
    test.setTimeout(600_000);
    const script: Step[] = [
      wait(20),
      hold(["ArrowRight"], 40),
      tap("Digit1"),
      wait(10),
      hold(["ArrowRight"], 100),
      hold(["Space", "ArrowLeft"], 5),
      wait(60),
      tap("Digit5"),
      wait(200),
      hold(["ArrowRight"], 80),
      tap("Digit7"),
      wait(200),
      hold(["ArrowDown", "KeyD"], 90),
      tap("Digit3"),
      wait(20),
      hold(["ArrowRight"], 200),
      hold(["Space"], 1),
      wait(120),
      tap("Digit6"),
      wait(240),
    ];
    const patterns: Array<{ pattern: PatternName; seed: number }> = [
      { pattern: "tick", seed: 1 },
      { pattern: "30", seed: 1 },
      { pattern: "60", seed: 1 },
      { pattern: "144", seed: 1 },
      { pattern: "jitter", seed: 1 },
      { pattern: "jitter", seed: 2026 },
    ];
    const results: Array<{ label: string; samples: Sample[]; frames: number }> = [];
    for (const { pattern, seed } of patterns) {
      const frames = plan(script, pattern, seed);
      const result = await run(page, script, { pattern, seed, sample: "boundary" });
      results.push({ label: `${pattern}${pattern === "jitter" ? ` seed ${String(seed)}` : ""}`, samples: result.samples, frames: frames.length });
    }
    const reference = results[0];
    expect(reference?.samples.length, "one snapshot per step of the script").toBe(script.length);
    for (const other of results.slice(1)) {
      expect(other.samples.length, other.label).toBe(reference?.samples.length);
      other.samples.forEach((sample, i) => {
        const want = reference?.samples[i] as Sample;
        expect(sample.ticks, `${other.label}: ticks at step ${String(i)}`).toBe(want.ticks);
        expect(sample.player, `${other.label}: player at step ${String(i)}`).toEqual(want.player);
        expect(sample.platforms, `${other.label}: platforms at step ${String(i)}`).toEqual(want.platforms);
        expect(sample.state, `${other.label}: state at step ${String(i)}`).toEqual(want.state);
      });
    }
    writeProbe("display-rate", {
      frames: Object.fromEntries(results.map((r) => [r.label, r.frames])),
      final: results.map((r) => ({ label: r.label, position: r.samples.at(-1)?.player.position })),
    });
    // The control: the equality is not vacuous. The same script with one key change a tick later ends elsewhere.
    const shifted: Step[] = script.map((step, i) => (i === 1 ? hold(["ArrowRight"], 41) : i === 2 ? step : step));
    const control = await run(page, shifted, { pattern: "tick", sample: "boundary" });
    const largest = Math.max(...control.samples.map((s, i) => norm(sub(s.player.position, reference?.samples[i]?.player.position as Vec3))));
    expect(largest, "a one-tick change of the input changes the result").toBeGreaterThan(0.05);
  });

  test("the host API answers from the page: a ray hits the expected entity, contacts lists the floor, collision groups change what a cast sees", async ({ page }) => {
    await page.goto(MOVEMENT_URL);
    const r = await page.evaluate(hostApi, { target: TARGET, settleFrames: 60, dt: STEP, idNames: ["Player", "Ground", "Ledge"] });
    expect(r.diagnostics).toEqual([]);
    expect(r.stateAfter).toBe("running");
    expect(r.hasPhysics).toBe(true);
    const { Player, Ground, Ledge } = r.ids as { Player: string; Ground: string; Ledge: string };
    expect(new Set([Player, Ground, Ledge]).size, "three distinct IDs").toBe(3);

    // A ray straight down 5 m above the floor hits it 5 m away with an upward normal.
    expect(r.rayFloor?.entityId).toBe(Ground);
    expect(r.rayFloor?.distance).toBeCloseTo(5, 3);
    expect(r.rayFloor?.normal.y).toBeCloseTo(1, 4);
    expect(r.rayFloor?.point.y).toBeCloseTo(0, 3);
    // Above the character it hits the character first (the top of the capsule at rest height + half the height), and not when the character is excluded.
    expect(r.rayPlayer?.entityId).toBe(Player);
    expect(r.rayPlayer?.distance).toBeCloseTo(5 - (REST_Y + 0.9), 2);
    expect(r.rayExcluded?.entityId).toBe(Ground);
    expect(r.rayExcluded?.distance).toBeCloseTo(5, 3);
    // Along +x at 0.3 m height in the ledge's lane: the ledge's front face, 3 m away, normal -x.
    expect(r.rayLedge?.entityId).toBe(Ledge);
    expect(r.rayLedge?.distance).toBeCloseTo(LEDGE.frontX, 3);
    expect(r.rayLedge?.normal.x).toBeCloseTo(-1, 4);
    expect(r.rayMiss, "nothing above").toBeNull();
    // A sphere of radius 0.5 swept 10 m down from 5 m above stops after 4.5 m: fraction 0.45.
    expect(r.castFloor?.entityId).toBe(Ground);
    expect(r.castFloor?.fraction).toBeCloseTo(0.45, 3);
    expect(r.castFloor?.normal.y).toBeCloseTo(1, 3);

    // The character stands on the floor: contacts lists it, with an upward normal and a gap of at most the skin plus the contact margin.
    const floor = r.contacts.find((c) => c.entityId === Ground);
    expect(floor, `contacts of the character: ${JSON.stringify(r.contacts)}`).toBeDefined();
    expect(Math.abs(floor?.normal.y ?? 0)).toBeGreaterThan(0.99);
    expect(floor?.distance ?? Number.NaN).toBeLessThan(0.05);

    // Collision groups: with the floor in group 2 only, a query of group 1 does not see it, one of group 2 does, so does a query without groups; restored, group 1 sees it again.
    expect(r.groups.before?.entityId).toBe(Ground);
    expect(r.groups.withOne, "a query of group 1 passes through a floor of group 2").toBeNull();
    expect(r.groups.withTwo?.entityId).toBe(Ground);
    expect(r.groups.withNone?.entityId, "a query without groups sees everything").toBe(Ground);
    expect(r.groups.afterRestore?.entityId).toBe(Ground);

    // Bad input throws the documented kinds and never reaches the engine.
    expect(r.errors.map((e) => `${e.call}: ${e.name}`)).toEqual([
      "castRay with a zero direction: RangeError",
      "castRay excluding a number: TypeError",
      "contacts of an unknown entity: RangeError",
      "setCollisionGroups out of range: RangeError",
    ]);
    for (const key of RELEASED_COUNTERS) expect(r.disposed[key], `${key} after dispose`).toBe(0);
  });

  test("mounting and disposing three times in one page leaves no live resource, and the camera follows the character", async ({ page }) => {
    await page.goto(MOVEMENT_URL);
    const result = await page.evaluate(
      async ({ target, dt }) => {
        interface AppLike {
          state: string;
          debug: { step(frames: number, dt: number): void; pressKey(code: string): void; releaseKey(code: string): void; counters(): Record<string, number>; readPixels(): Promise<{ width: number; height: number; data: Uint8Array }> };
          dispose(): void;
        }
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const diagnostics: string[] = [];
        const disposed: Array<Record<string, number>> = [];
        const whiteBox: Array<{ left: number; right: number; width: number } | null> = [];
        const pictures: Array<{ width: number; height: number; base64: string }> = [];
        for (let round = 0; round < 3; round += 1) {
          const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: { code: string }) => diagnostics.push(d.code) });
          const look = async (): Promise<void> => {
            const frame = await app.debug.readPixels();
            // The nose is the only pure white in the middle band of the picture (the HUD text is at the top).
            let left = Number.POSITIVE_INFINITY;
            let right = -1;
            for (let y = Math.floor(frame.height * 0.35); y < Math.floor(frame.height * 0.9); y += 1) {
              for (let x = 0; x < frame.width; x += 1) {
                const i = (y * frame.width + x) * 4;
                if ((frame.data[i] ?? 0) >= 250 && (frame.data[i + 1] ?? 0) >= 250 && (frame.data[i + 2] ?? 0) >= 250) {
                  left = Math.min(left, x);
                  right = Math.max(right, x);
                }
              }
            }
            whiteBox.push(right < 0 ? null : { left, right, width: frame.width });
            let text = "";
            for (let i = 0; i < frame.data.length; i += 0x8000) text += String.fromCharCode(...frame.data.subarray(i, i + 0x8000));
            pictures.push({ width: frame.width, height: frame.height, base64: btoa(text) });
          };
          app.debug.step(60, dt);
          if (round === 0) await look();
          app.debug.pressKey("ArrowUp");
          app.debug.step(120, dt);
          app.debug.releaseKey("ArrowUp");
          app.debug.pressKey("ArrowRight");
          app.debug.step(60, dt);
          app.debug.releaseKey("ArrowRight");
          app.debug.step(10, dt);
          if (round === 0) await look();
          app.dispose();
          disposed.push({ ...app.debug.counters() });
        }
        return { diagnostics, disposed, whiteBox, pictures };
      },
      { target: { width: 640, height: 320 }, dt: STEP },
    );
    result.pictures.forEach((picture, i) => writeResult(`movement-${i === 0 ? "start" : "walked"}-${test.info().project.name}.png`, encodePng(picture.width, picture.height, new Uint8Array(Buffer.from(picture.base64, "base64")))));
    expect(result.diagnostics).toEqual([]);
    for (const counters of result.disposed) for (const key of RELEASED_COUNTERS) expect(counters[key], key).toBe(0);
    // The nose is visible at the start and after the character walked 8 m towards the back wall and 4 m to the right, near the middle column both times: the camera follows.
    expect(result.whiteBox).toHaveLength(2);
    for (const box of result.whiteBox) {
      expect(box, "the nose is on screen").not.toBeNull();
      const middle = ((box?.left ?? 0) + (box?.right ?? 0)) / 2 / (box?.width ?? 1);
      expect(Math.abs(middle - 0.5), "the nose is near the middle of the picture").toBeLessThan(0.08);
    }
  });
});

/** Writes a small result file next to the run's other results (the measured numbers the decision record quotes). */
function writeProbe(name: string, value: unknown): void {
  const dir = process.env["MTEK_RESULTS_DIR"];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `movement-${name}-${test.info().project.name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}
