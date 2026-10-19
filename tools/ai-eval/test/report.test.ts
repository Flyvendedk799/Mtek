// The report (decision 0108): aggregates computed from stored records only. The cases that matter most are the ones that could
// flatter the result: a task set where nothing completes (tokens per completed task is UNDEFINED, never 0), failures that still
// cost tokens, attempts the harness could not judge, and a holdout whose text must never reach the report.
import { describe, expect, it } from "vitest";
import {
  buildReport,
  compare,
  extractTrials,
  holdoutSummary,
  MATCHED_SUCCESS_POINTS,
  parseRecords,
  summarize,
  type Outcome,
  type TrialRow,
} from "../src/report.ts";
import { mulberry32, quantile, ratioInterval, spread } from "../src/stats.ts";
import { canonicalJson, type Json } from "../src/canonical.ts";
import { GOOD_EDIT, harness, reply, validateRecord } from "./helpers.ts";

// ---- statistics -----------------------------------------------------------------------------------------------------------------

describe("statistics", () => {
  it("computes quantiles by linear interpolation and the interquartile range", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([7], 0.5)).toBe(7);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(spread([10, 20, 30, 40, 50])).toEqual({ n: 5, median: 30, q1: 20, q3: 40 });
    expect(spread([])).toEqual({ n: 0, median: null, q1: null, q3: null });
    expect(spread([5, 1, 3]).median).toBe(3); // order does not matter
  });

  it("has a reproducible generator", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  const totals = (tokens: number, completed: number) => ({ tokens, completed, valid: 5 });

  it("gives the same interval twice, and a ratio of 1 for equal sides", () => {
    const same = Array.from({ length: 10 }, (_, i) => totals(1000 + i * 10, 4));
    const a = ratioInterval(same, same);
    expect(a).toEqual(ratioInterval(same, same));
    expect(a.point).toBeCloseTo(1, 12);
    expect(a.low).toBeLessThanOrEqual(1);
    expect(a.high).toBeGreaterThanOrEqual(1);
  });

  it("puts the whole interval below 1 when one side is clearly cheaper on every task", () => {
    const cheap = Array.from({ length: 10 }, (_, i) => totals(500 + i * 5, 4));
    const dear = Array.from({ length: 10 }, (_, i) => totals(1000 + i * 10, 4));
    const r = ratioInterval(cheap, dear);
    expect(r.point).toBeCloseTo(0.5, 2);
    expect(r.high).toBeLessThan(1);
  });

  it("is undefined when a side completes nothing, and has no interval for fewer than five tasks", () => {
    const none = Array.from({ length: 10 }, () => totals(900, 0));
    const some = Array.from({ length: 10 }, () => totals(900, 3));
    expect(ratioInterval(none, some)).toMatchObject({ point: null, low: null, high: null });
    expect(ratioInterval(some, none).point).toBeNull();
    const few = ratioInterval(some.slice(0, 4), some.slice(0, 4));
    expect(few.point).toBe(1);
    expect(few.low).toBeNull();
    expect(() => ratioInterval(some, some.slice(1))).toThrow(/same tasks/);
  });
});

// ---- rows -----------------------------------------------------------------------------------------------------------------------

let counter = 0;
function row(overrides: Partial<TrialRow> & { taskId: string; side: "mtek" | "baseline"; outcome: Outcome }): TrialRow {
  counter += 1;
  const total = overrides.totalTokens === undefined ? 1000 : overrides.totalTokens;
  return {
    runId: "r",
    trialId: `${overrides.taskId}--${overrides.side}--${String(counter)}`,
    category: "interaction",
    mode: "edit",
    trialKind: "unconstrained",
    trial: counter,
    model: "m",
    provider: "p",
    conditionId: "c",
    reason: null,
    message: null,
    calls: 1,
    repairsUsed: 0,
    inputTokens: total === null ? null : total - 100,
    outputTokens: total === null ? null : 100,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    uncachedInputTokens: total === null ? null : total - 100,
    totalTokens: total,
    costUsd: 0.01,
    durationMs: 5000,
    modelMs: 2000,
    validationMs: 3000,
    firstAttempt: null,
    final: null,
    holdout: false,
    attribution: { input: { instructions: 0, task: 0, documentation: 0, "project files": 0, diagnostics: 0, "tool results": 0, "repair context": 0, "generated code": 0, other: 0 }, outputTokens: 0, repairRoundInputTokens: 0, repairRoundOutputTokens: 0 },
    documentationBytes: null,
    ...overrides,
  };
}

