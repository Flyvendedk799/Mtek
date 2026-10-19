// The benchmark runner (decision 0108): tasks x sides x kinds x trials of one model, one run directory, a spend cap that is
// mandatory for a provider, a holdout that never lands in the repository, and a key that is in no record. The model is the
// replay client or a scripted one; `mtek` and the baseline's runner are the scripted stand-ins.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayClient, type ReplayEntry } from "../src/adapters/replay.ts";
import { runBenchmark, taskIdsIn, isInside } from "../src/benchmark-run.ts";
import { steppingClock } from "../src/clock.ts";
import type { FetchLike, GenerateResult, ModelClient } from "../src/model-client.ts";
import { parseRecords, extractTrials, summarize } from "../src/report.ts";
import { FakeBaseline } from "./baseline-helpers.ts";
import { FIXTURE_TASKS, fakeMtek, tempDir, validateRecord } from "./helpers.ts";

const MTEK_FIX = "<<<FILE src/main.mtek\n<<<SEARCH\n        speed = 1;\n===\n        speed = -speed;\n>>>REPLACE\n";
const BASELINE_FIX = "<<<FILE src/main.ts\n<<<SEARCH\n  let speed = 1;\n===\n  let speed = -1;\n>>>REPLACE\n";

/** A repository stand-in: `benchmarks/tasks/demo-01` and, when asked, a holdout task. */
function fakeRoot(withHoldout = false): string {
  const root = tempDir("ai-bench-root-");
  mkdirSync(join(root, "benchmarks", "tasks"), { recursive: true });
  cpSync(join(FIXTURE_TASKS, "demo-01"), join(root, "benchmarks", "tasks", "demo-01"), { recursive: true });
  if (withHoldout) {
    mkdirSync(join(root, "benchmarks", "holdout"), { recursive: true });
    cpSync(join(FIXTURE_TASKS, "demo-01"), join(root, "benchmarks", "holdout", "hidden-01"), { recursive: true });
  }
  return root;
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
}

function deps(root: string, client: ModelClient, extra: { stdio?: ReturnType<typeof io> } = {}) {
  const stdio = extra.stdio ?? io();
  return {
    stdio,
    deps: { io: stdio.io, root, client, runner: fakeMtek(), programRunner: new FakeBaseline(), clock: steppingClock(), env: {} },
  };
}

/** A client that tells the mtek and baseline prompts apart by their system prompt. */
function sideAwareReplay(): ModelClient {
  const inner = createReplayClient([], { model: "claude-haiku-4-5-20251001" });
  return {
    provider: "replay",
    model: "claude-haiku-4-5-20251001",
    capabilities: inner.capabilities,
    generate: (request) => {
      const text = request.system.includes("three.js") ? BASELINE_FIX : MTEK_FIX;
      return Promise.resolve({ text, finish: "stop", usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 } });
    },
  };
}

function records(runDir: string): Record<string, unknown>[] {
  return parseRecords(readFileSync(join(runDir, "records.jsonl"), "utf8"));
}

