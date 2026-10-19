// Validates one baseline candidate (a TypeScript + three.js project, decision 0108) the way the repair harness
// validates a Mtek candidate with `mtek check`, `mtek build` and `mtek test`: in a fresh process, layer by layer,
// and prints ONE JSON report on stdout.
//
//   node run-candidate.ts --project DIR --fixtures DIR [--skip-browser]
//
//   check    the TypeScript compiler on the project's tsconfig.json (syntax errors are the `parse` layer, any
//            error at all the `check` layer), exactly the `tsc --noEmit` a developer would run
//   build    the same esbuild bundle the task tests use (test/build.ts)
//   tests    every `*.test.toml` fixture of the task (decision 0021 section 8: the expectations exist once), each in a
//            fresh page of a fresh browser context, with the hooks of `startTask`; a console error or warning fails
//            a fixture, as in the Playwright suite (test/suite.ts)
//
// A machine without a WebGPU adapter (or without the browser) leaves the fixtures `not-run` with the reason: that is
// never a pass. Nothing here depends on an inference provider.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserType } from "@playwright/test";
import ts from "typescript";
import { startStaticServer } from "../../../../tests/browser/support/serve.ts";
import { browserChannel, hardwareLaunchArgs, isHeadless } from "../../../../tests/browser/support/launch-args.ts";
import type { TaskHooks } from "../src/hooks.ts";
import { buildBaseline } from "./build.ts";
import { hexToBytes, parseFixture, type Fixture, type Step } from "./fixture.ts";

export const REPORT_SCHEMA_VERSION = 1;
const FIXTURE_TIMEOUT_MS = 120_000;
const MOUNT_TIMEOUT_MS = 60_000;

export interface CandidateDiagnostic {
  code: string;
  severity: "error";
  message: string;
  phase: "parse" | "check";
  source: {
    file: string;
    startByte: number;
    endByte: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  } | null;
  /** The line a developer sees from `tsc`: `src/main.ts(12,5): error TS2322: ...`. */
  rendered: string;
}

export interface CandidateFixtureResult {
  file: string;
  name: string;
  status: "pass" | "fail" | "not-run";
  reason: string | null;
  failure: { kind: string; step: number | null; line: number | null; message: string; details: string[] } | null;
  stepsRun: number;
  stepsTotal: number;
  durationMs: number;
}

export interface CandidateReport {
  schemaVersion: 1;
  command: "baseline-candidate";
  typescriptVersion: string;
  check: { diagnostics: CandidateDiagnostic[] };
  /** Null when the check failed (nothing is built then). */
  build: { ok: boolean; errors: string[] } | null;
  /** Null when nothing was built or `--skip-browser` was given. */
  tests: {
    status: "pass" | "fail" | "not-run";
    summary: { total: number; passed: number; failed: number; notRun: number };
    fixtures: CandidateFixtureResult[];
    environment: Record<string, unknown> | null;
    fallbackAdapter: boolean | null;
  } | null;
}