describe("aggregates", () => {
  it("counts the tokens of failures in tokens per completed task", () => {
    const rows = [
      row({ taskId: "a", side: "mtek", outcome: "success", totalTokens: 1000 }),
      row({ taskId: "a", side: "mtek", outcome: "failure", totalTokens: 3000 }),
      row({ taskId: "b", side: "mtek", outcome: "success", totalTokens: 2000 }),
    ];
    const s = summarize(rows);
    expect(s.success).toBe(2);
    expect(s.totalTokens).toBe(6000);
    expect(s.tokensPerCompleted).toBe(3000); // (1000 + 3000 + 2000) / 2, not (1000 + 2000) / 2
    expect(s.completionRate).toBeCloseTo(2 / 3, 12);
  });

  it("is UNDEFINED when no task completes, never 0 and never infinity", () => {
    const rows = [row({ taskId: "a", side: "mtek", outcome: "failure", totalTokens: 4000 }), row({ taskId: "b", side: "mtek", outcome: "failure", totalTokens: 5000 })];
    const s = summarize(rows);
    expect(s.tokensPerCompleted).toBeNull();
    expect(s.costPerCompleted).toBeNull();
    expect(s.completionRate).toBe(0);
    expect(s.totalTokens).toBe(9000); // the tokens were spent
    expect(summarize([]).tokensPerCompleted).toBeNull();
    expect(summarize([]).completionRate).toBeNull();
  });

  it("keeps attempts the harness could not judge out of the completion rate, and in the token sums and the counts", () => {
    const rows = [
      row({ taskId: "a", side: "mtek", outcome: "success" }),
      row({ taskId: "a", side: "mtek", outcome: "failure" }),
      row({ taskId: "a", side: "mtek", outcome: "not-run" }),
      row({ taskId: "a", side: "mtek", outcome: "error" }),
      row({ taskId: "a", side: "mtek", outcome: "unfinished" }),
      row({ taskId: "a", side: "mtek", outcome: "unavailable", totalTokens: 0 }),
    ];
    const s = summarize(rows);
    expect(s).toMatchObject({ n: 6, valid: 2, notRun: 1, error: 1, unfinished: 1, unavailable: 1 });
    expect(s.completionRate).toBe(0.5);
    expect(s.completionRateAll).toBeCloseTo(1 / 6, 12);
    expect(s.excludedShare).toBeCloseTo(4 / 6, 12);
    expect(s.totalTokens).toBe(5000);
    expect(s.tokensPerCompleted).toBe(5000);
  });

  it("reports unknown token counts instead of treating them as zero", () => {
    const s = summarize([row({ taskId: "a", side: "mtek", outcome: "success", totalTokens: null }), row({ taskId: "a", side: "mtek", outcome: "success", totalTokens: 2000 })]);
    expect(s.unknownUsage).toBe(1);
    expect(s.totalTokens).toBe(2000);
  });

  it("computes the median and interquartile range of tokens and of repairs", () => {
    const rows = [1000, 2000, 3000, 4000, 5000].map((t, i) => row({ taskId: "a", side: "mtek", outcome: "success", totalTokens: t, repairsUsed: i }));
    const s = summarize(rows);
    expect(s.tokensAll).toEqual({ n: 5, median: 3000, q1: 2000, q3: 4000 });
    expect(s.repairsCompleted.median).toBe(2);
  });
});

// ---- the conclusion -------------------------------------------------------------------------------------------------------------

const TASKS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];

function side(kind: "mtek" | "baseline", per: (task: string, trial: number) => { outcome: Outcome; tokens: number }, trials = 5): TrialRow[] {
  return TASKS.flatMap((taskId) =>
    Array.from({ length: trials }, (_, trial) => {
      const { outcome, tokens } = per(taskId, trial);
      return row({ taskId, side: kind, outcome, totalTokens: tokens, trial });
    }),
  );
}