describe("a benchmark run", () => {
  it("runs both sides for every trial, trial index outermost, and writes one valid records.jsonl with the settings and the end", async () => {
    const root = fakeRoot();
    const out = join(tempDir("ai-bench-out-"), "ai");
    const { deps: d, stdio } = deps(root, sideAwareReplay());
    const code = await runBenchmark(["--tasks", "demo-01", "--trials", "2", "--client", "replay", "--run-id", "run-x", "--out", out], d);
    expect(code).toBe(0);
    const recs = records(join(out, "run-x"));
    for (const record of recs) expect(validateRecord(record), JSON.stringify(record).slice(0, 200)).toEqual([]);
    expect(recs[0]).toMatchObject({ type: "run-start", settings: { provider: "replay", model: "claude-haiku-4-5-20251001", temperature: 0, trials: 2, sides: ["mtek", "baseline"], holdout: false, spendCapUsd: null } });
    expect(recs[recs.length - 1]).toMatchObject({ type: "run-end", status: "complete", trials: 4, spend: null });
    const ends = recs.filter((r) => r["type"] === "trial-end").map((r) => `${String(r["trialId"])} ${String(r["outcome"])}`);
    expect(ends).toEqual([
      "demo-01--unconstrained--00 success",
      "demo-01--baseline-unconstrained--00 success",
      "demo-01--unconstrained--01 success",
      "demo-01--baseline-unconstrained--01 success",
    ]);
    expect(stdio.out.join("")).toContain("run run-x: complete, 4 trials");
    // the final candidate of every trial is preserved
    expect(existsSync(join(out, "run-x", "trials", "demo-01--baseline-unconstrained--00", "project", "src", "main.ts"))).toBe(true);
  });

  it("can run one side, and says so in the settings and the conditions", async () => {
    const root = fakeRoot();
    const out = tempDir("ai-bench-out-");
    const { deps: d } = deps(root, sideAwareReplay());
    expect(await runBenchmark(["--tasks", "demo-01", "--sides", "baseline", "--client", "replay", "--run-id", "b", "--out", out], d)).toBe(0);
    const { trials } = extractTrials(records(join(out, "b")));
    expect(trials.map((t) => t.side)).toEqual(["baseline"]);
  });

  it("selects tasks with --all and rejects an unknown id before anything runs", async () => {
    const root = fakeRoot();
    const out = tempDir("ai-bench-out-");
    const a = deps(root, sideAwareReplay());
    expect(await runBenchmark(["--all", "--sides", "mtek", "--client", "replay", "--run-id", "all", "--out", out], a.deps)).toBe(0);
    const b = deps(root, sideAwareReplay());
    expect(await runBenchmark(["--tasks", "nope-99", "--client", "replay", "--run-id", "x", "--out", out], b.deps)).toBe(2);
    expect(b.stdio.err.join("")).toContain("'nope-99' is not a task");
    expect(existsSync(join(out, "x"))).toBe(false);
  });

  it("never overwrites a run", async () => {
    const root = fakeRoot();
    const out = tempDir("ai-bench-out-");
    const args = ["--tasks", "demo-01", "--sides", "mtek", "--client", "replay", "--run-id", "once", "--out", out];
    expect(await runBenchmark(args, deps(root, sideAwareReplay()).deps)).toBe(0);
    const again = deps(root, sideAwareReplay());
    expect(await runBenchmark(args, again.deps)).toBe(3);
    expect(again.stdio.err.join("")).toMatch(/EEXIST|already exists/);
  });
});

