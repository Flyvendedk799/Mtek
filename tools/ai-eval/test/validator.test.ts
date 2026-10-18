import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner, CommandSpec } from "../src/commands.ts";
import { classifyTestReport, parseTestReport, Validator, verdictOf, type SymbolCheck, type TestFixtureResult, type TestReportSummary } from "../src/validator.ts";
import { Workspace } from "../src/workspace.ts";
import { editTask, fakeMtek, tempDir, validateDiagnosticReport, validateTestReport } from "./helpers.ts";

function fixture(overrides: Partial<TestFixtureResult>): TestFixtureResult {
  return { file: "tests/a.test.toml", name: "a", status: "pass", reason: null, failure: null, stepsRun: 1, stepsTotal: 1, ...overrides };
}

function report(fixtures: TestFixtureResult[], status: TestReportSummary["status"]): TestReportSummary {
  const count = (s: string): number => fixtures.filter((f) => f.status === s).length;
  return {
    status,
    exitCode: status === "fail" ? 1 : 0,
    summary: { total: fixtures.length, passed: count("pass"), failed: count("fail"), notRun: count("not-run") },
    fixtures,
    environment: null,
    fallbackAdapter: null,
  };
}

const failure = (kind: string, step: number | null = 2) => ({ kind, step, line: 3, message: `${kind} happened`, details: [] });

describe("classifyTestReport: start and tests from one mtek test report", () => {
  it("pass: every fixture passed", () => {
    const { start, tests } = classifyTestReport(report([fixture({})], "pass"));
    expect([start.outcome, tests.outcome]).toEqual(["pass", "pass"]);
  });

  it("a pass without fixtures, or without every fixture passing, is not believed", () => {
    expect(() => classifyTestReport(report([], "pass"))).toThrow(/without every fixture passing/);
    expect(() => classifyTestReport(report([fixture({}), fixture({ status: "fail", failure: failure("expect_state") })], "pass"))).toThrow();
  });

  it("an expectation that failed means the program started and the tests failed", () => {
    const { start, tests } = classifyTestReport(report([fixture({ status: "fail", failure: failure("expect_pixel") })], "fail"));
    expect(start.outcome).toBe("pass");
    expect(tests).toMatchObject({ outcome: "fail", notRun: null });
    expect(tests.reason).toContain("expect_pixel: expect_pixel happened");
  });

  it("runtime errors after the first step, step failures and timeouts mean it started", () => {
    for (const kind of ["runtime-error", "step", "set_input", "expect_counter", "timeout"]) {
      const { start } = classifyTestReport(report([fixture({ status: "fail", failure: failure(kind, 3) })], "fail"));
      expect(start.outcome, kind).toBe("pass");
    }
  });

  it("a mount failure, or an error reported before the first step, is a failure to start and the tests are skipped", () => {
    for (const f of [failure("mount", null), failure("runtime-error", null)]) {
      const { start, tests } = classifyTestReport(report([fixture({ status: "fail", failure: f })], "fail"));
      expect(start.outcome).toBe("fail");
      expect(tests).toMatchObject({ outcome: "not-run", notRun: "skipped" });
    }
  });

  it("no fixture ran (no GPU, no browser, no Node): both layers are not-run for the environment, with the reason", () => {
    const reason = "no WebGPU adapter: navigator.gpu.requestAdapter() resolved to null";
    const { start, tests } = classifyTestReport(report([fixture({ status: "not-run", reason })], "not-run"));
    expect(start).toMatchObject({ outcome: "not-run", notRun: "environment", reason });
    expect(tests).toMatchObject({ outcome: "not-run", notRun: "environment", reason });
  });

  it("some fixtures ran and passed while another could not run: tests are not-run, never pass", () => {
    const { start, tests } = classifyTestReport(report([fixture({}), fixture({ name: "b", status: "not-run", reason: "no GPU" })], "not-run"));
    expect(start.outcome).toBe("pass");
    expect(tests).toMatchObject({ outcome: "not-run", notRun: "environment" });
  });

  it("a failure outranks a fixture that could not run", () => {
    const { tests } = classifyTestReport(
      report([fixture({ status: "fail", failure: failure("expect_state") }), fixture({ name: "b", status: "not-run", reason: "x" })], "fail"),
    );
    expect(tests.outcome).toBe("fail");
  });
});

