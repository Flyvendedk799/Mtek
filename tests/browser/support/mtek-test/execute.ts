// Runs the steps of one fixture against an application (decision 0074). The application is behind
// `AppDriver` so that the semantics of every step are tested without a browser (`execute.test.ts`);
// `browser.ts` provides the driver that talks to the real runtime through Playwright.
import { compareCounters, comparePixel, compareState, type SceneView } from "./compare.ts";
import type { Failure, PlanStep } from "./plan.ts";

export type InputResult = { ok: true } | { ok: false; error: { code: string; message: string } };

/** The test hooks of a mounted application (`MtekApp` and `app.debug`, `spec/runtime-abi.md` section 10.2). */
export interface AppDriver {
  /** `app.debug.step(frames, dt)`: frames on the manual clock, rendering included. */
  step(frames: number, dt: number): Promise<void>;
  /** `app.debug.pressKey(code)`: queued, applied at the start of the next frame. */
  press(code: string): Promise<void>;
  release(code: string): Promise<void>;
  /** `app.setInput(name, value)`: validated now, applied at the start of the next frame. */
  setInput(name: string, value: unknown): Promise<InputResult>;
  /** `app.debug.scene()`: the scene state and the named entities. */
  scene(): Promise<SceneView>;
  /** `app.debug.counters()`. */
  counters(): Promise<Record<string, number>>;
  /** The red, green, blue and alpha bytes of the render target at (x, y); (0, 0) is the top left. */
  pixel(x: number, y: number): Promise<readonly number[]>;
  /** The error diagnostics the program has reported so far (`code: message`), oldest first. */
  runtimeErrors(): Promise<string[]>;
}

export interface Outcome {
  status: "pass" | "fail";
  /** The number of steps that completed without failing. */
  stepsRun: number;
  failure: Failure | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The failure of an expectation: one line, or a count and the lines. */
function expectationFailure(step: PlanStep, index: number, lines: string[], total: number): Failure {
  const [first] = lines;
  const single = lines.length === 1 && first !== undefined;
  return {
    kind: step.kind,
    step: index,
    line: step.line,
    message: single ? first : `${String(lines.length)} of ${String(total)} expectations failed`,
    ...(single ? {} : { details: lines }),
  };
}

/** Executes one step; the failure it causes, or null. Throws when the application does. */
async function executeStep(driver: AppDriver, step: PlanStep, index: number): Promise<Failure | null> {
  switch (step.kind) {
    case "step":
      await driver.step(step.frames, step.dt);
      return null;
    case "press":
      await driver.press(step.code);
      return null;
    case "release":
      await driver.release(step.code);
      return null;
    case "set_input": {
      const result = await driver.setInput(step.name, step.value);
      if (result.ok) return null;
      return {
        kind: "set_input",
        step: index,
        line: step.line,
        message: `the host input '${step.name}' was rejected: ${result.error.code}: ${result.error.message}`,
      };
    }
    case "expect_state": {
      const lines = compareState(await driver.scene(), step.entries);
      return lines.length === 0 ? null : expectationFailure(step, index, lines, step.entries.length);
    }
    case "expect_counter": {
      const lines = compareCounters(await driver.counters(), step.entries);
      return lines.length === 0 ? null : expectationFailure(step, index, lines, step.entries.length);
    }
    case "expect_pixel": {
      const actual = await driver.pixel(step.x, step.y);
      const line = comparePixel(step.x, step.y, actual, step.color, step.tolerance);
      return line === null ? null : expectationFailure(step, index, [line], 1);
    }
  }
}

/** A runtime error is a failure even when every expectation holds: a program that reports errors is not right. */
async function runtimeFailure(
  driver: AppDriver,
  step: PlanStep | null,
  index: number | null,
): Promise<Failure | null> {
  const errors = await driver.runtimeErrors();
  if (errors.length === 0) return null;
  return {
    kind: "runtime-error",
    step: index,
    line: step?.line ?? null,
    message: `the program reported ${String(errors.length)} runtime error${errors.length === 1 ? "" : "s"}`,
    details: errors,
  };
}

/** Executes `steps` in order and stops at the first failure. */
export async function executeSteps(driver: AppDriver, steps: readonly PlanStep[]): Promise<Outcome> {
  let stepsRun = 0;
  try {
    const atMount = await runtimeFailure(driver, null, null);
    if (atMount !== null) return { status: "fail", stepsRun, failure: atMount };
    for (const [position, step] of steps.entries()) {
      const index = position + 1;
      let failure: Failure | null;
      try {
        failure = await executeStep(driver, step, index);
      } catch (error) {
        failure = { kind: "step", step: index, line: step.line, message: errorMessage(error) };
      }
      // An error the program reported while the step ran explains an expectation that then fails
      // (and is a failure on its own), so it comes first.
      failure = (await runtimeFailure(driver, step, index)) ?? failure;
      if (failure !== null) return { status: "fail", stepsRun, failure };
      stepsRun += 1;
    }
  } catch (error) {
    return {
      status: "fail",
      stepsRun,
      failure: { kind: "step", step: null, line: null, message: errorMessage(error) },
    };
  }
  return { status: "pass", stepsRun, failure: null };
}