const PATH_IN_TEXT = /\b[A-Za-z]:[/\\][^\s'"`)]*/g;

function scrub(text: string, roots: readonly string[]): string {
  let out = text;
  for (const root of roots) {
    for (const spelling of new Set([root, root.replaceAll("\\", "/"), root.replaceAll("/", "\\")])) {
      if (spelling !== "") out = out.split(spelling).join("<project>");
    }
  }
  return out.replace(PATH_IN_TEXT, "<path>");
}

/** The TypeScript compiler's verdict on the project, as diagnostics. */
export function typeCheck(projectDir: string): CandidateDiagnostic[] {
  const configPath = join(projectDir, "tsconfig.json");
  const config = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  if (config === undefined) throw new Error(`cannot read ${configPath}`);
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  const syntactic = new Set<ts.Diagnostic>(program.getSyntacticDiagnostics());
  const all = ts.getPreEmitDiagnostics(program);
  const result: CandidateDiagnostic[] = [];
  const seen = new Set<string>();
  for (const diagnostic of [...syntactic, ...all]) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    let source: CandidateDiagnostic["source"] = null;
    let where = "";
    if (diagnostic.file !== undefined && diagnostic.start !== undefined) {
      const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const end = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + (diagnostic.length ?? 0));
      const file = relative(projectDir, diagnostic.file.fileName).replaceAll("\\", "/");
      source = {
        file,
        startByte: diagnostic.start,
        endByte: diagnostic.start + (diagnostic.length ?? 0),
        startLine: start.line + 1,
        startColumn: start.character + 1,
        endLine: end.line + 1,
        endColumn: end.character + 1,
      };
      where = `${file}(${String(start.line + 1)},${String(start.character + 1)}): `;
    }
    const rendered = `${where}error TS${String(diagnostic.code)}: ${message}`;
    if (seen.has(rendered)) continue;
    seen.add(rendered);
    result.push({
      code: `TS${String(diagnostic.code)}`,
      severity: "error",
      message,
      phase: syntactic.has(diagnostic) ? "parse" : "check",
      source,
      rendered,
    });
  }
  return result;
}

interface RunDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
}

function loadFixtures(fixturesDir: string): { file: string; fixture: Fixture }[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".test.toml"))
    .sort()
    .map((name) => ({ file: `mtek-tests/${name}`, fixture: parseFixture(readFileSync(join(fixturesDir, name), "utf8"), `mtek-tests/${name}`) }));
}

class StepFailure extends Error {
  readonly kind: string;
  readonly step: number | null;
  constructor(kind: string, step: number | null, message: string) {
    super(message);
    this.kind = kind;
    this.step = step;
  }
}

async function runFixture(
  browser: import("@playwright/test").Browser,
  baseUrl: string,
  entry: { file: string; fixture: Fixture },
): Promise<CandidateFixtureResult> {
  const started = Date.now();
  const { fixture, file } = entry;
  const context = await browser.newContext();
  const stepsTotal = fixture.steps.length;
  let stepsRun = 0;
  const result = (status: "pass" | "fail", failure: CandidateFixtureResult["failure"]): CandidateFixtureResult => ({
    file,
    name: fixture.name,
    status,
    reason: null,
    failure,
    stepsRun,
    stepsTotal,
    durationMs: Date.now() - started,
  });
  const timer = setTimeout(() => void context.close(), FIXTURE_TIMEOUT_MS);
  try {
    const page = await context.newPage();
    const consoleMessages: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") consoleMessages.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
    await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
    await page.goto(`${baseUrl}/index.html`);
    try {
      await page.waitForFunction(() => window.mtekTask !== undefined || window.mtekTaskError !== undefined, undefined, { timeout: MOUNT_TIMEOUT_MS });
    } catch {
      return result("fail", { kind: "mount", step: null, line: null, message: "the application did not start: window.mtekTask was never set", details: consoleMessages.slice(0, 5) });
    }
    const startError = await page.evaluate(() => window.mtekTaskError);
    if (startError !== undefined) {
      return result("fail", { kind: "mount", step: null, line: null, message: `the application failed to start: ${startError.split("\n")[0] ?? ""}`, details: consoleMessages.slice(0, 5) });
    }
    let pixels: { width: number; height: number; data: readonly number[] } | null = null;
    try {
      for (const [index, step] of fixture.steps.entries()) {
        const where = `step ${String(index + 1)} (${step.kind})`;
        await runStep(page, step, where, index + 1, () => pixels, (p) => (pixels = p));
        stepsRun = index + 1;
      }
    } catch (error) {
      if (error instanceof StepFailure) return result("fail", { kind: error.kind, step: error.step, line: null, message: scrub(error.message, []), details: [] });
      const text = error instanceof Error ? error.message : String(error);
      return result("fail", { kind: "runtime-error", step: stepsRun + 1, line: null, message: scrub(text.split("\n")[0] ?? text, []), details: consoleMessages.slice(0, 5) });
    }
    if (consoleMessages.length > 0) {
      return result("fail", { kind: "console", step: null, line: null, message: `the page reported ${String(consoleMessages.length)} console errors or warnings`, details: consoleMessages.slice(0, 5).map((m) => scrub(m, [])) });
    }
    return result("pass", null);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return result("fail", { kind: "runtime-error", step: stepsRun + 1, line: null, message: scrub(text.split("\n")[0] ?? text, []), details: [] });
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => undefined);
  }
}

