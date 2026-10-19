// The cost projection of the AI/token benchmark (decision 0108): what a scope of the protocol would cost, from the
// cost per attempt that a pilot MEASURED for each condition and mode (cold authoring, edit). The projection is arithmetic on
// measured means, nothing is run, and three figures are given so that the reader sees how much it leans on a small pilot:
//   central  the pilot's mean cost per attempt, weighted by the share of cold and edit tasks of the scope
//   high     central x 1.5 (a pilot of 6 to 8 attempts per condition is a small sample: failure rates, and so cost, can be higher)
//   ceiling  every attempt as dear as the dearest attempt of its condition in the pilot
// A run is protected by the spend guard anyway: when the cap is reached the remaining attempts are recorded as unfinished
// instead of being paid for, so a scope whose high figure is above the budget degrades into fewer trials, never an overspend.
import { sum } from "./stats.ts";
import type { TrialRow } from "./report.ts";

/** The number of tasks of the main set and of the holdout by mode (decision 0085 and the task files; a test checks the main set). */
export const MAIN_SET = { cold: 11, edit: 23 } as const;
export const HOLDOUT_SET = { cold: 3, edit: 5 } as const;

/** Tasks by mode, trials per task, and the conditions run on them (labels as `cellKey` gives them: `mtek`, `baseline`, `mtek+guide`). */
export interface ScopePart {
  tasks: { cold: number; edit: number };
  trials: number;
  conditions: readonly string[];
}

export interface Scope {
  name: string;
  description: string;
  parts: readonly ScopePart[];
  /** What the scope leaves out relative to the full protocol. */
  drops: string;
}

export interface ConditionCost {
  key: string;
  attempts: number;
  meanUsd: { cold: number | null; edit: number | null; all: number };
  maxUsd: number;
  meanSeconds: number;
  /** Attempts the mean rests on, by mode. */
  attemptsByMode: { cold: number; edit: number };
}

export interface ScopeCost {
  scope: Scope;
  attempts: number;
  central: number;
  high: number;
  ceiling: number;
  seconds: number;
  byCondition: { key: string; attempts: number; central: number }[];
}

export const HIGH_FACTOR = 1.5;

export function cellKey(row: Pick<TrialRow, "side" | "variant">): string {
  return `${row.side}${row.variant}`;
}

/** Measured cost per attempt of every condition in `rows`, by mode. */
export function conditionCosts(rows: readonly TrialRow[]): ConditionCost[] {
  const keys = [...new Set(rows.map(cellKey))].sort();
  return keys.map((key) => {
    const mine = rows.filter((r) => cellKey(r) === key && r.costUsd !== null);
    const mean = (subset: readonly TrialRow[]): number | null => (subset.length === 0 ? null : sum(subset.map((r) => r.costUsd as number)) / subset.length);
    const cold = mine.filter((r) => r.mode === "cold");
    const edit = mine.filter((r) => r.mode === "edit");
    return {
      key,
      attempts: mine.length,
      meanUsd: { cold: mean(cold), edit: mean(edit), all: mean(mine) ?? 0 },
      maxUsd: Math.max(0, ...mine.map((r) => r.costUsd as number)),
      meanSeconds: mine.length === 0 ? 0 : sum(mine.map((r) => r.durationMs / 1000)) / mine.length,
      attemptsByMode: { cold: cold.length, edit: edit.length },
    };
  });
}

/** The cost of a scope. A condition the pilot never ran has no figure and fails the projection rather than being guessed. */
export function projectScope(scope: Scope, costs: readonly ConditionCost[]): ScopeCost {
  let central = 0;
  let ceiling = 0;
  let seconds = 0;
  let attempts = 0;
  const byCondition: ScopeCost["byCondition"] = [];
  for (const part of scope.parts) {
    for (const key of part.conditions) {
      const cost = costs.find((c) => c.key === key);
      if (cost === undefined) throw new Error(`the pilot has no attempt of condition '${key}': it cannot be projected`);
      const cold = part.tasks.cold * part.trials;
      const edit = part.tasks.edit * part.trials;
      const money = cold * (cost.meanUsd.cold ?? cost.meanUsd.all) + edit * (cost.meanUsd.edit ?? cost.meanUsd.all);
      central += money;
      ceiling += (cold + edit) * cost.maxUsd;
      seconds += (cold + edit) * cost.meanSeconds;
      attempts += cold + edit;
      byCondition.push({ key, attempts: cold + edit, central: money });
    }
  }
  return { scope, attempts, central, high: central * HIGH_FACTOR, ceiling, seconds, byCondition };
}

const ALL = { cold: MAIN_SET.cold + HOLDOUT_SET.cold, edit: MAIN_SET.edit + HOLDOUT_SET.edit };
/** Every second task of the sorted main set (the shares of cold and edit tasks are kept). */
const HALF = { cold: 6, edit: 11 };