describe("the conclusion on H4", () => {
  const wiggle = (task: string, trial: number): number => 1 + ((task.charCodeAt(1) * 7 + trial * 3) % 5) / 100;

  it("is better when completion is matched and the whole interval is below 1", () => {
    const c = compare(side("mtek", (t, i) => ({ outcome: "success", tokens: 1000 * wiggle(t, i) })), side("baseline", (t, i) => ({ outcome: "success", tokens: 2000 * wiggle(t, i) })));
    expect(c.verdict).toBe("better");
    expect(c.targetMet).toBe(true); // ratio about 0.5, at most 0.70
    expect(c.provisional).toBe(false);
  });

  it("is better yet misses the 30 % target when the saving is real but smaller", () => {
    const c = compare(side("mtek", (t, i) => ({ outcome: "success", tokens: 850 * wiggle(t, i) })), side("baseline", (t, i) => ({ outcome: "success", tokens: 1000 * wiggle(t, i) })));
    expect(c.verdict).toBe("better");
    expect(c.targetMet).toBe(false);
  });

  it("is equivalent when completion is matched and the interval contains 1", () => {
    const c = compare(side("mtek", (t, i) => ({ outcome: "success", tokens: 1000 * wiggle(t, i + 1) })), side("baseline", (t, i) => ({ outcome: "success", tokens: 1000 * wiggle(t, i) })));
    expect(c.verdict).toBe("equivalent");
    expect(c.targetMet).toBe(false);
  });

  it("is worse when the tokens per completed task are significantly more", () => {
    const c = compare(side("mtek", (t, i) => ({ outcome: "success", tokens: 3000 * wiggle(t, i) })), side("baseline", (t, i) => ({ outcome: "success", tokens: 1000 * wiggle(t, i) })));
    expect(c.verdict).toBe("worse");
  });

  it("counts failures' tokens, so failing more is worse even at fewer tokens per attempt", () => {
    // Mtek: half the attempts fail (1000 tokens each); baseline: all succeed with 1500 tokens.
    const c = compare(side("mtek", (t, i) => ({ outcome: i % 2 === 0 ? "success" : "failure", tokens: 1000 })), side("baseline", () => ({ outcome: "success", tokens: 1500 })));
    expect(c.successAxis).toBe("lower");
    expect(c.mtek.tokensPerCompleted).toBeGreaterThan(c.baseline.tokensPerCompleted as number);
    expect(c.verdict).toBe("worse");
  });

  it("is better when only the Mtek side completes anything, worse for the reverse, inconclusive when nothing completes anywhere", () => {
    const fail = () => ({ outcome: "failure" as const, tokens: 1000 });
    const win = () => ({ outcome: "success" as const, tokens: 1000 });
    const only = compare(side("mtek", win), side("baseline", fail));
    expect(only.verdict).toBe("better");
    expect(only.baseline.tokensPerCompleted).toBeNull();
    expect(only.interval.point).toBeNull();
    expect(compare(side("mtek", fail), side("baseline", win)).verdict).toBe("worse");
    const nothing = compare(side("mtek", fail), side("baseline", fail));
    expect(nothing.verdict).toBe("inconclusive");
    expect(nothing.reason).toMatch(/nothing completes on either side/);
  });

  it("does not conclude from fewer than five tasks, and says so", () => {
    const few = TASKS.slice(0, 3);
    const m = side("mtek", () => ({ outcome: "success", tokens: 1000 })).filter((r) => few.includes(r.taskId));
    const b = side("baseline", () => ({ outcome: "success", tokens: 3000 })).filter((r) => few.includes(r.taskId));
    const c = compare(m, b);
    expect(c.verdict).toBe("inconclusive");
    expect(c.reason).toMatch(/too few for an interval/);
    expect(c.interval.point).toBeCloseTo(1 / 3, 12);
  });

  it("is provisional below five trials per task and side, or with many unjudged attempts, and still reports a direction", () => {
    const c = compare(side("mtek", () => ({ outcome: "success", tokens: 1000 }), 2), side("baseline", () => ({ outcome: "success", tokens: 3000 }), 2));
    expect(c.provisional).toBe(true);
    expect(c.provisionalReasons.join(" ")).toMatch(/only 2 trial/);
    const unjudged = compare(side("mtek", (t, i) => ({ outcome: i === 0 ? "error" : "success", tokens: 1000 })), side("baseline", () => ({ outcome: "success", tokens: 3000 })));
    expect(unjudged.provisionalReasons.join(" ")).toMatch(/could not be judged/);
  });

  it("compares only the tasks both sides attempted, and lists the others", () => {
    const m = side("mtek", () => ({ outcome: "success", tokens: 1000 }));
    const b = side("baseline", () => ({ outcome: "success", tokens: 1000 })).filter((r) => r.taskId !== "t8");
    const c = compare(m, b);
    expect(c.tasks).toHaveLength(7);
    expect(c.unmatchedTasks).toEqual(["t8"]);
    expect(c.provisional).toBe(true);
  });

  it("treats a gap of exactly ten points as matched", () => {
    expect(MATCHED_SUCCESS_POINTS).toBe(0.1);
    const m = side("mtek", (t, i) => ({ outcome: i === 0 && t <= "t4" ? "failure" : "success", tokens: 1000 }), 5); // 4 of 40 fail = 90 %
    const b = side("baseline", () => ({ outcome: "success", tokens: 1000 }), 5);
    expect(compare(m, b).successAxis).toBe("matched");
  });
});