async function runStep(
  page: import("@playwright/test").Page,
  step: Step,
  where: string,
  stepNumber: number,
  getPixels: () => { width: number; height: number; data: readonly number[] } | null,
  setPixels: (p: { width: number; height: number; data: readonly number[] } | null) => void,
): Promise<void> {
  switch (step.kind) {
    case "step":
      setPixels(null);
      await page.evaluate(([f, d]) => (window.mtekTask as TaskHooks).step(f, d), [step.frames, step.dt] as const);
      return;
    case "press":
      await page.evaluate((c) => (window.mtekTask as TaskHooks).pressKey(c), step.code);
      return;
    case "release":
      await page.evaluate((c) => (window.mtekTask as TaskHooks).releaseKey(c), step.code);
      return;
    case "set_input": {
      const outcome = await page.evaluate(([n, v]) => (window.mtekTask as TaskHooks).setInput(n, v), [step.name, step.value as unknown] as const);
      if (!outcome.ok) throw new StepFailure("set-input", stepNumber, `${where}: setInput('${step.name}') was rejected: ${outcome.error.code}: ${outcome.error.message}`);
      return;
    }
    case "expect_state":
      throw new StepFailure("invalid-fixture", stepNumber, `${where}: expect_state is a Mtek-only step`);
    case "expect_pixel": {
      let pixels = getPixels();
      if (pixels === null) {
        pixels = await page.evaluate(() => (window.mtekTask as TaskHooks).readPixels());
        setPixels(pixels);
      }
      const { width, height, data } = pixels;
      if (step.x < 0 || step.y < 0 || step.x >= width || step.y >= height) {
        throw new StepFailure("invalid-fixture", stepNumber, `${where}: pixel (${String(step.x)}, ${String(step.y)}) is outside the ${String(width)} x ${String(height)} target`);
      }
      const offset = (step.y * width + step.x) * 4;
      const actual = [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1];
      const expected = hexToBytes(step.color);
      const worst = Math.max(...actual.map((value, channel) => Math.abs(value - (expected[channel] ?? 0))));
      if (worst > step.tolerance) {
        throw new StepFailure(
          "expectation",
          stepNumber,
          `${where}: pixel (${String(step.x)}, ${String(step.y)}) is rgb(${actual.join(", ")}), expected ${step.color} within ${String(step.tolerance)}`,
        );
      }
      return;
    }
  }
}

function allNotRun(entries: readonly { file: string; fixture: Fixture }[], reason: string, environment: Record<string, unknown> | null): NonNullable<CandidateReport["tests"]> {
  return {
    status: "not-run",
    summary: { total: entries.length, passed: 0, failed: 0, notRun: entries.length },
    fixtures: entries.map(({ file, fixture }) => ({ file, name: fixture.name, status: "not-run", reason, failure: null, stepsRun: 0, stepsTotal: fixture.steps.length, durationMs: 0 })),
    environment,
    fallbackAdapter: null,
  };
}

