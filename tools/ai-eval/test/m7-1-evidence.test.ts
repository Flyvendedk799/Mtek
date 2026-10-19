// The stored M7.1 re-run of the Mtek conditions on the main set (benchmarks/results/ai/m7-1-rerun-main, decision 0124) is evidence:
// every record is valid, 57 of the 340 attempts were lost to the transport and are read as not judged, the report and the
// comparison are reproduced byte for byte from the records, and the figures the evidence page quotes are the figures of the
// records. The holdout re-run lives OUTSIDE the repository (its records hold prompts), so its summary is not regenerated here:
// only its form and its counts are checked.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildComparison } from "../src/compare.ts";
import { buildReport, extractTrials, parseRecords, selectSide, summarize, type TrialRow } from "../src/report.ts";
import { REPO_ROOT, validateRecord } from "./helpers.ts";

const RESULTS = join(REPO_ROOT, "benchmarks", "results", "ai");
const files = ["m7-1-rerun-main/records.jsonl", "m7-05-main/records.jsonl", "m7-05-guide/records.jsonl", "report-m7-1.md", "compare-m7-1.md", "holdout-summary-m7-1.jsonl"];
const present = files.every((file) => existsSync(join(RESULTS, ...file.split("/"))));

const text = (file: string): string => readFileSync(join(RESULTS, ...file.split("/")), "utf8").replaceAll("\r\n", "\n");
const records = (run: string) => parseRecords(text(`${run}/records.jsonl`));

