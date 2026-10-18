import { describe, expect, it } from "vitest";
import type { SceneView } from "./compare.ts";
import { executeSteps, type AppDriver, type InputResult } from "./execute.ts";
import type { PlanStep } from "./plan.ts";

/** A driver over a small model: `speed` flips with Space and `step` advances an angle. */
class FakeDriver implements AppDriver {
  readonly log: string[] = [];
  errors: string[] = [];
  inputResult: InputResult = { ok: true };
  throwOn: string | null = null;
  speed = 0.7;
  angle = 0;
  private pressed = false;
  private readonly pixels: Record<string, number[]>;
  constructor(pixels: Record<string, number[]> = {}) {
    this.pixels = pixels;
  }

  private record(entry: string): void {
    this.log.push(entry);
    if (this.throwOn !== null && entry.startsWith(this.throwOn)) throw new Error(`boom in ${entry}`);
  }
  step(frames: number, dt: number): Promise<void> {
    this.record(`step ${String(frames)} ${String(dt)}`);
    if (this.pressed) {
      this.speed = -this.speed;
      this.pressed = false;
    }
    this.angle += this.speed * frames * dt;
    return Promise.resolve();
  }
  press(code: string): Promise<void> {
    this.record(`press ${code}`);
    if (code === "Space") this.pressed = true;
    return Promise.resolve();
  }
  release(code: string): Promise<void> {
    this.record(`release ${code}`);
    return Promise.resolve();
  }
  setInput(name: string, value: unknown): Promise<InputResult> {
    this.record(`set_input ${name} ${JSON.stringify(value)}`);
    return Promise.resolve(this.inputResult);
  }
  scene(): Promise<SceneView> {
    this.record("scene");
    return Promise.resolve({ state: { speed: Math.fround(this.speed) }, entities: [] });
  }
  counters(): Promise<Record<string, number>> {
    this.record("counters");
    return Promise.resolve({ drawCalls: 2 });
  }
  pixel(x: number, y: number): Promise<readonly number[]> {
    this.record(`pixel ${String(x)} ${String(y)}`);
    return Promise.resolve(this.pixels[`${String(x)},${String(y)}`] ?? [0, 0, 0, 255]);
  }
  runtimeErrors(): Promise<string[]> {
    return Promise.resolve([...this.errors]);
  }
}

const at = (line: number) => ({ line });
const frames = (n: number, line = 1): PlanStep => ({ kind: "step", frames: n, dt: 1 / 60, ...at(line) });
const state = (name: string, expected: number, line = 1): PlanStep => ({
  kind: "expect_state",
  entries: [{ name, expected, tolerance: 1e-5 }],
  ...at(line),
});

describe("executeSteps", () => {
  it("runs the steps in order and passes when every expectation holds", async () => {
    const driver = new FakeDriver({ "64,64": [107, 92, 255, 255] });
    const outcome = await executeSteps(driver, [
      frames(60),
      { kind: "press", code: "Space", ...at(2) },
      frames(1, 3),
      { kind: "release", code: "Space", ...at(4) },
      state("speed", -0.7, 5),
      { kind: "expect_pixel", x: 64, y: 64, color: [107, 92, 255], tolerance: 2, ...at(6) },
      { kind: "expect_counter", entries: [{ name: "drawCalls", equals: 2, min: null, max: null }], ...at(7) },
      { kind: "set_input", name: "tint", value: "#ff8800", ...at(8) },
    ]);
    expect(outcome).toEqual({ status: "pass", stepsRun: 8, failure: null });
    expect(driver.log.slice(0, 4)).toEqual(["step 60 0.016666666666666666", "press Space", "step 1 0.016666666666666666", "release Space"]);
    expect(driver.log).toContain('set_input tint "#ff8800"');
  });

  it("stops at the first failed expectation and names step, line and what differs", async () => {
    const driver = new FakeDriver();
    const outcome = await executeSteps(driver, [frames(1), state("speed", -0.7, 12), frames(5, 13)]);
    expect(outcome.status).toBe("fail");
    expect(outcome.stepsRun).toBe(1);
    expect(outcome.failure).toMatchObject({ kind: "expect_state", step: 2, line: 12 });
    expect(outcome.failure?.message).toContain("expected -0.7");
    // The step after the failure did not run.
    expect(driver.log.filter((entry) => entry.startsWith("step"))).toHaveLength(1);
  });

  it("counts several failed entries of one step", async () => {
    const outcome = await executeSteps(new FakeDriver(), [
      {
        kind: "expect_counter",
        entries: [
          { name: "drawCalls", equals: 9, min: null, max: null },
          { name: "other", equals: 1, min: null, max: null },
        ],
        ...at(3),
      },
    ]);
    expect(outcome.failure?.message).toBe("2 of 2 expectations failed");
    expect(outcome.failure?.details).toHaveLength(2);
  });

  it("fails a pixel of the wrong colour", async () => {
    const outcome = await executeSteps(new FakeDriver({ "1,2": [0, 0, 0, 255] }), [
      { kind: "expect_pixel", x: 1, y: 2, color: [255, 0, 0], tolerance: 2, ...at(9) },
    ]);
    expect(outcome.failure).toMatchObject({ kind: "expect_pixel", step: 1, line: 9 });
    expect(outcome.failure?.message).toContain("pixel (1, 2) is #000000, expected #ff0000");
  });

  it("fails a rejected host input with its code", async () => {
    const driver = new FakeDriver();
    driver.inputResult = { ok: false, error: { code: "MTEK-E8040", message: "unknown input 'x'" } };
    const outcome = await executeSteps(driver, [{ kind: "set_input", name: "x", value: 1, ...at(4) }]);
    expect(outcome.failure).toMatchObject({ kind: "set_input", step: 1, line: 4 });
    expect(outcome.failure?.message).toContain("MTEK-E8040");
  });

  it("fails a step that throws, with the message of the error", async () => {
    const driver = new FakeDriver();
    driver.throwOn = "press";
    const outcome = await executeSteps(driver, [{ kind: "press", code: "Space", ...at(2) }]);
    expect(outcome.failure).toEqual({ kind: "step", step: 1, line: 2, message: "boom in press Space" });
  });

  it("fails a program that reports a runtime error even when every expectation holds", async () => {
    const driver = new FakeDriver();
    const original = driver.step.bind(driver);
    driver.step = async (n, dt) => {
      await original(n, dt);
      driver.errors.push("MTEK-E8050: shader validation failed");
    };
    const outcome = await executeSteps(driver, [frames(1), state("speed", 0.7)]);
    expect(outcome.status).toBe("fail");
    expect(outcome.stepsRun).toBe(0);
    expect(outcome.failure).toMatchObject({
      kind: "runtime-error",
      step: 1,
      details: ["MTEK-E8050: shader validation failed"],
    });
  });

  it("fails an error reported before the first step (at mount)", async () => {
    const driver = new FakeDriver();
    driver.errors = ["MTEK-E8063: out of memory"];
    const outcome = await executeSteps(driver, [frames(1)]);
    expect(outcome.failure).toMatchObject({ kind: "runtime-error", step: null, line: null });
    expect(driver.log).toEqual([]);
  });

  it("reports the runtime error before an expectation it explains", async () => {
    const driver = new FakeDriver();
    const original = driver.scene.bind(driver);
    driver.scene = async () => {
      driver.errors.push("MTEK-E8101: handler threw");
      return original();
    };
    const outcome = await executeSteps(driver, [frames(1), state("speed", 99, 8)]);
    expect(outcome.stepsRun).toBe(1);
    expect(outcome.failure).toMatchObject({ kind: "runtime-error", step: 2, line: 8 });
  });
});
