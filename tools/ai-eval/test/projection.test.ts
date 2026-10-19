// The cost projection and the order of a run (decision 0108): arithmetic on measured means, and the two orders in which the
// attempts of a run can be made.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plan, taskIdsIn } from "../src/benchmark-run.ts";
import { conditionCosts, HIGH_FACTOR, HOLDOUT_SET, MAIN_SET, projectScope, renderProjection, SCOPES, type ConditionCost } from "../src/projection.ts";
import type { TrialRow } from "../src/report.ts";
import { mtekSide, baselineSide } from "../src/side.ts";
import { loadTask } from "../src/task.ts";
import { REPO_ROOT, editTask } from "./helpers.ts";

function row(side: "mtek" | "baseline", variant: string, mode: "cold" | "edit", costUsd: number | null, seconds = 10): TrialRow {
  return { side, variant, mode, costUsd, durationMs: seconds * 1000 } as unknown as TrialRow;
}

const COSTS: ConditionCost[] = conditionCosts([
  row("mtek", "", "cold", 0.04),
  row("mtek", "", "cold", 0.02),
  row("mtek", "", "edit", 0.02),
  row("baseline", "", "cold", 0.01),
  row("baseline", "", "edit", 0.005, 20),
  row("baseline", "", "edit", null), // an attempt without a recorded cost is not part of any mean
  row("mtek", "+guide", "edit", 0.03),
]);

describe("measured costs", () => {
  it("are the mean per attempt by mode, the dearest attempt and the mean time, per condition", () => {
    const mtek = COSTS.find((c) => c.key === "mtek");
    expect(mtek?.meanUsd.cold).toBeCloseTo(0.03, 12);
    expect(mtek?.meanUsd.edit).toBeCloseTo(0.02, 12);
    expect(mtek?.meanUsd.all).toBeCloseTo(0.08 / 3, 12);
    expect(mtek?.maxUsd).toBe(0.04);
    expect(mtek?.attemptsByMode).toEqual({ cold: 2, edit: 1 });
    const baseline = COSTS.find((c) => c.key === "baseline");
    expect(baseline?.attempts).toBe(2);
    expect(baseline?.meanSeconds).toBe(15);
    expect(COSTS.map((c) => c.key)).toEqual(["baseline", "mtek", "mtek+guide"]);
    expect(COSTS.find((c) => c.key === "mtek+guide")?.meanUsd.cold).toBeNull();
  });
});

describe("a projected scope", () => {
  const scope = { name: "t", description: "t", drops: "nothing", parts: [{ tasks: { cold: 10, edit: 20 }, trials: 5, conditions: ["mtek", "baseline"] }] };

  it("weights the cost of each mode by the number of tasks of that mode, times the trials, summed over the conditions", () => {
    const p = projectScope(scope, COSTS);
    expect(p.attempts).toBe(300);
    expect(p.central).toBeCloseTo(50 * 0.03 + 100 * 0.02 + 50 * 0.01 + 100 * 0.005, 10);
    expect(p.high).toBeCloseTo(p.central * HIGH_FACTOR, 10);
    expect(p.ceiling).toBeCloseTo(150 * 0.04 + 150 * 0.01, 10);
    expect(p.byCondition.map((c) => c.key)).toEqual(["mtek", "baseline"]);
  });

  it("falls back to the all-mode mean for a mode the pilot did not see, and refuses a condition it never ran", () => {
    const p = projectScope({ ...scope, parts: [{ tasks: { cold: 10, edit: 0 }, trials: 1, conditions: ["mtek+guide"] }] }, COSTS);
    expect(p.central).toBeCloseTo(10 * 0.03, 10);
    expect(() => projectScope({ ...scope, parts: [{ tasks: { cold: 1, edit: 1 }, trials: 1, conditions: ["mtek-reference"] }] }, COSTS)).toThrow(/never ran|no attempt of condition/);
  });

  it("sums the parts of a scope", () => {
    const two = projectScope({ ...scope, parts: [{ tasks: { cold: 1, edit: 0 }, trials: 2, conditions: ["mtek"] }, { tasks: { cold: 0, edit: 1 }, trials: 3, conditions: ["baseline"] }] }, COSTS);
    expect(two.attempts).toBe(5);
    expect(two.central).toBeCloseTo(2 * 0.03 + 3 * 0.005, 10);
  });
});

describe("the scopes offered", () => {
  it("count the tasks of the main set as the repository has them", () => {
    const main = taskIdsIn(join(REPO_ROOT, "benchmarks", "tasks")).map((id) => loadTask(join(REPO_ROOT, "benchmarks", "tasks", id)));
    expect(main.filter((t) => t.mode === "cold")).toHaveLength(MAIN_SET.cold);
    expect(main.filter((t) => t.mode === "edit")).toHaveLength(MAIN_SET.edit);
    // the holdout is only counted, never read: its size is the sum
    expect(readdirSync(join(REPO_ROOT, "benchmarks", "holdout"), { withFileTypes: true }).filter((e) => e.isDirectory())).toHaveLength(HOLDOUT_SET.cold + HOLDOUT_SET.edit);
  });

  it("render as a table with the budget they are compared with and what each drops", () => {
    const text = renderProjection(COSTS, 8);
    expect(text).toContain("## Measured per attempt");
    expect(text).toContain("| S0 full protocol |");
    expect(text).toContain("The budget compared with is $8.00");
    for (const scope of SCOPES) expect(text).toContain(scope.drops);
  });

  it("include the full protocol first and keep the trials of every scope at least one", () => {
    expect(SCOPES[0]?.name).toBe("S0 full protocol");
    expect(SCOPES[0]?.parts[0]?.trials).toBe(5);
    for (const scope of SCOPES) for (const part of scope.parts) expect(part.trials).toBeGreaterThanOrEqual(1);
  });
});

describe("the order of a run", () => {
  const tasks = [editTask(), { ...editTask(), id: "demo-02" }];
  const sides = [mtekSide, baselineSide];
  const name = (p: ReturnType<typeof plan>[number]): string => `${p.task.id}/${p.side.label}/${String(p.trial)}`;

  it("is trial-major by default: every task and side once before any is repeated", () => {
    const order = plan(tasks, sides, ["unconstrained"], 0, 2, "trial-major").map(name);
    expect(order).toEqual(["demo-01/mtek/0", "demo-01/baseline/0", "demo-02/mtek/0", "demo-02/baseline/0", "demo-01/mtek/1", "demo-01/baseline/1", "demo-02/mtek/1", "demo-02/baseline/1"]);
  });

  it("can be task-major: the trials of a task and side one after another (the cache serves their first prompt)", () => {
    const order = plan(tasks, sides, ["unconstrained"], 3, 2, "task-major").map(name);
    expect(order).toEqual(["demo-01/mtek/3", "demo-01/mtek/4", "demo-01/baseline/3", "demo-01/baseline/4", "demo-02/mtek/3", "demo-02/mtek/4", "demo-02/baseline/3", "demo-02/baseline/4"]);
  });

  it("makes the same attempts in either order", () => {
    const a = plan(tasks, sides, ["unconstrained", "constrained"], 0, 3, "trial-major").map((p) => `${name(p)}/${p.kind}`).sort();
    const b = plan(tasks, sides, ["unconstrained", "constrained"], 0, 3, "task-major").map((p) => `${name(p)}/${p.kind}`).sort();
    expect(a).toEqual(b);
    expect(a).toHaveLength(2 * 2 * 2 * 3);
    expect(readFileSync(join(REPO_ROOT, "tools", "ai-eval", "src", "benchmark-run.ts"), "utf8")).toContain("trial-major");
  });
});
