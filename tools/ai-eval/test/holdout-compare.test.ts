// The holdout section of the comparison and the machine-readable baseline (decision 0125), on synthetic summary files and records. The
// stored M7.1 figures are checked in m7-1-evidence.test.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringifySorted } from "../src/baseline-json.ts";
import { runCompare } from "../src/compare-cli.ts";
import { buildComparison } from "../src/compare.ts";
import { activeRows, compareHoldout, parseHoldoutSummary } from "../src/holdout-compare.ts";
import { tempDir } from "./helpers.ts";

type Row = Record<string, unknown>;

function row(task: string, trial: number, kind: "mtek" | "mtek-guide" | "baseline", outcome: "success" | "failure" | "error" | "unfinished", tokens: number, extra: Row = {}): Row {
  const side = kind === "baseline" ? "baseline" : "mtek";
  return {
    trialId: `${task}--${kind === "mtek" ? "" : `${kind}-`}unconstrained--${String(trial).padStart(2, "0")}`,
    taskId: task,
    side,
    trialKind: "unconstrained",
    outcome,
    reason: outcome === "success" ? null : outcome === "failure" ? "max-repairs" : outcome === "error" ? "transport-error" : "budget-spend",
    calls: 1,
    repairsUsed: 0,
    inputTokens: tokens,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: tokens / 1000,
    firstAttemptLayers: null,
    finalVerdict: outcome === "success" ? "pass" : null,
    ...extra,
  };
}
const jsonl = (rows: Row[]): string => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

const TASKS = ["h1", "h2", "h3", "h4", "h5", "h6"];
// earlier: Mtek fails half, the baseline always completes with 10 tokens; new: Mtek context-only and guide
const EARLIER: Row[] = TASKS.flatMap((t) => [0, 1, 2, 3, 4].flatMap((n) => [row(t, n, "mtek", n % 2 === 0 ? "success" : "failure", 100), row(t, n, "baseline", "success", 10)]));
const NEW_LOST: Row[] = TASKS.flatMap((t) => [0, 1, 2, 3, 4].map((n) => row(t, n, "mtek", "error", 0, { runId: "first", variant: "", trial: n, supersededBy: "retry" })));
const NEW: Row[] = TASKS.flatMap((t) =>
  [0, 1, 2, 3, 4].flatMap((n) => [row(t, n, "mtek", "success", 50, { runId: "retry", variant: "", trial: n, retryOf: "first" }), row(t, n, "mtek-guide", n === 0 ? "failure" : "success", 40, { runId: "retry", variant: "+guide", trial: n })]),
);

describe("reading a holdout summary", () => {
  it("reads variant and trial from the attempt id when the file has none (the M7-05 summary), and keeps them when it has", () => {
    const rows = parseHoldoutSummary(jsonl([row("h1", 3, "mtek-guide", "success", 5), row("h1", 4, "baseline", "success", 5), row("h1", 2, "mtek", "failure", 5, { variant: "+guide", trial: 9 })]));
    expect(rows.map((r) => [r.side, r.variant, r.trial])).toEqual([["mtek", "+guide", 3], ["baseline", "", 4], ["mtek", "+guide", 9]]);
    expect(rows[0]).toMatchObject({ runId: null, supersededBy: null, retryOf: null, inputTokens: 5 });
  });

  it("refuses lines that are not summary rows", () => {
    expect(() => parseHoldoutSummary("{not json}\n", "f")).toThrow(/f line 1: not JSON/);
    expect(() => parseHoldoutSummary(`${JSON.stringify({ taskId: "x" })}\n`, "f")).toThrow(/not a holdout summary row/);
    expect(() => parseHoldoutSummary(`${JSON.stringify({ ...row("h1", 0, "mtek", "success", 1), outcome: "weird" })}\n`)).toThrow(/not a holdout summary row/);
    expect(() => parseHoldoutSummary(`${JSON.stringify({ ...row("h1", 0, "mtek", "success", 1), trialId: "nonumber" })}\n`)).toThrow(/no trial index/);
    expect(parseHoldoutSummary("\n\n")).toEqual([]);
  });

  it("leaves the attempts a retry run replaced out of every number", () => {
    const later = parseHoldoutSummary(jsonl([...NEW_LOST, ...NEW]));
    expect(later).toHaveLength(30 + 60);
    expect(activeRows(later)).toHaveLength(60);
  });
});

