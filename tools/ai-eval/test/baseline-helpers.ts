// A scripted stand-in for the baseline's candidate runner (`benchmarks/baselines/support/test/run-candidate.ts`): it reads the
// candidate's `src/main.ts` and prints the JSON report the real runner would, so the tests of the baseline side need no
// TypeScript compiler run, no bundler, no browser and no GPU. The real runner is exercised by `baseline-integration.test.ts`.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CommandResult, CommandRunner, CommandSpec } from "../src/commands.ts";

export interface FakeBaselineOptions {
  /** False simulates a machine without a WebGPU adapter. */
  gpu?: boolean;
  /** Makes the runner exit with 3. */
  crash?: boolean;
}

/** Markers in the candidate's source decide the outcome, like the markers of the fake `mtek`. */
export class FakeBaseline implements CommandRunner {
  readonly calls: CommandSpec[] = [];
  private readonly options: FakeBaselineOptions;

  constructor(options: FakeBaselineOptions = {}) {
    this.options = options;
  }

  run(spec: CommandSpec): Promise<CommandResult> {
    this.calls.push(spec);
    const done = (exitCode: number, stdout: string, stderr = ""): Promise<CommandResult> => Promise.resolve({ exitCode, stdout, stderr, timedOut: false, spawnError: null });
    if (this.options.crash === true) return done(3, "", "error: the runner crashed");
    const project = spec.args[spec.args.indexOf("--project") + 1] ?? "";
    const fixtures = spec.args[spec.args.indexOf("--fixtures") + 1] ?? "";
    const text = readFileSync(join(project, "src", "main.ts"), "utf8");
    const diagnostics: Record<string, unknown>[] = [];
    const add = (code: string, phase: string, message: string, marker: string): void => {
      const line = text.split("\n").findIndex((l) => l.includes(marker)) + 1;
      diagnostics.push({
        code,
        severity: "error",
        message,
        phase,
        source: { file: "src/main.ts", startByte: 0, endByte: 1, startLine: line, startColumn: 5, endLine: line, endColumn: 9 },
        rendered: `src/main.ts(${String(line)},5): error ${code}: ${message}`,
      });
    };
    if (text.includes("SYNTAX_ERROR")) add("TS1005", "parse", "';' expected.", "SYNTAX_ERROR");
    if (text.includes("TYPE_ERROR")) add("TS2322", "check", "Type 'string' is not assignable to type 'number'.", "TYPE_ERROR");
    const report: Record<string, unknown> = { schemaVersion: 1, command: "baseline-candidate", typescriptVersion: "6.0.3", check: { diagnostics }, build: null, tests: null };
    if (diagnostics.length === 0) {
      report["build"] = text.includes("BUILD_ERROR") ? { ok: false, errors: ["src/main.ts:3:1: Could not resolve \"nowhere\""] } : { ok: true, errors: [] };
      if ((report["build"] as { ok: boolean }).ok) {
        const names = readdirSync(fixtures).filter((n) => n.endsWith(".test.toml"));
        const gpu = this.options.gpu !== false;
        const passes = text.includes("speed = -1");
        const mounts = !text.includes("MOUNT_ERROR");
        const fixtureResults = names.map((name) => {
          const base = { file: `mtek-tests/${name}`, name: name.replace(/\.test\.toml$/, ""), stepsTotal: 2, durationMs: 5 };
          if (!gpu) return { ...base, status: "not-run", reason: "no WebGPU adapter: navigator.gpu.requestAdapter() resolved to null", failure: null, stepsRun: 0 };
          if (!mounts) return { ...base, status: "fail", reason: null, failure: { kind: "mount", step: null, line: null, message: "the application failed to start: ReferenceError", details: [] }, stepsRun: 0 };
          if (passes) return { ...base, status: "pass", reason: null, failure: null, stepsRun: 2 };
          return { ...base, status: "fail", reason: null, failure: { kind: "expectation", step: 2, line: null, message: "step 2 (expect_pixel): pixel (64, 64) is rgb(1, 2, 3), expected #ef4444 within 2", details: [] }, stepsRun: 1 };
        });
        const failed = fixtureResults.filter((f) => f.status === "fail").length;
        const passed = fixtureResults.filter((f) => f.status === "pass").length;
        report["tests"] = {
          status: failed > 0 ? "fail" : passed === fixtureResults.length ? "pass" : "not-run",
          summary: { total: fixtureResults.length, passed, failed, notRun: fixtureResults.length - passed - failed },
          fixtures: fixtureResults,
          environment: gpu ? { browser: { name: "chromium" }, gpu: { adapter: { isFallbackAdapter: false } } } : { browser: { name: "chromium" }, gpu: { adapter: null } },
          fallbackAdapter: gpu ? false : null,
        };
      }
    }
    return done(0, JSON.stringify(report));
  }
}