describe("parseTestReport", () => {
  it("reads the report of the fake, which validates against spec/test-report.schema.json", async () => {
    const dir = tempDir();
    const task = editTask();
    const workspace = Workspace.create(task, dir, "w");
    for (const gpu of [true, false]) {
      const result = await fakeMtek({ gpu, behaviour: () => "pass" }).run({ args: ["test", "--format", "json"], cwd: workspace.projectDir, timeoutMs: 1000 });
      expect(validateTestReport(JSON.parse(result.stdout))).toEqual([]);
      const parsed = parseTestReport(result.stdout);
      expect(parsed.status).toBe(gpu ? "pass" : "not-run");
    }
  });

  it("refuses anything that is not a version 1 report", () => {
    expect(() => parseTestReport("not json")).toThrow(/did not print a JSON report/);
    expect(() => parseTestReport("{}")).toThrow(/schema version 1/);
    expect(() => parseTestReport(JSON.stringify({ schemaVersion: 1, command: "mtek test", status: "great" }))).toThrow(/status/);
  });

  it("reads whether the adapter was a software fallback", () => {
    const doc = {
      schemaVersion: 1,
      command: "mtek test",
      status: "pass",
      exitCode: 0,
      summary: { total: 1, passed: 1, failed: 0, notRun: 0 },
      fixtures: [{ file: "tests/a.test.toml", name: "a", status: "pass", reason: null, failure: null, stepsRun: 1, stepsTotal: 1 }],
      environment: { gpu: { adapter: { isFallbackAdapter: true } } },
      error: null,
    };
    expect(parseTestReport(JSON.stringify(doc)).fallbackAdapter).toBe(true);
  });
});

describe("verdictOf", () => {
  const ok = { outcome: "pass", reason: null, notRun: null } as const;
  const layers = { parse: ok, check: ok, build: ok, start: ok, tests: ok };
  const symbols: SymbolCheck = { outcome: "pass", checked: [], missing: [], reason: null };

  it("passes only when every layer and the required symbols pass", () => {
    expect(verdictOf(layers, symbols)).toBe("pass");
    expect(verdictOf({ ...layers, tests: { outcome: "fail", reason: "x", notRun: null } }, symbols)).toBe("fail");
    expect(verdictOf(layers, { ...symbols, outcome: "fail" })).toBe("fail");
    expect(verdictOf({ ...layers, start: { outcome: "not-run", reason: "no gpu", notRun: "environment" } }, symbols)).toBe("not-run");
    expect(verdictOf(layers, { ...symbols, outcome: "not-run" })).toBe("not-run");
  });

  it("a failure outranks a layer that did not run", () => {
    const notRun = { outcome: "not-run", reason: "skipped", notRun: "skipped" } as const;
    expect(verdictOf({ ...layers, check: { outcome: "fail", reason: "x", notRun: null }, build: notRun }, symbols)).toBe("fail");
  });
});

