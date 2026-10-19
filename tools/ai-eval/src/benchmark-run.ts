// The benchmark runner of the AI/token benchmark (spec/ai-and-benchmarks.md section 6.4, decision 0108):
// tasks x sides x trial kinds x trials for ONE model, one run directory `<out>/<run-id>/` with
// `records.jsonl` (every call, edit and validation of every attempt, failures included, plus the settings
// of the run and its spend) and the final candidate of every trial.
//
//   node tools/ai-eval/src/benchmark-run.ts --tasks id,id | --all [--holdout] [--sides mtek,baseline]
//        [--trial-kinds unconstrained] [--trials N] [--first-trial N] --client anthropic --model ID
//        --spend-cap USD [--spend-ledger FILE] [--no-prompt-caching] [--order trial-major|task-major] [--temperature N|default]
//        [--max-total-tokens N] [--max-repairs N] [--run-id ID] [--out DIR] [--gpu-lock DIR]
//
// Order: trial index outermost, then task, then side, then trial kind: if the money or the time runs out, what
// exists is balanced between the sides instead of complete for one of them. A trial that the spend cap stops is
// recorded as unfinished-by-budget, and so is every trial that would have followed (it starts, finds the cap
// reached and ends unfinished without a call): nothing is dropped silently.
//
// Money: a non-replay client is refused without `--spend-cap`; every call is checked against the cap before it is
// made and charged to the ledger after (`spend.ts`). The API key is read from the environment variable named by
// `--api-key-env` (default `ANTHROPIC_API_KEY`) and appears nowhere in the records.
//
// Holdout: with `--holdout` the tasks come from `benchmarks/holdout/` and the run directory must be OUTSIDE the
// repository, because a record holds prompts and candidates and no holdout text may enter the repository
// (decisions 0021 and 0085); `report` turns such a run into ids and layer outcomes only.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "./adapters/registry.ts";
import { systemClock, type Clock } from "./clock.ts";
import { createMtekRunner, createProgramRunner, findMtek, repoRoot, type CommandRunner } from "./commands.ts";
import type { GrammarCapability, TrialKind } from "./grammar.ts";
import { defaultGrammarCapability } from "./grammar.ts";
import { lockedRunner } from "./gpu-lock.ts";
import type { FetchLike, ModelClient } from "./model-client.ts";
import { JsonlRecorder } from "./recorder.ts";
import { RepairLoop, DEFAULT_CONTEXT_MAX_BYTES } from "./repair-loop.ts";
import { sideByName, type Side } from "./side.ts";
import { DEFAULT_LEDGER_PATH, guardClient, SpendLedger, type SpendGuardedClient } from "./spend.ts";
import { loadTask, type TaskSpec } from "./task.ts";
import { commandGrammarCapability, findGrammarAdapter } from "./command-grammar.ts";
import { BASELINE_PROMPT_VERSION, PROMPT_VERSION } from "./prompts.ts";

export const HARNESS_VERSION = "0.1.0-dev";

export interface BenchmarkIo {
  out(text: string): void;
  err(text: string): void;
}

export interface BenchmarkDeps {
  io?: BenchmarkIo;
  env?: Readonly<Record<string, string | undefined>>;
  runner?: CommandRunner;
  programRunner?: CommandRunner;
  clock?: Clock;
  fetch?: FetchLike;
  grammar?: GrammarCapability;
  /** Replaces the client of `--client` (tests). */
  client?: ModelClient;
  /** The repository root (tests use a stand-in); default the real one. */
  root?: string;
}

class UsageError extends Error {}

const VALUE_FLAGS = new Set([
  "tasks", "sides", "trial-kinds", "trials", "first-trial", "client", "model", "base-url", "api-key-env", "transcript", "temperature", "max-total-tokens",
  "max-repairs", "max-bytes", "test-feedback", "run-id", "out", "mtek", "scratch", "spend-cap", "spend-ledger", "gpu-lock", "grammar-adapter", "api-key-file", "order",
]);
const SWITCH_FLAGS = new Set(["all", "holdout", "no-prompt-caching", "keep-scratch", "help"]);

const USAGE = `usage:
  benchmark-run (--tasks ID,ID,... | --all) [--holdout] [--sides mtek,baseline] [--trial-kinds unconstrained,constrained]
                [--trials N] [--first-trial N] --client anthropic --model ID --spend-cap USD [--spend-ledger FILE]
                [--no-prompt-caching] [--temperature N|default] [--max-total-tokens N] [--max-repairs N] [--max-bytes N]
                [--test-feedback messages|status-only] [--run-id ID] [--out DIR] [--gpu-lock DIR] [--mtek PATH]
                [--api-key-env VAR] [--api-key-file FILE] [--base-url URL] [--scratch DIR] [--keep-scratch]
`;

