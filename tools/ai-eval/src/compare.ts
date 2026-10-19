// The before/after comparison of two sets of runs of the Mtek conditions (decision 0124), computed from the stored `records.jsonl`
// ONLY, by the same extraction as the report (`report.ts`, so the legacy rule for transport failures applies to both sides).
//
// Per Mtek condition (the compiler context alone; the context with a document added) it states, for
//   (a) all attempts of each run as published, and
//   (b) the matched cells: the cells (same task, same trial index) that were judged in BOTH runs, so that before and after cover
//       the same cells and an attempt lost to the transport does not make one side look worse or better than the other,
// the attempts, the completed tasks, the completion rate (completed / attempts that ended by themselves) and tokens per completed
// task (all tokens of all attempts / completed tasks), overall, per mode and per category. The baseline row is copied from the
// "before" runs for reference (the baseline is not re-run), and what was lost is stated plainly. It does not apply the rule of
// decision 0108: that is the report's job; this document compares two states of the same condition.
import { compareHoldout, type HoldoutComparison, type HoldoutRow } from "./holdout-compare.ts";
import { compare as h4Compare, conclusion, extractTrials, summarize, type CellSummary, type Comparison as H4Comparison, type RunInfo, type TrialRow } from "./report.ts";

type Raw = Record<string, unknown>;

export interface CompareInput {
  /** The records of the runs before (their ids are listed), as the report reads them. */
  before: readonly Raw[];
  after: readonly Raw[];
  /**
   * The records of retry runs of the runs after (decision 0125): their attempts replace the NOT-JUDGED attempts of the same cells in
   * `after`, in every table and in the verdict; both stay listed. A retry attempt for a cell that was judged is an error.
   */
  afterRetry?: readonly Raw[];
  /**
   * The holdout, from summary files only: the earlier summary (the Mtek condition of M7-05 and the baseline) and the new one.
   * Exploratory numbers; the section is left out when this is not given.
   */
  holdout?: { earlier: readonly HoldoutRow[]; later: readonly HoldoutRow[] };
  /** Task ids of the holdout set: their attempts are never compared (a holdout run holds text that must stay out of the repository). */
  holdoutIds?: ReadonlySet<string>;
  title?: string;
  note?: string;
}

export interface Side2 {
  all: CellSummary;
  matched: CellSummary;
  rows: TrialRow[];
  matchedRows: TrialRow[];
}

export interface ConditionComparison {
  label: string;
  variant: string;
  trialKind: string;
  before: Side2;
  after: Side2;
  /** Cells judged in the after run. */
  afterJudgedCells: number;
  /** Cells judged in both runs (what the matched comparison covers). */
  matchedCells: number;
  /** Cells judged in the after run that have no judged attempt before (left out of the matched comparison; none when the before runs are complete). */
  unmatchedAfter: number;
  /** Not-judged attempts of this condition that a retry run replaced, and the retry attempts that stand in their place (empty without retry runs). */
  replaced: TrialRow[];
  retried: TrialRow[];
  /** The rule of decision 0108 for this condition (after) against the baseline of the runs before; null when those hold no baseline. */
  h4: H4Comparison | null;
}

export interface Comparison {
  markdown: string;
  conditions: ConditionComparison[];
  baseline: CellSummary | null;
  /** The baseline attempts of the runs before (the main set). */
  baselineRows: TrialRow[];
  runs: { before: RunInfo[]; after: RunInfo[] };
  holdout: HoldoutComparison | null;
}

const JUDGED = (t: TrialRow): boolean => t.outcome === "success" || t.outcome === "failure";
const cellKey = (t: TrialRow): string => `${t.taskId}\u0000${String(t.trial)}`;

