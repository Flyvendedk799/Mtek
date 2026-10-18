// Execution tests of generated functions (spec/testing.md section 4.1, decision 0040). Every
// codegen fixture with an `exec.json` is built by the global setup with the **real** runtime
// bundle; each row
//
//   { "fn": "pick", "args": [{"i32": -5}], "expect": {"f32": 1.5},
//     "warnings": ["W8030"], "calls": 1, "tolerance": {"ulp": 2}, "id": "...", "note": "..." }
//
// names a function by its source name in src/main.mtek (or by its full symbol,
// `src/util.mtek::scale`), which the test looks up in the generated `functions` table and calls
// with a test `ctx` first and the decoded arguments (support/typed-values.ts). The result must
// equal `expect` bit for bit — every f32 a binary32 value, `-0` distinct from `0`, any NaN for a
// NaN — or lie within `tolerance` (transcendental functions only). The function is called `calls`
// times (default 1) with the same `ctx`, which must receive exactly the run-time warnings listed
// (index clamping reports `W8030` once per call site and context), each with the manifest span of
// an index expression. Arguments must not be modified.
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeContext } from "./support/fake-ctx.js";
import { codegenDir } from "./support/fixtures.js";
import { type BuiltProgram, type ProgramVariant, codegenFixtures, loadProgram, record, spanText } from "./support/programs.js";
import { type Tolerance, compare, decode } from "./support/typed-values.js";

interface ExecRow {
  readonly fn: string;
  readonly args: readonly unknown[];
  readonly expect: unknown;
  readonly id?: string;
  readonly tolerance?: Tolerance;
  readonly calls?: number;
  readonly warnings?: readonly string[];
  readonly note?: string;
}

const ROW_KEYS = new Set(["fn", "args", "expect", "id", "tolerance", "calls", "warnings", "note"]);

/** The functions that exist only to make the others CPU-reachable. */
const ROOTS = new Set(["src/main.mtek::reach_all"]);

