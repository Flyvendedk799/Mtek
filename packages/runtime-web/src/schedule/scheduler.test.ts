import { describe, expect, it } from "vitest";
import { Scheduler, m1Phases, type FramePhases, type FrameSource, type SchedulerConfig } from "./scheduler.js";

const CONFIG: SchedulerConfig = { fixedStep: 0.01, maxCatchUpSteps: 4, maxFrameDelta: 0.1 };

/** Records the phase order as strings. */
function recordingPhases(log: string[]): FramePhases {
  return {
    phase1_input: () => log.push("1"),
    phase2_tick: (step) => log.push(`2(${String(step)})`),
    phase3_update: (delta) => log.push(`3(${delta.toFixed(3)})`),
    phase4_flush: () => log.push("4"),
    phase5_bindings: () => log.push("5"),
    phase6_transforms: () => log.push("6"),
    phase7_render: () => log.push("7"),
  };
}

/** A frame source that runs callbacks only when the test says so; models requestAnimationFrame/cancelAnimationFrame. */
class ManualFrameSource implements FrameSource {
  private next = 1;
  private readonly pending = new Map<number, (nowMs: number) => void>();
  readonly requests: number[] = [];
  readonly cancelled: number[] = [];

  request(callback: (nowMs: number) => void): number {
    const id = this.next++;
    this.pending.set(id, callback);
    this.requests.push(id);
    return id;
  }

