// Retry runs (decision 0125): a retry run supplies attempts for the cells (task, condition, trial index) whose attempt in the other runs
// was NOT judged. In aggregates the retry attempt replaces the lost one; both stay listed; a retry attempt for a cell that was judged is
// refused. Synthetic runs; the stored M7.1 runs are checked in m7-1-evidence.test.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCompare } from "../src/compare-cli.ts";
import { buildComparison } from "../src/compare.ts";
import { runReport } from "../src/report-cli.ts";
import { buildReport, extractTrials, holdoutSummary } from "../src/report.ts";
import { tempDir } from "./helpers.ts";

type Rec = Record<string, unknown>;

interface Cell {
  side?: "mtek" | "baseline";
  guide?: boolean;
  task: string;
  trial: number;
  mode?: "cold" | "edit";
  outcome: "success" | "failure" | "error" | "unfinished";
  reason?: string;
  tokens: number;
  /** Recorded the old way: failure / generation-error with one call that is a connection error (the legacy rule reads it as not judged). */
  legacy?: boolean;
  model?: string;
  /** SHA-256 of the documentation text, when the test sets it. */
  ctx?: string;
}

/** A run whose condition ids do not depend on the run id (as in the real runs, where the id covers settings and the kind of documentation). */
function run(runId: string, cells: Cell[]): Rec[] {
  const out: Rec[] = [{ type: "run-start", runId, startedAt: "2026-10-19T10:00:00.000Z", settings: { provider: "anthropic", model: "m-1", temperature: 1, promptCaching: true, testFeedback: "messages" } }];
  for (const c of cells) {
    const side = c.side ?? "mtek";
    const model = c.model ?? "m-1";
    const documentation = side === "baseline" ? "baseline-reference:abc" : c.guide === true ? "context-export+docs/language-guide.md:def" : "context-export";
    const trialId = `${c.task}--${side}${c.guide === true ? "-guide" : ""}--${String(c.trial)}`;
    const conditionId = `${side}${c.guide === true ? "G" : ""}-${model}-id-padding`;
    out.push({ type: "trial-start", runId, trialId, taskId: c.task, category: c.task.startsWith("a") ? "interaction" : "maintenance", mode: c.mode ?? (c.task.startsWith("a") ? "cold" : "edit"), trialKind: "unconstrained", trial: c.trial, condition: { side, model, provider: "anthropic", documentation }, conditionId, contextBytes: 1000, ...(c.ctx === undefined ? {} : { contextSha256: c.ctx }) });
    const legacy = c.legacy === true;
    out.push(
      legacy
        ? { type: "model-call", runId, trialId, round: 0, generation: "backend-error", error: "Connection error.", finish: "error", response: { text: "" }, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, promptSections: null, request: null, durationMs: 1, costUsd: 0.03 }
        : { type: "model-call", runId, trialId, round: 0, generation: "completed", error: null, finish: "stop", response: { text: "x" }, usage: { inputTokens: c.tokens, outputTokens: 0, cachedInputTokens: 0 }, promptSections: null, request: null, durationMs: 1, costUsd: 0.01 },
    );
    out.push({
      type: "trial-end",
      runId,
      trialId,
      outcome: legacy ? "failure" : c.outcome,
      reason: legacy ? "generation-error" : (c.reason ?? (c.outcome === "success" ? null : c.outcome === "failure" ? "max-repairs" : c.outcome === "unfinished" ? "budget-spend" : "transport-error")),
      message: legacy ? "Connection error." : null,
      calls: 1,
      repairsUsed: 0,
      final: null,
      totals: { inputTokens: c.tokens, outputTokens: 0, cachedInputTokens: 0 },
      durationMs: 1000,
    });
  }
  out.push({ type: "run-end", runId, status: "complete", endedAt: "x", trials: cells.length, spend: null });
  return out;
}

const c = (task: string, trial: number, outcome: Cell["outcome"], tokens: number, extra: Partial<Cell> = {}): Cell => ({ task, trial, outcome, tokens, ...extra });

// the main run: 3 of 6 attempts of the context-only condition are lost (one legacy, one error, one unfinished), the guide condition is complete
const MAIN = run("main", [
  c("a1", 0, "success", 100),
  c("a1", 1, "failure", 0, { legacy: true }),
  c("b1", 0, "failure", 300),
  c("b1", 1, "error", 0),
  c("a2", 0, "unfinished", 0),
  c("a2", 1, "success", 50),
  c("a1", 0, "success", 90, { guide: true }),
  c("b1", 0, "success", 40, { guide: true }),
]);
const BASELINE = run("base", [c("a1", 0, "success", 10, { side: "baseline" }), c("b1", 0, "success", 10, { side: "baseline" }), c("a2", 0, "success", 10, { side: "baseline" })]);
const RETRY = run("retry", [c("a1", 1, "success", 120), c("b1", 1, "failure", 200), c("a2", 0, "success", 70)]);