// ---- the text -------------------------------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

/** The records of one attempt, in the shape the Recorder writes them. */
function attempt(o: { runId?: string; taskId: string; side: "mtek" | "baseline"; trial: number; outcome: string; reason?: string | null; message?: string | null; input?: number | null; output?: number | null; cost?: number; category?: string; mode?: string; seq?: number }): Rec[] {
  const runId = o.runId ?? "run-a";
  const trialId = `${o.taskId}--${o.side === "baseline" ? "baseline-" : ""}unconstrained--0${String(o.trial)}`;
  const base = { schemaVersion: 1, runId, trialId };
  const input = o.input === undefined ? 900 : o.input;
  const output = o.output === undefined ? 100 : o.output;
  return [
    { ...base, type: "trial-start", taskId: o.taskId, category: o.category ?? "interaction", mode: o.mode ?? "edit", trialKind: "unconstrained", trial: o.trial, condition: { provider: "anthropic", model: "claude-haiku-4-5-20251001", side: o.side }, conditionId: "c".repeat(64), contextBytes: o.side === "mtek" ? 8000 : 10000 },
    {
      ...base,
      type: "model-call",
      round: 0,
      request: { system: "x".repeat(100), messages: [{ role: "user", content: "y".repeat(900) }] },
      promptSections: { system: 100, task: 200, context: 500, project: 150, instructions: 50 },
      response: { text: "reply" },
      usage: input === null || output === null ? { inputTokens: null, outputTokens: null } : { inputTokens: input, outputTokens: output, cachedInputTokens: 0, cacheWriteInputTokens: 0 },
      costUsd: o.cost ?? 0.002,
      durationMs: 1500,
    },
    {
      ...base,
      type: "validation",
      round: 0,
      verdict: o.outcome === "success" ? "pass" : "fail",
      layers: { parse: { outcome: "pass" }, check: { outcome: "pass" }, build: { outcome: "pass" }, start: { outcome: "pass" }, tests: { outcome: o.outcome === "success" ? "pass" : "fail" } },
      requiredSymbols: { outcome: "pass" },
      durationMs: 2500,
    },
    { ...base, type: "trial-end", outcome: o.outcome, reason: o.reason ?? null, message: o.message ?? null, calls: 1, repairsUsed: 0, final: null, durationMs: 4000 },
  ];
}

function runRecords(attempts: Rec[][], runId = "run-a"): Rec[] {
  const start = { schemaVersion: 1, runId, type: "run-start", startedAt: "2026-10-19T08:00:00.000Z", settings: { provider: "anthropic", model: "claude-haiku-4-5-20251001", temperature: 0, promptCaching: true, testFeedback: "messages", maxRepairs: "per task" } };
  const end = { schemaVersion: 1, runId, type: "run-end", endedAt: "2026-10-19T09:00:00.000Z", status: "complete", trials: attempts.length, spend: { capUsd: 1, ledgerTotalAtStartUsd: 0, ledgerTotalEndUsd: 0.5, runSpendUsd: 0.5, calls: attempts.length, refusedCalls: 0 } };
  return [start, ...attempts.flat(), end];
}