const n0 = (value: number): string => Math.round(value).toLocaleString("en-US");
const n1 = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (value: number | null): string => (value === null ? "undefined" : `${n1(value * 100)} %`);
const tok = (value: number | null): string => (value === null ? "UNDEFINED" : n0(value));

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`)].join("\n");
}

/** `context only`, `context + guide`, `constrained context only`: the name of a Mtek condition in this document. */
export function conditionLabel(trialKind: string, variant: string): string {
  const docs = variant === "" ? "context only" : `context ${variant.split("+").filter((part) => part !== "").map((part) => `+ ${part}`).join(" ")}`;
  return trialKind === "unconstrained" ? docs : `${trialKind} ${docs}`;
}

function sideOf(rows: TrialRow[], matchedRows: TrialRow[]): Side2 {
  return { all: summarize(rows), matched: summarize(matchedRows), rows, matchedRows };
}

function duplicates(rows: readonly TrialRow[], what: string): void {
  const seen = new Set<string>();
  for (const t of rows) {
    const key = `${t.side}\u0000${t.trialKind}\u0000${t.variant}\u0000${cellKey(t)}`;
    if (seen.has(key)) throw new Error(`${what}: the cell ${t.taskId} trial ${String(t.trial)} of the condition '${conditionLabel(t.trialKind, t.variant)}' occurs more than once; the runs given for one side must not repeat a condition`);
    seen.add(key);
  }
}

function runTable(runs: readonly RunInfo[]): string {
  return table(
    ["run", "started", "status", "provider / model", "settings"],
    runs.map((run) => {
      const s = run.settings;
      const id = run.retry === true ? `${run.runId} (retry run)` : run.runId;
      const text = (key: string): string => {
        const value = s?.[key];
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "?";
      };
      return [id, run.startedAt ?? "?", run.status ?? "no run-end record", s === null ? "?" : `${text("provider")} / ${text("model")}`, s === null ? "?" : `temperature ${text("temperature")}, prompt caching ${text("promptCaching")}, test feedback ${text("testFeedback")}`];
    }),
  );
}

const share = (c: CellSummary): string => `${String(c.success)} / ${String(c.valid)}`;

/** A row of the before/after tables; `-` where a side has no attempt in the scope. */
function scopeRow(scope: string, b: CellSummary, a: CellSummary): string[] {
  const present = (c: CellSummary, cells: (string | number)[]): string[] => (c.n === 0 ? cells.map(() => "-") : cells.map(String));
  const change = (x: number | null, y: number | null): string => (x === null || y === null ? "n/a" : `${n1((y - x) * 100)} points`);
  const relative = (x: number | null, y: number | null): string => (x === null || y === null || x === 0 ? "n/a" : `${y / x - 1 >= 0 ? "+" : ""}${n1((y / x - 1) * 100)} %`);
  return [
    scope,
    ...present(b, [b.n, share(b), pct(b.completionRate), tok(b.tokensPerCompleted)]),
    ...present(a, [a.n, share(a), pct(a.completionRate), tok(a.tokensPerCompleted)]),
    b.n === 0 || a.n === 0 ? "-" : change(b.completionRate, a.completionRate),
    b.n === 0 || a.n === 0 ? "-" : relative(b.tokensPerCompleted, a.tokensPerCompleted),
  ];
}

const SCOPE_HEADER = [
  "scope",
  "before: attempts",
  "before: completed / judged",
  "before: completion rate",
  "before: tokens per completed task",
  "after: attempts",
  "after: completed / judged",
  "after: completion rate",
  "after: tokens per completed task",
  "completion rate, change",
  "tokens per completed task, change",
];

function scopeRows(label: string, before: readonly TrialRow[], after: readonly TrialRow[]): string[][] {
  const out: string[][] = [scopeRow(`${label}: all`, summarize(before), summarize(after))];
  const modes = [...new Set([...before, ...after].map((t) => t.mode))].sort();
  for (const mode of modes) out.push(scopeRow(`${label}: mode ${mode}`, summarize(before.filter((t) => t.mode === mode)), summarize(after.filter((t) => t.mode === mode))));
  const categories = [...new Set([...before, ...after].map((t) => t.category))].sort();
  for (const category of categories) out.push(scopeRow(`${label}: category ${category}`, summarize(before.filter((t) => t.category === category)), summarize(after.filter((t) => t.category === category))));
  return out;
}

export function buildComparison(input: CompareInput): Comparison {
  const holdoutIds = input.holdoutIds ?? new Set<string>();
  const b = extractTrials(input.before, holdoutIds);
  const a = extractTrials(input.after, holdoutIds, input.afterRetry ?? []);
  const beforeAll = b.trials.filter((t) => !t.holdout);
  const afterAll = a.trials.filter((t) => !t.holdout);
  const afterSuperseded = a.superseded.filter((t) => !t.holdout);
  const retried = afterAll.filter((t) => t.retryOf !== undefined);
  const hasRetry = (input.afterRetry ?? []).length > 0;
  const beforeMtek = beforeAll.filter((t) => t.side === "mtek");
  const afterMtek = afterAll.filter((t) => t.side === "mtek");
  duplicates(beforeMtek, "before");
  duplicates(afterMtek, "after");
  const models = [...new Set([...beforeMtek, ...afterMtek].map((t) => t.model))].sort();

  // The conditions: the Mtek variants of the trial kinds present in the after runs (what was re-run).
  const keys = [...new Set(afterMtek.map((t) => `${t.trialKind}\u0000${t.variant}`))].sort();
  const baselineRows = beforeAll.filter((t) => t.side === "baseline" && t.trialKind === "unconstrained");
  const baseline = baselineRows.length === 0 ? null : summarize(baselineRows);
  const conditions: ConditionComparison[] = keys.map((key) => {
    const [trialKind = "", variant = ""] = key.split("\u0000");
    const pick = (rows: readonly TrialRow[]): TrialRow[] => rows.filter((t) => t.trialKind === trialKind && t.variant === variant);
    const before = pick(beforeMtek);
    const after = pick(afterMtek);
    const judgedBefore = new Set(before.filter(JUDGED).map(cellKey));
    const judgedAfter = new Set(after.filter(JUDGED).map(cellKey));
    const matched = new Set([...judgedAfter].filter((k) => judgedBefore.has(k)));
    return {
      label: conditionLabel(trialKind, variant),
      variant,
      trialKind,
      before: sideOf(before, before.filter((t) => matched.has(cellKey(t)))),
      after: sideOf(after, after.filter((t) => matched.has(cellKey(t)))),
      afterJudgedCells: judgedAfter.size,
      matchedCells: matched.size,
      unmatchedAfter: judgedAfter.size - matched.size,
      replaced: pick(afterSuperseded.filter((t) => t.side === "mtek")),
      retried: pick(retried.filter((t) => t.side === "mtek")),
      h4: baselineRows.length === 0 ? null : h4Compare(after, baselineRows),
    };
  });

  const out: string[] = [];
  out.push(`# ${input.title ?? "Before and after: the Mtek conditions"}`, "");
  if (input.note !== undefined) out.push(input.note, "");
  out.push(
    "Generated from the stored `records.jsonl` files by `tools/ai-eval/src/compare-cli.ts` (decisions 0124 and 0125); the same records give the same text. Nothing here is read from a running process, a ledger or a hand computation. The completion rate is completed / attempts that ended by themselves (completed or failed); an attempt the harness could not judge (not-run, error, unavailable, unfinished by budget) is counted as an attempt and as neither. Tokens per completed task is all tokens of all attempts / completed tasks. This document compares two states of the same conditions" +
      (baseline === null ? "; the verdict against the baseline by the rule of decision 0108 is in the report." : ", and ends with the verdict of each condition after against the baseline of the runs before by the rule of decision 0108 (the report of the same runs gives the same verdict)."),
    "",
  );

  // ---- what is compared
  out.push("## What is compared", "");
  out.push("Runs before:", "", runTable(b.runs), "", "Runs after:", "", runTable(a.runs), "");
  if (models.length > 1) out.push(`Models differ between the runs (${models.join(", ")}): the comparison mixes models.`, "");
  else out.push(`Model of every compared attempt: ${models.join(", ") || "none"}.`, "");
  const bytes = (rows: readonly TrialRow[]): string => {
    const sizes = rows.map((t) => t.documentationBytes).filter((v): v is number => v !== null);
    return sizes.length === 0 ? "n/a" : n0(Math.max(...sizes));
  };
  const ids = (rows: readonly TrialRow[]): string => [...new Set(rows.map((t) => t.conditionId.slice(0, 12)))].join(", ") || "-";
  out.push(
    table(
      ["condition", "condition id before", "condition id after", "largest documentation before (bytes)", "largest documentation after (bytes)"],
      conditions.map((c) => [c.label, ids(c.before.rows), ids(c.after.rows), bytes(c.before.rows), bytes(c.after.rows)]),
    ),
    "",
  );
  out.push("A condition id covers the settings of the run and the KIND of documentation (the compiler's context export, or the context plus a named document with the hash of that document); it does not cover the text of the compiler's context export, which the compiler produces. The same id before and after therefore does not mean the same text was given to the model.", "");

  // ---- what was lost
  out.push("## What was lost", "");
  const lostRows = conditions.map((c) => {
    const lost = (rows: readonly TrialRow[]): TrialRow[] => rows.filter((t) => !JUDGED(t));
    const reasons = (rows: readonly TrialRow[]): string => {
      const by = new Map<string, number>();
      for (const t of lost(rows)) by.set(`${t.outcome}/${t.reason ?? "-"}`, (by.get(`${t.outcome}/${t.reason ?? "-"}`) ?? 0) + 1);
      return by.size === 0 ? "none" : [...by.entries()].sort().map(([reason, count]) => `${String(count)} ${reason}`).join(", ");
    };
    return [c.label, `${String(c.before.rows.length)}`, `${String(lost(c.before.rows).length)} (${reasons(c.before.rows)})`, `${String(c.after.rows.length)}`, `${String(lost(c.after.rows).length)} (${reasons(c.after.rows)})`];
  });
  out.push(table(["condition", "attempts before", "not judged before", "attempts after", "not judged after"], lostRows), "");
  const lostAfter = conditions.reduce((sum, c) => sum + c.after.rows.filter((t) => !JUDGED(t)).length, 0);
  const attemptsAfter = conditions.reduce((sum, c) => sum + c.after.rows.length, 0);
  const transportAfter = conditions.reduce((sum, c) => sum + c.after.rows.filter((t) => t.reason === "transport-error").length, 0);
  if (lostAfter === 0 && hasRetry) {
    out.push(`No attempt that counts after was lost: every one ended in success or failure. ${String(afterSuperseded.length)} attempts of the runs after were not judged and were replaced by the attempt of the same cell in the retry run${a.runs.filter((r) => r.retry === true).length === 1 ? "" : "s"} (below); the lost attempts are in no table of this document except the one below.`, "");
  } else if (lostAfter === 0) {
    out.push("No attempt of the runs after was lost: every one ended in success or failure.", "");
  } else {
    out.push(
      `Of ${String(attemptsAfter)} attempts of the runs after, ${String(lostAfter)} (${pct(lostAfter / attemptsAfter)}) were not judged and are in no completion rate${transportAfter === lostAfter ? ", all of them because the model could not be reached (reason `transport-error`: a connection error or a timeout, no response at all)" : transportAfter > 0 ? `, ${String(transportAfter)} of them because the model could not be reached (reason \`transport-error\`)` : ""}. ` +
        "Nothing is imputed for them: they are not counted as failures and not as successes, and the cells they occupy are left out of the matched comparison below.",
      "",
    );
    const byTrial = new Map<number, number>();
    for (const c of conditions) for (const t of c.after.rows) if (!JUDGED(t)) byTrial.set(t.trial, (byTrial.get(t.trial) ?? 0) + 1);
    out.push(`Trial index of the attempts not judged after (index: attempts): ${[...byTrial.entries()].sort((x, y) => x[0] - y[0]).map(([index, count]) => `${String(index)}: ${String(count)}`).join(", ")}.`, "");
  }

  // ---- the retries (decision 0125)
  if (hasRetry) {
    out.push("## Retries of the lost attempts", "");
    out.push(
      "A retry run supplies an attempt for a cell (task, condition, trial index) whose attempt in the other runs was NOT judged. In every table of this document the retry attempt stands in the place of the lost one; the lost attempt stays in the records and is listed here. A retry attempt for a cell that was judged would have been refused.",
      "",
    );
    const reasons = (rows: readonly TrialRow[]): string => {
      const by = new Map<string, number>();
      for (const t of rows) by.set(`${t.outcome}/${t.reason ?? "-"}`, (by.get(`${t.outcome}/${t.reason ?? "-"}`) ?? 0) + 1);
      return by.size === 0 ? "none" : [...by.entries()].sort().map(([reason, count]) => `${String(count)} ${reason}`).join(", ");
    };
    const trialsOf = (rows: readonly TrialRow[]): string => [...new Set(rows.map((t) => t.trial))].sort((x, y) => x - y).join(", ") || "-";
    out.push(
      table(
        ["condition", "retry run", "lost attempts replaced", "what they were", "trial index", "retry attempts", "completed", "failed", "not judged", "completed share of the retry attempts"],
        conditions.map((c) => {
          const s = summarize(c.retried);
          return [c.label, [...new Set(c.retried.map((t) => t.runId))].join(", ") || "-", String(c.replaced.length), reasons(c.replaced), trialsOf(c.replaced), String(c.retried.length), String(s.success), String(s.failure), String(s.n - s.valid), pct(s.n === 0 ? null : s.success / s.n)];
        }),
      ),
      "",
    );
    const unretried = conditions.reduce((sum, c) => sum + c.after.rows.filter((t) => !JUDGED(t)).length, 0);
    out.push(unretried === 0 ? "Every lost cell has a judged retry attempt." : `${String(unretried)} attempts are still not judged after the retries.`, "");
  }

  // ---- (a) all attempts as published
  out.push("## All attempts of each run, as published", "");
  out.push(
    hasRetry
      ? "Every attempt that counts, with the retry attempts in the place of the attempts they replaced (the lost attempts are not in these tables; they are listed above). Attempts that were not judged would count as attempts, not in the rate."
      : "Every attempt of each run, including the attempts that were not judged (they count as attempts, not in the rate). The two sides do not cover the same cells when attempts were lost.",
    "",
  );
  out.push(
    table(
      ["condition", "side", "attempts", "completed", "failed", "not judged", "completion rate", "tokens per completed task"],
      [
        ...conditions.flatMap((c) =>
          (["before", "after"] as const).map((which) => {
            const s = c[which].all;
            return [c.label, which, String(s.n), String(s.success), String(s.failure), String(s.n - s.valid), pct(s.completionRate), tok(s.tokensPerCompleted)];
          }),
        ),
        ...(baseline === null ? [] : [["baseline (three.js), copied from the runs before", "before", String(baseline.n), String(baseline.success), String(baseline.failure), String(baseline.n - baseline.valid), pct(baseline.completionRate), tok(baseline.tokensPerCompleted)]]),
      ],
    ),
    "",
  );
  if (baseline === null) out.push("The runs before hold no baseline attempt, so no baseline row is shown.", "");
  else out.push("The baseline was not re-run: its row is the baseline of the runs before, repeated for reference only.", "");
  out.push(table(SCOPE_HEADER, conditions.flatMap((c) => scopeRows(c.label, c.before.rows, c.after.rows))), "");

  // ---- (b) matched cells
  out.push("## Matched cells (judged in both runs)", "");
  out.push(
    "A cell is a task with a trial index. The matched cells of a condition are those judged in BOTH runs, so before and after cover exactly the same cells; the attempts that were lost are out of both sides. Tokens per completed task is computed over the matched cells only.",
    "",
  );
  out.push(
    table(
      ["condition", "cells judged after", "cells judged in both (matched)", "judged after without a judged attempt before"],
      conditions.map((c) => [c.label, String(c.afterJudgedCells), String(c.matchedCells), String(c.unmatchedAfter)]),
    ),
    "",
  );
  if (conditions.length > 0 && conditions.every((c) => c.matchedCells === c.after.rows.length && c.matchedCells === c.before.rows.length)) {
    out.push("Every cell of every condition is judged in both runs, so the matched cells are all the cells and the table below equals the table of all attempts above.", "");
  }
  out.push(table(SCOPE_HEADER, conditions.flatMap((c) => scopeRows(c.label, c.before.matchedRows, c.after.matchedRows))), "");
  if (baseline !== null) out.push("The baseline row for reference: see the table of all attempts above; it covers every cell and is not restricted to the matched cells.", "");

  // ---- the verdict against the baseline (decision 0108)
  if (baseline !== null) {
    out.push("## The verdict against the baseline (rule of decision 0108)", "");
    out.push(
      `Each condition after, over all attempts that count (the retry attempts in the place of the lost ones), against the ${String(baselineRows.length)} baseline attempts of the runs before, which were not re-run. Success is matched when the completion rates differ by at most 10 points; tokens per completed task are \`fewer\` or \`more\` only when the 95 % bootstrap interval over tasks of the ratio Mtek / baseline excludes 1; the research target is a ratio of at most 0.70 with the verdict better. The rule, in full, is in the report of the same runs.`,
      "",
    );
    for (const c of conditions) {
      if (c.h4 === null) continue;
      out.push(...conclusion(`Mtek ${c.label} against the baseline`, c.h4), "");
    }
    const provisional = conditions.flatMap((c) => (c.h4 === null || !c.h4.provisional ? [] : [`${c.label}: ${c.h4.provisionalReasons.join("; ")}`]));
    const minTrials = Math.min(...conditions.map((c) => c.h4?.minTrialsPerTaskSide ?? Number.POSITIVE_INFINITY));
    out.push(provisional.length === 0 ? `No verdict is provisional by the rule: every task has at least ${String(minTrials)} trials on each side, the largest share of attempts that could not be judged is ${pct(Math.max(...conditions.map((c) => c.h4?.mtek.excludedShare ?? 0), baseline.excludedShare))} (the limit is 10 %), and no token count is unknown.` : `Provisional by the rule: ${provisional.join(" | ")}.`, "");
  }

  // ---- the holdout (exploratory), from summary files only
  const holdout = input.holdout === undefined ? null : compareHoldout(input.holdout.earlier, input.holdout.later);
  if (holdout !== null) out.push(...holdoutSection(holdout), "");

  return { markdown: `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`, conditions, baseline, baselineRows, runs: { before: b.runs, after: a.runs }, holdout };
}

