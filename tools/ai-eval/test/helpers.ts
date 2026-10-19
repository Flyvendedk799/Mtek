// Shared test machinery: a scripted stand-in for the `mtek` command line (`FakeMtek`), the fixture
// tasks, schema validators and small builders. No test here starts a process, opens a network
// connection or needs a GPU; the real binary is exercised by `integration.test.ts` only.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach } from "vitest";
import type { CommandResult, CommandRunner, CommandSpec } from "../src/commands.ts";
import { steppingClock, type Clock } from "../src/clock.ts";
import { createReplayClient, type ReplayClient, type ReplayEntry } from "../src/adapters/replay.ts";
import { MemoryRecorder } from "../src/recorder.ts";
import { RepairLoop, type LoopDeps, type TrialConfig, type TrialResult } from "../src/repair-loop.ts";
import { loadTask, type TaskSpec } from "../src/task.ts";
import type { GenerateResult, Usage } from "../src/model-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..", "..");
export const FIXTURE_TASKS = join(here, "fixtures", "tasks");

export const editTask = (): TaskSpec => loadTask(join(FIXTURE_TASKS, "demo-01"));
export const coldTask = (): TaskSpec => loadTask(join(FIXTURE_TASKS, "demo-cold-01"));

const tempDirs: string[] = [];
export function tempDir(prefix = "ai-eval-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function validatorFor(schemaFile: string, root?: string): (value: unknown) => string[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  const schema = JSON.parse(readFileSync(join(REPO_ROOT, "spec", schemaFile), "utf8")) as object;
  const validate = ajv.compile(root === undefined ? schema : { ...schema, $ref: root });
  return (value) => {
    validate(value);
    return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""} ${JSON.stringify(e.params)}`);
  };
}

/** Validates one record line against `spec/ai-eval-record.schema.json`; returns the problems (none when valid). */
export const validateRecord = validatorFor("ai-eval-record.schema.json");
/** Validates a diagnostics report against `spec/diagnostic.schema.json` (to keep the fake faithful). */
export const validateDiagnosticReport = validatorFor("diagnostic.schema.json");
/** Validates an `mtek test` report against `spec/test-report.schema.json` (to keep the fake faithful). */
export const validateTestReport = validatorFor("test-report.schema.json");

// ---- the fake compiler -------------------------------------------------------------------------

/** What the fake's `mtek test` does for the files of a candidate. */
export type Behaviour = "pass" | "fail" | "mount-fail" | "invalid-fixture";

export interface FakeMtekOptions {
  /** Decides the test outcome from the candidate's files (path to content). Default: pass. */
  behaviour?: (files: Map<string, string>) => Behaviour;
  /** False simulates a machine without a WebGPU adapter: every fixture is not-run. */
  gpu?: boolean;
  /** Makes the named command (`check`, `build`, `test`, `context`) exit with 3. */
  crash?: string;
  /** Reads the candidate's files; supplied by the test (the fake reads them from disk by default). */
  readFiles: (projectDir: string) => Map<string, string>;
}

const DIAGNOSTIC_BASE = { schemaVersion: 1, related: [], notes: [], suggestedEdits: [], docs: "spec/diagnostics.md#mtek-e1003" };

function diagnostic(code: string, phase: string, message: string, file: string, line: number): Record<string, unknown> {
  return {
    ...DIAGNOSTIC_BASE,
    code,
    severity: "error",
    title: "a title",
    message,
    source: { file, startByte: 0, endByte: 1, startLine: line, startColumn: 1, endLine: line, endColumn: 2 },
    phase,
    docs: `spec/diagnostics.md#${code.toLowerCase()}`,
  };
}

function report(diagnostics: Record<string, unknown>[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    tool: "mtek",
    compilerVersion: "0.1.0-fake",
    languageVersion: "0.1",
    project: "demo",
    diagnostics,
    summary: { errors: diagnostics.length, warnings: 0, notes: 0, suppressed: 0 },
  });
}

