// The Validator (spec/ai-and-benchmarks.md sections 1 and 4.1, decision 0077): runs the real compiler
// on a candidate and records every layer separately. It never counts syntax as success.
//
//   parse   pass | fail   from `mtek check --format json`: no error diagnostic of phase `parse`
//   check   pass | fail   the same report: no error diagnostic at all
//   build   pass | fail   `mtek build --mode test --format json` (emits and validates the shaders)
//   start   pass | fail | not-run   from `mtek test --format json`: the program mounted in the fixtures that ran
//   tests   pass | fail | not-run   the same report: every fixture of the task passed
//   requiredSymbols   pass | fail | not-run   `mtek context --symbol S` for each symbol the task requires
//
// A layer after a failed one is `not-run` (kind `skipped`). A layer this machine cannot run (no Node,
// no browser, no GPU adapter: the NOT-RUN of decision 0074) is `not-run` (kind `environment`), and a
// candidate with a layer that did not run is never a pass. A failure of the tool chain itself (the
// binary missing, a crash, output that is not the documented shape, an invalid task fixture) makes the
// verdict `error`: it says nothing about the candidate.
//
// Every command is a fresh process. `mtek test` runs each fixture in a fresh page of a fresh browser
// context (decision 0074), so no state carries over between candidates.
import { projectEntry } from "./context-builder.ts";
import type { Json } from "./canonical.ts";
import { systemClock, type Clock } from "./clock.ts";
import type { CommandResult, CommandRunner } from "./commands.ts";
import { parseDiagnosticsReport, type Diagnostic, type DiagnosticsReport } from "./diagnostics.ts";
import { ToolError } from "./errors.ts";
import { fail, notRun, pass, type LayerResult, type Layers, type LayerOutcome, type Verdict } from "./outcomes.ts";

export interface ValidatorTimeouts {
  check: number;
  build: number;
  test: number;
  context: number;
}

export const DEFAULT_TIMEOUTS: ValidatorTimeouts = { check: 60_000, build: 120_000, test: 900_000, context: 60_000 };

export interface TestFailure {
  kind: string;
  step: number | null;
  line: number | null;
  message: string;
  details: string[];
}

export interface TestFixtureResult {
  file: string;
  name: string;
  status: "pass" | "fail" | "not-run";
  reason: string | null;
  failure: TestFailure | null;
  stepsRun: number;
  stepsTotal: number;
}

/** What the harness keeps of the `mtek test` report (spec/test-report.schema.json, decision 0074). */
export interface TestReportSummary {
  status: "pass" | "fail" | "not-run";
  exitCode: number;
  summary: { total: number; passed: number; failed: number; notRun: number };
  fixtures: TestFixtureResult[];
  /** The `environment` object of the report as printed (browser, GPU adapter), or null. */
  environment: Json | null;
  /** True when the fixtures ran on a software adapter: correctness only, never hardware evidence. */
  fallbackAdapter: boolean | null;
}

export interface SymbolCheck {
  outcome: LayerOutcome;
  checked: string[];
  missing: string[];
  reason: string | null;
}