describe("extracting trials with a retry run", () => {
  const x = extractTrials(MAIN, new Set(), RETRY);

  it("puts the retry attempt in the place of the not-judged one and keeps both listed, marked", () => {
    expect(extractTrials(MAIN).trials).toHaveLength(8);
    expect(x.trials).toHaveLength(8);
    expect(x.superseded).toHaveLength(3);
    expect(x.listing).toHaveLength(11);
    expect(x.superseded.map((t) => `${t.taskId}/${String(t.trial)}/${t.outcome}/${t.reason ?? ""}/${t.supersededBy ?? ""}`)).toEqual(["a1/1/error/transport-error/retry", "b1/1/error/transport-error/retry", "a2/0/unfinished/budget-spend/retry"]);
    expect(x.trials.filter((t) => t.retryOf !== undefined).map((t) => `${t.taskId}/${String(t.trial)}/${t.outcome}/${t.retryOf ?? ""}/${t.runId}`)).toEqual(["a1/1/success/main/retry", "b1/1/failure/main/retry", "a2/0/success/main/retry"]);
    // nothing that counts is superseded, and every cell occurs once
    expect(x.trials.some((t) => t.supersededBy !== undefined)).toBe(false);
    expect(new Set(x.trials.map((t) => `${t.side}${t.variant}${t.taskId}${String(t.trial)}`)).size).toBe(8);
    // the legacy reading applies to the lost attempt, and the retry run is marked in the run list
    expect(x.superseded[0]?.legacyTransport).toBe(true);
    expect(x.runs.map((r) => [r.runId, r.retry === true])).toEqual([["main", false], ["retry", true]]);
  });

  it("leaves everything as it was without a retry run", () => {
    const plain = extractTrials(MAIN);
    expect(plain.superseded).toEqual([]);
    expect(plain.listing).toBe(plain.trials);
    expect(plain.trials.some((t) => t.retryOf !== undefined || t.supersededBy !== undefined)).toBe(false);
  });

  it("refuses a retry attempt for a cell that WAS judged", () => {
    const bad = run("retry2", [c("a1", 0, "success", 5)]);
    expect(() => extractTrials(MAIN, new Set(), bad)).toThrow(/WAS judged \(success\)/);
    const failed = run("retry3", [c("b1", 0, "success", 5)]);
    expect(() => extractTrials(MAIN, new Set(), failed)).toThrow(/WAS judged \(failure\)/);
  });

  it("refuses a retry attempt for a cell nothing occupies, two attempts for one cell, a repeated run id and another condition", () => {
    expect(() => extractTrials(MAIN, new Set(), run("r", [c("zz", 0, "success", 5)]))).toThrow(/no attempt of the other runs occupies this cell/);
    expect(() => extractTrials(MAIN, new Set(), [...run("r", [c("a1", 1, "success", 5)]), ...run("r2", [c("a1", 1, "success", 5)])])).toThrow(/more than one attempt for this cell/);
    expect(() => extractTrials(MAIN, new Set(), run("main", [c("a1", 1, "success", 5)]))).toThrow(/same id as a run it is a retry of/);
    expect(() => extractTrials(MAIN, new Set(), run("r", [c("a1", 1, "success", 5, { model: "m-2" })]))).toThrow(/m-2/);
    // the guide condition is another cell: a retry for the context-only cell a1/1 does not touch it, and a guide retry needs a guide cell
    expect(() => extractTrials(MAIN, new Set(), run("r", [c("a1", 1, "success", 5, { guide: true })]))).toThrow(/no attempt of the other runs occupies this cell/);
  });

  it("refuses a retry attempt that was given other documentation text than the attempt it replaces, and accepts the same text", () => {
    const lost = run("first", [c("a1", 1, "error", 0, { ctx: "aaaa1111aaaa1111" })]);
    expect(() => extractTrials(lost, new Set(), run("again", [c("a1", 1, "success", 5, { ctx: "bbbb2222bbbb2222" })]))).toThrow(/documentation given to the model differs/);
    expect(extractTrials(lost, new Set(), run("again", [c("a1", 1, "success", 5, { ctx: "aaaa1111aaaa1111" })])).superseded).toHaveLength(1);
    // a record without a context hash (nothing to compare) is not refused
    expect(extractTrials(lost, new Set(), run("again", [c("a1", 1, "success", 5)])).superseded).toHaveLength(1);
  });

  it("accepts a retry attempt that is itself not judged (the cell stays not judged, with the later attempt)", () => {
    const still = extractTrials(MAIN, new Set(), run("r", [c("b1", 1, "error", 0)]));
    expect(still.trials.filter((t) => t.outcome === "error" || t.outcome === "unfinished")).toHaveLength(3);
    expect(still.superseded).toHaveLength(1);
  });
});

