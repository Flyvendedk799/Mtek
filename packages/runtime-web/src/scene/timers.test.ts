/**
 * The timer list (decision 0142, `spec/scenes.md` section 15.3): order of ties, owners that die, timers started by
 * timers, a block that throws, `every` after a long frame, `clear()` from inside a block, and the early-out that
 * keeps a quiet frame from looking at the list.
 */
import { describe, expect, it } from "vitest";
import { TimerList, type TimerOwner } from "./timers.js";

const alive = (): boolean => true;
const owner = (name: string): NonNullable<TimerOwner> => ({ ref: name });

describe("TimerList", () => {
  it("runs due timers in order of due time, then of the order they were started", () => {
    const timers = new TimerList();
    const log: string[] = [];
    timers.after(0.5, () => log.push("late"), null, 0);
    timers.after(0.2, () => log.push("tie-first"), null, 0);
    timers.every(0.2, () => log.push("tie-second"), null, 0);
    timers.after(0.1, () => log.push("early"), null, 0);
    timers.advance(1, alive);
    expect(log).toEqual(["early", "tie-first", "tie-second", "late"]);
  });

  it("does not run a timer before its time and counts only game time", () => {
    const timers = new TimerList();
    let runs = 0;
    timers.after(0.25, () => (runs += 1), null, 0);
    timers.advance(0.1, alive);
    timers.advance(0.1, alive);
    expect(runs).toBe(0);
    expect(timers.gameTime).toBeCloseTo(0.2);
    timers.advance(0.1, alive);
    expect(runs).toBe(1);
    expect(timers.size).toBe(0);
  });

  it("drops the timer of an owner that was destroyed while the timer was due, without running it", () => {
    const timers = new TimerList();
    const log: string[] = [];
    const gone = owner("gone");
    const kept = owner("kept");
    timers.after(0.1, () => log.push("gone"), gone, 0);
    timers.every(0.1, () => log.push("gone-every"), gone, 0);
    timers.after(0.1, () => log.push("kept"), kept, 0);
    timers.advance(0.2, (who) => who !== gone);
    expect(log).toEqual(["kept"]);
    expect(timers.size).toBe(0);
  });

  it("drops the timer of an owner destroyed by an earlier block of the same frame", () => {
    const timers = new TimerList();
    const log: string[] = [];
    const victim = owner("victim");
    let victimAlive = true;
    timers.after(0.1, () => {
      victimAlive = false;
      log.push("killer");
    }, null, 0);
    timers.after(0.1, () => log.push("victim"), victim, 0);
    timers.advance(0.2, (who) => who !== victim || victimAlive);
    expect(log).toEqual(["killer"]);
    expect(timers.size).toBe(0);
  });

  it("makes a timer started inside a timer wait for the next frame", () => {
    const timers = new TimerList();
    const log: string[] = [];
    timers.after(0.1, () => {
      log.push("outer");
      timers.after(0, () => log.push("inner"), null, 0);
    }, null, 0);
    timers.advance(0.2, alive);
    expect(log).toEqual(["outer"]);
    expect(timers.size).toBe(1);
    timers.advance(0.01, alive);
    expect(log).toEqual(["outer", "inner"]);
  });

  it("starts a timer inside a timer from the game time of the frame that started it", () => {
    const timers = new TimerList();
    const log: number[] = [];
    timers.every(0.1, () => {
      log.push(timers.gameTime);
      if (log.length === 1) timers.after(0.3, () => log.push(-timers.gameTime), null, 0);
    }, null, 0);
    timers.advance(0.1, alive);
    timers.advance(0.1, alive);
    timers.advance(0.1, alive);
    timers.advance(0.1, alive);
    expect(log.map((t) => Math.round(Math.abs(t) * 100) / 100)).toEqual([0.1, 0.2, 0.3, 0.4, 0.4]);
    expect(log.filter((t) => t < 0)).toHaveLength(1);
  });

  it("leaves the list consistent when a block throws: the rest stays queued and a repeating timer stays scheduled", () => {
    const timers = new TimerList();
    const log: string[] = [];
    timers.after(0.1, () => log.push("first"), null, 0);
    timers.every(0.1, () => {
      log.push("boom");
      throw new Error("boom");
    }, null, 0);
    timers.after(0.1, () => log.push("after-boom"), null, 0);
    timers.after(5, () => log.push("far"), null, 0);
    expect(() => {
      timers.advance(0.2, alive);
    }).toThrow("boom");
    expect(log).toEqual(["first", "boom"]);
    // The one that threw is an `every`: still scheduled. The one behind it did not run: still queued. Not run twice.
    expect(timers.size).toBe(3);
    expect(() => {
      timers.advance(0.2, alive);
    }).toThrow("boom");
    expect(log).toEqual(["first", "boom", "after-boom", "boom"]);
    expect(timers.size).toBe(2);
  });

  it("runs an every block once after a long frame and schedules the next one period after now", () => {
    const timers = new TimerList();
    let runs = 0;
    timers.every(0.1, () => (runs += 1), null, 0);
    timers.advance(1, alive);
    expect(runs).toBe(1);
    timers.advance(0.05, alive);
    expect(runs).toBe(1);
    timers.advance(0.06, alive);
    expect(runs).toBe(2);
  });

  it("runs an every block with a period of 0 once per frame", () => {
    const timers = new TimerList();
    let runs = 0;
    timers.every(0, () => (runs += 1), null, 0);
    timers.advance(0.01, alive);
    timers.advance(0.01, alive);
    timers.advance(0.01, alive);
    expect(runs).toBe(3);
  });

  it("treats a negative or non-finite delay as 0", () => {
    const timers = new TimerList();
    const log: string[] = [];
    timers.after(-1, () => log.push("negative"), null, 0);
    timers.after(Number.NaN, () => log.push("nan"), null, 0);
    timers.after(Number.POSITIVE_INFINITY, () => log.push("infinite"), null, 0);
    timers.advance(0, alive);
    expect(log).toEqual(["negative", "nan", "infinite"]);
  });

  it("ends the scene's timers when a block clears the list (reset from inside a timer)", () => {
    const timers = new TimerList();
    const log: string[] = [];
    timers.after(0.1, () => {
      log.push("reset");
      timers.clear();
    }, null, 0);
    timers.after(0.1, () => log.push("same-frame-after-reset"), null, 0);
    timers.every(0.1, () => log.push("every"), null, 0);
    timers.advance(0.2, alive);
    expect(log).toEqual(["reset"]);
    expect(timers.size).toBe(0);
    timers.advance(10, alive);
    expect(log).toEqual(["reset"]);
  });

  it("keeps a timer a block starts after it cleared the list", () => {
    const timers = new TimerList();
    const log: string[] = [];
    timers.after(0.1, () => {
      timers.clear();
      timers.after(0.1, () => log.push("fresh"), null, 0);
    }, null, 0);
    timers.advance(0.2, alive);
    expect(timers.size).toBe(1);
    timers.advance(0.2, alive);
    expect(log).toEqual(["fresh"]);
  });

  it("rejects a block that is not a function", () => {
    expect(() => {
      new TimerList().after(1, "nope", null, 0);
    }).toThrow(TypeError);
  });

  it("does not look at the list in a frame before the earliest due time", () => {
    const timers = new TimerList();
    let looked = 0;
    // `alive` is only asked about owned timers that fall due: a quiet frame must not ask at all.
    const probe = (): boolean => {
      looked += 1;
      return true;
    };
    timers.after(1, () => undefined, owner("a"), 0);
    for (let i = 0; i < 50; i += 1) timers.advance(0.01, probe);
    expect(looked).toBe(0);
    timers.advance(1, probe);
    expect(looked).toBeGreaterThan(0);
  });

  it("keeps the earliest due time right after timers run, are added and are cleared", () => {
    const timers = new TimerList();
    const log: string[] = [];
    timers.after(0.5, () => log.push("a"), null, 0);
    timers.advance(0.1, alive);
    timers.after(0.1, () => log.push("b"), null, 0);
    timers.advance(0.1, alive);
    expect(log).toEqual(["b"]);
    timers.advance(0.3, alive);
    expect(log).toEqual(["b", "a"]);
    timers.after(0.1, () => log.push("c"), null, 0);
    timers.clear();
    timers.after(0.2, () => log.push("d"), null, 0);
    timers.advance(0.1, alive);
    expect(log).toEqual(["b", "a"]);
    timers.advance(0.1, alive);
    expect(log).toEqual(["b", "a", "d"]);
  });
});
