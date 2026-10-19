// The command line of the harness.
//
//   node tools/ai-eval/src/cli.ts run --task DIR --client NAME [client options] [options]
//   node tools/ai-eval/src/cli.ts validate --task DIR [--project DIR]
//
// `run` runs trials of a task under one condition and writes `<out>/<run-id>/records.jsonl` plus the
// final candidate of every trial. `validate` runs the Validator once on a project (the task's starter
// unless `--project` names another, e.g. `benchmarks/tasks/X/reference/mtek`) with the task's fixtures:
// no model involved, the layers of the outcome taxonomy printed as JSON.
//
// Exit codes: 0 run completed / validation verdict `pass`; 1 verdict `fail`; 2 usage error; 3 the tool
// chain failed (`mtek` missing, crash) or the run was refused; 4 verdict `not-run` (nothing failed
// but something could not run here, e.g. no GPU: never a success).
//
// API keys are read from the environment when a client is created (`ANTHROPIC_API_KEY` by default,
// `--api-key-env NAME` to name another variable); they are never recorded.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "./adapters/registry.ts";
import type { AdapterOptions } from "./adapter-options.ts";
import { systemClock, type Clock } from "./clock.ts";
import { createMtekRunner, findMtek, repoRoot, type CommandRunner } from "./commands.ts";
import { commandGrammarCapability, findGrammarAdapter } from "./command-grammar.ts";
import { defaultGrammarCapability, type GrammarCapability, type TrialKind } from "./grammar.ts";
import type { FetchLike, ModelClient } from "./model-client.ts";
import { JsonlRecorder } from "./recorder.ts";
import { RepairLoop } from "./repair-loop.ts";
import { sideByName } from "./side.ts";
import { loadTask } from "./task.ts";
import { Validator } from "./validator.ts";
import { Workspace } from "./workspace.ts";

export const HARNESS_VERSION = "0.1.0-dev";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliDeps {
  io?: CliIo;
  env?: Readonly<Record<string, string | undefined>>;
  runner?: CommandRunner;
  clock?: Clock;
  fetch?: FetchLike;
  grammar?: GrammarCapability;
  /** Replaces the client of `--client` (tests). */
  client?: ModelClient;
}

interface Parsed {
  command: string;
  flags: Map<string, string[]>;
}

const VALUE_FLAGS = new Set([
  "task", "client", "model", "base-url", "api-key-env", "transcript", "trial-kind", "trials", "temperature", "stop", "seed",
  "max-repairs", "max-total-tokens", "max-bytes", "test-feedback", "run-id", "out", "mtek", "scratch", "project", "first-trial",
  "grammar-adapter", "side",
]);
const SWITCH_FLAGS = new Set(["keep-scratch", "accept-grammar", "help"]);

class UsageError extends Error {}