describe.skipIf(!present)("the stored M7.1 re-run", () => {
  const rerun = records("m7-1-rerun-main");
  const { trials, runs } = extractTrials(rerun);
  const cell = (variant: string) => trials.filter((t) => t.variant === variant);

  it("has only valid records, and the run ends with a run-end record", () => {
    for (const record of rerun) expect(validateRecord(record), JSON.stringify(record).slice(0, 160)).toEqual([]);
    expect(runs.map((r) => [r.runId, r.status])).toEqual([["m7-1-rerun-main", "complete"]]);
  });

  it("is 340 attempts, of which 57 never reached the model and are read as not judged: 28 context only, 29 with the guide", () => {
    expect(trials).toHaveLength(340);
    expect(trials.every((t) => t.model === "claude-haiku-4-5-20251001" && t.side === "mtek")).toBe(true);
    const lost = trials.filter((t) => t.outcome === "error");
    expect(lost).toHaveLength(57);
    expect(lost.every((t) => t.reason === "transport-error" && t.legacyTransport === true)).toBe(true);
    expect(lost.every((t) => t.trial === 4 && t.calls === 1 && t.totalTokens === 0 && t.firstAttempt === null)).toBe(true);
    expect(cell("").filter((t) => t.outcome === "error")).toHaveLength(28);
    expect(cell("+guide").filter((t) => t.outcome === "error")).toHaveLength(29);
    // what the records themselves say: failures with the reason generation-error, one call each, one of two error texts
    const ends = rerun.filter((r) => r["type"] === "trial-end" && r["reason"] === "generation-error");
    expect(ends).toHaveLength(57);
    const errors = rerun.filter((r) => r["type"] === "model-call" && r["generation"] === "backend-error").map((r) => r["error"]);
    expect(errors.filter((e) => e === "Connection error.")).toHaveLength(52);
    expect(errors.filter((e) => e === "Request timed out.")).toHaveLength(5);
    // everything else ended by itself
    expect(trials.filter((t) => t.outcome !== "error").every((t) => t.outcome === "success" || t.outcome === "failure")).toBe(true);
  });

  it("has the completion rates and tokens per completed task the evidence page quotes", () => {
    const ctx = summarize(cell(""));
    const guide = summarize(cell("+guide"));
    expect(ctx).toMatchObject({ n: 170, success: 97, failure: 45, error: 28, valid: 142 });
    expect(guide).toMatchObject({ n: 170, success: 119, failure: 22, error: 29, valid: 141 });
    expect(Math.round(ctx.tokensPerCompleted ?? 0)).toBe(33_659);
    expect(Math.round(guide.tokensPerCompleted ?? 0)).toBe(31_166);
  });

  const before = [...records("m7-05-main"), ...records("m7-05-guide")];
  const comparison = buildComparison({ before, after: rerun });

  it("compares the matched cells as computed by hand: 86/142 -> 97/142 and 112/141 -> 119/141", () => {
    const [ctx, guide] = comparison.conditions;
    expect(ctx?.label).toBe("context only");
    expect(ctx).toMatchObject({ afterJudgedCells: 142, matchedCells: 142, unmatchedAfter: 0 });
    expect(ctx?.before.matched).toMatchObject({ n: 142, success: 86, valid: 142 });
    expect(ctx?.after.matched).toMatchObject({ n: 142, success: 97, valid: 142 });
    expect(Math.round(ctx?.before.matched.tokensPerCompleted ?? 0)).toBe(40_270);
    expect(Math.round(ctx?.after.matched.tokensPerCompleted ?? 0)).toBe(33_659);
    expect(guide?.label).toBe("context + guide");
    expect(guide?.before.matched).toMatchObject({ n: 141, success: 112, valid: 141 });
    expect(guide?.after.matched).toMatchObject({ n: 141, success: 119, valid: 141 });
    expect(Math.round(guide?.before.matched.tokensPerCompleted ?? 0)).toBe(33_000);
    expect(Math.round(guide?.after.matched.tokensPerCompleted ?? 0)).toBe(31_166);
  });

  it("states the cold-authoring figures: all attempts as published, 17/55 -> 25/44 and 30/55 -> 30/44", () => {
    const cold = (rows: readonly TrialRow[]) => summarize(rows.filter((t) => t.mode === "cold"));
    const [ctx, guide] = comparison.conditions;
    expect(cold(ctx?.before.rows ?? [])).toMatchObject({ n: 55, success: 17, valid: 55 });
    expect(cold(ctx?.after.rows ?? [])).toMatchObject({ n: 55, success: 25, valid: 44 });
    expect(Math.round(cold(ctx?.before.rows ?? []).tokensPerCompleted ?? 0)).toBe(112_711);
    expect(Math.round(cold(ctx?.after.rows ?? []).tokensPerCompleted ?? 0)).toBe(55_042);
    expect(cold(guide?.before.rows ?? [])).toMatchObject({ n: 55, success: 30, valid: 55 });
    expect(cold(guide?.after.rows ?? [])).toMatchObject({ n: 55, success: 30, valid: 44 });
    expect(Math.round(cold(guide?.before.rows ?? []).tokensPerCompleted ?? 0)).toBe(64_631);
    expect(Math.round(cold(guide?.after.rows ?? []).tokensPerCompleted ?? 0)).toBe(51_678);
  });

  it("reproduces report-m7-1.md from the records alone (the baseline attempts of m7-05-main only)", () => {
    const stored = text("report-m7-1.md");
    const lines = stored.split("\n");
    const title = (lines[0] ?? "").replace(/^# /, "");
    const note = lines[2] ?? "";
    const baseline = selectSide(records("m7-05-main"), "baseline");
    const generated = buildReport({ records: [...rerun, ...baseline], holdoutIds: new Set(), title, note }).markdown;
    expect(generated).toBe(stored);
    // the earlier run's Mtek cells are not in it: 170 + 170 Mtek attempts of the re-run and 170 baseline attempts of the earlier run
    const { trials: all } = extractTrials([...rerun, ...baseline]);
    expect(all).toHaveLength(510);
    expect(all.filter((t) => t.side === "baseline").every((t) => t.runId === "m7-05-main")).toBe(true);
    expect(all.filter((t) => t.side === "mtek").every((t) => t.runId === "m7-1-rerun-main")).toBe(true);
  });

  it("reproduces compare-m7-1.md from the records alone", () => {
    const stored = text("compare-m7-1.md");
    const lines = stored.split("\n");
    const title = (lines[0] ?? "").replace(/^# /, "");
    const note = lines[2] ?? "";
    expect(buildComparison({ before, after: rerun, title, note }).markdown).toBe(stored);
  });

  it("keeps the holdout summary to ids and outcomes: 80 attempts, none judged (63 not reached, 17 refused by the cap)", () => {
    const rows = text("holdout-summary-m7-1.jsonl")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(80);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["calls", "cachedInputTokens", "costUsd", "finalVerdict", "firstAttemptLayers", "inputTokens", "outcome", "outputTokens", "reason", "repairsUsed", "side", "taskId", "trialId", "trialKind"].sort());
    }
    expect(rows.filter((r) => r["outcome"] === "error" && r["reason"] === "transport-error")).toHaveLength(63);
    expect(rows.filter((r) => r["outcome"] === "unfinished" && r["reason"] === "budget-spend")).toHaveLength(17);
    expect(rows.some((r) => r["outcome"] === "success" || r["outcome"] === "failure")).toBe(false);
  });

  it("holds no credential in the stored documents and records", () => {
    for (const file of files) {
      const content = text(file);
      expect(new RegExp(`${"sk-"}${"ant-"}[A-Za-z0-9_-]{8,}`).test(content), file).toBe(false);
      expect(/x-api-key|authorization/i.test(content), file).toBe(false);
    }
  });
});
