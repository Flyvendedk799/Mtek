// The baseline side of the benchmark (decision 0108): the same task as a TypeScript + three.js r186 project,
// validated layer by layer like a Mtek candidate.
//
//   parse   the TypeScript compiler reports no syntax error                    (Mtek: no `parse` diagnostic)
//   check   the TypeScript compiler reports no error at all (`tsc --noEmit`)   (Mtek: `mtek check`)
//   build   the bundle of the task tests builds                               (Mtek: `mtek build`)
//   start   the page started: `startTask` set `window.mtekTask`                (Mtek: the program mounted)
//   tests   every fixture of the task passed in a fresh browser context        (Mtek: `mtek test`)
//   required names   the objects the task names are still declared            (Mtek: `mtek context --symbol`)
//
// The fixtures are the task's own `mtek-tests/*.test.toml`: one definition of success for both sides
// (decision 0021 section 8). All layers but the required names run in ONE fresh process,
// `benchmarks/baselines/support/test/run-candidate.ts`, which prints a JSON report; this module only reads it.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "./canonical.ts";
import { systemClock, type Clock } from "./clock.ts";
import { createProgramRunner, repoRoot, type CommandRunner } from "./commands.ts";
import type { BuiltContext } from "./context-builder.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { ToolError } from "./errors.ts";
import { fail, notRun, pass, type Layers, type LayerResult } from "./outcomes.ts";
import type { TaskSpec } from "./task.ts";
import {
  classifyTestReport,
  scrubMachinePaths,
  scrubPaths,
  verdictOf,
  type CommandLog,
  type SymbolCheck,
  type TestReportSummary,
  type ValidateInput,
  type ValidationResult,
} from "./validator.ts";
import { listFiles } from "./workspace.ts";
import type { CandidateValidator } from "./side.ts";

/** Where baseline candidates are made: inside the repository's `node_modules/.cache`, so that `three` and the support module resolve like in the task directories. */
export function baselineScratchRoot(): string {
  const root = join(repoRoot(), "node_modules", ".cache", "mtek-ai-eval");
  mkdirSync(root, { recursive: true });
  return root;
}

function sourcesOf(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return listFiles(directory)
    .filter((path) => path.endsWith(".ts"))
    .map((path) => readFileSync(join(directory, ...path.split("/")), "utf8"));
}

function quoted(source: string, name: string): boolean {
  return [`"${name}"`, `'${name}'`, `\`${name}\``].some((literal) => source.includes(literal));
}

/**
 * The names a baseline candidate must still declare: the last segment of each required symbol of the task that the task's
 * REFERENCE baseline declares as a string (a three.js `name`), so a name that exists only in Mtek (a scene state such as
 * `Demo.count`) is not demanded of the baseline. The model is told the names; the check is a literal search of the sources.
 */
export function baselineRequiredNames(task: TaskSpec): string[] {
  const reference = sourcesOf(join(task.dir, "reference", "baseline", "src")).join("\n");
  const names: string[] = [];
  for (const symbol of task.requiredSymbols) {
    const leaf = symbol.split(".").pop() as string;
    if (quoted(reference, leaf) && !names.includes(leaf)) names.push(leaf);
  }
  return names;
}