interface Parsed {
  flags: Map<string, string[]>;
}

function parse(argv: readonly string[]): Parsed {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument '${arg}'`);
    const name = arg.slice(2);
    if (SWITCH_FLAGS.has(name)) {
      flags.set(name, ["true"]);
    } else if (VALUE_FLAGS.has(name)) {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      flags.set(name, [...(flags.get(name) ?? []), value]);
      i += 1;
    } else {
      throw new UsageError(`unknown option --${name}`);
    }
  }
  return { flags };
}

const one = (parsed: Parsed, name: string): string | undefined => {
  const values = parsed.flags.get(name);
  if (values !== undefined && values.length > 1) throw new UsageError(`--${name} was given more than once`);
  return values?.[0];
};

function integer(parsed: Parsed, name: string, min: number): number | undefined {
  const text = one(parsed, name);
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text) || Number(text) < min) throw new UsageError(`--${name} must be an integer of at least ${String(min)}`);
  return Number(text);
}

function list(parsed: Parsed, name: string, fallback: readonly string[]): string[] {
  const text = one(parsed, name);
  if (text === undefined) return [...fallback];
  const items = text.split(",").map((item) => item.trim()).filter((item) => item !== "");
  if (items.length === 0) throw new UsageError(`--${name} is empty`);
  return items;
}

/** The ids of the tasks below `directory` (its subdirectory names, sorted). */
export function taskIdsIn(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** True when `path` is `root` or below it. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

export interface PlannedTrial {
  task: TaskSpec;
  side: Side;
  kind: TrialKind;
  trial: number;
}

/**
 * The attempts of a run in the order they are made. `trial-major` (the default): trial index outermost, so what exists when the
 * money or the time runs out is balanced across tasks and sides. `task-major`: all trials of a task and side one after another,
 * so the identical first prompt of the trials is served from the provider's prompt cache (it lives five minutes), which is
 * cheaper, but a run that is stopped early lacks whole tasks instead of whole trials.
 */
export function plan(tasks: readonly TaskSpec[], sides: readonly Side[], kinds: readonly TrialKind[], firstTrial: number, trials: number, order: "trial-major" | "task-major"): PlannedTrial[] {
  const out: PlannedTrial[] = [];
  const indices = Array.from({ length: trials }, (_, i) => firstTrial + i);
  if (order === "trial-major") {
    for (const trial of indices) for (const task of tasks) for (const side of sides) for (const kind of kinds) out.push({ task, side, kind, trial });
  } else {
    for (const task of tasks) for (const side of sides) for (const kind of kinds) for (const trial of indices) out.push({ task, side, kind, trial });
  }
  return out;
}

export async function runBenchmark(argv: readonly string[], deps: BenchmarkDeps = {}): Promise<number> {
  const io: BenchmarkIo = deps.io ?? { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) };
  const env = deps.env ?? process.env;
  const root = deps.root ?? repoRoot();
  let guard: SpendGuardedClient | null = null;
  try {
    const parsed = parse(argv);
    if (parsed.flags.has("help")) {
      io.out(USAGE);
      return 0;
    }
    const holdout = parsed.flags.has("holdout");
    const setDir = join(root, "benchmarks", holdout ? "holdout" : "tasks");
    const available = taskIdsIn(setDir);
    let ids: string[];
    if (parsed.flags.has("all")) {
      if (one(parsed, "tasks") !== undefined) throw new UsageError("--all and --tasks exclude each other");
      ids = available;
    } else {
      ids = list(parsed, "tasks", []);
      if (one(parsed, "tasks") === undefined) throw new UsageError("--tasks or --all is required");
      for (const id of ids) if (!available.includes(id)) throw new UsageError(`'${id}' is not a task of ${holdout ? "the holdout set" : "benchmarks/tasks"}`);
    }
    if (ids.length === 0) throw new UsageError("no task to run");
    const sideNames = list(parsed, "sides", ["mtek", "baseline"]);
    const sides: Side[] = sideNames.map((name) => {
      try {
        return sideByName(name);
      } catch (error) {
        throw new UsageError((error as Error).message);
      }
    });
    const kinds = list(parsed, "trial-kinds", ["unconstrained"]) as TrialKind[];
    for (const kind of kinds) if (kind !== "unconstrained" && kind !== "constrained") throw new UsageError("--trial-kinds takes unconstrained and constrained");
    const trials = integer(parsed, "trials", 1) ?? 1;
    const firstTrial = integer(parsed, "first-trial", 0) ?? 0;
    const maxRepairs = integer(parsed, "max-repairs", 0);
    const maxTotalTokens = integer(parsed, "max-total-tokens", 1);
    const maxBytes = integer(parsed, "max-bytes", 1);
    const temperatureText = one(parsed, "temperature") ?? "0";
    const temperature = temperatureText === "default" ? null : Number(temperatureText);
    if (temperature !== null && (!Number.isFinite(temperature) || temperature < 0)) throw new UsageError("--temperature must be a number or 'default'");
    const order = one(parsed, "order") ?? "trial-major";
    if (order !== "trial-major" && order !== "task-major") throw new UsageError("--order must be trial-major or task-major");
    const feedback = one(parsed, "test-feedback") ?? "messages";
    if (feedback !== "messages" && feedback !== "status-only") throw new UsageError("--test-feedback must be messages or status-only");

    const runId = one(parsed, "run-id") ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new UsageError("--run-id may contain letters, digits, '.', '_' and '-'");
    const outRoot = resolve(one(parsed, "out") ?? join(root, "benchmarks", "results", "ai"));
    if (holdout && isInside(root, outRoot)) {
      throw new UsageError("a holdout run holds prompts and candidates: --out must be a directory outside the repository (decisions 0021 and 0085); `report` reduces it to ids and layer outcomes");
    }

    // The tasks are read before anything is paid for.
    const tasks: TaskSpec[] = ids.map((id) => loadTask(join(setDir, id)));
    for (const side of sides) {
      if (side.kind === "baseline") for (const task of tasks) if (!existsSync(task.baselineDir)) throw new UsageError(`task ${task.id} has no baseline project`);
    }

    let runner = deps.runner;
    if (runner === undefined) {
      const mtek = one(parsed, "mtek") ?? findMtek(env);
      if (mtek === null) {
        io.err("error: no mtek executable: build one (npm run build), or name it with --mtek PATH or MTEK_BIN\n");
        return 3;
      }
      runner = createMtekRunner(resolve(mtek));
    }
    let programRunner = deps.programRunner ?? createProgramRunner(process.execPath);
    const gpuLock = one(parsed, "gpu-lock");
    if (gpuLock !== undefined) {
      runner = lockedRunner(runner, resolve(gpuLock), (spec) => spec.args[0] === "test");
      programRunner = lockedRunner(programRunner, resolve(gpuLock), () => true);
    }

    // The model client, behind the spend guard.
    const clientName = one(parsed, "client");
    if (deps.client === undefined && clientName === undefined) throw new UsageError("--client is required");
    const promptCaching = !parsed.flags.has("no-prompt-caching");
    let client: ModelClient =
      deps.client ??
      (await createClient(clientName as string, {
        model: one(parsed, "model"),
        baseUrl: one(parsed, "base-url"),
        apiKeyEnv: one(parsed, "api-key-env"),
        transcript: one(parsed, "transcript"),
        promptCaching: clientName === "anthropic" ? promptCaching : undefined,
      }, { env: clientEnv(parsed, env), fetch: deps.fetch }));
    const capText = one(parsed, "spend-cap");
    if (client.provider !== "replay") {
      if (capText === undefined) throw new UsageError("--spend-cap USD is required: a run that calls a provider never starts without a money cap");
    }
    if (capText !== undefined) {
      const cap = Number(capText);
      if (!Number.isFinite(cap) || cap <= 0) throw new UsageError("--spend-cap must be a positive number of USD");
      guard = guardClient(client, {
        ledger: new SpendLedger(resolve(one(parsed, "spend-ledger") ?? DEFAULT_LEDGER_PATH)),
        capUsd: cap,
        runId,
        cachingRequested: client.promptCaching === true,
      });
      client = guard;
    }

    const clock = deps.clock ?? systemClock;
    const scratchRoot = one(parsed, "scratch") ?? mkdtempSync(join(tmpdir(), "mtek-ai-bench-"));
    const ownScratch = one(parsed, "scratch") === undefined;
    const runDir = join(outRoot, runId);
    mkdirSync(outRoot, { recursive: true });
    const recorder = new JsonlRecorder(runDir, runId);
    const grammar = deps.grammar ?? grammarCapability(parsed, env);
    const controller = new AbortController();
    const interrupt = (): void => controller.abort();
    process.once("SIGINT", interrupt);

    const settings = {
      date: clock.iso(),
      provider: client.provider,
      model: client.model,
      temperature,
      promptCaching: client.promptCaching === true,
      testFeedback: feedback,
      contextMaxBytes: maxBytes ?? DEFAULT_CONTEXT_MAX_BYTES,
      maxRepairs: maxRepairs ?? "per task",
      maxTotalTokens: maxTotalTokens ?? null,
      sides: sides.map((side) => side.label),
      documentation: Object.fromEntries(sides.map((side) => [side.label, side.documentationId()])),
      promptVersions: { mtek: PROMPT_VERSION, baseline: BASELINE_PROMPT_VERSION },
      trialKinds: kinds,
      trials,
      firstTrial,
      order,
      taskCount: tasks.length,
      holdout,
      spendCapUsd: guard === null ? null : guard.summary().capUsd,
      node: process.version,
      platform: process.platform,
    };
    recorder.record({ type: "run-start", harnessVersion: HARNESS_VERSION, startedAt: clock.iso(), settings });

    const loop = new RepairLoop({
      runner,
      programRunner,
      recorder,
      clock,
      scratchRoot,
      runDir,
      grammar,
      keepScratch: parsed.flags.has("keep-scratch"),
      signal: controller.signal,
    });
    let count = 0;
    let status: "complete" | "stopped-by-budget" | "aborted" = "complete";
    try {
      for (const planned of plan(tasks, sides, kinds, firstTrial, trials, order)) {
        if (controller.signal.aborted) break;
        const result = await loop.run({
          task: planned.task,
          side: planned.side,
          client,
          trialKind: planned.kind,
          trialIndex: planned.trial,
          temperature,
          ...(maxRepairs === undefined ? {} : { maxRepairs }),
          ...(maxTotalTokens === undefined ? {} : { maxTotalTokens }),
          ...(maxBytes === undefined ? {} : { contextMaxBytes: maxBytes }),
          testFeedback: feedback,
        });
        count += 1;
        if (result.outcome === "unfinished") status = "stopped-by-budget";
        const cost = result.costUsd === undefined || result.costUsd === null ? "" : ` cost=$${result.costUsd.toFixed(4)}`;
        io.out(`${result.trialId}: ${result.outcome}${result.reason === null ? "" : ` (${result.reason})`} calls=${String(result.calls)} repairs=${String(result.repairsUsed)}${cost}\n`);
      }
      if (controller.signal.aborted) status = "aborted";
    } catch (error) {
      status = "aborted";
      throw error;
    } finally {
      process.removeListener("SIGINT", interrupt);
      const summary = guard?.summary() ?? null;
      recorder.record({
        type: "run-end",
        endedAt: clock.iso(),
        status,
        trials: count,
        spend:
          summary === null
            ? null
            : {
                capUsd: summary.capUsd,
                ledgerTotalAtStartUsd: summary.ledgerTotalAtStartUsd,
                ledgerTotalEndUsd: summary.ledgerTotalNowUsd,
                runSpendUsd: Number(summary.runSpendUsd.toFixed(8)),
                calls: summary.calls,
                refusedCalls: summary.refusedCalls,
              },
      });
      if (ownScratch) rmSync(scratchRoot, { recursive: true, force: true });
    }
    const summary = guard?.summary() ?? null;
    io.out(`run ${runId}: ${status}, ${String(count)} trials${summary === null ? "" : `, spent $${summary.runSpendUsd.toFixed(4)} of the cap $${summary.capUsd.toFixed(2)} (ledger total $${summary.ledgerTotalNowUsd.toFixed(4)})`}\n`);
    io.out(`records: ${holdout ? "<outside the repository>" : join(runDir, "records.jsonl")}\n`);
    return status === "aborted" ? 3 : 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`error: ${error.message}\n${USAGE}`);
      return 2;
    }
    if (error instanceof Error) {
      io.err(`error: ${error.message}\n`);
      return 3;
    }
    throw error;
  }
}

/**
 * The environment the client is created with. `--api-key-file FILE` puts the key in that file into the variable named by
 * `--api-key-env` for the client only: it is never put in `process.env`, never on a command line, never recorded.
 */
function clientEnv(parsed: Parsed, env: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string | undefined>> {
  const file = one(parsed, "api-key-file");
  if (file === undefined) return env;
  const key = readFileSync(resolve(file), "utf8").trim();
  if (key === "") throw new UsageError("--api-key-file names an empty file");
  return { ...env, [one(parsed, "api-key-env") ?? "ANTHROPIC_API_KEY"]: key };
}

function grammarCapability(parsed: Parsed, env: Readonly<Record<string, string | undefined>>): GrammarCapability {
  const named = one(parsed, "grammar-adapter");
  const adapter = named === undefined ? findGrammarAdapter(env) : resolve(named);
  const mtek = one(parsed, "mtek") ?? findMtek(env);
  if (adapter === null || mtek === null) return defaultGrammarCapability;
  return commandGrammarCapability({ adapter, mtek: resolve(mtek) });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBenchmark(process.argv.slice(2));
}