describe("Validator against the scripted compiler", () => {
  async function validate(
    runner: CommandRunner,
    edit?: (workspace: Workspace) => void,
    symbols: readonly string[] = ["Demo.Cube", "Demo.Marker"],
  ) {
    const dir = tempDir();
    const workspace = Workspace.create(editTask(), dir, "w");
    edit?.(workspace);
    const validator = new Validator(runner);
    return validator.validate({ projectDir: workspace.projectDir, outDir: `${workspace.root}/out`, requiredSymbols: symbols });
  }

  it("the diagnostics the fake prints validate against spec/diagnostic.schema.json", async () => {
    const dir = tempDir();
    const workspace = Workspace.create(editTask(), dir, "w");
    workspace.write("src/main.mtek", "scene Demo {\n    entity Cube {\n        speed = TYPE_ERROR;\n        SYNTAX_ERROR\n    }\n}\n");
    for (const command of ["check", "build"]) {
      const result = await fakeMtek().run({ args: [command], cwd: workspace.projectDir, timeoutMs: 1000 });
      expect(validateDiagnosticReport(JSON.parse(result.stdout))).toEqual([]);
    }
  });

  it("an unchanged starter fails the tests layer but passes parse, check, build and start", async () => {
    const result = await validate(fakeMtek());
    expect(result.verdict).toBe("fail");
    expect(Object.entries(result.layers).map(([k, v]) => `${k}:${v.outcome}`)).toEqual(["parse:pass", "check:pass", "build:pass", "start:pass", "tests:fail"]);
    expect(result.requiredSymbols.outcome).toBe("pass");
    expect(result.testReport?.status).toBe("fail");
    expect(result.compilerVersion).toBe("0.1.0-fake");
    expect(result.commands.map((c) => c.command)).toEqual(["check", "context Demo.Cube", "context Demo.Marker", "build", "test"]);
  });

  it("calls mtek test with --allow-not-run so that its exit code never hides NOT-RUN, and reads the JSON", async () => {
    const runner = fakeMtek({ gpu: false });
    const result = await validate(runner);
    expect(result.verdict).toBe("not-run");
    const call = runner.calls.find((c) => c.command === "test");
    expect(call?.args).toEqual(["test", "--allow-not-run", "--format", "json", expect.any(String)]);
    expect(result.testReport?.status).toBe("not-run");
  });

  it("builds in test mode into a directory outside the project", async () => {
    const runner = fakeMtek();
    await validate(runner);
    const build = runner.calls.find((c) => c.command === "build");
    expect(build?.args.slice(0, 4)).toEqual(["build", "--mode", "test", "--format"]);
    expect(build?.args).toContain("--out");
  });

  it("lists every missing required symbol", async () => {
    const result = await validate(fakeMtek({ behaviour: () => "pass" }), (w) => w.write("src/main.mtek", "scene Demo {\n}\n"));
    expect(result.requiredSymbols).toMatchObject({ outcome: "fail", missing: ["Demo.Cube", "Demo.Marker"] });
    expect(result.verdict).toBe("fail");
    expect(result.layers.tests.outcome).toBe("pass"); // the tests are vacuous; the symbols are what fails
  });

  it("without required symbols the check passes trivially and runs no command", async () => {
    const runner = fakeMtek();
    const result = await validate(runner, undefined, []);
    expect(result.requiredSymbols).toMatchObject({ outcome: "pass", checked: [] });
    expect(runner.commandsRun().filter((c) => c === "context")).toEqual([]);
  });

  it("a project that does not load leaves the required symbols not-run, never pass", async () => {
    const unloadable: CommandRunner = {
      run: (): Promise<CommandResult> => {
        const result = (exitCode: number, stdout: string, stderr = ""): Promise<CommandResult> => Promise.resolve({ exitCode, stdout, stderr, timedOut: false, spawnError: null });
        const diag = {
          schemaVersion: 1, code: "MTEK-E9001", severity: "error", title: "t", message: "mtek.toml is invalid", source: null, related: [], notes: [], suggestedEdits: [], phase: "check", docs: "spec/diagnostics.md#mtek-e9001",
        };
        const doc = JSON.stringify({ schemaVersion: 1, tool: "mtek", compilerVersion: "x", languageVersion: "0.1", project: null, diagnostics: [diag], summary: { errors: 1, warnings: 0, notes: 0, suppressed: 0 } });
        return result(1, doc);
      },
    };
    const result = await validate(unloadable);
    expect(result.requiredSymbols).toMatchObject({ outcome: "not-run" });
    expect(result.layers.check.outcome).toBe("fail");
    expect(result.verdict).toBe("fail");
  });

  describe("failures of the tool chain are verdict error, with the reason", () => {
    const scripted = (handler: (spec: CommandSpec) => Partial<CommandResult>, base = fakeMtek()): CommandRunner => ({
      run: async (spec) => {
        const override = handler(spec);
        if (Object.keys(override).length > 0) return { exitCode: 0, stdout: "", stderr: "", timedOut: false, spawnError: null, ...override };
        return base.run(spec);
      },
    });

    it("a binary that cannot be started", async () => {
      const result = await validate(scripted(() => ({ exitCode: null, spawnError: "ENOENT" })));
      expect(result).toMatchObject({ verdict: "error" });
      expect(result.toolError).toContain("could not be started: ENOENT");
    });

    it("a timeout", async () => {
      const result = await validate(scripted((s) => (s.args[0] === "build" ? { exitCode: null, timedOut: true } : {})));
      expect(result.verdict).toBe("error");
      expect(result.toolError).toContain("did not finish");
    });

    it("output that is not a report, and a report that contradicts its exit code", async () => {
      expect((await validate(scripted((s) => (s.args[0] === "check" ? { stdout: "hello" } : {})))).toolError).toContain("did not print a diagnostics report");
      const lying = scripted((s) => (s.args[0] === "check" ? { exitCode: 1, stdout: JSON.stringify({ schemaVersion: 1, diagnostics: [], summary: { errors: 0, warnings: 0, notes: 0 } }) } : {}));
      expect((await validate(lying)).toolError).toContain("but its report has 0 errors");
    });

    it("a test report that contradicts its exit code", async () => {
      // The starter fails its tests (exit 1, status fail); a process that claims exit 0 for that report is lying.
      const result = await validate({
        run: async (spec) => {
          const real = await fakeMtek().run(spec);
          return spec.args[0] === "test" ? { ...real, exitCode: 0 } : real;
        },
      });
      expect(result.verdict).toBe("error");
      expect(result.toolError).toContain("but its report says status fail");
    });

    it("never puts a machine path into the recorded reason", async () => {
      let cwd = "";
      const result = await validate(
        scripted((s) => {
          cwd = s.cwd;
          return s.args[0] === "check" ? { exitCode: 3, stderr: `error: cannot read ${s.cwd}/src/main.mtek` } : {};
        }),
      );
      expect(cwd).not.toBe("");
      expect(result.toolError).toContain("<project>/src/main.mtek");
      expect(result.toolError).not.toContain(cwd);
    });

    it("mtek test exiting 3 (its own failure)", async () => {
      const result = await validate(fakeMtek({ crash: "test" }));
      expect(result.verdict).toBe("error");
      expect(result.toolError).toContain("mtek test exited with 3");
    });

    it("a layer outcome is never taken from a failed tool: an error verdict has no pass in it", async () => {
      const result = await validate(fakeMtek({ crash: "build" }));
      expect(result.verdict).toBe("error");
      expect(result.layers.build.outcome).toBe("not-run");
      expect(result.layers.tests.outcome).toBe("not-run");
    });
  });
});
