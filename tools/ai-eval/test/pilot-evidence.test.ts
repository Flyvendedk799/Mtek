// The stored pilot (benchmarks/results/ai/pilot-*, decision 0109) is evidence: every record is valid, the report and the
// projection are reproduced byte for byte from the records, the spend recorded is the spend of the calls, no key is in any file,
// and the numbers that decision 0109 quotes are the numbers of the records.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conditionCosts, renderProjection } from "../src/projection.ts";
import { buildReport, extractTrials, parseRecords, summarize } from "../src/report.ts";
import { REPO_ROOT, validateRecord } from "./helpers.ts";

const RESULTS = join(REPO_ROOT, "benchmarks", "results", "ai");
const RUNS = ["pilot-2026-10-19", "pilot-guide-2026-10-19"];
const present = RUNS.every((run) => existsSync(join(RESULTS, run, "records.jsonl")));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

describe.skipIf(!present)("the stored pilot", () => {
  const records = RUNS.flatMap((run) => parseRecords(readFileSync(join(RESULTS, run, "records.jsonl"), "utf8")));
  const { trials, runs } = extractTrials(records);

  it("has only valid records, and every run ends with a run-end record", () => {
    for (const record of records) expect(validateRecord(record), JSON.stringify(record).slice(0, 160)).toEqual([]);
    expect(runs.map((r) => r.status)).toEqual(["complete", "complete"]);
  });

  it("is 22 attempts, none of them unjudged, and the outcomes decision 0109 quotes", () => {
    expect(trials).toHaveLength(22);
    expect(trials.every((t) => t.outcome === "success" || t.outcome === "failure")).toBe(true);
    const by = (side: string, variant: string) => summarize(trials.filter((t) => t.side === side && t.variant === variant));
    expect(by("mtek", "")).toMatchObject({ n: 8, success: 3, failure: 5 });
    expect(by("mtek", "+guide")).toMatchObject({ n: 6, success: 5, failure: 1 });
    expect(by("baseline", "")).toMatchObject({ n: 8, success: 8, failure: 0 });
    expect(Math.round(by("mtek", "").tokensPerCompleted ?? 0)).toBe(77_083);
    expect(Math.round(by("mtek", "+guide").tokensPerCompleted ?? 0)).toBe(43_394);
    expect(Math.round(by("baseline", "").tokensPerCompleted ?? 0)).toBe(5_471);
    expect(trials.every((t) => t.model === "claude-haiku-4-5-20251001")).toBe(true);
  });

  it("charged what the run-end records say, and the pilot cost what decision 0109 says", () => {
    for (const run of runs) {
      const mine = trials.filter((t) => t.runId === run.runId);
      const spent = mine.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
      const recorded = (run.spend as { runSpendUsd: number }).runSpendUsd;
      expect(spent).toBeCloseTo(recorded, 6);
    }
    const total = trials.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
    expect(total).toBeCloseTo(0.4177, 3); // 0.2704 + 0.1473
  });

  it("reproduces report.md and projection.md from the records alone", () => {
    const stored = readFileSync(join(RESULTS, "pilot-2026-10-19", "report.md"), "utf8").replaceAll("\r\n", "\n");
    const lines = stored.split("\n");
    const title = (lines[0] ?? "").replace(/^# /, "");
    const note = lines[2] ?? "";
    expect(buildReport({ records, holdoutIds: new Set(), title, note }).markdown).toBe(stored);
    const projection = readFileSync(join(RESULTS, "pilot-2026-10-19", "projection.md"), "utf8").replaceAll("\r\n", "\n");
    expect(renderProjection(conditionCosts(trials), 8)).toBe(projection);
  });

  it("holds no credential in any stored file, and no holdout text", () => {
    for (const run of RUNS) {
      for (const file of walk(join(RESULTS, run))) {
        if (statSync(file).size > 5_000_000) continue;
        const text = readFileSync(file, "utf8");
        expect(/sk-ant-[A-Za-z0-9_-]{8,}/.test(text), file).toBe(false);
        expect(/x-api-key|authorization/i.test(text), file).toBe(false);
      }
    }
    expect(trials.some((t) => t.holdout)).toBe(false);
  });

  it("keeps the final candidate of every attempt", () => {
    for (const t of trials) expect(existsSync(join(RESULTS, t.runId, "trials", t.trialId, "project")), t.trialId).toBe(true);
  });
});