/** The scopes the orchestrator can choose from. */
export const SCOPES: readonly Scope[] = [
  {
    name: "S0 full protocol",
    description: "34 main tasks + 8 holdout tasks, 5 trials each, Mtek (compiler context) and the baseline",
    parts: [{ tasks: ALL, trials: 5, conditions: ["mtek", "baseline"] }],
    drops: "nothing of the protocol",
  },
  {
    name: "S1 main set at the protocol's trials",
    description: "34 main tasks, 5 trials each, Mtek (compiler context) and the baseline",
    parts: [{ tasks: { ...MAIN_SET }, trials: 5, conditions: ["mtek", "baseline"] }],
    drops: "the holdout (8 tasks, 40 attempts per condition)",
  },
  {
    name: "S2 S1 + the guide on half the tasks",
    description: "S1, plus Mtek with docs/language-guide.md added on 17 main tasks, 3 trials each",
    parts: [
      { tasks: { ...MAIN_SET }, trials: 5, conditions: ["mtek", "baseline"] },
      { tasks: HALF, trials: 3, conditions: ["mtek+guide"] },
    ],
    drops: "the holdout; the guide condition covers half the tasks with 3 trials (provisional)",
  },
  {
    name: "S3 all 42 tasks at 3 trials",
    description: "34 main tasks + 8 holdout tasks, 3 trials each, Mtek (compiler context) and the baseline",
    parts: [{ tasks: ALL, trials: 3, conditions: ["mtek", "baseline"] }],
    drops: "trials 5 to 3: below the protocol minimum, so every verdict is provisional",
  },
  {
    name: "S4 main set, three conditions at 3 trials",
    description: "34 main tasks, 3 trials each, Mtek (compiler context), Mtek with the guide, and the baseline",
    parts: [{ tasks: { ...MAIN_SET }, trials: 3, conditions: ["mtek", "mtek+guide", "baseline"] }],
    drops: "the holdout; trials 5 to 3 (provisional)",
  },
  {
    name: "S5 half the main set at 5 trials, three conditions",
    description: "17 main tasks (every second task), 5 trials each, Mtek (compiler context), Mtek with the guide, and the baseline",
    parts: [{ tasks: HALF, trials: 5, conditions: ["mtek", "mtek+guide", "baseline"] }],
    drops: "17 of the 34 main tasks and the holdout: the subset is a sample of the set, not the set",
  },
];

const usd = (v: number): string => `$${v.toFixed(2)}`;
const hours = (seconds: number): string => `${(seconds / 3600).toFixed(1)} h`;

export function renderProjection(costs: readonly ConditionCost[], budgetUsd: number, scopes: readonly Scope[] = SCOPES): string {
  const lines: string[] = [];
  lines.push("# Cost projection for the full AI/token benchmark (from the pilot)", "");
  lines.push(
    "Arithmetic on the cost per attempt that the pilot measured; nothing here was run. `central` is the pilot mean weighted by the share of cold and edit tasks of the scope, " +
      `\`high\` is central x ${String(HIGH_FACTOR)} (the pilot is small), \`ceiling\` prices every attempt as the dearest attempt of its condition in the pilot. Wall time is the pilot's mean seconds per attempt, run one attempt at a time. ` +
      `The budget compared with is ${usd(budgetUsd)}.`,
    "",
  );
  lines.push("## Measured per attempt", "");
  lines.push("| condition | attempts | mean cost, cold | mean cost, edit | mean cost, all | dearest attempt | mean seconds |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const c of costs) {
    const m = (v: number | null, n: number): string => (v === null ? "none" : `$${v.toFixed(4)} (n=${String(n)})`);
    lines.push(`| ${c.key} | ${String(c.attempts)} | ${m(c.meanUsd.cold, c.attemptsByMode.cold)} | ${m(c.meanUsd.edit, c.attemptsByMode.edit)} | $${c.meanUsd.all.toFixed(4)} | $${c.maxUsd.toFixed(4)} | ${c.meanSeconds.toFixed(1)} |`);
  }
  lines.push("", "## Scopes", "");
  lines.push("| scope | what it runs | attempts | central | high | ceiling | fits the budget | time | what it drops |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const scope of scopes) {
    const p = projectScope(scope, costs);
    const fits = p.high <= budgetUsd ? "yes, also at high" : p.central <= budgetUsd ? "at central only" : "no";
    lines.push(`| ${scope.name} | ${scope.description} | ${String(p.attempts)} | ${usd(p.central)} | ${usd(p.high)} | ${usd(p.ceiling)} | ${fits} | ${hours(p.seconds)} | ${scope.drops} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