describe("the report text", () => {
  const records = runRecords([
    attempt({ taskId: "alpha-01", side: "mtek", trial: 0, outcome: "success" }),
    attempt({ taskId: "alpha-01", side: "mtek", trial: 1, outcome: "failure", reason: "max-repairs", message: "still failing after 3 repairs" }),
    attempt({ taskId: "alpha-01", side: "baseline", trial: 0, outcome: "success" }),
    attempt({ taskId: "alpha-01", side: "baseline", trial: 1, outcome: "unfinished", reason: "budget-spend", message: "spend cap reached" }),
  ]);

  it("lists every attempt, failures and the ones the harness could not judge included, and shows the settings and the spend", () => {
    const { markdown } = buildReport({ records });
    for (const id of ["alpha-01--unconstrained--00", "alpha-01--unconstrained--01", "alpha-01--baseline-unconstrained--00", "alpha-01--baseline-unconstrained--01"]) expect(markdown).toContain(id);
    expect(markdown).toMatch(/\| alpha-01--unconstrained--01 \|[^\n]*\| failure \| max-repairs \|/);
    expect(markdown).toMatch(/\| alpha-01--baseline-unconstrained--01 \|[^\n]*\| unfinished \| budget-spend \|/);
    expect(markdown).toContain("## Attempts that could not be judged");
    expect(markdown).toContain("budget-spend: spend cap reached");
    expect(markdown).toContain("claude-haiku-4-5-20251001");
    expect(markdown).toContain("cap $1, this run $0.5000, ledger after $0.5000");
    expect(markdown).toContain("2026-10-19T08:00:00.000Z");
  });

  it("is the same text when computed twice, whatever the order of the run directories' records within a run", () => {
    expect(buildReport({ records }).markdown).toBe(buildReport({ records: [...records] }).markdown);
  });

  it("says UNDEFINED, not 0, when nothing completes", () => {
    const nothing = runRecords([attempt({ taskId: "alpha-01", side: "mtek", trial: 0, outcome: "failure", reason: "max-repairs" }), attempt({ taskId: "alpha-01", side: "baseline", trial: 0, outcome: "failure", reason: "max-repairs" })]);
    const { markdown, comparisons } = buildReport({ records: nothing });
    expect(markdown).toMatch(/\| mtek unconstrained \| 1 \| 0 \/ 1 \/ 0 \| 0\.0 % \| UNDEFINED \|/);
    expect(markdown).toContain("tokens per completed task is undefined for both");
    expect(comparisons[0]?.comparison.verdict).toBe("inconclusive");
    expect(markdown).not.toMatch(/\| mtek unconstrained \|[^\n]*\| 0 \|[^\n]*Infinity/);
  });

  it("keeps cached reads, cache writes and uncached input apart, and input apart from output", () => {
    const withCache = attempt({ taskId: "alpha-01", side: "mtek", trial: 0, outcome: "success" });
    const call = withCache[1] as Rec;
    call["usage"] = { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 600, cacheWriteInputTokens: 100 };
    const { trials, markdown } = buildReport({ records: runRecords([withCache]) });
    expect(trials[0]).toMatchObject({ inputTokens: 1000, outputTokens: 50, cachedInputTokens: 600, cacheWriteInputTokens: 100, uncachedInputTokens: 300, totalTokens: 1050 });
    expect(markdown).toMatch(/\| mtek unconstrained \| 1,000 \| 600 \| 100 \| 300 \| 50 \| 1,050 \| 0 \|/);
  });

  it("attributes the input tokens of a request to its parts so that the parts add up", () => {
    const { trials } = buildReport({ records });
    const first = trials[0];
    const a = first?.attribution;
    const total = Object.values(a?.input ?? {}).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(900, 6);
    expect(a?.input.documentation).toBeCloseTo((900 * 500) / 1000, 6); // 500 of the 1000 characters
    expect(a?.input.instructions).toBeCloseTo((900 * 150) / 1000, 6); // the system prompt and the instructions line
    expect(a?.outputTokens).toBe(100);
  });

  it("reports the holdout apart, by ids and layer outcomes only, and never leaks its text into the report or the summary", () => {
    const secret = "SECRET-HOLDOUT-PROMPT-TEXT";
    const holdoutAttempt = attempt({ taskId: "private-01", side: "mtek", trial: 0, outcome: "failure", reason: "max-repairs", message: secret });
    (holdoutAttempt[1] as Rec)["request"] = { system: secret, messages: [{ role: "user", content: secret }] };
    (holdoutAttempt[1] as Rec)["response"] = { text: secret };
    const all = runRecords([attempt({ taskId: "alpha-01", side: "mtek", trial: 0, outcome: "success" }), holdoutAttempt]);
    const { markdown, trials } = buildReport({ records: all, holdoutIds: new Set(["private-01"]) });
    expect(markdown).not.toContain(secret);
    expect(markdown).toContain("## Holdout (reported apart");
    const section = markdown.slice(markdown.indexOf("## Holdout"), markdown.indexOf("## All attempts"));
    expect(section).toContain("private-01--unconstrained--00");
    expect(section).toContain("max-repairs");
    // not in any aggregate or per-task table of the main set
    expect(markdown.slice(0, markdown.indexOf("## Holdout"))).not.toContain("private-01");
    expect(markdown.slice(markdown.indexOf("## All attempts"))).not.toContain("private-01");
    const summary = holdoutSummary(trials).map((row) => canonicalJson(row as Json)).join("\n");
    expect(summary).not.toContain(secret);
    expect(JSON.parse(summary.split("\n")[0] as string)).toMatchObject({ taskId: "private-01", outcome: "failure", reason: "max-repairs" });
    expect(Object.keys(JSON.parse(summary.split("\n")[0] as string) as object)).not.toContain("message");
  });

  it("says that an attempt without an end record was interrupted rather than dropping it", () => {
    const cut = attempt({ taskId: "alpha-01", side: "mtek", trial: 0, outcome: "success" }).slice(0, 3);
    const { markdown, trials } = buildReport({ records: runRecords([cut]) });
    expect(trials[0]).toMatchObject({ outcome: "unfinished" });
    expect(markdown).toContain("no trial-end record");
  });

  it("states the unverified status of the 80 % claim and the rule", () => {
    const { markdown } = buildReport({ records });
    expect(markdown).toContain("about 80 % fewer tokens");
    expect(markdown).toContain("unverified hypothesis");
    expect(markdown).toContain("## How the conclusion is reached");
  });

  it("reads records back from JSONL and refuses a line that is not a record", () => {
    expect(parseRecords(`${canonicalJson({ type: "run-start", a: 1 })}\n\n`)).toHaveLength(1);
    expect(() => parseRecords("not json\n")).toThrow(/not JSON/);
    expect(() => parseRecords("[1]\n")).toThrow(/not a record/);
  });
});

describe("records written by the loop", () => {
  it("are read back into the same totals", async () => {
    const h = harness([reply("nothing useful", { usage: { inputTokens: 700, outputTokens: 70, cachedInputTokens: 0 } }), reply(GOOD_EDIT, { usage: { inputTokens: 900, outputTokens: 90, cachedInputTokens: 0 } })]);
    const result = await h.run();
    expect(result.outcome).toBe("success");
    for (const line of h.recorder.lines) expect(validateRecord(JSON.parse(line) as unknown), line).toEqual([]);
    const { trials } = extractTrials(parseRecords(h.recorder.text));
    expect(trials).toHaveLength(1);
    expect(trials[0]).toMatchObject({ outcome: "success", calls: 2, repairsUsed: 1, inputTokens: 1600, outputTokens: 160, totalTokens: 1760, side: "mtek" });
    expect(trials[0]?.firstAttempt?.verdict).toBe("no-candidate"); // the first reply was rejected: no candidate, a failed first attempt on every layer
    expect(trials[0]?.final?.verdict).toBe("pass");
    const attributed = Object.values(trials[0]?.attribution.input ?? {}).reduce((s, v) => s + v, 0);
    expect(attributed).toBeCloseTo(1600, 6);
  });
});
