// The contract between `mtek test` (crates/mtek-cli/src/test_cmd) and this runner: the plan the CLI
// writes and the report the runner writes back (decision 0074). The CLI has already parsed and
// validated the fixtures (`fixture.rs`); the runner trusts the shape of the plan but not the
// behaviour of the page.

export const SCHEMA_VERSION = 1;

/** One entry of `expect_state`: tolerance is null for booleans and strings. */
export interface StateEntry {
  name: string;
  expected: number | boolean | string | number[];
  tolerance: number | null;
}

/** One entry of `expect_counter`: exactly one of `equals` or a `min`/`max` pair is set. */
export interface CounterEntry {
  name: string;
  equals: number | null;
  min: number | null;
  max: number | null;
}

interface StepBase {
  /** The 1-based line of the step in the fixture file. */
  line: number;
}

export type PlanStep = StepBase &
  (
    | { kind: "step"; frames: number; dt: number }
    | { kind: "press"; code: string }
    | { kind: "release"; code: string }
    | { kind: "set_input"; name: string; value: number | boolean | string | number[] }
    | { kind: "expect_state"; entries: StateEntry[] }
    | { kind: "expect_pixel"; x: number; y: number; color: [number, number, number]; tolerance: number }
    | { kind: "expect_counter"; entries: CounterEntry[] }
  );

export interface PlanFixture {
  /** The path relative to the project, for example `tests/space.test.toml`. */
  file: string;
  name: string;
  /** The `random()` seed of the run. */
  seed: number;
  steps: PlanStep[];
}

export interface Plan {
  schemaVersion: typeof SCHEMA_VERSION;
  /** The test build (`index.html`, `app.js`, ...): the directory to serve. */
  root: string;
  renderTarget: { width: number; height: number };
  fixtures: PlanFixture[];
}

export type FixtureStatus = "pass" | "fail" | "not-run";

/**
 * What went wrong. `kind` is `mount`, `step` (a step threw or an input was rejected), `runtime-error`
 * (the program reported an error diagnostic), `page-error`, `timeout`, or the kind of the expectation
 * (`expect_state`, `expect_pixel`, `expect_counter`).
 */
export interface Failure {
  kind: string;
  /** The 1-based index of the step, when a step is to blame. */
  step: number | null;
  line: number | null;
  message: string;
  details?: string[];
  expected?: unknown;
  actual?: unknown;
}

export interface FixtureResult {
  file: string;
  status: FixtureStatus;
  /** Why it is NOT-RUN. */
  reason: string | null;
  failure: Failure | null;
  /** The number of steps that completed. */
  stepsRun: number;
  durationMs: number;
}

export interface AdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallbackAdapter: boolean;
}

export interface Environment {
  browser: { name: string; channel: string; version: string; headless: boolean; launchArgs: string[] };
  gpu: { available: boolean; reason: string | null; adapter: AdapterInfo | null };
}

export interface RunnerReport {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Null when the browser did not start. */
  environment: Environment | null;
  /** One result per fixture of the plan, in plan order. */
  fixtures: FixtureResult[];
}