describe("the report with a retry run", () => {
  const records = [...MAIN, ...BASELINE];
  const without = buildReport({ records });
  const withRetry = buildReport({ records, retryRecords: RETRY });

  it("counts the retry attempt in the aggregates and the lost attempt in none", () => {
    const ctx = without.trials.filter((t) => t.side === "mtek" && t.variant === "");
    expect(ctx).toHaveLength(6);
    expect(withRetry.trials.filter((t) => t.side === "mtek" && t.variant === "")).toHaveLength(6);
    expect(withRetry.trials.filter((t) => t.outcome === "error" || t.outcome === "unfinished")).toHaveLength(0);
    expect(withRetry.comparisons.find((x) => x.kind === "unconstrained" && x.scope === "all")?.comparison.mtek).toMatchObject({ n: 6, success: 4, failure: 2, valid: 6 });
    expect(without.comparisons.find((x) => x.kind === "unconstrained" && x.scope === "all")?.comparison.mtek).toMatchObject({ n: 6, success: 2, failure: 1, valid: 3 });
    expect(withRetry.comparisons.find((x) => x.kind === "unconstrained" && x.scope === "all")?.comparison.provisional).toBe(true); // only 1 trial per task: still stated
  });

  it("lists both attempts, marked, and says what was superseded", () => {
    const md = withRetry.markdown;
    expect(md).toContain("| retry (retry run) |");
    expect(md).toContain("| main: a1--mtek--1 |");
    expect(md).toContain("transport-error; superseded by retry run retry |");
    expect(md).toContain("retry of the attempt in run main");
    expect(md).toContain("3 attempts that were not judged are superseded by the attempt of the same cell");
    expect(md).toContain("None: every attempt that counts ended in success or failure");
    expect(md).toContain("1 of the superseded attempts are read by a legacy rule (decision 0124)");
    expect(md).not.toContain("ended with the reason `transport-error`");
    expect(withRetry.listing).toHaveLength(14);
    expect(withRetry.superseded).toHaveLength(3);
  });

  it("is the report as before when no retry run is given", () => {
    expect(buildReport({ records, retryRecords: [] }).markdown).toBe(without.markdown);
    expect(without.markdown).not.toContain("superseded");
    expect(without.markdown).not.toContain("retry run");
  });

  it("writes the lost attempts into the holdout summary with their link, and the retry attempts with theirs", () => {
    const { listing } = extractTrials(MAIN, new Set(["a1", "a2"]), RETRY);
    const rows = holdoutSummary(listing);
    expect(rows.filter((r) => r["supersededBy"] === "retry")).toHaveLength(2);
    expect(rows.filter((r) => r["retryOf"] === "main")).toHaveLength(2);
    expect(rows[0]).toMatchObject({ runId: "main", variant: "", trial: 0, taskId: "a1" });
  });
});

