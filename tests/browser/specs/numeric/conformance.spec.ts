// CPU/GPU numeric conformance (task M2-08, spec/testing.md section 5, decision 0043): every case of
// tests/semantics/numeric/cpu.json is evaluated on the GPU by the compiler's own WGSL for the operation
// (support/numeric-probe.ts), and every portable case is compared with the CPU result — bit-exact rows
// exactly, tolerance rows within the WGSL accuracy of tests/semantics/numeric/tolerances.json plus one
// step for CPU rounding. Cases that are not compared are listed in gpu-not-compared.json; their GPU
// values are still written to the report. The full per-row report is
// `$MTEK_RESULTS_DIR/numeric-conformance-<project>.json`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../../support/fixtures.ts";
import { BROWSER_ROOT } from "../../support/environment.ts";
import { AccuracyEvaluator, parseTolerances } from "../../support/numeric-accuracy.ts";
import type { NumericProbeResult } from "../../support/numeric-api.ts";
import { type RowResult, compareRow, summarize } from "../../support/numeric-compare.ts";
import { CPU_TABLE_PATH, TOLERANCES_PATH, type ProbePlan, caseWords } from "../../support/numeric-probe.ts";
import { parseCpuTable } from "../../support/numeric-values.ts";

const NUMERIC_OUT = join(BROWSER_ROOT, ".out", "numeric");

function loadPlan(): ProbePlan {
  return JSON.parse(readFileSync(join(NUMERIC_OUT, "probe.json"), "utf8")) as ProbePlan;
}

/** The compiled body of `fn <name>(…) { … }` in the material WGSL. */
function helperBody(wgsl: string, name: string): string {
  const start = wgsl.indexOf(`\nfn ${name}(`);
  if (start < 0) throw new Error(`the compiled material has no helper ${name}`);
  const end = wgsl.indexOf("\n}\n", start);
  return wgsl.slice(start, end);
}

test("the compiled helpers are the expressions whose accuracy tolerances.json bounds", () => {
  const wgsl = readFileSync(join(NUMERIC_OUT, "material.wgsl"), "utf8");
  const tolerances = parseTolerances(readFileSync(TOLERANCES_PATH, "utf8"));
  const checked: string[] = [];
  for (const entry of tolerances.entries) {
    if (entry.helper === undefined || entry.accuracy.kind !== "inherited") continue;
    const body = helperBody(wgsl, entry.helper);
    // The compiled helper prefixes its parameters and locals with `mtek_` (decision 0041 item 3).
    const compiled = body.replace(/\bmtek_(?!quat_|mat4_|color_|srgb_)(\w+)/g, "$1");
    if (entry.helperCheck === "manual") {
      // mtek_srgb_channel: the `if` of the helper, written as select(...) in tolerances.json.
      expect(compiled).toContain("if c <= 0.04045 {");
      expect(compiled).toContain("return c / 12.92;");
      expect(compiled).toContain("return pow((c + 0.055) / 1.055, 2.4);");
    } else {
      for (const binding of entry.accuracy.lets ?? []) expect(compiled, `${entry.key}: let ${binding}`).toContain(`let ${binding};`);
      expect(compiled, `${entry.key}: return`).toContain(`return ${entry.accuracy.expr};`);
    }
    checked.push(entry.helper);
  }
  expect(checked.sort()).toEqual([
    "mtek_color_srgb", "mtek_mat4_rotation", "mtek_quat_axis_angle", "mtek_quat_euler", "mtek_quat_mul",
    "mtek_quat_rotate", "mtek_srgb_channel",
  ]);
});

test("every portable case of cpu.json agrees on the GPU: bit-exact rows exactly, the rest within the WGSL tolerances", async ({ page, gpu }, testInfo) => {
  const table = parseCpuTable(readFileSync(CPU_TABLE_PATH, "utf8"));
  const evaluator = new AccuracyEvaluator(parseTolerances(readFileSync(TOLERANCES_PATH, "utf8")));
  const plan = loadPlan();
  expect(plan.cases.map((c) => c.id), "the probe plan covers the table").toEqual(table.cases.map((c) => c.id));

  await page.goto("/numeric.html");
  await page.waitForFunction(() => window.__numeric !== undefined);
  const result: NumericProbeResult = await page.evaluate(() => {
    const api = window.__numeric;
    if (api === undefined) throw new Error("window.__numeric is missing");
    return api.run();
  });
  expect(result.errors, "no uncaptured GPU errors").toEqual([]);
  expect(result.words).toHaveLength(plan.width * plan.height * 4);

  const rows: RowResult[] = table.cases.map((row, index) => compareRow(row, caseWords(plan, result.words, index), evaluator));
  const summary = summarize(rows);
  const adapter = gpu.record.gpu.adapter;
  const report = {
    project: testInfo.project.name,
    adapter,
    compilationMessages: result.compilationMessages,
    summary,
    rows,
  };
  const resultsDir = process.env["MTEK_RESULTS_DIR"];
  if (resultsDir === undefined) throw new Error("MTEK_RESULTS_DIR is not set");
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, `numeric-conformance-${testInfo.project.name}.json`), `${JSON.stringify(report, null, 2)}\n`);

  const { exact, tolerance, notCompared, permissions } = summary;
  testInfo.annotations.push(
    { type: "numeric: bit-exact rows", description: `${exact.match} identical, ${exact.permitted} differing only as WGSL permits (${JSON.stringify(permissions)}), ${exact.specDisagreement} spec disagreements, ${exact.failed} failed, of ${exact.total}` },
    { type: "numeric: tolerance rows", description: `${tolerance.within} within (${tolerance.withinWgslBound} without the CPU step), ${tolerance.knownDeviation} known deviations (tolerances.json knownDeviations), ${tolerance.failed} failed, of ${tolerance.total}` },
    { type: "numeric: not compared", description: `${notCompared.nonPortable} non-portable, ${notCompared.outsideDomain} outside a WGSL accuracy domain (gpu-not-compared.json)` },
  );
  for (const row of rows.filter((r) => r.status === "spec-disagreement" || r.status === "permitted" || r.status === "known-deviation")) {
    testInfo.annotations.push({ type: `numeric: ${row.status}`, description: `${row.id}: ${row.reason ?? (row.permissions ?? []).join(", ")}` });
  }

  const failures = rows.filter((r) => r.status === "fail").map((r) => `${r.id} (${r.key}): ${r.reason ?? ""}`);
  expect(failures, "CPU/GPU disagreements (a lowering bug or a spec issue: see decision 0043)").toEqual([]);
  expect(exact.total + tolerance.total + notCompared.outsideDomain).toBe(table.cases.filter((c) => c.portable).length);
});