describe("the money", () => {
  const priced = (results: () => GenerateResult): ModelClient => ({ provider: "anthropic", model: "claude-haiku-4-5-20251001", capabilities: { grammar: false, seed: false }, generate: () => Promise.resolve(results()) });
  const answer = (text: string, input: number, output: number): GenerateResult => ({ text, finish: "stop", usage: { inputTokens: input, outputTokens: output, cachedInputTokens: 0 } });

  it("refuses to start a provider without a spend cap", async () => {
    const root = fakeRoot();
    const out = tempDir("ai-bench-out-");
    const { deps: d, stdio } = deps(root, priced(() => answer(MTEK_FIX, 1, 1)));
    expect(await runBenchmark(["--tasks", "demo-01", "--client", "anthropic", "--run-id", "x", "--out", out], d)).toBe(2);
    expect(stdio.err.join("")).toContain("--spend-cap USD is required");
    expect(existsSync(join(out, "x"))).toBe(false);
  });

  it("refuses a cap that is not a positive number", async () => {
    const root = fakeRoot();
    for (const cap of ["0", "-1", "abc"]) {
      const { deps: d } = deps(root, priced(() => answer(MTEK_FIX, 1, 1)));
      expect(await runBenchmark(["--tasks", "demo-01", "--client", "anthropic", "--spend-cap", cap, "--spend-ledger", join(tempDir(), "l.json"), "--run-id", "x", "--out", tempDir()], d)).toBe(2);
    }
  });

  it("records the cap, the cost of every call and the spend of the run; the ledger keeps the total", async () => {
    const root = fakeRoot();
    const out = tempDir("ai-bench-out-");
    const ledger = join(tempDir(), "ledger.json");
    const { deps: d } = deps(root, priced(() => answer(MTEK_FIX, 2000, 200)));
    expect(await runBenchmark(["--tasks", "demo-01", "--sides", "mtek", "--client", "anthropic", "--spend-cap", "1", "--spend-ledger", ledger, "--run-id", "m", "--out", out], d)).toBe(0);
    const recs = records(join(out, "m"));
    const cost = (2000 * 1 + 200 * 5) / 1_000_000;
    expect(recs.find((r) => r["type"] === "model-call")?.["costUsd"]).toBeCloseTo(cost, 10);
    expect(recs[0]).toMatchObject({ settings: { spendCapUsd: 1 } });
    const end = recs[recs.length - 1] as { spend: { capUsd: number; runSpendUsd: number; calls: number; refusedCalls: number; ledgerTotalEndUsd: number } };
    expect(end.spend).toMatchObject({ capUsd: 1, calls: 1, refusedCalls: 0 });
    expect(end.spend.runSpendUsd).toBeCloseTo(cost, 8);
    expect((JSON.parse(readFileSync(ledger, "utf8")) as { totalUsd: number }).totalUsd).toBeCloseTo(cost, 10);
  });

  it("records every planned trial when the cap is reached: the one in progress and all that follow end unfinished-by-budget, none is dropped", async () => {
    const root = fakeRoot();
    const out = tempDir("ai-bench-out-");
    const ledger = join(tempDir(), "ledger.json");
    // Two trials of two sides = 4 planned. A wrong first reply makes every trial want a second call; the cap lets about two calls through.
    const { deps: d } = deps(root, priced(() => answer("no edit blocks here", 3000, 300)));
    const code = await runBenchmark(["--tasks", "demo-01", "--trials", "2", "--client", "anthropic", "--spend-cap", "0.05", "--spend-ledger", ledger, "--run-id", "c", "--out", out], d);
    expect(code).toBe(0);
    const recs = records(join(out, "c"));
    const { trials } = extractTrials(recs);
    expect(trials).toHaveLength(4);
    expect(trials.every((t) => t.outcome === "unfinished" || t.outcome === "failure")).toBe(true);
    expect(trials.some((t) => t.outcome === "unfinished")).toBe(true);
    expect(trials.filter((t) => t.outcome === "unfinished").every((t) => t.reason === "budget-spend")).toBe(true);
    expect(trials.every((t) => t.outcome !== "success")).toBe(true);
    const end = recs[recs.length - 1] as { status: string; trials: number; spend: { runSpendUsd: number; refusedCalls: number } };
    expect(end).toMatchObject({ status: "stopped-by-budget", trials: 4 });
    expect(end.spend.refusedCalls).toBeGreaterThan(0);
    expect(end.spend.runSpendUsd).toBeLessThanOrEqual(0.05);
    expect((JSON.parse(readFileSync(ledger, "utf8")) as { totalUsd: number }).totalUsd).toBeLessThanOrEqual(0.05);
    for (const record of recs) expect(validateRecord(record), JSON.stringify(record).slice(0, 200)).toEqual([]);
  });

  it("carries the ledger of an earlier run into the cap of the next", async () => {
    const root = fakeRoot();
    const ledger = join(tempDir(), "ledger.json");
    const first = deps(root, priced(() => answer(MTEK_FIX, 2000, 200)));
    expect(await runBenchmark(["--tasks", "demo-01", "--sides", "mtek", "--client", "anthropic", "--spend-cap", "0.03", "--spend-ledger", ledger, "--run-id", "one", "--out", tempDir()], first.deps)).toBe(0);
    const out = tempDir();
    const second = deps(root, priced(() => answer(MTEK_FIX, 2000, 200)));
    // The first run spent 0.003; the cap of 0.0035 leaves less than the worst case of one call.
    expect(await runBenchmark(["--tasks", "demo-01", "--sides", "mtek", "--client", "anthropic", "--spend-cap", "0.0035", "--spend-ledger", ledger, "--run-id", "two", "--out", out], second.deps)).toBe(0);
    const { trials } = extractTrials(records(join(out, "two")));
    expect(trials[0]).toMatchObject({ outcome: "unfinished", reason: "budget-spend", calls: 0 });
  });

  it("puts the key in no record, no output line and no error, whether the call works or fails", async () => {
    const root = fakeRoot();
    const keyFile = join(tempDir(), "key.txt");
    const KEY = ["sk", "ant", "api03", "REALLYSECRETVALUE0123456789"].join("-");
    writeFileSync(keyFile, `${KEY}\n`);
    let sawKey = "";
    const fetch: FetchLike = (_input, init) => {
      sawKey = new Headers(init?.headers).get("x-api-key") ?? "";
      const body = { id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: MTEK_FIX }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    };
    const out = tempDir("ai-bench-out-");
    const stdio = io();
    const code = await runBenchmark(
      ["--tasks", "demo-01", "--sides", "mtek", "--client", "anthropic", "--model", "claude-haiku-4-5-20251001", "--api-key-file", keyFile, "--spend-cap", "1", "--spend-ledger", join(tempDir(), "l.json"), "--run-id", "k", "--out", out],
      { io: stdio.io, root, runner: fakeMtek(), programRunner: new FakeBaseline(), clock: steppingClock(), env: {}, fetch },
    );
    expect(code).toBe(0);
    expect(sawKey).toBe(KEY); // the client used it
    const everything = [readFileSync(join(out, "k", "records.jsonl"), "utf8"), stdio.out.join(""), stdio.err.join("")].join("\n");
    expect(everything).not.toContain("REALLYSECRETVALUE");
    expect(everything).not.toContain(KEY);
    // and the client got the caching flag, recorded in the condition
    expect(extractTrials(records(join(out, "k"))).trials[0]?.model).toBe("claude-haiku-4-5-20251001");
    const start = records(join(out, "k")).find((r) => r["type"] === "trial-start");
    expect((start?.["condition"] as Record<string, unknown>)["promptCaching"]).toBe(true);
  });

  it("turns off prompt caching with --no-prompt-caching and records it", async () => {
    const root = fakeRoot();
    const out = tempDir();
    const fetch: FetchLike = () =>
      Promise.resolve(new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: MTEK_FIX }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } }));
    const keyFile = join(tempDir(), "key.txt");
    writeFileSync(keyFile, "k\n");
    const code = await runBenchmark(
      ["--tasks", "demo-01", "--sides", "mtek", "--client", "anthropic", "--model", "claude-haiku-4-5-20251001", "--api-key-file", keyFile, "--no-prompt-caching", "--spend-cap", "1", "--spend-ledger", join(tempDir(), "l.json"), "--run-id", "n", "--out", out],
      { io: io().io, root, runner: fakeMtek(), programRunner: new FakeBaseline(), clock: steppingClock(), env: {}, fetch },
    );
    expect(code).toBe(0);
    const start = records(join(out, "n")).find((r) => r["type"] === "trial-start");
    expect((start?.["condition"] as Record<string, unknown>)["promptCaching"]).toBe(false);
  });
});