describe("the comparison with a retry run", () => {
  const before = [...run("before", [c("a1", 0, "success", 100), c("a1", 1, "failure", 300), c("b1", 0, "success", 50), c("b1", 1, "failure", 150), c("a2", 0, "failure", 80), c("a2", 1, "success", 60)]), ...BASELINE];
  const after = MAIN.filter((r) => typeof r["trialId"] !== "string" || !r["trialId"].includes("guide"));
  const x = buildComparison({ before, after, afterRetry: RETRY, title: "T" });
  const ctx = x.conditions[0];

  it("replaces the lost cells in the after side, so the matched cells are all the cells", () => {
    expect(x.conditions.map((k) => k.label)).toEqual(["context only"]);
    expect(ctx?.after.all).toMatchObject({ n: 6, success: 4, failure: 2, error: 0, unfinished: 0, valid: 6 });
    expect(ctx).toMatchObject({ afterJudgedCells: 6, matchedCells: 6, unmatchedAfter: 0 });
    expect(ctx?.replaced).toHaveLength(3);
    expect(ctx?.retried).toHaveLength(3);
  });

  it("without the retry run the same cells are lost, as before", () => {
    const plain = buildComparison({ before, after }).conditions[0];
    expect(plain?.after.all).toMatchObject({ n: 6, success: 2, error: 2, unfinished: 1, valid: 3 });
    expect(plain).toMatchObject({ afterJudgedCells: 3, matchedCells: 3 });
  });

  it("states the retries and that nothing is left not judged, and gives the verdict against the baseline", () => {
    expect(x.markdown).toContain("## Retries of the lost attempts");
    expect(x.markdown).toContain("| context only | retry | 3 | 2 error/transport-error, 1 unfinished/budget-spend | 0, 1 | 3 | 2 | 1 | 0 | 66.7 % |");
    expect(x.markdown).toContain("Every lost cell has a judged retry attempt.");
    expect(x.markdown).toContain("No attempt that counts after was lost");
    expect(x.markdown).toContain("| retry (retry run) |");
    expect(x.markdown).toContain("Every cell of every condition is judged in both runs");
    expect(x.markdown).toContain("## The verdict against the baseline (rule of decision 0108)");
    expect(ctx?.h4).not.toBeNull();
  });

  it("refuses a retry run that would replace a judged attempt", () => {
    expect(() => buildComparison({ before, after, afterRetry: run("r", [c("a1", 0, "success", 1)]) })).toThrow(/WAS judged/);
  });
});

describe("report-cli and compare-cli with retry runs", () => {
  function write(dir: string, name: string, records: Rec[]): string {
    const path = join(dir, name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "records.jsonl"), `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
    return path;
  }
  const sink = { out: () => undefined, err: () => undefined };

  it("report-cli --retry-run is repeatable and gives the report of buildReport", () => {
    const dir = tempDir();
    const m = write(dir, "main", MAIN);
    const r1 = write(dir, "r1", run("retry", [c("a1", 1, "success", 120), c("b1", 1, "failure", 200)]));
    const r2 = write(dir, "r2", run("retry-b", [c("a2", 0, "success", 70)]));
    const out = join(dir, "report.md");
    const lines: string[] = [];
    expect(runReport(["--run", m, "--retry-run", r1, "--retry-run", r2, "--out", out], { out: (t) => lines.push(t), err: (t) => lines.push(t) }, dir)).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("(retry run)");
    expect(text).toContain("3 attempts that were not judged are superseded");
    expect(text).toContain("`retry`, `retry-b`");
  });

  it("report-cli refuses a retry run for a judged cell with exit 3 and writes nothing", () => {
    const dir = tempDir();
    const m = write(dir, "main", MAIN);
    const bad = write(dir, "bad", run("retry", [c("a1", 0, "success", 5)]));
    const errors: string[] = [];
    const out = join(dir, "report.md");
    expect(runReport(["--run", m, "--retry-run", bad, "--out", out], { out: () => undefined, err: (t) => errors.push(t) }, dir)).toBe(3);
    expect(errors.join("")).toContain("WAS judged");
    expect(() => readFileSync(out, "utf8")).toThrow();
  });

  it("compare-cli --after-retry gives the comparison of buildComparison and refuses a judged cell", () => {
    const dir = tempDir();
    const before = write(dir, "before", run("before", [c("a1", 0, "success", 100), c("a1", 1, "failure", 300), c("b1", 0, "success", 50), c("b1", 1, "failure", 150), c("a2", 0, "failure", 80), c("a2", 1, "success", 60)]));
    const ctxOnly = MAIN.filter((r) => typeof r["trialId"] !== "string" || !r["trialId"].includes("guide"));
    const after = write(dir, "after", ctxOnly);
    const retry = write(dir, "retry", RETRY);
    const out = join(dir, "compare.md");
    expect(runCompare(["--before", before, "--after", after, "--after-retry", retry, "--out", out, "--title", "T"], sink, dir)).toBe(0);
    const expected = buildComparison({ before: run("before", [c("a1", 0, "success", 100), c("a1", 1, "failure", 300), c("b1", 0, "success", 50), c("b1", 1, "failure", 150), c("a2", 0, "failure", 80), c("a2", 1, "success", 60)]), after: ctxOnly, afterRetry: RETRY, title: "T" }).markdown;
    expect(readFileSync(out, "utf8")).toBe(expected);
    const bad = write(dir, "bad", run("bad", [c("a1", 0, "success", 5)]));
    const errors: string[] = [];
    expect(runCompare(["--before", before, "--after", after, "--after-retry", bad, "--out", join(dir, "x.md")], { out: () => undefined, err: (t) => errors.push(t) }, dir)).toBe(3);
    expect(errors.join("")).toContain("WAS judged");
  });
});
