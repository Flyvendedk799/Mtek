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
import { type BuiltProgram, codegenFixtures, loadProgram, record, spanText } from "./support/programs.js";
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

describe("exec.json: generated functions against the real runtime bundle", () => {
  it("covers the function fixtures", () => {
    expect(execFixtures).toEqual(["assignable_places", "cpu_functions", "numeric_cpu_table"]);
  });

  for (const name of execFixtures) {
    const rows = rowsOf(name);

    describe(name, () => {
      it("calls every emitted function except the reaching root", async () => {
        const program = await loadProgram(name);
        const called = new Set(rows.map((row) => symbolOf(row.fn)));
        const functions = Object.keys(record(program.module["functions"], "functions"));
        const missing = functions.filter((symbol) => !called.has(symbol) && !ROOTS.has(symbol));
        expect(missing).toEqual([]);
        for (const symbol of called) expect(functions).toContain(symbol);
      });

      rows.forEach((row, index) => {
        it(`${row.id ?? `#${index + 1}`} ${row.fn}`, async () => {
          const program = await loadProgram(name);
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