describe("the holdout", () => {
  it("is run only into a directory outside the repository, because a record holds prompts and candidates", async () => {
    const root = fakeRoot(true);
    const inside = join(root, "benchmarks", "results", "ai");
    const refused = deps(root, sideAwareReplay());
    expect(await runBenchmark(["--holdout", "--tasks", "hidden-01", "--client", "replay", "--run-id", "h", "--out", inside], refused.deps)).toBe(2);
    expect(refused.stdio.err.join("")).toContain("outside the repository");
    expect(existsSync(inside)).toBe(false);
    const outside = tempDir("ai-bench-private-");
    const allowed = deps(root, sideAwareReplay());
    expect(await runBenchmark(["--holdout", "--tasks", "hidden-01", "--sides", "mtek", "--client", "replay", "--run-id", "h", "--out", outside], allowed.deps)).toBe(0);
    expect(existsSync(join(outside, "h", "records.jsonl"))).toBe(true);
    expect(allowed.stdio.out.join("")).toContain("<outside the repository>");
  });

  it("takes its tasks from the holdout directory only, and the main set from tasks only", async () => {
    const root = fakeRoot(true);
    const a = deps(root, sideAwareReplay());
    expect(await runBenchmark(["--holdout", "--tasks", "demo-01", "--client", "replay", "--run-id", "h", "--out", tempDir()], a.deps)).toBe(2);
    const b = deps(root, sideAwareReplay());
    expect(await runBenchmark(["--tasks", "hidden-01", "--client", "replay", "--run-id", "h", "--out", tempDir()], b.deps)).toBe(2);
    expect(taskIdsIn(join(root, "benchmarks", "holdout"))).toEqual(["hidden-01"]);
  });

  it("knows what is inside a directory", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/a/b", "/a")).toBe(false);
  });
});