export interface CommandLog {
  command: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

export interface ValidationResult {
  layers: Layers;
  requiredSymbols: SymbolCheck;
  /** The diagnostics of the layer that failed (check, else build); empty when both passed. */
  diagnostics: Diagnostic[];
  testReport: TestReportSummary | null;
  compilerVersion: string | null;
  verdict: Verdict;
  /** For verdict `error`: what failed. */
  toolError: string | null;
  commands: CommandLog[];
  durationMs: number;
}

export interface ValidateInput {
  /** The candidate's project directory (with `tests/` holding the task's fixtures). */
  projectDir: string;
  /** Where `mtek build` writes; outside the project. */
  outDir: string;
  requiredSymbols: readonly string[];
}

/** Codes of `mtek build` that mean the tool chain, not the candidate, failed. */
const TOOL_CODES = new Set(["MTEK-E9030", "MTEK-E9031", "MTEK-E9999"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Replaces machine paths (in both separator spellings) so that a record never names the machine it ran on. */
export function scrubPaths(text: string, replacements: readonly (readonly [string, string])[]): string {
  let out = text;
  for (const [path, label] of replacements) {
    for (const spelling of new Set([path, path.replace(/\\/g, "/"), path.replace(/\//g, "\\")])) {
      if (spelling !== "") out = out.split(spelling).join(label);
    }
  }
  return out;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

function describe(diagnostic: Diagnostic): string {
  const where = diagnostic.source === null ? "" : ` (${diagnostic.source.file}:${String(diagnostic.source.startLine)})`;
  return `${diagnostic.code}: ${firstLine(diagnostic.message)}${where}`;
}

function errorsOf(report: DiagnosticsReport): Diagnostic[] {
  return report.diagnostics.filter((d) => d.severity === "error");
}

/** Parses the JSON report of `mtek test --format json`; throws a ToolError when it is not one. */
export function parseTestReport(stdout: string): TestReportSummary & { error: string | null } {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new ToolError("mtek test did not print a JSON report");
  }
  const bad = (what: string): ToolError => new ToolError(`mtek test printed a report that is not schema version 1 (${what})`);
  if (!isRecord(value) || value["schemaVersion"] !== 1 || value["command"] !== "mtek test") throw bad("schemaVersion or command");
  const status = value["status"];
  if (status !== "pass" && status !== "fail" && status !== "not-run") throw bad("status");
  const exitCode = value["exitCode"];
  if (typeof exitCode !== "number") throw bad("exitCode");
  const summary = value["summary"];
  if (!isRecord(summary)) throw bad("summary");
  const num = (key: string): number => {
    const n = summary[key];
    if (typeof n !== "number") throw bad(`summary.${key}`);
    return n;
  };
  const fixturesValue = value["fixtures"];
  if (!Array.isArray(fixturesValue)) throw bad("fixtures");
  const fixtures: TestFixtureResult[] = (fixturesValue as unknown[]).map((item, index) => {
    if (!isRecord(item)) throw bad(`fixtures[${String(index)}]`);
    const fixtureStatus = item["status"];
    if (fixtureStatus !== "pass" && fixtureStatus !== "fail" && fixtureStatus !== "not-run") throw bad(`fixtures[${String(index)}].status`);
    if (typeof item["file"] !== "string" || typeof item["name"] !== "string") throw bad(`fixtures[${String(index)}] file or name`);
    const failureValue = item["failure"];
    let failure: TestFailure | null = null;
    if (isRecord(failureValue)) {
      if (typeof failureValue["kind"] !== "string" || typeof failureValue["message"] !== "string") throw bad(`fixtures[${String(index)}].failure`);
      const details = failureValue["details"];
      failure = {
        kind: failureValue["kind"],
        step: typeof failureValue["step"] === "number" ? failureValue["step"] : null,
        line: typeof failureValue["line"] === "number" ? failureValue["line"] : null,
        message: failureValue["message"],
        details: Array.isArray(details) ? (details as unknown[]).filter((d): d is string => typeof d === "string") : [],
      };
    }
    return {
      file: item["file"],
      name: item["name"],
      status: fixtureStatus,
      reason: typeof item["reason"] === "string" ? item["reason"] : null,
      failure,
      stepsRun: typeof item["stepsRun"] === "number" ? item["stepsRun"] : 0,
      stepsTotal: typeof item["stepsTotal"] === "number" ? item["stepsTotal"] : 0,
    };
  });
  const environment = isRecord(value["environment"]) ? (value["environment"] as Json) : null;
  let fallbackAdapter: boolean | null = null;
  if (isRecord(environment)) {
    const gpu = environment["gpu"];
    const adapter = isRecord(gpu) ? gpu["adapter"] : null;
    if (isRecord(adapter) && typeof adapter["isFallbackAdapter"] === "boolean") fallbackAdapter = adapter["isFallbackAdapter"];
  }
  return {
    status,
    exitCode,
    summary: { total: num("total"), passed: num("passed"), failed: num("failed"), notRun: num("notRun") },
    fixtures,
    environment,
    fallbackAdapter,
    error: typeof value["error"] === "string" ? value["error"] : null,
  };
}

/** Whether a failed fixture is a failure to start the program (kind `mount`, or an error reported before the first step). */
function failedToStart(fixture: TestFixtureResult): boolean {
  const failure = fixture.failure;
  if (fixture.status !== "fail" || failure === null) return false;
  return failure.kind === "mount" || (failure.kind === "runtime-error" && failure.step === null);
}

/**
 * The `start` and `tests` layers from a test report.
 *
 * - `start` passes when at least one fixture got past mounting and none failed to mount; it fails when a
 *   fixture failed to mount; it is not-run when no fixture ran.
 * - `tests` passes only when the run was `pass` (at least one fixture, all passed); it fails when a
 *   fixture that started failed an expectation; it is not-run when fixtures could not run, or when the
 *   program did not start (so the expectations were never evaluated).
 */
export function classifyTestReport(report: TestReportSummary): { start: LayerResult; tests: LayerResult } {
  if (report.status === "pass") {
    if (report.summary.total === 0 || report.summary.passed !== report.summary.total) {
      throw new ToolError("mtek test reported pass without every fixture passing");
    }
    return { start: pass(), tests: pass() };
  }
  const ran = report.fixtures.filter((f) => f.status !== "not-run");
  const notRunReasons = report.fixtures.filter((f) => f.status === "not-run").map((f) => f.reason ?? "no reason given");
  if (ran.length === 0) {
    const reason = firstLine(notRunReasons[0] ?? "no fixture ran");
    return { start: notRun("environment", reason), tests: notRun("environment", reason) };
  }
  const startFailures = ran.filter(failedToStart);
  if (startFailures.length > 0) {
    const first = startFailures[0] as TestFixtureResult;
    const why = `the program did not start in fixture '${first.name}': ${firstLine(first.failure?.message ?? "")}`;
    return { start: fail(why), tests: notRun("skipped", "the program did not start") };
  }
  const start = pass();
  const failed = ran.filter((f) => f.status === "fail");
  if (failed.length > 0) {
    const first = failed[0] as TestFixtureResult;
    const names = failed.map((f) => `'${f.name}'`).join(", ");
    return { start, tests: fail(`${String(failed.length)} of ${String(report.summary.total)} fixtures failed: ${names} (${first.failure?.kind ?? "failure"}: ${firstLine(first.failure?.message ?? "")})`) };
  }
  // No failure, but some fixture could not run.
  return { start, tests: notRun("environment", firstLine(notRunReasons[0] ?? "a fixture could not run")) };
}

export class Validator {
  private readonly runner: CommandRunner;
  private readonly clock: Clock;
  private readonly timeouts: ValidatorTimeouts;

  constructor(runner: CommandRunner, options: { clock?: Clock; timeouts?: Partial<ValidatorTimeouts> } = {}) {
    this.runner = runner;
    this.clock = options.clock ?? systemClock;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  }

  private async run(log: CommandLog[], label: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
    const started = this.clock.nowMs();
    const result = await this.runner.run({ args, cwd, timeoutMs });
    log.push({ command: label, exitCode: result.exitCode, durationMs: Math.max(0, Math.round(this.clock.nowMs() - started)), timedOut: result.timedOut });
    if (result.spawnError !== null) throw new ToolError(`mtek ${label} could not be started: ${result.spawnError}`);
    if (result.timedOut) throw new ToolError(`mtek ${label} did not finish within ${String(Math.round(timeoutMs / 1000))} s`);
    return result;
  }

  async validate(input: ValidateInput): Promise<ValidationResult> {
    const started = this.clock.nowMs();
    const commands: CommandLog[] = [];
    const skipped = (reason: string): LayerResult => notRun("skipped", reason);
    const layers: Layers = {
      parse: skipped("not run"),
      check: skipped("not run"),
      build: skipped("not run"),
      start: skipped("not run"),
      tests: skipped("not run"),
    };
    let requiredSymbols: SymbolCheck = { outcome: "not-run", checked: [], missing: [], reason: "not run" };
    let diagnostics: Diagnostic[] = [];
    let testReport: TestReportSummary | null = null;
    let compilerVersion: string | null = null;
    let toolError: string | null = null;

    try {
      // parse and check: one `mtek check`.
      const checkResult = await this.run(commands, "check", ["check", "--format", "json", input.projectDir], input.projectDir, this.timeouts.check);
      const checkReport = this.report("check", checkResult);
      compilerVersion = checkReport.compilerVersion;
      const checkErrors = errorsOf(checkReport);
      if ((checkResult.exitCode === 0) !== (checkErrors.length === 0)) {
        throw new ToolError(`mtek check exited with ${String(checkResult.exitCode)} but its report has ${String(checkErrors.length)} errors`);
      }
      const parseErrors = checkErrors.filter((d) => d.phase === "parse");
      layers.parse = parseErrors.length === 0 ? pass() : fail(`${String(parseErrors.length)} syntax errors; first ${describe(parseErrors[0] as Diagnostic)}`);
      layers.check = checkErrors.length === 0 ? pass() : fail(`${String(checkErrors.length)} errors; first ${describe(checkErrors[0] as Diagnostic)}`);
      diagnostics = checkErrors.length === 0 ? [] : checkReport.diagnostics;

      // Required symbols: independent of the layers, so a "repair" that deletes a feature is caught even when it checks.
      requiredSymbols = await this.checkSymbols(commands, input);

      if (checkErrors.length > 0) {
        for (const layer of ["build", "start", "tests"] as const) layers[layer] = skipped("check failed");
      } else {
        // build
        const buildResult = await this.run(
          commands,
          "build",
          ["build", "--mode", "test", "--format", "json", "--out", input.outDir, input.projectDir],
          input.projectDir,
          this.timeouts.build,
        );
        const buildReport = this.report("build", buildResult);
        const buildErrors = errorsOf(buildReport);
        const toolCode = buildErrors.find((d) => TOOL_CODES.has(d.code));
        if (toolCode !== undefined) throw new ToolError(`mtek build failed in the tool chain: ${describe(toolCode)}`);
        if ((buildResult.exitCode === 0) !== (buildErrors.length === 0)) {
          throw new ToolError(`mtek build exited with ${String(buildResult.exitCode)} but its report has ${String(buildErrors.length)} errors`);
        }
        if (buildErrors.length > 0) {
          layers.build = fail(`${String(buildErrors.length)} errors; first ${describe(buildErrors[0] as Diagnostic)}`);
          diagnostics = buildReport.diagnostics;
          for (const layer of ["start", "tests"] as const) layers[layer] = skipped("build failed");
        } else {
          layers.build = pass();
          // start and tests: one `mtek test`, fixtures from the task in tests/.
          const testResult = await this.run(
            commands,
            "test",
            ["test", "--allow-not-run", "--format", "json", input.projectDir],
            input.projectDir,
            this.timeouts.test,
          );
          if (testResult.exitCode !== 0 && testResult.exitCode !== 1) {
            const detail = firstLine(testResult.stderr);
            throw new ToolError(`mtek test exited with ${String(testResult.exitCode)}${detail === "" ? "" : `: ${detail}`}`);
          }
          const report = parseTestReport(testResult.stdout);
          if (report.error !== null && report.fixtures.length === 0) throw new ToolError(`mtek test: ${firstLine(report.error)}`);
          if ((testResult.exitCode === 0) !== (report.status !== "fail") || report.exitCode !== testResult.exitCode) {
            throw new ToolError(`mtek test exited with ${String(testResult.exitCode)} but its report says status ${report.status}, exitCode ${String(report.exitCode)}`);
          }
          const invalid = report.fixtures.find((f) => f.failure?.kind === "invalid-fixture");
          if (invalid !== undefined) throw new ToolError(`the task's fixture '${invalid.file}' is invalid: ${firstLine(invalid.failure?.message ?? "")}`);
          const buildFailure = report.fixtures.find((f) => f.failure?.kind === "build");
          if (buildFailure !== undefined) throw new ToolError("mtek test could not build a project that mtek build built");
          const summary: TestReportSummary = {
            status: report.status,
            exitCode: report.exitCode,
            summary: report.summary,
            fixtures: report.fixtures,
            environment: report.environment,
            fallbackAdapter: report.fallbackAdapter,
          };
          testReport = summary;
          const classified = classifyTestReport(summary);
          layers.start = classified.start;
          layers.tests = classified.tests;
        }
      }
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      toolError = scrubPaths(error.message, [[input.projectDir, "<project>"], [input.outDir, "<out>"]]);
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

  private report(label: string, result: CommandResult): DiagnosticsReport {
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      const detail = firstLine(result.stderr);
      throw new ToolError(`mtek ${label} exited with ${String(result.exitCode)}${detail === "" ? "" : `: ${detail}`}`);
    }
    const report = parseDiagnosticsReport(result.stdout);
    if (report === null) throw new ToolError(`mtek ${label} did not print a diagnostics report of schema version 1`);
    return report;
  }

  /** `mtek context --symbol S` per required symbol: it exits 2 with "no declaration is named" when S does not exist. */
  private async checkSymbols(log: CommandLog[], input: ValidateInput): Promise<SymbolCheck> {
    const checked = [...input.requiredSymbols];
    if (checked.length === 0) return { outcome: "pass", checked, missing: [], reason: null };
    const entry = projectEntry(input.projectDir);
    const missing: string[] = [];
    for (const symbol of checked) {
      const result = await this.run(
        log,
        `context ${symbol}`,
        ["context", "--entry", entry, "--symbol", symbol, "--max-bytes", "1000000", "--format", "json"],
        input.projectDir,
        this.timeouts.context,
      );
      if (result.exitCode === 0) {
        const present = this.declares(result.stdout, symbol);
        if (!present) throw new ToolError(`mtek context accepted --symbol ${symbol} but does not list it`);
      } else if (result.exitCode === 2 && result.stderr.includes("no declaration is named")) {
        missing.push(symbol);
      } else if (result.exitCode === 1) {
        // The project does not load at all (`E9001` and the like): the context is the diagnostics report.
        return { outcome: "not-run", checked, missing: [], reason: "the project does not load, so its declarations cannot be listed" };
      } else {
        throw new ToolError(`mtek context exited with ${String(result.exitCode)}: ${firstLine(result.stderr)}`);
      }
    }
    return missing.length === 0
      ? { outcome: "pass", checked, missing, reason: null }
      : { outcome: "fail", checked, missing, reason: `required symbols not declared: ${missing.join(", ")}` };
  }

  private declares(stdout: string, symbol: string): boolean {
    let value: unknown;
    try {
      value = JSON.parse(stdout);
    } catch {
      throw new ToolError("mtek context did not print JSON");
    }
    const symbols = isRecord(value) ? value["symbols"] : undefined;
    return Array.isArray(symbols) && (symbols as unknown[]).some((s) => isRecord(s) && s["name"] === symbol);
  }
}

/** The verdict of a validation without a tool error: pass needs everything to pass; a failure outranks a layer that did not run. */
export function verdictOf(layers: Layers, symbols: SymbolCheck): Verdict {
  const outcomes: LayerOutcome[] = [...Object.values(layers).map((l) => l.outcome), symbols.outcome];
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("not-run")) return "not-run";
  return "pass";
}