function parse(argv: readonly string[]): Parsed {
  const [command, ...rest] = argv;
  if (command === undefined) throw new UsageError("missing command (run | validate)");
  const flags = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument '${arg}'`);
    const name = arg.slice(2);
    if (SWITCH_FLAGS.has(name)) {
      flags.set(name, [...(flags.get(name) ?? []), "true"]);
    } else if (VALUE_FLAGS.has(name)) {
      const value = rest[i + 1];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      flags.set(name, [...(flags.get(name) ?? []), value]);
      i += 1;
    } else {
      throw new UsageError(`unknown option --${name}`);
    }
  }
  return { command, flags };
}

function one(parsed: Parsed, name: string): string | undefined {
  const values = parsed.flags.get(name);
  if (values !== undefined && values.length > 1) throw new UsageError(`--${name} was given more than once`);
  return values?.[0];
}

function integer(parsed: Parsed, name: string, min: number): number | undefined {
  const text = one(parsed, name);
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text) || Number(text) < min) throw new UsageError(`--${name} must be an integer of at least ${String(min)}`);
  return Number(text);
}

const USAGE = `usage:
  ai-eval run --task DIR --client replay|anthropic|openai-compatible|llama-cpp [--model M] [--base-url U]
              [--api-key-env VAR] [--transcript FILE] [--trial-kind unconstrained|constrained] [--trials N]
              [--temperature N|default] [--stop S]... [--seed N] [--max-repairs N] [--max-total-tokens N]
              [--max-bytes N] [--test-feedback messages|status-only] [--run-id ID] [--out DIR]
              [--mtek PATH] [--grammar-adapter PATH] [--scratch DIR] [--keep-scratch] [--side mtek|baseline]
  ai-eval validate --task DIR [--project DIR] [--mtek PATH]
`;

export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const io: CliIo = deps.io ?? { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) };
  const env = deps.env ?? process.env;
  try {
    const parsed = parse(argv);
    if (parsed.flags.has("help")) {
      io.out(USAGE);
      return 0;
    }
    if (parsed.command !== "run" && parsed.command !== "validate") throw new UsageError(`unknown command '${parsed.command}'`);
    const taskDir = one(parsed, "task");
    if (taskDir === undefined) throw new UsageError("--task is required");
    const task = loadTask(taskDir);

    let runner = deps.runner;
    if (runner === undefined) {
      const mtek = one(parsed, "mtek") ?? findMtek(env);
      if (mtek === null) {
        io.err("error: no mtek executable: build one (npm run build), or name it with --mtek PATH or MTEK_BIN\n");
        return 3;
      }
      runner = createMtekRunner(resolve(mtek));
    }
    const clock = deps.clock ?? systemClock;
    const scratchRoot = one(parsed, "scratch") ?? mkdtempSync(join(tmpdir(), "mtek-ai-eval-"));
    const ownScratch = one(parsed, "scratch") === undefined;
    try {
      return parsed.command === "validate"
        ? await validateCommand(parsed, task, runner, clock, scratchRoot, io)
        : await runCommand(parsed, task, runner, clock, scratchRoot, deps, env, io);
    } finally {
      if (ownScratch) rmSync(scratchRoot, { recursive: true, force: true });
    }
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

async function validateCommand(
  parsed: Parsed,
  task: ReturnType<typeof loadTask>,
  runner: CommandRunner,
  clock: Clock,
  scratchRoot: string,
  io: CliIo,
): Promise<number> {
  const project = one(parsed, "project");
  const workspace = Workspace.create(task, scratchRoot, "validate", project === undefined ? {} : { from: resolve(project) });
  try {
    const result = await new Validator(runner, { clock }).validate({
      projectDir: workspace.projectDir,
      outDir: join(workspace.root, "out"),
      requiredSymbols: task.requiredSymbols,
    });
    io.out(`${JSON.stringify({ task: task.id, project: project === undefined ? "starter" : project, ...result }, null, 2)}\n`);
    return { pass: 0, fail: 1, "not-run": 4, error: 3 }[result.verdict];
  } finally {
    workspace.dispose();
  }
}

/**
 * The capability a constrained trial asks: the real check of M6-06 when the `grammar-adapter` binary is named
 * (`--grammar-adapter PATH`, `MTEK_GRAMMAR_ADAPTER`) or built in this repository, else the honest default that says
 * "grammar-constrained mode unavailable". The real check still fails with its own reason when the pinned backend
 * or model is not installed; nothing here ever runs a constrained trial unconstrained.
 */
function grammarCapabilityFor(parsed: Parsed, env: Readonly<Record<string, string | undefined>>): GrammarCapability {
  const named = one(parsed, "grammar-adapter");
  const adapter = named === undefined ? findGrammarAdapter(env) : resolve(named);
  const mtek = one(parsed, "mtek") ?? findMtek(env);
  if (adapter === null || mtek === null) return defaultGrammarCapability;
  return commandGrammarCapability({ adapter, mtek: resolve(mtek) });
}

async function runCommand(
  parsed: Parsed,
  task: ReturnType<typeof loadTask>,
  runner: CommandRunner,
  clock: Clock,
  scratchRoot: string,
  deps: CliDeps,
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
): Promise<number> {
  const clientName = one(parsed, "client");
  if (deps.client === undefined && clientName === undefined) throw new UsageError("--client is required");
  const trialKind = (one(parsed, "trial-kind") ?? "unconstrained") as TrialKind;
  if (trialKind !== "unconstrained" && trialKind !== "constrained") throw new UsageError("--trial-kind must be unconstrained or constrained");
  const trials = integer(parsed, "trials", 1) ?? 1;
  const temperatureText = one(parsed, "temperature") ?? "0";
  const temperature = temperatureText === "default" ? null : Number(temperatureText);
  if (temperature !== null && (!Number.isFinite(temperature) || temperature < 0)) throw new UsageError("--temperature must be a number or 'default'");
  const feedback = one(parsed, "test-feedback") ?? "messages";
  if (feedback !== "messages" && feedback !== "status-only") throw new UsageError("--test-feedback must be messages or status-only");
  const seed = integer(parsed, "seed", 0);
  const maxRepairs = integer(parsed, "max-repairs", 0);
  const maxTotalTokens = integer(parsed, "max-total-tokens", 1);
  const maxBytes = integer(parsed, "max-bytes", 1);
  const firstTrial = integer(parsed, "first-trial", 0) ?? 0;

  const adapterOptions: AdapterOptions = {
    model: one(parsed, "model"),
    baseUrl: one(parsed, "base-url"),
    apiKeyEnv: one(parsed, "api-key-env"),
    transcript: one(parsed, "transcript"),
    acceptGrammar: parsed.flags.has("accept-grammar"),
  };
  const runId = one(parsed, "run-id") ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new UsageError("--run-id may contain letters, digits, '.', '_' and '-'");
  const client = deps.client ?? (await createClient(clientName as string, adapterOptions, { env, fetch: deps.fetch }));
  const outRoot = resolve(one(parsed, "out") ?? join(repoRoot(), "benchmarks", "results"));
  const runDir = join(outRoot, runId);
  mkdirSync(outRoot, { recursive: true });
  const recorder = new JsonlRecorder(runDir, runId);
  recorder.record({ type: "run-start", harnessVersion: HARNESS_VERSION, startedAt: clock.iso() });

  const loop = new RepairLoop({
    runner,
    recorder,
    clock,
    scratchRoot,
    runDir,
    grammar: deps.grammar ?? grammarCapabilityFor(parsed, env),
    keepScratch: parsed.flags.has("keep-scratch"),
  });
  const stop = parsed.flags.get("stop");
  let side;
  try {
    side = sideByName(one(parsed, "side") ?? "mtek");
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  for (let i = 0; i < trials; i += 1) {
    const result = await loop.run({
      task,
      side,
      client,
      trialKind,
      trialIndex: firstTrial + i,
      temperature,
      ...(stop === undefined ? {} : { stop }),
      ...(seed === undefined ? {} : { seed }),
      ...(maxRepairs === undefined ? {} : { maxRepairs }),
      ...(maxTotalTokens === undefined ? {} : { maxTotalTokens }),
      ...(maxBytes === undefined ? {} : { contextMaxBytes: maxBytes }),
      testFeedback: feedback,
    });
    io.out(`${result.trialId}: ${result.outcome}${result.reason === null ? "" : ` (${result.reason})`}${result.message === null ? "" : ` - ${result.message}`}\n`);
  }
  io.out(`records: ${join(runDir, "records.jsonl")}\n`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
