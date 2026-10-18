// The frame order of the baseline support (`spec/scenes.md` section 10): host inputs, key transitions, fixed
// ticks, update. It is the same module `startTask` runs in the browser; these tests need no GPU.
import { describe, expect, it } from "vitest";
import { FIXED_STEP, FrameClock, type FrameCallbacks, MAX_CATCH_UP_STEPS, MAX_FRAME_DELTA } from "../src/frame.ts";

function recorder(): { log: string[]; callbacks: FrameCallbacks } {
  const log: string[] = [];
  return {
    log,
    callbacks: {
      input: (name, value) => log.push(`input ${name}=${String(value)}`),
      keyDown: (code) => log.push(`down ${code}`),
      keyUp: (code) => log.push(`up ${code}`),
      fixedUpdate: () => log.push("fixed"),
      update: (dt) => log.push(`update ${dt.toFixed(4)}`),
    },
  };
}

describe("frame clock", () => {
  it("applies host inputs before key transitions, each in arrival order (section 10, phase 1)", () => {
    const clock = new FrameClock();
    const { log, callbacks } = recorder();
    clock.pressKey("KeyA");
    clock.setInput("speed", 2);
    clock.pressKey("KeyB");
    clock.setInput("speed", 3);
    clock.frame(0, callbacks);
    expect(log).toEqual(["input speed=2", "input speed=3", "down KeyA", "down KeyB", "update 0.0000"]);
  });

  it("delivers key up, and a repeat of a held key is not a second press", () => {
    const clock = new FrameClock();
    const { log, callbacks } = recorder();
    clock.pressKey("Space");
    clock.pressKey("Space");
    clock.releaseKey("Space");
    clock.releaseKey("Space");
    clock.frame(0, callbacks);
    expect(log).toEqual(["down Space", "up Space", "update 0.0000"]);
  });

  it("answers is_key_down as of the input phase of the frame that applies the transition", () => {
    const clock = new FrameClock();
    const { callbacks } = recorder();
    clock.pressKey("KeyA");
    expect(clock.down.has("KeyA")).toBe(false);
    clock.frame(0, callbacks);
    expect(clock.down.has("KeyA")).toBe(true);
    clock.releaseKey("KeyA");
    expect(clock.down.has("KeyA")).toBe(true);
    clock.frame(0, callbacks);
    expect(clock.down.has("KeyA")).toBe(false);
  });

  it("answers is_key_down as of the END of the input phase, also inside a handler of that phase", () => {
    const clock = new FrameClock();
    const seen: string[] = [];
    const callbacks: FrameCallbacks = {
      input: () => undefined,
      keyDown: (code) => seen.push(`down ${code}: A ${String(clock.down.has("KeyA"))} B ${String(clock.down.has("KeyB"))}`),
      keyUp: (code) => seen.push(`up ${code}: A ${String(clock.down.has("KeyA"))} B ${String(clock.down.has("KeyB"))}`),
      fixedUpdate: () => undefined,
      update: () => undefined,
    };
    // A goes down and up again in one frame, B goes down: when the handler of A's press runs, A is already up
    // (the state is that of the end of the phase) and B is already down.
    clock.pressKey("KeyA");
    clock.releaseKey("KeyA");
    clock.pressKey("KeyB");
    clock.frame(0, callbacks);
    expect(seen).toEqual(["down KeyA: A false B true", "up KeyA: A false B true", "down KeyB: A false B true"]);
  });

  it("runs the fixed ticks between the input and the update", () => {
    const clock = new FrameClock();
    const { log, callbacks } = recorder();
    clock.pressKey("KeyA");
    clock.frame(FIXED_STEP, callbacks);
    expect(log).toEqual(["down KeyA", "fixed", `update ${FIXED_STEP.toFixed(4)}`]);
  });

  it("carries the remainder of the accumulator, so 3 frames of 0.024 s (1.44 steps) run 1, 1 and 2 ticks", () => {
    const clock = new FrameClock();
    const { callbacks } = recorder();
    const counts = [0, 1, 2].map(() => clock.frame(0.024, callbacks));
    expect(counts).toEqual([1, 1, 2]);
  });

  it("uses the step of the runtime manifest, 0.016666668 s, so a frame of exactly that length is one tick", () => {
    const clock = new FrameClock();
    const { callbacks } = recorder();
    expect(FIXED_STEP).toBe(0.016666668);
    expect([0, 1, 2].map(() => clock.frame(0.016666668, callbacks))).toEqual([1, 1, 1]);
    expect([0, 1].map(() => clock.frame(2 * 0.016666668, callbacks))).toEqual([2, 2]);
  });

  it("clamps the frame delta to 0.1 s, runs at most 4 ticks and drops the surplus", () => {
    const clock = new FrameClock();
    const { log, callbacks } = recorder();
    const ticks = clock.frame(5, callbacks);
    expect(MAX_CATCH_UP_STEPS).toBe(4);
    expect(ticks).toBe(4);
    expect(log.at(-1)).toBe(`update ${MAX_FRAME_DELTA.toFixed(4)}`);
    // 0.1 s is 6 steps: 4 ran and the surplus (less than one step) is what remains, not 2 steps of backlog.
    expect(clock.frame(0, callbacks)).toBe(0);
  });
});
