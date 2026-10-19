// The stored M7.1 re-run of the Mtek conditions on the main set (benchmarks/results/ai/m7-1-rerun-main) and its two retry runs
// (m7-1-retry-ctx, m7-1-retry-guide; decisions 0124 and 0125) are evidence: every record is valid, 57 of the 340 attempts of the first
// run were lost to the transport and are read as not judged, the retry runs replace exactly those 57 cells, and after them every
// attempt that counts ended in success or failure. The report, the comparison and the machine-readable baseline are reproduced byte for
// byte from the stored records and the holdout summary files, and the figures the evidence page quotes are the figures of the records.
// The holdout runs live OUTSIDE the repository (their records hold prompts): only their summaries are in it, and only their form and
// numbers are checked here.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/canonical.ts";
import { buildComparison } from "../src/compare.ts";
import { runCompare } from "../src/compare-cli.ts";
import { activeRows, compareHoldout, parseHoldoutSummary } from "../src/holdout-compare.ts";
import { extractTrials, parseRecords, selectSide, summarize, type TrialRow } from "../src/report.ts";
import { runReport } from "../src/report-cli.ts";
import { REPO_ROOT, tempDir, validateRecord } from "./helpers.ts";

const RESULTS = join(REPO_ROOT, "benchmarks", "results", "ai");
const files = [
  "m7-1-rerun-main/records.jsonl",
  "m7-1-retry-ctx/records.jsonl",
  "m7-1-retry-guide/records.jsonl",
  "m7-05-main/records.jsonl",
  "m7-05-guide/records.jsonl",
  "report-m7-1.md",
  "compare-m7-1.md",
  "holdout-summary.jsonl",
  "holdout-summary-m7-1.jsonl",
];
const present = files.every((file) => existsSync(join(RESULTS, ...file.split("/")))) && existsSync(join(REPO_ROOT, "evidence", "M7", "ai-baseline.json"));

const text = (file: string): string => readFileSync(join(RESULTS, ...file.split("/")), "utf8").replaceAll("\r\n", "\n");
const records = (run: string) => parseRecords(text(`${run}/records.jsonl`));
const dir = (run: string): string => join(RESULTS, run);

