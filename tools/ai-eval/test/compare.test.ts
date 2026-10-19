// The before/after comparison (decision 0124): numbers from stored records only, per condition, for all attempts as published and for
// the matched cells (judged in both runs), with the baseline row copied from the runs before and what was lost stated plainly.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCompare } from "../src/compare-cli.ts";
import { buildComparison, conditionLabel } from "../src/compare.ts";
import { tempDir } from "./helpers.ts";

type Rec = Record<string, unknown>;

interface Cell {
  side?: "mtek" | "baseline";
  guide?: boolean;
  task: string;
  trial: number;
  mode: "cold" | "edit";
  category?: string;
  outcome: "success" | "failure" | "error" | "unfinished";
  reason?: string | null;
  tokens: number;
  /** An attempt recorded the old way: failure / generation-error with one call that is a connection error. */
  legacy?: boolean;
}

function run(runId: string, cells: Cell[]): Rec[] {
  const out: Rec[] = [{ type: "run-start", runId, startedAt: `2026-10-19T0${String(runId.length % 9)}:00:00.000Z`, settings: { provider: "anthropic", model: "m-1", temperature: 1, promptCaching: true, testFeedback: "messages" } }];
  for (const c of cells) {
    const side = c.side ?? "mtek";
    const documentation = side === "baseline" ? "baseline-reference:abc" : c.guide === true ? "context-export+docs/language-guide.md:def" : "context-export";
    const trialId = `${c.task}--${side}${c.guide === true ? "-guide" : ""}--${String(c.trial)}`;
    const conditionId = `${side}${c.guide === true ? "G" : ""}-${runId}-id-padding`;
    out.push({ type: "trial-start", runId, trialId, taskId: c.task, category: c.category ?? "interaction", mode: c.mode, trialKind: "unconstrained", trial: c.trial, condition: { side, model: "m-1", provider: "anthropic", documentation }, conditionId, contextBytes: 1000 });
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
      reason: legacy ? "generation-error" : (c.reason ?? (c.outcome === "success" ? null : c.outcome === "failure" ? "max-repairs" : "tool-error")),
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

// Four cells of each condition: a (cold) and b (edit), trials 0 and 1.
const cells = (guide: boolean, spec: [string, number, "cold" | "edit", Cell["outcome"], number, boolean?][]): Cell[] =>
  spec.map(([task, trial, mode, outcome, tokens, legacy]) => ({ task, trial, mode, outcome, tokens, guide, ...(legacy === true ? { legacy: true } : {}) }));

const BEFORE_CTX = cells(false, [["a", 0, "cold", "success", 100], ["a", 1, "cold", "failure", 300], ["b", 0, "edit", "success", 50], ["b", 1, "edit", "failure", 150]]);
const AFTER_CTX = cells(false, [["a", 0, "cold", "success", 80], ["a", 1, "cold", "failure", 0, true], ["b", 0, "edit", "failure", 100], ["b", 1, "edit", "success", 60]]);
const BEFORE_GUIDE = cells(true, [["a", 0, "cold", "success", 90], ["a", 1, "cold", "success", 90], ["b", 0, "edit", "success", 40], ["b", 1, "edit", "failure", 200]]);
const AFTER_GUIDE = cells(true, [["a", 0, "cold", "success", 70], ["a", 1, "cold", "success", 70], ["b", 0, "edit", "success", 40], ["b", 1, "edit", "success", 40]]);
const BASELINE: Cell[] = ["a", "b"].flatMap((task) => [0, 1].map((trial) => ({ side: "baseline" as const, task, trial, mode: task === "a" ? ("cold" as const) : ("edit" as const), outcome: "success" as const, tokens: 10 })));

const before = [...run("before-main", [...BEFORE_CTX, ...BASELINE]), ...run("before-guide", BEFORE_GUIDE)];
const after = run("after-main", [...AFTER_CTX, ...AFTER_GUIDE]);

describe("the comparison of two sets of runs", () => {
  const c = buildComparison({ before, after, title: "T", note: "N" });
  const ctx = c.conditions.find((x) => x.label === "context only");
  const guide = c.conditions.find((x) => x.label === "context + guide");

  it("names the conditions and finds the cells judged in both runs", () => {
    expect(c.conditions.map((x) => x.label)).toEqual(["context only", "context + guide"]);
    expect(conditionLabel("unconstrained", "")).toBe("context only");
    expect(conditionLabel("unconstrained", "+guide")).toBe("context + guide");
    expect(conditionLabel("constrained", "+guide")).toBe("constrained context + guide");
    expect(ctx).toMatchObject({ afterJudgedCells: 3, matchedCells: 3, unmatchedAfter: 0 });
    expect(guide).toMatchObject({ afterJudgedCells: 4, matchedCells: 4 });
  });

  it("counts all attempts as published: the lost attempt is an attempt, in neither the rate nor the completed count", () => {
    expect(ctx?.before.all).toMatchObject({ n: 4, success: 2, failure: 2, valid: 4 });
    expect(ctx?.before.all.tokensPerCompleted).toBe((100 + 300 + 50 + 150) / 2);
    expect(ctx?.after.all).toMatchObject({ n: 4, success: 2, failure: 1, error: 1, valid: 3 });
    expect(ctx?.after.all.completionRate).toBeCloseTo(2 / 3, 12);
    expect(ctx?.after.all.tokensPerCompleted).toBe((80 + 0 + 100 + 60) / 2);
  });

  it("compares the matched cells only, so both sides cover the same cells", () => {
    // matched: a0, b0, b1 (a1 is not judged after)
    expect(ctx?.before.matched).toMatchObject({ n: 3, success: 2, valid: 3 });
    expect(ctx?.before.matched.tokensPerCompleted).toBe((100 + 50 + 150) / 2);
    expect(ctx?.after.matched).toMatchObject({ n: 3, success: 2, valid: 3 });
    expect(ctx?.after.matched.tokensPerCompleted).toBe((80 + 100 + 60) / 2);
    expect(guide?.before.matched).toMatchObject({ n: 4, success: 3 });
    expect(guide?.after.matched).toMatchObject({ n: 4, success: 4 });
  });

  it("copies the baseline row from the runs before and says it was not re-run", () => {
    expect(c.baseline).toMatchObject({ n: 4, success: 4 });
    expect(c.markdown).toContain("| baseline (three.js), copied from the runs before | before | 4 | 4 | 0 | 0 | 100.0 % | 10 |");
    expect(c.markdown).toContain("The baseline was not re-run");
  });

  it("states what was lost, by condition, and why", () => {
    expect(c.markdown).toContain("| context only | 4 | 0 (none) | 4 | 1 (1 error/transport-error) |");
    expect(c.markdown).toContain("| context + guide | 4 | 0 (none) | 4 | 0 (none) |");
    expect(c.markdown).toContain("Of 8 attempts of the runs after, 1 (12.5 %) were not judged");
    expect(c.markdown).toContain("`transport-error`");
    expect(c.markdown).toContain("Trial index of the attempts not judged after (index: attempts): 1: 1.");
  });

  it("prints the figures of the tables the way the report does", () => {
    expect(c.markdown).toContain("| context only | before | 4 | 2 | 2 | 0 | 50.0 % | 300 |");
    expect(c.markdown).toContain("| context only | after | 4 | 2 | 1 | 1 | 66.7 % | 120 |");
    expect(c.markdown).toContain("| context only: all | 3 | 2 / 3 | 66.7 % | 150 | 3 | 2 / 3 | 66.7 % | 120 | 0.0 points | -20.0 % |");
    expect(c.markdown).toContain("| context only: mode cold | 1 | 1 / 1 | 100.0 % | 100 | 1 | 1 / 1 | 100.0 % | 80 | 0.0 points | -20.0 % |");
    expect(c.markdown).toContain("| context + guide: all | 4 | 3 / 4 | 75.0 % | 140 | 4 | 4 / 4 | 100.0 % | 55 | 25.0 points | -60.7 % |");
    expect(c.markdown.startsWith("# T\n\nN\n\n")).toBe(true);
  });

  it("is a function of the records: the same records give the same text", () => {
    expect(buildComparison({ before, after, title: "T", note: "N" }).markdown).toBe(c.markdown);
  });

  it("has no lost-attempt text when nothing was lost, and an empty baseline when the runs before hold none", () => {
    const clean = buildComparison({ before: run("b", BEFORE_GUIDE), after: run("a", AFTER_GUIDE) });
    expect(clean.markdown).toContain("No attempt of the runs after was lost");
    expect(clean.baseline).toBeNull();
    expect(clean.markdown).toContain("hold no baseline attempt");
  });

  it("keeps a cell lost in the runs before out of the matched comparison, and says so", () => {
    const lostBefore = run("b", [{ task: "a", trial: 0, mode: "cold", outcome: "unfinished", tokens: 0, reason: "budget-spend" }, { task: "a", trial: 1, mode: "cold", outcome: "success", tokens: 10 }]);
    const afterAll = run("a", [{ task: "a", trial: 0, mode: "cold", outcome: "success", tokens: 5 }, { task: "a", trial: 1, mode: "cold", outcome: "success", tokens: 6 }]);
    const x = buildComparison({ before: lostBefore, after: afterAll }).conditions[0];
    expect(x).toMatchObject({ afterJudgedCells: 2, matchedCells: 1, unmatchedAfter: 1 });
    expect(x?.before.matched).toMatchObject({ n: 1, success: 1 });
    expect(x?.after.matched).toMatchObject({ n: 1, success: 1 });
  });

  it("refuses runs on one side that repeat a condition (their cells would be counted twice)", () => {
    expect(() => buildComparison({ before: [...run("b1", BEFORE_CTX), ...run("b2", BEFORE_CTX)], after })).toThrow(/occurs more than once/);
  });

  it("leaves holdout attempts out", () => {
    const x = buildComparison({ before, after, holdoutIds: new Set(["a"]) });
    expect(x.conditions[0]?.before.all.n).toBe(2); // only task b is left
  });
});

describe("compare-cli", () => {
  function write(dir: string, name: string, records: Rec[]): string {
    const path = join(dir, name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "records.jsonl"), `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
    return path;
  }

  it("writes the comparison of the given runs (several before runs, comma separated)", () => {
    const dir = tempDir();
    const b1 = write(dir, "b1", run("before-main", [...BEFORE_CTX, ...BASELINE]));
    const b2 = write(dir, "b2", run("before-guide", BEFORE_GUIDE));
    const a = write(dir, "a", run("after-main", [...AFTER_CTX, ...AFTER_GUIDE]));
    const out = join(dir, "compare.md");
    const lines: string[] = [];
    const code = runCompare(["--before", `${b1},${b2}`, "--after", a, "--out", out, "--title", "T", "--note", "N"], { out: (t) => lines.push(t), err: (t) => lines.push(t) }, dir);
    expect(code).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(buildComparison({ before, after, title: "T", note: "N" }).markdown);
  });

  it("refuses incomplete or unknown options, and reports a comparison it cannot make", () => {
    const dir = tempDir();
    const sink = { out: () => undefined, err: () => undefined };
    expect(runCompare([], sink, dir)).toBe(2);
    expect(runCompare(["--before", "x"], sink, dir)).toBe(2);
    expect(runCompare(["--bogus", "x"], sink, dir)).toBe(2);
    const a = write(dir, "a", run("after-main", AFTER_CTX));
    const b = write(dir, "b", [...run("b1", BEFORE_CTX), ...run("b2", BEFORE_CTX)]);
    expect(runCompare(["--before", b, "--after", a, "--out", join(dir, "o.md")], sink, dir)).toBe(3);
  });
});