describe("usage", () => {
  it("needs a client, tasks and a valid run id, and refuses an unknown option", async () => {
    const root = fakeRoot();
    const run = async (args: string[]) => {
      const { deps: d, stdio } = deps(root, sideAwareReplay());
      return { code: await runBenchmark(args, d), err: stdio.err.join("") };
    };
    expect((await run(["--bogus"])).code).toBe(2);
    expect((await run(["--client", "replay"])).err).toContain("--tasks or --all is required");
    expect((await run(["--tasks", "demo-01", "--run-id", "../x", "--out", tempDir()])).err).toContain("--run-id");
    expect((await run(["--tasks", "demo-01", "--sides", "both", "--out", tempDir()])).err).toContain("unknown side");
    expect((await run(["--tasks", "demo-01", "--trials", "0", "--out", tempDir()])).err).toContain("--trials");
  });
});

describe("a replayed transcript", () => {
  it("works as the model of a run (a recorded run is itself a transcript)", async () => {
    const root = fakeRoot();
    const entries: ReplayEntry[] = [{ text: MTEK_FIX, finish: "stop", usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } }];
    const file = join(tempDir(), "t.jsonl");
    writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
    const { deps: d } = deps(root, createReplayClient(entries, { model: "claude-haiku-4-5-20251001" }));
    expect(await runBenchmark(["--tasks", "demo-01", "--sides", "mtek", "--client", "replay", "--transcript", file, "--run-id", "r", "--out", tempDir()], { ...d, client: undefined as never })).toBe(0);
  });
});

describe("a run that cannot reach the model (decision 0124)", () => {
  const unreachable = (): ModelClient => ({
    provider: "replay",
    model: "claude-haiku-4-5-20251001",
    capabilities: { grammar: false, seed: false },
    generate: (): Promise<GenerateResult> => Promise.resolve({ text: "", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, finish: "error", error: "Connection error.", transport: "connection" }),
  });

  it("retries, ends every attempt error / transport-error, says so, and is not a failure of the model or of the run", async () => {
    const root = fakeRoot();
    const out = join(tempDir("ai-bench-out-"), "ai");
    const waited: number[] = [];
    const { deps: d, stdio } = deps(root, unreachable());
    const code = await runBenchmark(["--tasks", "demo-01", "--sides", "mtek", "--trials", "2", "--client", "replay", "--run-id", "down", "--out", out], {
      ...d,
      retryDelaysMs: [3, 4],
      sleep: (ms) => {
        waited.push(ms);
        return Promise.resolve();
      },
    });
    expect(code).toBe(0);
    expect(waited).toEqual([3, 4, 3, 4]);
    const recs = records(join(out, "down"));
    for (const record of recs) expect(validateRecord(record), JSON.stringify(record).slice(0, 200)).toEqual([]);
    const ends = recs.filter((r) => r["type"] === "trial-end");
    expect(ends.map((r) => [r["outcome"], r["reason"], r["calls"]])).toEqual([
      ["error", "transport-error", 3],
      ["error", "transport-error", 3],
    ]);
    expect(recs[recs.length - 1]).toMatchObject({ type: "run-end", status: "complete", trials: 2 });
    expect(stdio.out.join("")).toContain("warning: 2 of 2 attempts got no response from the model after the retries (transport-error)");
    const { trials } = extractTrials(recs);
    expect(summarize(trials)).toMatchObject({ n: 2, error: 2, valid: 0, completionRate: null, tokensPerCompleted: null });
  });
});