async function runTests(
  builtDir: string,
  entries: readonly { file: string; fixture: Fixture }[],
  deps: RunDeps,
): Promise<NonNullable<CandidateReport["tests"]>> {
  let chromium: BrowserType;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch (error) {
    return allNotRun(entries, `Playwright is not installed: ${String(error).split("\n")[0] ?? ""}`, null);
  }
  const channel = browserChannel(deps.env);
  const args = hardwareLaunchArgs(deps.env);
  let browser: import("@playwright/test").Browser;
  try {
    browser = await chromium.launch({ channel, headless: isHeadless(deps.env), args });
  } catch (error) {
    return allNotRun(entries, scrub(`Chromium could not be launched (${String(error).split("\n")[0] ?? ""})`, []), null);
  }
  const server = await startStaticServer(builtDir);
  try {
    const probeContext = await browser.newContext();
    let adapter: Record<string, unknown> | null = null;
    let reason = "no WebGPU adapter";
    try {
      const page = await probeContext.newPage();
      await page.goto(`${server.url}/index.html`);
      const probe = await page.evaluate(async () => {
        const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
        if (gpu === undefined) return { available: false as const, reason: "navigator.gpu is undefined" };
        try {
          const found = await gpu.requestAdapter({ powerPreference: "high-performance" });
          if (found === null) return { available: false as const, reason: "navigator.gpu.requestAdapter() resolved to null" };
          const { vendor, architecture, device, description, isFallbackAdapter } = found.info;
          return { available: true as const, adapter: { vendor, architecture, device, description, isFallbackAdapter } };
        } catch (error) {
          return { available: false as const, reason: `requestAdapter threw: ${String(error)}` };
        }
      });
      if (probe.available) adapter = probe.adapter;
      else reason = probe.reason;
    } finally {
      await probeContext.close();
    }
    const environment: Record<string, unknown> = {
      browser: { name: chromium.name(), channel, version: browser.version(), launchArgs: args },
      gpu: { adapter },
    };
    if (adapter === null) return allNotRun(entries, reason, environment);
    const fixtures: CandidateFixtureResult[] = [];
    for (const entry of entries) fixtures.push(await runFixture(browser, server.url, entry));
    const passed = fixtures.filter((f) => f.status === "pass").length;
    const failed = fixtures.filter((f) => f.status === "fail").length;
    return {
      status: failed > 0 ? "fail" : passed === fixtures.length ? "pass" : "not-run",
      summary: { total: fixtures.length, passed, failed, notRun: fixtures.length - passed - failed },
      fixtures,
      environment,
      fallbackAdapter: adapter["isFallbackAdapter"] === true,
    };
  } finally {
    await server.close();
    await browser.close().catch(() => undefined);
  }
}

export async function validateCandidate(projectDir: string, fixturesDir: string, options: { skipBrowser?: boolean; env?: RunDeps["env"] } = {}): Promise<CandidateReport> {
  const project = resolve(projectDir);
  const diagnostics = typeCheck(project);
  const report: CandidateReport = { schemaVersion: 1, command: "baseline-candidate", typescriptVersion: ts.version, check: { diagnostics }, build: null, tests: null };
  if (diagnostics.length > 0) return report;
  const scratch = mkdtempSync(join(tmpdir(), "mtek-baseline-"));
  try {
    try {
      await buildBaseline(project, scratch);
      report.build = { ok: true, errors: [] };
    } catch (error) {
      const failures = (error as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors;
      const messages = failures === undefined
        ? [String(error)]
        : failures.map((e) => `${e.location === null || e.location === undefined ? "" : `${e.location.file}:${String(e.location.line)}:${String(e.location.column)}: `}${e.text}`);
      report.build = { ok: false, errors: messages.map((m) => scrub(m, [project])) };
      return report;
    }
    if (options.skipBrowser === true) return report;
    report.tests = await runTests(scratch, loadFixtures(resolve(fixturesDir)), { env: options.env ?? process.env });
    return report;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index < 0 ? undefined : argv[index + 1];
  };
  const project = get("project");
  const fixtures = get("fixtures");
  if (project === undefined || fixtures === undefined) {
    process.stderr.write("usage: run-candidate.ts --project DIR --fixtures DIR [--skip-browser]\n");
    process.exitCode = 2;
  } else {
    try {
      const report = await validateCandidate(project, fixtures, { skipBrowser: argv.includes("--skip-browser") });
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } catch (error) {
      process.stderr.write(`${scrub(error instanceof Error ? error.message : String(error), [])}\n`);
      process.exitCode = 3;
    }
  }
}