  cancel(handle: number): void {
    this.cancelled.push(handle);
    this.pending.delete(handle);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Fires every pending callback once, like a browser animation-frame tick. */
  tick(nowMs: number): void {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback(nowMs);
  }
}

describe("phase order", () => {
  it("runs the seven phases in order, with the ticks between input and update", () => {
    const log: string[] = [];
    const scheduler = new Scheduler(CONFIG, recordingPhases(log), null);
    scheduler.stepManual(1, 0.025);
    expect(log).toEqual(["1", "2(0.01)", "2(0.01)", "3(0.025)", "4", "5", "6", "7"]);
  });

  it("carries the fractional remainder of the accumulator into the next frame", () => {
    const log: string[] = [];
    const scheduler = new Scheduler(CONFIG, recordingPhases(log), null);
    scheduler.stepManual(1, 0.025);
    log.length = 0;
    scheduler.stepManual(1, 0.005);
    // 0.005 left over + 0.005 = 0.010 -> exactly one tick (within float tolerance of the accumulator)
    expect(log.filter((entry) => entry.startsWith("2"))).toHaveLength(1);
  });

  it("m1Phases leaves phases 1 to 6 empty and calls the renderer in phase 7", () => {
    let rendered = 0;
    const scheduler = new Scheduler(CONFIG, m1Phases(() => (rendered += 1)), null);
    scheduler.stepManual(3, 0.016);
    expect(rendered).toBe(3);
    expect(scheduler.frameIndex).toBe(3);
  });
});

describe("clamping and catch-up", () => {
  it("clamps the frame delta to maxFrameDelta", () => {
    const log: string[] = [];
    const scheduler = new Scheduler(CONFIG, recordingPhases(log), null);
    scheduler.stepManual(1, 5);
    expect(scheduler.delta).toBe(0.1);
    expect(scheduler.activeTime).toBeCloseTo(0.1, 12);
    expect(log).toContain("3(0.100)");
  });

  it("runs at most maxCatchUpSteps ticks and counts the discarded steps", () => {
    const log: string[] = [];
    const scheduler = new Scheduler({ ...CONFIG, maxFrameDelta: 1 }, recordingPhases(log), null);
    scheduler.stepManual(1, 0.095); // 9.5 steps worth; 4 run, the rest is discarded
    expect(log.filter((entry) => entry.startsWith("2"))).toHaveLength(4);
    expect(scheduler.discardedSteps).toBe(5);
    // The remainder below one step survives.
    log.length = 0;
    scheduler.stepManual(1, 0.005);
    expect(log.filter((entry) => entry.startsWith("2"))).toHaveLength(1);
  });

  it("accumulates activeTime as an f64 sum of the clamped deltas", () => {
    const scheduler = new Scheduler(CONFIG, m1Phases(() => undefined), null);
    scheduler.stepManual(1000, 0.001);
    expect(scheduler.activeTime).toBeCloseTo(1, 9);
    expect(scheduler.frameIndex).toBe(1000);
  });

  it("rejects invalid manual steps", () => {
    const scheduler = new Scheduler(CONFIG, m1Phases(() => undefined), null);
    expect(() => scheduler.stepManual(-1, 0.01)).toThrow(RangeError);
    expect(() => scheduler.stepManual(1.5, 0.01)).toThrow(RangeError);
    expect(() => scheduler.stepManual(1, Number.NaN)).toThrow(RangeError);
    expect(() => scheduler.stepManual(1, -0.01)).toThrow(RangeError);
  });

  it("stepManual requires the manual clock", () => {
    const scheduler = new Scheduler(CONFIG, m1Phases(() => undefined), new ManualFrameSource());
    expect(() => scheduler.stepManual(1, 0.01)).toThrow(/manual clock/);
  });
});

describe("animation-frame loop", () => {
  it("uses delta 0 for the first frame, then real time differences in seconds", () => {
    const source = new ManualFrameSource();
    const log: string[] = [];
    const scheduler = new Scheduler(CONFIG, recordingPhases(log), source);
    scheduler.start();
    source.tick(1000);
    expect(scheduler.delta).toBe(0);
    source.tick(1016);
    expect(scheduler.delta).toBeCloseTo(0.016, 12);
    expect(scheduler.frameIndex).toBe(2);
    expect(source.pendingCount).toBe(1); // exactly one request outstanding
  });

  it("clamps a long gap between animation frames", () => {
    const source = new ManualFrameSource();
    const scheduler = new Scheduler(CONFIG, m1Phases(() => undefined), source);
    scheduler.start();
    source.tick(0);
    source.tick(60_000);
    expect(scheduler.delta).toBe(0.1);
  });

  it("never simulates the paused interval: resume restarts with delta 0", () => {
    const source = new ManualFrameSource();
    const scheduler = new Scheduler(CONFIG, m1Phases(() => undefined), source);
    scheduler.start();
    source.tick(0);
    source.tick(16);
    const timeBefore = scheduler.activeTime;
    scheduler.pause();
    expect(source.pendingCount).toBe(0); // the pending request was cancelled
    source.tick(10_000); // nothing is pending, so nothing runs
    expect(scheduler.activeTime).toBe(timeBefore);
    scheduler.resume();
    expect(source.pendingCount).toBe(1);
    source.tick(20_000);
    expect(scheduler.delta).toBe(0);
    expect(scheduler.activeTime).toBe(timeBefore);
    source.tick(20_016);
    expect(scheduler.delta).toBeCloseTo(0.016, 12);
    expect(scheduler.activeTime).toBeCloseTo(timeBefore + 0.016, 12);
  });

  it("pause and resume are idempotent and never double-request frames", () => {
    const source = new ManualFrameSource();
    const scheduler = new Scheduler(CONFIG, m1Phases(() => undefined), source);
    scheduler.start();
    scheduler.start();
    expect(source.pendingCount).toBe(1);
    scheduler.pause();
    scheduler.pause();
    expect(scheduler.state).toBe("paused");
    scheduler.resume();
    scheduler.resume();
    expect(source.pendingCount).toBe(1);
  });

  it("manual stepping does nothing while paused or stopped", () => {
    let rendered = 0;
    const scheduler = new Scheduler(CONFIG, m1Phases(() => (rendered += 1)), null);
    scheduler.pause();
    scheduler.stepManual(5, 0.01);
    expect(rendered).toBe(0);
    scheduler.resume();
    scheduler.stepManual(2, 0.01);
    expect(rendered).toBe(2);
    scheduler.stop();
    scheduler.stepManual(5, 0.01);
    expect(rendered).toBe(2);
  });

  it("stop cancels the pending frame and cannot be resumed", () => {
    const source = new ManualFrameSource();
    const scheduler = new Scheduler(CONFIG, m1Phases(() => undefined), source);
    scheduler.start();
    scheduler.stop();
    expect(source.pendingCount).toBe(0);
    expect(scheduler.hasPendingFrame).toBe(false);
    scheduler.resume();
    expect(source.pendingCount).toBe(0);
    expect(scheduler.state).toBe("stopped");
  });

  it("does not render when a handler stops the scheduler mid-frame", () => {
    const log: string[] = [];
    const phases = recordingPhases(log);
    const scheduler: Scheduler = new Scheduler(
      CONFIG,
      {
        ...phases,
        phase3_update: () => {
          scheduler.stop();
        },
      },
      null,
    );
    scheduler.stepManual(1, 0.016);
    expect(log).not.toContain("7");
  });

  it("reports a throwing frame to onFrameError and keeps the loop alive", () => {
    const source = new ManualFrameSource();
    const errors: unknown[] = [];
    const boom = new Error("boom");
    const scheduler = new Scheduler(
      CONFIG,
      {
        ...m1Phases(() => undefined),
        phase3_update: () => {
          throw boom;
        },
      },
      source,
      (error) => errors.push(error),
    );
    scheduler.start();
    source.tick(0);
    expect(errors).toEqual([boom]);
    expect(source.pendingCount).toBe(1);
  });

  it("lets the owner stop the scheduler from the error handler", () => {
    const source = new ManualFrameSource();
    const scheduler: Scheduler = new Scheduler(
      CONFIG,
      {
        ...m1Phases(() => undefined),
        phase3_update: () => {
          throw new Error("boom");
        },
      },
      source,
      () => {
        scheduler.stop();
      },
    );
    scheduler.start();
    source.tick(0);
    expect(source.pendingCount).toBe(0);
  });

  it("propagates a frame error when no handler is given", () => {
    const source = new ManualFrameSource();
    const scheduler = new Scheduler(
      CONFIG,
      {
        ...m1Phases(() => undefined),
        phase3_update: () => {
          throw new Error("unhandled");
        },
      },
      source,
    );
    scheduler.start();
    expect(() => {
      source.tick(0);
    }).toThrow("unhandled");
  });
});