function rowsOf(name: string): ExecRow[] {
  const parsed: unknown = JSON.parse(readFileSync(resolve(codegenDir, name, "exec.json"), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${name}/exec.json: expected an array of rows`);
  return (parsed as unknown[]).map((row, index) => {
    const object = record(row, `${name}/exec.json row ${index + 1}`);
    for (const key of Object.keys(object)) {
      if (!ROW_KEYS.has(key)) throw new Error(`${name}/exec.json row ${index + 1}: unknown key '${key}'`);
    }
    if (typeof object["fn"] !== "string" || !Array.isArray(object["args"])) {
      throw new Error(`${name}/exec.json row ${index + 1}: needs "fn" and "args"`);
    }
    return object as unknown as ExecRow;
  });
}

function symbolOf(fn: string): string {
  return fn.includes("::") ? fn : `src/main.mtek::${fn}`;
}

type Generated = (ctx: unknown, ...args: unknown[]) => unknown;

function functionOf(program: BuiltProgram, fn: string): Generated {
  const functions = record(program.module["functions"], "functions");
  const found = functions[symbolOf(fn)];
  if (typeof found !== "function") throw new Error(`${program.name}: no function ${symbolOf(fn)}`);
  return found as Generated;
}

/** A structural copy that keeps `-0` and typed arrays, to check arguments stay unmodified. */
function snapshot(value: unknown): unknown {
  if (value instanceof Float32Array) return Array.from(value, (v) => (Object.is(v, -0) ? "-0" : v));
  if (Array.isArray(value)) return (value as unknown[]).map(snapshot);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)]));
  }
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return value;
}

const execFixtures = codegenFixtures().filter((name) =>
  existsSync(resolve(codegenDir, name, "exec.json")),
);

// Both builds run every row: a preview build (decision 0075) computes exactly what a release build does, with a
// budget check at the head of every loop that never fires here (the context's budget is as large as a double
// can count). `preview budget` below checks what the checks do count.
for (const variant of ["release", "preview"] as const satisfies readonly ProgramVariant[]) {
  describe(`exec.json: generated functions against the real runtime bundle (${variant})`, () => {
    it("covers the function fixtures", () => {
      expect(execFixtures).toEqual(["assignable_places", "cpu_functions", "numeric_cpu_table"]);
    });

    for (const name of execFixtures) {
      const rows = rowsOf(name);

      describe(name, () => {
        it("calls every emitted function except the reaching root", async () => {
          const program = await loadProgram(name, variant);
          const called = new Set(rows.map((row) => symbolOf(row.fn)));
          const functions = Object.keys(record(program.module["functions"], "functions"));
          const missing = functions.filter((symbol) => !called.has(symbol) && !ROOTS.has(symbol));
          expect(missing).toEqual([]);
          for (const symbol of called) expect(functions).toContain(symbol);
        });

        rows.forEach((row, index) => {
          it(`${row.id ?? `#${index + 1}`} ${row.fn}`, async () => {
            const program = await loadProgram(name, variant);
            const generated = functionOf(program, row.fn);
            const args = row.args.map((arg, i) => decode(arg, `argument ${i}`));
            const before = snapshot(args);
            const { ctx, warnings } = createFakeContext(0);
            const calls = row.calls ?? 1;
            for (let call = 0; call < calls; call++) {
              const result = generated(ctx, ...args);
              expect(compare(result, row.expect, row.tolerance), `call ${call + 1}`).toEqual([]);
            }
            expect(snapshot(args)).toEqual(before);
            expect(warnings.map((w) => w.code)).toEqual(row.warnings ?? []);
            for (const warning of warnings) {
              expect(spanText(program, warning.spanId)).toMatch(/\[[^\]]+\]$/);
            }
          });
        });
      });
    }
  });
}

// The budget of a preview build, counted by the code the compiler really emits and the real runtime's helper
// (decision 0075): one iteration is one decrement, taken at the head of the body, so `continue` and `break` pay for the
// iteration they happen in; an empty range pays nothing; the check that finds the budget below zero reports the span
// of the loop.
describe("preview budget: the checks of a preview build count iterations", () => {

  /** The error `rt.budgetExceeded` of the built runtime bundle throws (a class of that bundle, so it is told by name). */
  const isBudgetError = (error: unknown): boolean =>
    error instanceof Error && error.name === "ExecutionBudgetExceeded" && typeof (error as { spanId?: unknown }).spanId === "number";

  async function run(fn: string, args: unknown[], budget: number, fixture = "cpu_functions"): Promise<{ result: unknown; left: number }> {
    const program = await loadProgram(fixture, "preview");
    const { ctx } = createFakeContext(0, [], budget);
    const generated = functionOf(program, fn);
    const result = generated(ctx, ...args);
    return { result, left: (ctx as unknown as { budget: { n: number } }).budget.n };
  }

  it("takes one unit per iteration, `continue` and `break` included", async () => {
    // for i in 0..n { if i == 3 { continue; } if i == 7 { break; } total += i; }: iterations 0..7 enter the body.
    expect(await run("sum_to", [10], 1000)).toEqual({ result: 0 + 1 + 2 + 4 + 5 + 6, left: 1000 - 8 });
    // A loop that runs to its end: 5 iterations (0..5), then the check of a sixth does not exist.
    expect(await run("sum_to", [5], 1000)).toEqual({ result: 0 + 1 + 2 + 4, left: 1000 - 5 });
    // `for i in 1..n` over u32 and `for v in values` over an array.
    expect(await run("count_u", [11], 1000)).toEqual({ result: 55, left: 990 });
    expect(await run("sum_each", [Float32Array.from([1, 2, 3])], 1000)).toEqual({ result: 6, left: 997 });
  });

  it("takes nothing for an empty range, and uses no budget outside loops", async () => {
    expect((await run("sum_to", [0], 1000)).left).toBe(1000);
    expect((await run("sum_to", [-5], 1000)).left).toBe(1000);
    expect((await run("classify", [1.5], 1000)).left).toBe(1000);
  });

  it("allows exactly the budget: the last iteration passes, the next one is refused", async () => {
    expect((await run("sum_each", [Float32Array.from([1, 2, 3])], 3)).left).toBe(0);
    expect((await run("sum_to", [4], 4)).left).toBe(0);
    let thrown: unknown;
    try {
      await run("sum_each", [Float32Array.from([1, 2, 3])], 2);
    } catch (error) {
      thrown = error;
    }
    expect(isBudgetError(thrown)).toBe(true);
  });

  it("stops an enormous loop after the budget and names the loop", async () => {
    const program = await loadProgram("cpu_functions", "preview");
    const { ctx } = createFakeContext(0, [], 5_000);
    const started = performance.now();
    let thrown: unknown;
    try {
      // 2 000 000 000 iterations would take seconds; the budget ends it after 5 000.
      (functionOf(program, "count_u"))(ctx, 2_000_000_000);
    } catch (error) {
      thrown = error;
    }
    expect(performance.now() - started).toBeLessThan(1000);
    expect(isBudgetError(thrown)).toBe(true);
    const { spanId } = thrown as { spanId: number };
    expect(spanText(program, spanId)).toMatch(/^for i in 1\.\.n \{[\s\S]*\}$/);
    expect((ctx as unknown as { budget: { n: number } }).budget.n).toBe(-1);
  });

  it("a release build has no checks and does not touch the budget", async () => {
    const program = await loadProgram("cpu_functions");
    expect(program.appText).not.toContain("budget");
    const { ctx } = createFakeContext(0, [], 7);
    (functionOf(program, "sum_to"))(ctx, 10);
    expect((ctx as unknown as { budget: { n: number } }).budget.n).toBe(7);
  });
});