/** The toy language of the fixtures: `scene S {` and `entity E {` declare `S` and `S.E`. */
export function declaredSymbols(files: Map<string, string>): string[] {
  const names: string[] = [];
  for (const [path, text] of files) {
    if (!path.endsWith(".mtek")) continue;
    let scene: string | null = null;
    for (const line of text.split("\n")) {
      const sceneMatch = /^scene (\w+) \{/.exec(line);
      if (sceneMatch !== null) {
        scene = sceneMatch[1] ?? null;
        names.push(scene ?? "");
      }
      const entity = /^\s+entity (\w+) \{/.exec(line);
      if (entity !== null && scene !== null) names.push(`${scene}.${entity[1] ?? ""}`);
    }
  }
  return names;
}

export class FakeMtek implements CommandRunner {
  readonly calls: { command: string; args: readonly string[] }[] = [];
  private readonly options: FakeMtekOptions;

  constructor(options: FakeMtekOptions) {
    this.options = options;
  }

  commandsRun(): string[] {
    return this.calls.map((c) => c.command);
  }

  run(spec: CommandSpec): Promise<CommandResult> {
    const command = spec.args[0] ?? "";
    this.calls.push({ command, args: spec.args });
    const done = (exitCode: number, stdout: string, stderr = ""): Promise<CommandResult> =>
      Promise.resolve({ exitCode, stdout, stderr, timedOut: false, spawnError: null });
    if (this.options.crash === command) return done(3, "", "error: internal error (E9999)");
    const files = this.options.readFiles(spec.cwd);
    const main = [...files.entries()].find(([path]) => path.endsWith("main.mtek"));
    const text = main?.[1] ?? "";
    const lineOf = (needle: string): number => text.split("\n").findIndex((l) => l.includes(needle)) + 1;

    if (command === "check" || command === "build") {
      const diagnostics: Record<string, unknown>[] = [];
      if (text.includes("SYNTAX_ERROR")) diagnostics.push(diagnostic("MTEK-E1003", "parse", "Expected ';'.", "src/main.mtek", lineOf("SYNTAX_ERROR")));
      if (text.includes("TYPE_ERROR")) diagnostics.push(diagnostic("MTEK-E3102", "check", "Field expects f32, but received vec3.", "src/main.mtek", lineOf("TYPE_ERROR")));
      if (command === "build" && text.includes("BUILD_ERROR")) diagnostics.push(diagnostic("MTEK-E6001", "validate", "The generated shader is invalid.", "src/main.mtek", lineOf("BUILD_ERROR")));
      if (command === "build" && text.includes("NO_RUNTIME")) diagnostics.push(diagnostic("MTEK-E9030", "emit", "The runtime bundle is not embedded.", "src/main.mtek", 1));
      return done(diagnostics.length > 0 ? 1 : 0, report(diagnostics));
    }
    if (command === "context") {
      const symbol = spec.args[spec.args.indexOf("--symbol") + 1] ?? "";
      const declared = declaredSymbols(files);
      if (spec.args.includes("--symbol") && !declared.includes(symbol)) {
        return done(2, "", `error: no declaration is named '${symbol}' in the project\n`);
      }
      const doc = {
        languageVersion: "0.1",
        compilerVersion: "0.1.0-fake",
        contextFormat: 2,
        supported: { features: ["scenes"], notSupported: ["while"] },
        syntax: { keywords: ["scene"], precedence: [], rules: [] },
        project: { entry: "src/main.mtek", scene: "Demo", modules: ["src/main.mtek"] },
        symbols: declared.map((name) => ({ name, kind: "entity", type: "entity", doc: "", file: "src/main.mtek", line: 1 })),
        schemas: [],
        examples: [],
        diagnosticsGuide: "Fix errors in report order.",
      };
      return done(0, `${JSON.stringify(doc, null, 2)}\n`);
    }
    if (command === "test") return done(...this.test(files));
    return done(2, "", `error: unknown command ${command}`);
  }

  private test(files: Map<string, string>): [number, string] {
    const behaviour = this.options.behaviour?.(files) ?? "pass";
    const gpu = this.options.gpu !== false;
    const name = "the cube's speed is negative";
    const base = { file: "tests/negative.test.toml", name, seed: 0, stepsTotal: 2, durationMs: 5 };
    let fixture: Record<string, unknown>;
    if (!gpu) {
      fixture = { ...base, status: "not-run", reason: "no WebGPU adapter: navigator.gpu.requestAdapter() resolved to null", failure: null, stepsRun: 0 };
    } else if (behaviour === "pass") {
      fixture = { ...base, status: "pass", reason: null, failure: null, stepsRun: 2 };
    } else if (behaviour === "mount-fail") {
      fixture = { ...base, status: "fail", reason: null, failure: { kind: "mount", step: null, line: null, message: "the program did not mount: E8001", details: [] }, stepsRun: 0 };
    } else if (behaviour === "invalid-fixture") {
      fixture = { ...base, status: "fail", reason: null, failure: { kind: "invalid-fixture", step: null, line: 4, message: "line 4: unknown step", details: [] }, stepsRun: 0 };
    } else {
      fixture = {
        ...base,
        status: "fail",
        reason: null,
        failure: { kind: "expect_state", step: 2, line: 4, message: "Cube.speed is 1, expected -1", details: [] },
        stepsRun: 1,
      };
    }
    const status = fixture["status"] as "pass" | "fail" | "not-run";
    const exitCode = status === "fail" ? 1 : 0;
    const doc = {
      schemaVersion: 1,
      command: "mtek test",
      project: "demo",
      status,
      exitCode,
      allowNotRun: true,
      error: null,
      summary: { total: 1, passed: status === "pass" ? 1 : 0, failed: status === "fail" ? 1 : 0, notRun: status === "not-run" ? 1 : 0 },
      build: { ok: true, mode: "test", buildId: "abc", errors: 0, warnings: 0, diagnostics: [] },
      environment: gpu
        ? {
            browser: { name: "chromium", channel: "chromium", version: "153", headless: true, launchArgs: [] },
            gpu: { available: true, reason: null, adapter: { vendor: "v", architecture: "a", device: "d", description: "x", isFallbackAdapter: false } },
          }
        : null,
      fixtures: [fixture],
    };
    return [exitCode, JSON.stringify(doc)];
  }
}

/** Reads the candidate's files from disk (`.mtek` files and `mtek.toml`). */
export function readProjectFiles(projectDir: string): Map<string, string> {
  const files = new Map<string, string>();
  const read = (path: string): void => {
    try {
      files.set(path, readFileSync(join(projectDir, ...path.split("/")), "utf8"));
    } catch {
      // absent
    }
  };
  read("src/main.mtek");
  read("src/extra.mtek");
  read("mtek.toml");
  return files;
}

export const toyBehaviour = (files: Map<string, string>): Behaviour =>
  (files.get("src/main.mtek") ?? "").includes("speed = -speed;") ? "pass" : "fail";

export function fakeMtek(options: Partial<FakeMtekOptions> = {}): FakeMtek {
  return new FakeMtek({ readFiles: readProjectFiles, behaviour: toyBehaviour, ...options });
}

// ---- replies -------------------------------------------------------------------------------------

export const GOOD_EDIT = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = -speed;\n>>>REPLACE\n";
export const TYPE_ERROR_EDIT = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = TYPE_ERROR;\n>>>REPLACE\n";
export const SYNTAX_ERROR_EDIT = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = SYNTAX_ERROR\n>>>REPLACE\n";
/** Fixes the type error of `TYPE_ERROR_EDIT`. */
export const FIX_EDIT = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = TYPE_ERROR;\n===\n        speed = -speed;\n>>>REPLACE\n";
/** A "repair" that deletes the entity under test: the error is gone, the feature too. */
export const DELETE_CUBE_EDIT = "<<<FILE src/main.mtek\n<<<SEARCH\n    entity Cube {\n        speed = TYPE_ERROR;\n    }\n===\n>>>REPLACE\n";
export const RESTORE_CUBE_EDIT = "<<<FILE src/main.mtek\n<<<SEARCH\n    entity Marker {\n===\n    entity Cube {\n        speed = -speed;\n    }\n    entity Marker {\n>>>REPLACE\n";

export const usage = (inputTokens: number, outputTokens: number): Usage => ({ inputTokens, outputTokens, cachedInputTokens: 0 });

export function reply(text: string, overrides: Partial<ReplayEntry> = {}): ReplayEntry {
  return { text, finish: "stop", usage: usage(1000, 100), ...overrides };
}

// ---- running a trial -----------------------------------------------------------------------------

export interface Harness {
  recorder: MemoryRecorder;
  client: ReplayClient;
  fake: FakeMtek;
  run: (config?: Partial<TrialConfig>) => Promise<TrialResult>;
  runDir: string;
}

export function harness(
  entries: readonly ReplayEntry[],
  options: { fake?: Partial<FakeMtekOptions>; task?: TaskSpec; deps?: Partial<LoopDeps>; clock?: Clock; acceptGrammar?: boolean } = {},
): Harness {
  const recorder = new MemoryRecorder("test-run");
  const client = createReplayClient(entries, { model: "replay-test", acceptGrammar: options.acceptGrammar === true });
  const fake = fakeMtek(options.fake);
  const runDir = tempDir("ai-eval-run-");
  const scratchRoot = tempDir("ai-eval-scratch-");
  const clock = options.clock ?? steppingClock();
  const loop = new RepairLoop({ runner: fake, recorder, clock, scratchRoot, runDir, ...options.deps });
  const task = options.task ?? editTask();
  return {
    recorder,
    client,
    fake,
    runDir,
    run: (config = {}) => loop.run({ task, client, trialKind: "unconstrained", trialIndex: 0, temperature: 0, ...config }),
  };
}

export type { GenerateResult };