describe("the holdout comparison", () => {
  const h = compareHoldout(parseHoldoutSummary(jsonl(EARLIER)), parseHoldoutSummary(jsonl([...NEW_LOST, ...NEW])));
  const find = (set: string, label: string) => h.conditions.find((c) => c.set === set && c.label === label);

  it("lists earlier Mtek, earlier baseline, then the new conditions, with the numbers of the active attempts", () => {
    expect(h.conditions.map((c) => `${c.set}: ${c.label}`)).toEqual(["earlier: Mtek, context only", "earlier: three.js baseline", "new: Mtek, context only", "new: Mtek, context + guide"]);
    expect(find("earlier", "Mtek, context only")?.summary).toMatchObject({ n: 30, success: 18, failure: 12, valid: 30 });
    expect(find("earlier", "Mtek, context only")?.summary.tokensPerCompleted).toBe((30 * 100) / 18);
    expect(find("new", "Mtek, context only")?.summary).toMatchObject({ n: 30, success: 30, error: 0 });
    expect(find("new", "Mtek, context + guide")?.summary).toMatchObject({ n: 30, success: 24, failure: 6 });
    expect(h).toMatchObject({ tasks: 6, trialsPerTask: 5, supersededRows: { earlier: 0, new: 30 } });
  });

  it("judges every Mtek condition against the EARLIER baseline by the rule of decision 0108", () => {
    expect(find("earlier", "three.js baseline")?.h4).toBeNull();
    expect(find("earlier", "Mtek, context only")?.h4).toMatchObject({ verdict: "worse", provisional: false });
    // 100 % completion at 50 tokens against 100 % at 10: success matched, tokens significantly more
    expect(find("new", "Mtek, context only")?.h4).toMatchObject({ verdict: "worse", successAxis: "matched", tokensAxis: "more" });
    expect(find("new", "Mtek, context + guide")?.h4?.interval.point).toBeCloseTo(5, 9);
  });

  it("allows no direction when the holdout has fewer than 5 tasks", () => {
    const keep = (rows: Row[]): Row[] => rows.filter((r) => ["h1", "h2", "h3"].includes(String(r["taskId"])));
    const few = compareHoldout(parseHoldoutSummary(jsonl(keep(EARLIER))), parseHoldoutSummary(jsonl(keep(NEW))));
    expect(few.conditions.find((c) => c.set === "new")?.h4?.verdict).toBe("inconclusive");
  });
});