function holdoutSection(h: HoldoutComparison): string[] {
  const out: string[] = [];
  out.push("## Holdout (exploratory, numbers only)", "");
  out.push(
    `Computed from the holdout summary files only (ids, outcomes, tokens and cost; \`holdout-summary.jsonl\` for the earlier run and \`holdout-summary-m7-1.jsonl\` for the new one). ${String(h.tasks)} holdout tasks, ${String(h.trialsPerTask)} trials per task and condition, one model, one run of each condition: **exploratory**, not a result of the benchmark protocol. The holdout was not used for design (the repository check forbids holdout ids in tools, spec and docs), but its tasks may be easier or harder than the main set, so these rates are not comparable with the main set's. The holdout baseline was not re-run: the earlier baseline stands for both Mtek rows. Tokens per completed task is input plus output of all attempts / completed tasks.`,
    "",
  );
  out.push(
    table(
      ["set", "condition", "attempts", "completed", "failed", "not judged", "completion rate", "tokens per completed task", "cost"],
      h.conditions.map((c) => {
        const s = c.summary;
        return [c.set === "earlier" ? "earlier (M7-05, old documentation)" : "new (M7.1 documentation)", c.label, String(s.n), String(s.success), String(s.failure), String(s.n - s.valid), pct(s.completionRate), tok(s.tokensPerCompleted), `$${s.costUsd.toFixed(4)}`];
      }),
    ),
    "",
  );
  if (h.supersededRows.earlier + h.supersededRows.new > 0) {
    out.push(`${String(h.supersededRows.new)} rows of the new summary file are attempts that were lost to the network or the spend cap (not judged) and are replaced by the attempt of the same cell in the retry run; they are in no row above.`, "");
  }
  const rows = h.conditions.filter((c) => c.h4 !== null);
  if (rows.length > 0) {
    out.push("Verdict by the rule of decision 0108 against the earlier holdout baseline (the holdout has at least 5 tasks, so a verdict is allowed; all of them are exploratory):", "");
    out.push(
      table(
        ["set", "condition", "verdict", "completion difference", "token ratio Mtek / baseline", "95 % interval", "provisional by the rule", "reason"],
        rows.map((c) => {
          const v = c.h4 as H4Comparison;
          return [
            c.set === "earlier" ? "earlier" : "new",
            c.label,
            `${v.verdict.toUpperCase()} (exploratory)`,
            v.completionDifference === null ? "undefined" : `${n1(v.completionDifference * 100)} points`,
            v.interval.point === null ? "undefined" : v.interval.point.toFixed(3),
            v.interval.low === null || v.interval.high === null ? "none" : `[${v.interval.low.toFixed(3)}, ${v.interval.high.toFixed(3)}]`,
            v.provisional ? `yes: ${v.provisionalReasons.join("; ")}` : "no",
            v.reason,
          ];
        }),
      ),
      "",
    );
  }
  return out;
}