/** The documentation the baseline's model is given: one checked-in reference (three.js r186, TSL and the support module), the counterpart of `mtek context`. */
export function baselineDocs(maxBytes: number): BuiltContext {
  const root = repoRoot();
  const file = join(root, "benchmarks", "baselines", "docs", "reference.md");
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n"); // a checkout is LF (.gitattributes); the document and its hash must not depend on the platform
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) throw new ToolError(`the baseline documentation is ${String(bytes)} bytes, over the budget of ${String(maxBytes)}: it is never truncated silently`);
  let three = "unknown";
  try {
    three = (JSON.parse(readFileSync(join(root, "node_modules", "three", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    // the version is informational
  }
  return { text, sha256: sha256Hex(text), bytes, compilerVersion: `three@${three}`, contextFormat: 1, truncated: null };
}

interface RunnerReport {
  schemaVersion: number;
  command: string;
  typescriptVersion?: string;
  check: { diagnostics: Diagnostic[] };
  build: { ok: boolean; errors: string[] } | null;
  tests: {
    status: "pass" | "fail" | "not-run";
    summary: { total: number; passed: number; failed: number; notRun: number };
    fixtures: TestReportSummary["fixtures"];
    environment: Record<string, unknown> | null;
    fallbackAdapter: boolean | null;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRunnerReport(stdout: string): RunnerReport {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new ToolError("the baseline candidate runner did not print JSON");
  }
  if (!isRecord(value) || value["schemaVersion"] !== 1 || value["command"] !== "baseline-candidate") {
    throw new ToolError("the baseline candidate runner printed a report that is not schema version 1");
  }
  const check = value["check"];
  if (!isRecord(check) || !Array.isArray(check["diagnostics"])) throw new ToolError("the baseline candidate runner printed a report without check.diagnostics");
  return value as unknown as RunnerReport;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

function describe(d: Diagnostic): string {
  const where = d.source === null ? "" : ` (${d.source.file}:${String(d.source.startLine)})`;
  return `${d.code}: ${firstLine(d.message)}${where}`;
}

export interface BaselineValidatorOptions {
  clock?: Clock;
  runner?: CommandRunner;
  /** The runner script; default the one of this repository. */
  script?: string;
  timeoutMs?: number;
  /** Pass `--skip-browser` (checks and build only; start and tests are then `not-run`). */
  skipBrowser?: boolean;
}

export const BASELINE_RUNNER_SCRIPT = join("benchmarks", "baselines", "support", "test", "run-candidate.ts");

export class BaselineValidator implements CandidateValidator {
  private readonly task: TaskSpec;
  private readonly clock: Clock;
  private readonly runner: CommandRunner;
  private readonly script: string;
  private readonly timeoutMs: number;
  private readonly skipBrowser: boolean;

  constructor(task: TaskSpec, options: BaselineValidatorOptions = {}) {
    this.task = task;
    this.clock = options.clock ?? systemClock;
    this.runner = options.runner ?? createProgramRunner(process.execPath);
    this.script = options.script ?? join(repoRoot(), BASELINE_RUNNER_SCRIPT);
    this.timeoutMs = options.timeoutMs ?? 600_000;
    this.skipBrowser = options.skipBrowser === true;
  }

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const started = this.clock.nowMs();
    const commands: CommandLog[] = [];
    const skipped = (reason: string): LayerResult => notRun("skipped", reason);
    const layers: Layers = { parse: skipped("not run"), check: skipped("not run"), build: skipped("not run"), start: skipped("not run"), tests: skipped("not run") };
    let diagnostics: Diagnostic[] = [];
    let testReport: TestReportSummary | null = null;
    let compilerVersion: string | null = null;
    let toolError: string | null = null;
    const requiredSymbols = this.checkNames(input);

    try {
      const args = [this.script, "--project", input.projectDir, "--fixtures", this.task.testsDir, ...(this.skipBrowser ? ["--skip-browser"] : [])];
      const callStarted = this.clock.nowMs();
      const result = await this.runner.run({ args, cwd: input.projectDir, timeoutMs: this.timeoutMs });
      commands.push({ command: "baseline-candidate", exitCode: result.exitCode, durationMs: Math.max(0, Math.round(this.clock.nowMs() - callStarted)), timedOut: result.timedOut });
      if (result.spawnError !== null) throw new ToolError(`the baseline candidate runner could not be started: ${result.spawnError}`);
      if (result.timedOut) throw new ToolError(`the baseline candidate runner did not finish within ${String(Math.round(this.timeoutMs / 1000))} s`);
      if (result.exitCode !== 0) throw new ToolError(`the baseline candidate runner exited with ${String(result.exitCode)}: ${firstLine(result.stderr)}`);
      const report = parseRunnerReport(result.stdout);
      compilerVersion = report.typescriptVersion === undefined ? null : `typescript@${report.typescriptVersion}`;
      const errors = report.check.diagnostics;
      const parseErrors = errors.filter((d) => d.phase === "parse");
      layers.parse = parseErrors.length === 0 ? pass() : fail(`${String(parseErrors.length)} syntax errors; first ${describe(parseErrors[0] as Diagnostic)}`);
      layers.check = errors.length === 0 ? pass() : fail(`${String(errors.length)} errors; first ${describe(errors[0] as Diagnostic)}`);
      if (errors.length > 0) {
        diagnostics = errors;
        for (const layer of ["build", "start", "tests"] as const) layers[layer] = skipped("check failed");
      } else if (report.build === null) {
        throw new ToolError("the baseline candidate runner built nothing although the check passed");
      } else if (!report.build.ok) {
        layers.build = fail(`${String(report.build.errors.length)} build errors; first ${firstLine(report.build.errors[0] ?? "")}`);
        diagnostics = report.build.errors.map(
          (message): Diagnostic => ({ code: "BASELINE-BUILD", severity: "error", message, phase: "build", source: null, rendered: `build error: ${message}` }),
        );
        for (const layer of ["start", "tests"] as const) layers[layer] = skipped("build failed");
      } else {
        layers.build = pass();
        if (report.tests === null) {
          const reason = "the browser layers were not run (skipped by configuration)";
          layers.start = notRun("environment", reason);
          layers.tests = notRun("environment", reason);
        } else {
          const tests = report.tests;
          testReport = {
            status: tests.status,
            exitCode: tests.status === "fail" ? 1 : 0,
            summary: tests.summary,
            fixtures: tests.fixtures.map((f) => ({
              file: f.file,
              name: f.name,
              status: f.status,
              reason: f.reason === null ? null : scrubMachinePaths(f.reason),
              failure: f.failure === null ? null : { ...f.failure, message: scrubMachinePaths(f.failure.message), details: f.failure.details.map(scrubMachinePaths) },
              stepsRun: f.stepsRun,
              stepsTotal: f.stepsTotal,
            })),
            environment: (tests.environment ?? null) as TestReportSummary["environment"],
            fallbackAdapter: tests.fallbackAdapter,
          };
          const invalid = testReport.fixtures.find((f) => f.failure?.kind === "invalid-fixture");
          if (invalid !== undefined) throw new ToolError(`the task's fixture '${invalid.file}' cannot run on the baseline: ${firstLine(invalid.failure?.message ?? "")}`);
          const classified = classifyTestReport(testReport);
          layers.start = classified.start;
          layers.tests = classified.tests;
        }
      }
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      toolError = scrubMachinePaths(scrubPaths(error.message, [[input.projectDir, "<project>"], [input.outDir, "<out>"]]));
    }

    return {
      layers,
      requiredSymbols,
      diagnostics,
      testReport,
      compilerVersion,
      verdict: toolError !== null ? "error" : verdictOf(layers, requiredSymbols),
      toolError,
      commands,
      durationMs: Math.max(0, Math.round(this.clock.nowMs() - started)),
    };
  }

  /** The required names, searched as string literals in the candidate's sources. */
  private checkNames(input: ValidateInput): SymbolCheck {
    const checked = [...input.requiredSymbols];
    if (checked.length === 0) return { outcome: "pass", checked, missing: [], reason: null };
    const source = sourcesOf(join(input.projectDir, "src")).join("\n");
    const missing = checked.filter((name) => !quoted(source, name));
    return missing.length === 0
      ? { outcome: "pass", checked, missing, reason: null }
      : { outcome: "fail", checked, missing, reason: `required names not declared: ${missing.join(", ")}` };
  }
}