describe("compare-cli with holdout summaries and a baseline file", () => {
  const sink = { out: () => undefined, err: () => undefined };

  function setup() {
    const dir = tempDir();
    const put = (name: string, text: string): string => {
      const path = join(dir, name);
      writeFileSync(path, text, "utf8");
      return path;
    };
    const run = (name: string): string => {
      const p = join(dir, name);
      mkdirSync(p, { recursive: true });
      return p;
    };
    return { dir, put, run };
  }

  const startEnd = (runId: string, cells: { task: string; trial: number; outcome: "success" | "failure"; tokens: number; side?: "mtek" | "baseline" }[]): string => {
    const lines: Row[] = [{ type: "run-start", runId, startedAt: "2026-10-19T10:00:00.000Z", settings: { provider: "anthropic", model: "claude-haiku-4-5-20251001", temperature: 1, promptCaching: true, testFeedback: "messages", trials: 1 } }];
    for (const c of cells) {
      const side = c.side ?? "mtek";
      const trialId = `${c.task}--${side}--${String(c.trial)}`;
      lines.push({ type: "trial-start", runId, trialId, taskId: c.task, category: "interaction", mode: "cold", trialKind: "unconstrained", trial: c.trial, condition: { side, model: "claude-haiku-4-5-20251001", provider: "anthropic", documentation: side === "baseline" ? "baseline-reference:abc" : "context-export" }, conditionId: `${side}-id`, contextBytes: 10 });
      lines.push({ type: "model-call", runId, trialId, round: 0, generation: "completed", error: null, finish: "stop", response: { text: "x" }, usage: { inputTokens: c.tokens, outputTokens: 0, cachedInputTokens: 0 }, promptSections: null, request: null, durationMs: 1, costUsd: 0.01 });
      lines.push({ type: "trial-end", runId, trialId, outcome: c.outcome, reason: c.outcome === "success" ? null : "max-repairs", message: null, calls: 1, repairsUsed: 0, final: null, durationMs: 1 });
    }
    lines.push({ type: "run-end", runId, status: "complete", endedAt: "x", trials: cells.length, spend: null });
    return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  };

  it("adds the holdout section from the two summary files, writes the baseline file, and gives the same bytes twice", () => {
    const { dir, put, run } = setup();
    const beforeDir = run("before");
    writeFileSync(join(beforeDir, "records.jsonl"), startEnd("before", [{ task: "a", trial: 0, outcome: "success", tokens: 100 }, { task: "a", trial: 0, outcome: "success", tokens: 10, side: "baseline" }]), "utf8");
    const afterDir = run("after");
    writeFileSync(join(afterDir, "records.jsonl"), startEnd("after", [{ task: "a", trial: 0, outcome: "success", tokens: 80 }]), "utf8");
    const earlier = put("earlier.jsonl", jsonl(EARLIER));
    const later = put("later.jsonl", jsonl([...NEW_LOST, ...NEW]));
    const run1 = (out: string, json: string): number => runCompare(["--before", beforeDir, "--after", afterDir, "--holdout-before", earlier, "--holdout-after", later, "--out", out, "--baseline-json", json, "--title", "T"], sink, dir);
    expect(run1(join(dir, "c1.md"), join(dir, "b1.json"))).toBe(0);
    expect(run1(join(dir, "c2.md"), join(dir, "b2.json"))).toBe(0);
    const md = readFileSync(join(dir, "c1.md"), "utf8");
    expect(md).toContain("## Holdout (exploratory, numbers only)");
    expect(md).toContain("| new (M7.1 documentation) | Mtek, context + guide | 30 | 24 | 6 | 0 | 80.0 % | 50 |");
    expect(md).toContain("30 rows of the new summary file are attempts that were lost");
    expect(readFileSync(join(dir, "c2.md"), "utf8")).toBe(md);
    expect(readFileSync(join(dir, "b2.json"), "utf8")).toBe(readFileSync(join(dir, "b1.json"), "utf8"));
    const baseline = JSON.parse(readFileSync(join(dir, "b1.json"), "utf8")) as { sources: { role: string; sha256: string; rows: number; runIds: string[] }[]; holdout: { exploratory: boolean }; targets: { main: { baselineTokensPerCompletedTask: number }; holdout: { baselineCompletionRatePercent: number; baselineTokensPerCompletedTask: number } }; measurement: { model: { ids: string[] }; harness: { version: string } } };
    expect(baseline.sources.map((s) => [s.role, s.rows])).toEqual([["before", 8], ["after", 5], ["holdout-summary-earlier", 60], ["holdout-summary-new", 90]]);
    expect(baseline.sources[0]?.runIds).toEqual(["before"]);
    expect(baseline.sources.every((s) => /^[0-9a-f]{64}$/.test(s.sha256))).toBe(true);
    expect(baseline.holdout.exploratory).toBe(true);
    expect(baseline.targets.main.baselineTokensPerCompletedTask).toBe(10);
    expect(baseline.targets.holdout).toEqual({ baselineCompletionRatePercent: 100, baselineTokensPerCompletedTask: 10 });
    expect(baseline.measurement.model.ids).toEqual(["claude-haiku-4-5-20251001"]);
    expect(baseline.measurement.harness.version).toMatch(/^\d/);
  });

  it("gives the holdout files together or not at all, and reports a summary that is not one with exit 3", () => {
    const { dir, put, run } = setup();
    const beforeDir = run("before");
    const afterDir = run("after");
    writeFileSync(join(beforeDir, "records.jsonl"), startEnd("before", [{ task: "a", trial: 0, outcome: "success", tokens: 1 }]), "utf8");
    writeFileSync(join(afterDir, "records.jsonl"), startEnd("after", [{ task: "a", trial: 0, outcome: "success", tokens: 1 }]), "utf8");
    const good = put("good.jsonl", jsonl(EARLIER));
    const bad = put("bad.jsonl", "not json\n");
    const base = ["--before", beforeDir, "--after", afterDir, "--out", join(dir, "o.md")];
    expect(runCompare([...base, "--holdout-before", good], sink, dir)).toBe(2);
    expect(runCompare([...base, "--holdout-before", good, "--holdout-after", bad], sink, dir)).toBe(3);
    expect(runCompare(base, sink, dir)).toBe(0);
    expect(readFileSync(join(dir, "o.md"), "utf8")).not.toContain("Holdout");
  });

  it("leaves the holdout section and the baseline file out of a comparison without holdout summaries", () => {
    const x = buildComparison({ before: [], after: [] });
    expect(x.holdout).toBeNull();
    expect(x.markdown).not.toContain("Holdout");
  });

  it("writes sorted, indented JSON that ends in a newline", () => {
    expect(stringifySorted({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{\n  "a": {\n    "c": null,\n    "d": [\n      2,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n');
  });
});
