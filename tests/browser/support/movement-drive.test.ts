// The plans of the character movement acceptance (support/movement-drive.ts) against a model of the runtime's
// accumulator (packages/runtime-web/src/schedule/scheduler.ts, spec/runtime-abi.md section 7): whatever the frame-time
// pattern, a key change must arrive after the same number of ticks and the whole plan must run the same number of ticks.
import { describe, expect, it } from "vitest";
import { JITTER_MAX, JITTER_MIN, hold, plan, planTicks, tap, wait, type Frame, type PatternName, type Step } from "./movement-drive.ts";
import { MOVEMENT_SOURCE_LITERALS, STEP, movementConstant, movementSource } from "./movement-example.ts";

const PATTERNS: readonly PatternName[] = ["tick", "30", "60", "144", "jitter"];
const MAX_CATCH_UP = 4;
const MAX_FRAME_DELTA = 0.1;

/** What the scheduler does with a frame: the accumulator, the ticks, and the ticks run when each key change arrives. */
function run(frames: readonly Frame[]): { ticks: number; changes: Array<{ at: number; press: readonly string[]; release: readonly string[] }>; discarded: number } {
  let accumulator = 0;
  let ticks = 0;
  let discarded = 0;
  const changes: Array<{ at: number; press: readonly string[]; release: readonly string[] }> = [];
  for (const frame of frames) {
    if (frame.press.length > 0 || frame.release.length > 0) changes.push({ at: ticks, press: frame.press, release: frame.release });
    accumulator += Math.min(frame.dt, MAX_FRAME_DELTA);
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_CATCH_UP) {
      ticks += 1;
      accumulator -= STEP;
      steps += 1;
    }
    if (accumulator >= STEP) {
      discarded += Math.floor(accumulator / STEP);
      accumulator %= STEP;
    }
  }
  return { ticks, changes, discarded };
}

const SCRIPT: readonly Step[] = [wait(37), tap("Digit1"), wait(11), hold(["ArrowRight", "KeyD"], 61), hold(["ArrowRight"], 7), hold(["Space"], 1), wait(120), hold(["ArrowDown", "ArrowRight"], 600), wait(3)];

describe("movement plans", () => {
  it("counts the ticks of a script", () => {
    expect(planTicks(SCRIPT)).toBe(37 + 1 + 11 + 61 + 7 + 1 + 120 + 600 + 3);
  });

  it("runs the same ticks and delivers every key change after the same tick in every pattern", () => {
    const reference = run(plan(SCRIPT, "tick"));
    expect(reference.ticks).toBe(planTicks(SCRIPT));
    expect(reference.discarded).toBe(0);
    expect(reference.changes.map((c) => c.at)).toEqual([37, 49, 110, 117, 118, 238, 838]);
    for (const pattern of PATTERNS) {
      for (const seed of pattern === "jitter" ? [1, 2, 3, 99, 2026] : [1]) {
        const result = run(plan(SCRIPT, pattern, seed));
        expect(result.ticks, `${pattern} ${String(seed)}: ticks`).toBe(reference.ticks);
        expect(result.discarded, `${pattern} ${String(seed)}: no tick is dropped`).toBe(0);
        expect(result.changes, `${pattern} ${String(seed)}: key changes`).toEqual(reference.changes);
      }
    }
  });

  it("puts the key changes where the script says", () => {
    const { changes } = run(plan(SCRIPT, "60"));
    expect(changes[0]).toEqual({ at: 37, press: ["Digit1"], release: ["Digit1"] });
    expect(changes[1]).toEqual({ at: 49, press: ["ArrowRight", "KeyD"], release: [] });
    // The next hold keeps ArrowRight down and lets KeyD go; the one after swaps it for Space.
    expect(changes[2]).toEqual({ at: 110, press: [], release: ["KeyD"] });
    expect(changes[3]).toEqual({ at: 117, press: ["Space"], release: ["ArrowRight"] });
    expect(changes[4]).toEqual({ at: 118, press: [], release: ["Space"] });
  });

  it("uses frames of the nominal length, a shorter last frame, and bounded jitter", () => {
    for (const [pattern, dt] of [["30", 1 / 30], ["60", 1 / 60], ["144", 1 / 144]] as const) {
      const frames = plan([wait(120)], pattern);
      expect(frames.slice(0, -1).every((f) => f.dt === dt), pattern).toBe(true);
      expect(frames.at(-1)?.dt ?? Number.NaN).toBeLessThanOrEqual(dt);
      expect(frames.at(-1)?.boundary).toBe(true);
    }
    const jitter = plan([wait(600)], "jitter", 7);
    const lengths = jitter.slice(0, -1).map((f) => f.dt);
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(JITTER_MIN);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(JITTER_MAX);
    expect(new Set(lengths).size, "the lengths vary").toBeGreaterThan(50);
    expect(plan([wait(600)], "jitter", 7)).toEqual(jitter);
    expect(plan([wait(600)], "jitter", 8)).not.toEqual(jitter);
  });

  it("marks the last frame of every step as a boundary", () => {
    for (const pattern of PATTERNS) {
      const frames = plan([wait(30), wait(30), hold(["ArrowRight"], 5)], pattern);
      expect(frames.filter((f) => f.boundary), pattern).toHaveLength(3);
      expect(frames.at(-1)?.boundary, pattern).toBe(true);
    }
    expect(plan([wait(5)], "tick").map((f) => f.boundary)).toEqual([false, false, false, false, true]);
  });
});

describe("the movement example model", () => {
  it("transcribes lines that occur in the example's source", () => {
    const source = movementSource();
    for (const literal of MOVEMENT_SOURCE_LITERALS) expect(source, literal).toContain(literal);
  });

  it("reads the example's constants", () => {
    expect(movementConstant("WALK_SPEED")).toBe(4);
    expect(movementConstant("JUMP_SPEED")).toBe(5);
    expect(movementConstant("GRAVITY")).toBe(9.81);
    expect(movementConstant("GENTLE_ANGLE")).toBeCloseTo((30 * Math.PI) / 180, 6);
    expect(movementConstant("STEEP_ANGLE")).toBeCloseTo((60 * Math.PI) / 180, 6);
    expect(() => movementConstant("NO_SUCH_CONSTANT")).toThrow(/no `const NO_SUCH_CONSTANT/);
  });
});
