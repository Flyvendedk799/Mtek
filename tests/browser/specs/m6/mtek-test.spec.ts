/**
 * M6-09: `mtek test` (spec/tooling.md section 6, decision 0074) on the real CLI, the real runner and a real browser.
 *
 * - the declarative fixtures of the three examples (`examples/<name>/tests/*.test.toml`) pass on the hardware adapter;
 * - each of them is a test that would fail without the behaviour it checks: copies of the examples with one expectation made
 *   wrong fail, at the step and the line of that expectation, with the kind of failure the report documents;
 * - a machine without a GPU, without Playwright or without Node reports NOT-RUN with the reason, exits 1 and exits 0 only
 *   with `--allow-not-run`, which never turns a NOT-RUN into a pass in the report.
 *
 * Needs: the CLI built with the runtime embedded (global setup), and for the pass and mutation tests a hardware WebGPU adapter
 * (`gpu` fixture; NOT-RUN without one). The NOT-RUN tests need no GPU: they simulate its absence.
 *
 * Hardware evidence: `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m6/mtek-test.spec.ts`; the JSON report of each
 * run is written to the results directory (`mtek-test-<example>.json`).
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../support/environment.ts";
import { expect, test } from "../../support/fixtures.ts";
import { cliPath } from "../../support/m1-fixtures.ts";

const EXAMPLES = ["pulse-cube", "physics-playground", "material-configurator"] as const;
type Example = (typeof EXAMPLES)[number];

interface FixtureReport {
  file: string;
  name: string;
  status: "pass" | "fail" | "not-run";
  reason: string | null;
  failure: { kind: string; step: number | null; line: number | null; message: string; details?: string[] } | null;
  stepsRun: number;
  stepsTotal: number;
}

interface TestReport {
  status: "pass" | "fail" | "not-run";
  exitCode: number;
  allowNotRun: boolean;
  error: string | null;
  summary: { total: number; passed: number; failed: number; notRun: number };
  build: { ok: boolean } | null;
  environment: { gpu: { available: boolean; reason: string | null; adapter: { isFallbackAdapter: boolean; device: string } | null } } | null;
  fixtures: FixtureReport[];
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  report: TestReport;
}

/** `mtek test <args> --format json`; the report is the one document on stdout. */
function mtekTest(args: string[], env: Record<string, string | undefined> = {}): Run {
  const result = spawnSync(cliPath(), ["test", ...args, "--format", "json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 240_000,
    windowsHide: true,
  });
  if (result.status === null) throw new Error(`mtek test did not finish: ${String(result.error)}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, report: JSON.parse(result.stdout) as TestReport };
}

function record(name: string, run: Run): void {
  const dir = process.env["MTEK_RESULTS_DIR"];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), run.stdout);
}

/** A copy of `examples/<name>` in a scratch directory, without build output; `edit` may change its fixtures. */
function copyExample(name: Example, edit: (path: (relative: string) => string) => void): { dir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "mtek-test-spec-"));
  const dir = join(root, name);
  cpSync(join(REPO_ROOT, "examples", name), dir, { recursive: true, filter: (source) => !/[\\/](dist|node_modules)([\\/]|$)/.test(source) });
  edit((relative) => join(dir, relative));
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Replaces `from` by `to` in a file; fails when `from` is not there, so a stale mutation cannot pass silently. */
function replaceIn(path: string, from: string, to: string): number {
  const text = readFileSync(path, "utf8");
  const at = text.indexOf(from);
  expect(at, `'${from}' occurs in ${path}`).toBeGreaterThanOrEqual(0);
  writeFileSync(path, text.replace(from, to));
  return text.slice(0, at).split("\n").length;
}

test.describe("mtek test on the examples (hardware)", () => {
  test.beforeEach(({ gpu }, testInfo) => {
    void gpu;
    test.skip(testInfo.project.name !== "hardware", "the pass criteria of mtek test are hardware evidence: run with --project=hardware");
    test.setTimeout(240_000);
  });

  for (const example of EXAMPLES) {
    test(`every fixture of ${example} passes`, () => {
      const run = mtekTest([`examples/${example}`]);
      record(`mtek-test-${example}.json`, run);
      expect(run.stderr, "nothing on stderr in the JSON format").toBe("");
      expect(run.status, run.stdout).toBe(0);
      const { report } = run;
      expect(report.status).toBe("pass");
      expect(report.build?.ok).toBe(true);
      expect(report.error).toBeNull();
      expect(report.summary.failed + report.summary.notRun).toBe(0);
      expect(report.summary.total, "the example has fixtures").toBeGreaterThanOrEqual(2);
      for (const fixture of report.fixtures) {
        expect(fixture.status, `${fixture.file}: ${JSON.stringify(fixture.failure)}`).toBe("pass");
        expect(fixture.stepsRun, fixture.file).toBe(fixture.stepsTotal);
      }
      // Hardware evidence: the adapter is named and is not a software fallback.
      expect(report.environment?.gpu.available).toBe(true);
      expect(report.environment?.gpu.adapter?.isFallbackAdapter).toBe(false);
    });
  }

  // Each mutation makes one expectation wrong in a copy of an example. The fixture must fail at that very step.
  const mutations: Array<{
    label: string;
    example: Example;
    file: string;
    from: string;
    to: string;
    kind: string;
    mention: string;
  }> = [
    {
      label: "a pixel of the wrong colour",
      example: "pulse-cube",
      file: "tests/host-tint.test.toml",
      from: 'color = "#8c2a3f"',
      to: 'color = "#8c2a60"',
      kind: "expect_pixel",
      mention: "expected #8c2a60",
    },
    {
      label: "the wrong direction after Space",
      example: "pulse-cube",
      file: "tests/space-reverses.test.toml",
      from: "{ expect_state = { speed = -0.7,",
      to: "{ expect_state = { speed = 0.7,",
      kind: "expect_state",
      mention: "state 'speed' is -0.69999",
    },
    {
      label: "a rotation that is not the derived one",
      example: "pulse-cube",
      file: "tests/rotation-and-pulse.test.toml",
      from: "[0, 0.5224986, 0, 0.8526402]",
      to: "[0, 0.5324986, 0, 0.8526402]",
      kind: "expect_state",
      mention: "component y differs",
    },
    {
      label: "a host input that does not exist",
      example: "pulse-cube",
      file: "tests/host-tint.test.toml",
      from: '{ set_input = { tint = "#f04f72" } }',
      to: '{ set_input = { tin = "#f04f72" } }',
      kind: "set_input",
      mention: "MTEK-E8040",
    },
    {
      label: "a sensor that is expected to fire too early",
      example: "physics-playground",
      file: "tests/crates-and-sensor.test.toml",
      from: "{ expect_state = { entered = 0, inside = 0 } },",
      to: "{ expect_state = { entered = 1, inside = 0 } },",
      kind: "expect_state",
      mention: "state 'entered' is 0",
    },
    {
      label: "a lift that is too high",
      example: "physics-playground",
      file: "tests/space-lifts-first.test.toml",
      from: "[-4.5, 1.7634, 0]",
      to: "[-4.5, 1.9634, 0]",
      kind: "expect_state",
      mention: "'First.position'",
    },
    {
      label: "a wrong draw call count",
      example: "material-configurator",
      file: "tests/chair-defaults.test.toml",
      from: "drawCalls = 7",
      to: "drawCalls = 10",
      kind: "expect_counter",
      mention: "counter 'drawCalls' is 7, expected 10",
    },
    {
      label: "a seat that should not have changed colour",
      example: "material-configurator",
      file: "tests/host-inputs.test.toml",
      from: 'color = "#31782f"',
      to: 'color = "#c36256"',
      kind: "expect_pixel",
      mention: "expected #c36256",
    },
  ];

  for (const mutation of mutations) {
    test(`a fixture of ${mutation.example} fails on ${mutation.label}, at that step`, () => {
      let line = 0;
      const copy = copyExample(mutation.example, (path) => {
        line = replaceIn(path(mutation.file), mutation.from, mutation.to);
      });
      try {
        const run = mtekTest([copy.dir]);
        expect(run.status, run.stdout).toBe(1);
        expect(run.report.status).toBe("fail");
        const failed = run.report.fixtures.filter((fixture) => fixture.status === "fail");
        expect(failed.map((fixture) => fixture.file)).toEqual([mutation.file]);
        const failure = failed[0]?.failure;
        expect(failure?.kind).toBe(mutation.kind);
        expect(failure?.line, "the line of the step in the fixture file").toBe(line);
        expect(failure?.message).toContain(mutation.mention);
        // The fixtures that were not touched still pass: a failure is local to its fixture.
        expect(run.report.summary.failed).toBe(1);
        expect(run.report.summary.notRun).toBe(0);
      } finally {
        copy.cleanup();
      }
    });
  }

  test("a fixture file with problems fails as invalid without a browser run, naming each line", () => {
    const copy = copyExample("pulse-cube", (path) => {
      writeFileSync(path("tests/broken.test.toml"), 'name = "broken"\nsteps = [\n  { press = "Hyper" },\n  { step = 1 },\n]\n');
    });
    try {
      const run = mtekTest([copy.dir]);
      expect(run.status).toBe(1);
      const broken = run.report.fixtures.find((fixture) => fixture.file === "tests/broken.test.toml");
      expect(broken?.status).toBe("fail");
      expect(broken?.failure?.kind).toBe("invalid-fixture");
      expect(broken?.failure?.details?.[0]).toMatch(/^line 3:.*Hyper/);
      expect(broken?.failure?.details?.[1]).toMatch(/^line 4:.*'dt'/);
      expect(broken?.stepsRun).toBe(0);
      // The valid fixtures next to it ran and passed.
      expect(run.report.fixtures.filter((fixture) => fixture.status === "pass")).toHaveLength(3);
    } finally {
      copy.cleanup();
    }
  });
});

test.describe("mtek test reports NOT-RUN, never a pass, when it cannot run", () => {
  test.beforeEach(() => {
    test.setTimeout(240_000);
  });

  function expectAllNotRun(run: Run, reason: RegExp): void {
    expect(run.status, "NOT-RUN is a failure unless allowed").toBe(1);
    expect(run.report.status).toBe("not-run");
    expect(run.report.exitCode).toBe(1);
    expect(run.report.summary).toMatchObject({ passed: 0, failed: 0, notRun: run.report.summary.total });
    expect(run.report.summary.total).toBeGreaterThanOrEqual(2);
    for (const fixture of run.report.fixtures) {
      expect(fixture.status).toBe("not-run");
      expect(fixture.reason).toMatch(reason);
      expect(fixture.failure).toBeNull();
      expect(fixture.stepsRun).toBe(0);
    }
  }

  test("without a WebGPU adapter (Chromium with --disable-gpu)", () => {
    const env = { MTEK_BROWSER_ARGS: "--disable-gpu" };
    const run = mtekTest(["examples/pulse-cube"], env);
    record("mtek-test-not-run-no-gpu.json", run);
    // Whether `--disable-gpu` leaves Chromium without a WebGPU adapter depends on the platform: on Windows it does, on the
    // Linux runners of CI Chromium keeps a software (SwiftShader) adapter and `mtek test` then really runs the fixtures.
    // The spec can only show the no-adapter path where the browser has none, so it says so instead of failing; the path
    // itself is also covered without a browser (`run.test.ts`, and the Rust tests with a stand-in runner).
    test.skip(
      run.report.environment?.gpu.available === true,
      "this Chromium keeps a software WebGPU adapter under --disable-gpu, so there is no no-adapter run to observe here",
    );
    expectAllNotRun(run, /^no WebGPU adapter: /);
    expect(run.report.environment?.gpu.available).toBe(false);
    expect(run.report.environment?.gpu.adapter).toBeNull();

    // `--allow-not-run` exits 0, and the report still says not-run for the run and for every fixture.
    const allowed = mtekTest(["examples/pulse-cube", "--allow-not-run"], env);
    expect(allowed.status).toBe(0);
    expect(allowed.report.status).toBe("not-run");
    expect(allowed.report.allowNotRun).toBe(true);
    expect(allowed.report.exitCode).toBe(0);
    expect(allowed.report.fixtures.every((fixture) => fixture.status === "not-run")).toBe(true);
  });

  test("without Playwright (the runner copied where no node_modules is above it)", () => {
    const root = mkdtempSync(join(tmpdir(), "mtek-no-playwright-"));
    try {
      mkdirSync(join(root, "support"), { recursive: true });
      for (const file of ["serve.ts", "launch-args.ts"]) cpSync(join(REPO_ROOT, "tests", "browser", "support", file), join(root, "support", file));
      cpSync(join(REPO_ROOT, "tests", "browser", "support", "mtek-test"), join(root, "support", "mtek-test"), {
        recursive: true,
        filter: (source) => !source.endsWith(".test.ts"),
      });
      const run = mtekTest(["examples/pulse-cube"], { MTEK_TEST_RUNNER: join(root, "support", "mtek-test", "main.ts") });
      record("mtek-test-not-run-no-playwright.json", run);
      expectAllNotRun(run, /^Playwright is not installed/);
      expect(run.report.environment).toBeNull();
      expect(run.stdout, "no path of the machine in a result").not.toContain(root);
      expect(run.stdout).not.toContain(root.replace(/\\/g, "/"));
      expect(mtekTest(["examples/pulse-cube", "--allow-not-run"], { MTEK_TEST_RUNNER: join(root, "support", "mtek-test", "main.ts") }).status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("without Node.js", () => {
    const run = mtekTest(["examples/pulse-cube"], { MTEK_NODE: "mtek-no-such-node-binary" });
    expectAllNotRun(run, /^Node\.js was not found/);
  });
});