describe.skipIf(!present)("the stored M7.1 re-run and its retry runs", () => {
  const rerun = records("m7-1-rerun-main");
  const retry = [...records("m7-1-retry-ctx"), ...records("m7-1-retry-guide")];
  const first = extractTrials(rerun);
  const merged = extractTrials(rerun, new Set(), retry);
  const cell = (rows: readonly TrialRow[], variant: string) => rows.filter((t) => t.variant === variant);

  it("has only valid records, and every run ends with a run-end record", () => {
    for (const record of [...rerun, ...retry]) expect(validateRecord(record), JSON.stringify(record).slice(0, 160)).toEqual([]);
    expect(first.runs.map((r) => [r.runId, r.status])).toEqual([["m7-1-rerun-main", "complete"]]);
    expect(merged.runs.map((r) => [r.runId, r.status, r.retry === true])).toEqual([
      ["m7-1-rerun-main", "complete", false],
      ["m7-1-retry-ctx", "complete", true],
      ["m7-1-retry-guide", "complete", true],
    ]);
  });

  it("is 340 attempts, of which 57 never reached the model and are read as not judged: 28 context only, 29 with the guide", () => {
    expect(first.trials).toHaveLength(340);
    expect(first.trials.every((t) => t.model === "claude-haiku-4-5-20251001" && t.side === "mtek")).toBe(true);
    const lost = first.trials.filter((t) => t.outcome === "error");
    expect(lost).toHaveLength(57);
    expect(lost.every((t) => t.reason === "transport-error" && t.legacyTransport === true)).toBe(true);
    expect(lost.every((t) => t.trial === 4 && t.calls === 1 && t.totalTokens === 0 && t.firstAttempt === null)).toBe(true);
    expect(cell(lost, "")).toHaveLength(28);
    expect(cell(lost, "+guide")).toHaveLength(29);
    // what the records themselves say: failures with the reason generation-error, one call each, one of two error texts
    expect(rerun.filter((r) => r["type"] === "trial-end" && r["reason"] === "generation-error")).toHaveLength(57);
    const errors = rerun.filter((r) => r["type"] === "model-call" && r["generation"] === "backend-error").map((r) => r["error"]);
    expect(errors.filter((e) => e === "Connection error.")).toHaveLength(52);
    expect(errors.filter((e) => e === "Request timed out.")).toHaveLength(5);
    expect(first.trials.filter((t) => t.outcome !== "error").every((t) => t.outcome === "success" || t.outcome === "failure")).toBe(true);
  });

  it("has retry runs of 28 and 29 attempts, all trial index 4, all judged, each in the cell of exactly one lost attempt", () => {
    const { trials } = extractTrials(retry);
    expect(trials).toHaveLength(57);
    expect(trials.every((t) => t.trial === 4 && (t.outcome === "success" || t.outcome === "failure") && t.reason !== "transport-error")).toBe(true);
    expect(trials.filter((t) => t.runId === "m7-1-retry-ctx" && t.variant === "")).toHaveLength(28);
    expect(trials.filter((t) => t.runId === "m7-1-retry-guide" && t.variant === "+guide")).toHaveLength(29);
    expect(merged.superseded).toHaveLength(57);
    expect(merged.superseded.every((t) => t.runId === "m7-1-rerun-main" && t.outcome === "error" && t.legacyTransport === true)).toBe(true);
    expect(merged.superseded.filter((t) => t.supersededBy === "m7-1-retry-ctx")).toHaveLength(28);
    expect(merged.superseded.filter((t) => t.supersededBy === "m7-1-retry-guide")).toHaveLength(29);
    expect(merged.trials.filter((t) => t.retryOf === "m7-1-rerun-main")).toHaveLength(57);
    // the retry attempts were made with the same model, settings and condition as the attempts they replace
    expect(trials.every((t) => t.model === "claude-haiku-4-5-20251001" && t.provider === "anthropic")).toBe(true);
    // ... and with the same documentation text: the hash of the context given to the model is the same in the lost and the retry attempt
    const originals = new Map(merged.superseded.map((t) => [`${t.side}${t.variant}${t.taskId}${String(t.trial)}`, t]));
    for (const t of merged.trials.filter((x) => x.retryOf !== undefined)) {
      const lostAttempt = originals.get(`${t.side}${t.variant}${t.taskId}${String(t.trial)}`);
      expect(lostAttempt?.contextSha256, t.trialId).toMatch(/^[0-9a-f]{64}$/);
      expect(t.contextSha256, t.trialId).toBe(lostAttempt?.contextSha256);
    }
    // the harness behind the retry runs did not hit the outage again: no call without a response
    expect(retry.some((r) => r["type"] === "model-call" && r["generation"] === "backend-error")).toBe(false);
  });

  it("is 170 attempts per condition after the retries, every one judged", () => {
    expect(merged.trials).toHaveLength(340);
    expect(merged.listing).toHaveLength(397);
    for (const variant of ["", "+guide"]) {
      const rows = cell(merged.trials, variant);
      expect(rows).toHaveLength(170);
      expect(rows.every((t) => t.outcome === "success" || t.outcome === "failure")).toBe(true);
      expect(new Set(rows.map((t) => `${t.taskId}/${String(t.trial)}`)).size).toBe(170);
    }
    expect(summarize(cell(merged.trials, ""))).toMatchObject({ n: 170, success: 116, failure: 54, error: 0, valid: 170 });
    expect(summarize(cell(merged.trials, "+guide"))).toMatchObject({ n: 170, success: 145, failure: 25, error: 0, valid: 170 });
    expect(Math.round(summarize(cell(merged.trials, "")).tokensPerCompleted ?? 0)).toBe(33_648);
    expect(Math.round(summarize(cell(merged.trials, "+guide")).tokensPerCompleted ?? 0)).toBe(29_872);
  });

  it("refuses to use another run of the same cells as a retry: a retry attempt for a judged cell is an error", () => {
    expect(() => extractTrials(rerun, new Set(), selectSide(records("m7-05-guide"), "mtek"))).toThrow(/WAS judged/);
    expect(() => extractTrials(rerun, new Set(), rerun)).toThrow(/same id as a run it is a retry of/);
  });

  const before = [...records("m7-05-main"), ...records("m7-05-guide")];
  const comparison = buildComparison({ before, after: rerun, afterRetry: retry });

  it("compares all 170 cells of each condition, matched by construction: 103/170 -> 116/170 and 134/170 -> 145/170", () => {
    const [ctx, guide] = comparison.conditions;
    expect(ctx?.label).toBe("context only");
    expect(ctx).toMatchObject({ afterJudgedCells: 170, matchedCells: 170, unmatchedAfter: 0 });
    expect(ctx?.before.matched).toMatchObject({ n: 170, success: 103, valid: 170 });
    expect(ctx?.after.matched).toMatchObject({ n: 170, success: 116, valid: 170 });
    expect(Math.round(ctx?.before.matched.tokensPerCompleted ?? 0)).toBe(40_535);
    expect(Math.round(ctx?.after.matched.tokensPerCompleted ?? 0)).toBe(33_648);
    expect(guide?.label).toBe("context + guide");
    expect(guide).toMatchObject({ afterJudgedCells: 170, matchedCells: 170, unmatchedAfter: 0 });
    expect(guide?.before.matched).toMatchObject({ n: 170, success: 134, valid: 170 });
    expect(guide?.after.matched).toMatchObject({ n: 170, success: 145, valid: 170 });
    expect(Math.round(guide?.before.matched.tokensPerCompleted ?? 0)).toBe(32_842);
    expect(Math.round(guide?.after.matched.tokensPerCompleted ?? 0)).toBe(29_872);
    expect(comparison.baseline).toMatchObject({ n: 170, success: 156, failure: 14 });
    expect(Math.round(comparison.baseline?.tokensPerCompleted ?? 0)).toBe(9_388);
  });

  it("states the per-mode figures: cold 17/55 -> 32/55 and 30/55 -> 39/55, edit 86/115 -> 84/115 and 104/115 -> 106/115", () => {
    const mode = (rows: readonly TrialRow[], m: string) => summarize(rows.filter((t) => t.mode === m));
    const [ctx, guide] = comparison.conditions;
    expect(mode(ctx?.before.rows ?? [], "cold")).toMatchObject({ n: 55, success: 17 });
    expect(mode(ctx?.after.rows ?? [], "cold")).toMatchObject({ n: 55, success: 32 });
    expect(mode(ctx?.before.rows ?? [], "edit")).toMatchObject({ n: 115, success: 86 });
    expect(mode(ctx?.after.rows ?? [], "edit")).toMatchObject({ n: 115, success: 84 });
    expect(mode(guide?.before.rows ?? [], "cold")).toMatchObject({ n: 55, success: 30 });
    expect(mode(guide?.after.rows ?? [], "cold")).toMatchObject({ n: 55, success: 39 });
    expect(mode(guide?.before.rows ?? [], "edit")).toMatchObject({ n: 115, success: 104 });
    expect(mode(guide?.after.rows ?? [], "edit")).toMatchObject({ n: 115, success: 106 });
  });

  it("gives both conditions the verdict WORSE against the baseline, and no verdict is provisional by the rule", () => {
    const [ctx, guide] = comparison.conditions.map((c) => c.h4);
    expect(ctx).toMatchObject({ verdict: "worse", successAxis: "lower", tokensAxis: "more", provisional: false, provisionalReasons: [], targetMet: false, minTrialsPerTaskSide: 5 });
    expect(guide).toMatchObject({ verdict: "worse", successAxis: "matched", tokensAxis: "more", provisional: false, provisionalReasons: [], targetMet: false, minTrialsPerTaskSide: 5 });
    expect(ctx?.interval.point).toBeCloseTo(3.584, 3);
    expect(guide?.interval.point).toBeCloseTo(3.182, 3);
    expect(ctx?.mtek.excludedShare).toBe(0);
    expect(guide?.mtek.unknownUsage).toBe(0);
  });

  it("reproduces report-m7-1.md from the records alone, through report-cli (the baseline attempts of m7-05-main only)", () => {
    const stored = text("report-m7-1.md");
    const lines = stored.split("\n");
    const out = join(tempDir(), "report.md");
    const sink = { out: () => undefined, err: (t: string) => { throw new Error(t); } };
    expect(runReport(["--run", dir("m7-1-rerun-main"), "--retry-run", dir("m7-1-retry-ctx"), "--retry-run", dir("m7-1-retry-guide"), "--baseline-run", dir("m7-05-main"), "--out", out, "--title", (lines[0] ?? "").replace(/^# /, ""), "--note", lines[2] ?? ""], sink)).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(stored);
    // no verdict in it is provisional, and the lost attempts are listed, superseded
    expect(stored).not.toContain("(provisional)");
    expect(stored).toContain("57 attempts that were not judged are superseded by the attempt of the same cell");
    // the earlier run's Mtek cells are not in it: 340 Mtek attempts that count + 57 lost ones listed + 170 baseline attempts of the earlier run
    const { trials: all, listing } = extractTrials([...rerun, ...selectSide(records("m7-05-main"), "baseline")], new Set(), retry);
    expect(all).toHaveLength(510);
    expect(listing).toHaveLength(567);
    expect(all.filter((t) => t.side === "baseline").every((t) => t.runId === "m7-05-main")).toBe(true);
    expect(all.filter((t) => t.side === "mtek").every((t) => t.runId !== "m7-05-main")).toBe(true);
  });

  it("reproduces compare-m7-1.md and evidence/M7/ai-baseline.json from the stored records and holdout summaries alone, through compare-cli", () => {
    const stored = text("compare-m7-1.md");
    const lines = stored.split("\n");
    const tmp = tempDir();
    mkdirSync(tmp, { recursive: true });
    const out = join(tmp, "compare.md");
    const json = join(tmp, "ai-baseline.json");
    const sink = { out: () => undefined, err: (t: string) => { throw new Error(t); } };
    const args = [
      "--before", `${dir("m7-05-main")},${dir("m7-05-guide")}`,
      "--after", dir("m7-1-rerun-main"),
      "--after-retry", `${dir("m7-1-retry-ctx")},${dir("m7-1-retry-guide")}`,
      "--holdout-before", join(RESULTS, "holdout-summary.jsonl"),
      "--holdout-after", join(RESULTS, "holdout-summary-m7-1.jsonl"),
      "--baseline-json", json,
      "--out", out,
      "--title", (lines[0] ?? "").replace(/^# /, ""),
      "--note", lines[2] ?? "",
    ];
    expect(runCompare(args, sink, REPO_ROOT)).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(stored);
    expect(readFileSync(json, "utf8")).toBe(readFileSync(join(REPO_ROOT, "evidence", "M7", "ai-baseline.json"), "utf8").replaceAll("\r\n", "\n"));
  });

  it("has an ai-baseline.json whose hashes are those of the stored records and summaries, and whose numbers are the ones quoted", () => {
    const baseline = JSON.parse(readFileSync(join(REPO_ROOT, "evidence", "M7", "ai-baseline.json"), "utf8")) as {
      measurement: { model: { ids: string[] }; temperature: number; promptCaching: boolean; priceTableUsdPerMillionTokens: Record<string, Record<string, number>> };
      sources: { role: string; path: string; sha256: string }[];
      main: { baseline: { completionRate: number; tokensPerCompletedTask: number }; conditions: { label: string; after: { attempts: number; completed: number; notJudged: number }; verdictAgainstBaseline: { verdict: string; provisional: boolean } }[] };
      holdout: { exploratory: boolean; conditions: { set: string; label: string; attempts: number; completed: number }[] };
      targets: { main: { baselineCompletionRatePercent: number; baselineTokensPerCompletedTask: number }; holdout: { baselineCompletionRatePercent: number; baselineTokensPerCompletedTask: number } };
    };
    expect(baseline.measurement.model.ids).toEqual(["claude-haiku-4-5-20251001"]);
    expect(baseline.measurement.temperature).toBe(1);
    expect(baseline.measurement.promptCaching).toBe(true);
    expect(baseline.measurement.priceTableUsdPerMillionTokens["claude-haiku-4-5-20251001"]).toEqual({ inputPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outputPerMTok: 5 });
    expect(baseline.sources.map((s) => `${s.role}:${s.path}`)).toEqual([
      "before:benchmarks/results/ai/m7-05-main/records.jsonl",
      "before:benchmarks/results/ai/m7-05-guide/records.jsonl",
      "after:benchmarks/results/ai/m7-1-rerun-main/records.jsonl",
      "retry:benchmarks/results/ai/m7-1-retry-ctx/records.jsonl",
      "retry:benchmarks/results/ai/m7-1-retry-guide/records.jsonl",
      "holdout-summary-earlier:benchmarks/results/ai/holdout-summary.jsonl",
      "holdout-summary-new:benchmarks/results/ai/holdout-summary-m7-1.jsonl",
    ]);
    for (const source of baseline.sources) expect(source.sha256, source.path).toBe(sha256Hex(readFileSync(join(REPO_ROOT, ...source.path.split("/")), "utf8").replaceAll("\r\n", "\n")));
    expect(baseline.targets.main).toEqual({ baselineCompletionRatePercent: 91.8, baselineTokensPerCompletedTask: 9388 });
    expect(baseline.targets.holdout).toEqual({ baselineCompletionRatePercent: 97.5, baselineTokensPerCompletedTask: 7737 });
    expect(baseline.main.conditions.map((c) => [c.label, c.after.attempts, c.after.completed, c.after.notJudged, c.verdictAgainstBaseline.verdict, c.verdictAgainstBaseline.provisional])).toEqual([
      ["context only", 170, 116, 0, "worse", false],
      ["context + guide", 170, 145, 0, "worse", false],
    ]);
    expect(baseline.holdout.exploratory).toBe(true);
    expect(baseline.holdout.conditions.map((c) => [c.set, c.label, c.attempts, c.completed])).toEqual([
      ["earlier", "Mtek, context only", 40, 25],
      ["earlier", "three.js baseline", 40, 39],
      ["new", "Mtek, context only", 40, 34],
      ["new", "Mtek, context + guide", 40, 39],
    ]);
  });

  it("holds no credential in the stored documents and records", () => {
    for (const file of [...files, "../../../evidence/M7/ai-baseline.json"]) {
      const content = file.startsWith("..") ? readFileSync(join(REPO_ROOT, "evidence", "M7", "ai-baseline.json"), "utf8") : text(file);
      expect(new RegExp(`${"sk-"}${"ant-"}[A-Za-z0-9_-]{8,}`).test(content), file).toBe(false);
      expect(/x-api-key|authorization/i.test(content), file).toBe(false);
    }
  });
});

describe.skipIf(!present)("the stored holdout summaries (numbers only; the holdout runs are outside the repository)", () => {
  const earlier = parseHoldoutSummary(text("holdout-summary.jsonl"), "holdout-summary.jsonl");
  const later = parseHoldoutSummary(text("holdout-summary-m7-1.jsonl"), "holdout-summary-m7-1.jsonl");
  const KEYS = ["calls", "cachedInputTokens", "costUsd", "finalVerdict", "firstAttemptLayers", "inputTokens", "outcome", "outputTokens", "reason", "repairsUsed", "runId", "side", "taskId", "trial", "trialId", "trialKind", "variant"];

  it("keeps the new summary to ids and outcomes: 160 rows, 80 lost attempts each superseded by the retry, 80 judged retry attempts", () => {
    const rows = text("holdout-summary-m7-1.jsonl")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rows).toHaveLength(160);
    for (const row of rows) {
      const links = ["supersededBy", "retryOf"].filter((k) => row[k] !== undefined);
      expect(Object.keys(row).sort()).toEqual([...KEYS, ...links].sort());
      expect(links).toHaveLength(1);
    }
    const lost = rows.filter((r) => r["supersededBy"] !== undefined);
    expect(lost).toHaveLength(80);
    expect(lost.every((r) => r["runId"] === "m7-1-rerun-holdout" && r["supersededBy"] === "m7-1-retry-holdout")).toBe(true);
    expect(lost.filter((r) => r["outcome"] === "error" && r["reason"] === "transport-error")).toHaveLength(63);
    expect(lost.filter((r) => r["outcome"] === "unfinished" && r["reason"] === "budget-spend")).toHaveLength(17);
    expect(lost.some((r) => r["outcome"] === "success" || r["outcome"] === "failure")).toBe(false);
    const retried = rows.filter((r) => r["retryOf"] !== undefined);
    expect(retried).toHaveLength(80);
    expect(retried.every((r) => r["runId"] === "m7-1-retry-holdout" && r["retryOf"] === "m7-1-rerun-holdout" && (r["outcome"] === "success" || r["outcome"] === "failure"))).toBe(true);
    // each lost attempt is superseded by the retry attempt of the same cell
    const cells = (rs: Record<string, unknown>[]) => rs.map((r) => `${String(r["taskId"])}/${String(r["variant"])}/${String(r["trial"])}`).sort();
    expect(cells(lost)).toEqual(cells(retried));
    expect(new Set(cells(retried)).size).toBe(80);
  });

  it("reads the earlier summary, which has no run id, variant or trial, from the attempt ids", () => {
    expect(earlier).toHaveLength(80);
    expect(earlier.every((r) => r.runId === null && r.supersededBy === null)).toBe(true);
    expect(earlier.filter((r) => r.side === "mtek" && r.variant === "")).toHaveLength(40);
    expect(earlier.filter((r) => r.side === "baseline")).toHaveLength(40);
    expect(new Set(earlier.map((r) => r.trial))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(activeRows(later)).toHaveLength(80);
    expect(activeRows(later).filter((r) => r.variant === "+guide")).toHaveLength(40);
  });

  it("gives the holdout numbers: 25/40 -> 34/40 (context only) and 39/40 (guide), the baseline 39/40; tokens per completed task from input plus output", () => {
    const h = compareHoldout(earlier, later);
    const row = (set: string, label: string) => h.conditions.find((c) => c.set === set && c.label === label);
    const figures = (set: string, label: string) => {
      const s = row(set, label)?.summary;
      return [s?.n, s?.success, s?.failure, s?.n === undefined || s.valid === undefined ? undefined : s.n - s.valid, s?.completionRate, Math.round(s?.tokensPerCompleted ?? 0)];
    };
    expect(figures("earlier", "Mtek, context only")).toEqual([40, 25, 15, 0, 0.625, 38_845]);
    expect(figures("earlier", "three.js baseline")).toEqual([40, 39, 1, 0, 0.975, 7_737]);
    expect(figures("new", "Mtek, context only")).toEqual([40, 34, 6, 0, 0.85, 17_629]);
    expect(figures("new", "Mtek, context + guide")).toEqual([40, 39, 1, 0, 0.975, 16_112]);
    expect(h).toMatchObject({ tasks: 8, trialsPerTask: 5, supersededRows: { earlier: 0, new: 80 } });
    // the rule of decision 0108 against the earlier baseline: allowed (8 tasks), not provisional, all WORSE
    expect(h.conditions.filter((c) => c.h4 !== null).map((c) => [c.set, c.label, c.h4?.verdict, c.h4?.provisional])).toEqual([
      ["earlier", "Mtek, context only", "worse", false],
      ["new", "Mtek, context only", "worse", false],
      ["new", "Mtek, context + guide", "worse", false],
    ]);
    expect(row("new", "Mtek, context only")?.h4?.interval.point).toBeCloseTo(2.279, 3);
    expect(row("new", "Mtek, context + guide")?.h4?.interval.point).toBeCloseTo(2.083, 3);
    expect(row("new", "Mtek, context + guide")?.h4?.successAxis).toBe("matched");
  });

  it("is regenerated by the comparison from the summary files alone (no holdout run directory is read)", () => {
    const stored = text("compare-m7-1.md");
    expect(stored).toContain("## Holdout (exploratory, numbers only)");
    expect(stored).toContain("| new (M7.1 documentation) | Mtek, context only | 40 | 34 | 6 | 0 | 85.0 % | 17,629 |");
    expect(stored).toContain("| new (M7.1 documentation) | Mtek, context + guide | 40 | 39 | 1 | 0 | 97.5 % | 16,112 |");
    expect(stored).toContain("| earlier (M7-05, old documentation) | three.js baseline | 40 | 39 | 1 | 0 | 97.5 % | 7,737 |");
  });
});
