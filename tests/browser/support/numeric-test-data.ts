// The numeric conformance data files, loaded for the unit tests and the generated listing (task M2-08).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./environment.ts";
import { AccuracyEvaluator, parseTolerances } from "./numeric-accuracy.ts";
import { notComparedCases, resolveEntry, wgslFloatToInt } from "./numeric-compare.ts";
import { type CpuTable, decodeTyped, parseCpuTable } from "./numeric-values.ts";

export const NUMERIC_DIR = join(REPO_ROOT, "tests", "semantics", "numeric");
export const NOT_COMPARED_PATH = join(NUMERIC_DIR, "gpu-not-compared.json");

export function loadTable(): CpuTable {
  return parseCpuTable(readFileSync(join(NUMERIC_DIR, "cpu.json"), "utf8"));
}

export function loadEvaluator(): AccuracyEvaluator {
  return new AccuracyEvaluator(parseTolerances(readFileSync(join(NUMERIC_DIR, "tolerances.json"), "utf8")));
}

/**
 * The text of `gpu-not-compared.json`: every case of cpu.json the GPU comparison does not compare
 * (non-portable, or outside a WGSL accuracy domain), the portable cases where WGSL specifies a result
 * other than the CPU's, and the known deviations. Generated; checked for staleness by
 * `numeric-tables.test.ts` (`MTEK_BLESS=1` rewrites it).
 */
export function notComparedListing(table: CpuTable, evaluator: AccuracyEvaluator): string {
  const listed = notComparedCases(table.cases, evaluator);
  const portable = new Set(table.cases.filter((c) => c.portable).map((c) => c.id));
  const line = (value: unknown): string => `    ${JSON.stringify(value)}`;
  const section = (values: readonly unknown[]): string => (values.length === 0 ? "[]" : `[\n${values.map(line).join(",\n")}\n  ]`);
  const wgslDiffers = table.cases.flatMap((row) => {
    const entry = resolveEntry(row, evaluator);
    const expect = decodeTyped(row.expect, row.id);
    if (!row.portable || entry.accuracy.kind !== "conversion" || (expect.type !== "i32" && expect.type !== "u32")) return [];
    const x = decodeTyped(row.args[0] ?? {}, row.id).components[0] ?? NaN;
    if (decodeTyped(row.args[0] ?? {}, row.id).type !== "f32") return [];
    const wgsl = wgslFloatToInt(x, expect.type);
    return wgsl === expect.components[0] ? [] : [{ id: row.id, cpu: expect.components[0], wgsl, decision: "0043" }];
  });
  return [
    "{",
    '  "$comment": [',
    '    "Generated from cpu.json and tolerances.json by tests/browser/support/numeric-test-data.ts; do not edit",',
    '    "(MTEK_BLESS=1 npm run test:unit -w @mtek/browser-tests rewrites it). Task M2-08, decision 0043.",',
    '    "nonPortable: cases cpu.json marks non-portable (decision 0037 item 10); the CPU result is the specified one.",',
    '    "outsideAccuracyDomain: portable cases outside the input range WGSL states an accuracy for (15.7.4).",',
    '    "Neither is compared with the GPU; their GPU values are still written to the browser report.",',
    '    "cpuDiffersFromWgsl: portable cases compared with the WGSL result, which differs from the CPU (spec issue).",',
    '    "knownDeviations: measured platform deviations from the WGSL bound (tolerances.json)."',
    "  ],",
    '  "format": "mtek-numeric-gpu-not-compared/1",',
    `  "nonPortable": ${section(listed.filter((c) => !portable.has(c.id)))},`,
    `  "outsideAccuracyDomain": ${section(listed.filter((c) => portable.has(c.id)))},`,
    `  "cpuDiffersFromWgsl": ${section(wgslDiffers)},`,
    `  "knownDeviations": ${section(evaluator.tolerances.knownDeviations.map((d) => ({ id: d.id, decision: d.decision })))}`,
    "}",
    "",
  ].join("\n");
}

export function blessing(): boolean {
  return process.env["MTEK_BLESS"] === "1";
}

export function writeNotComparedListing(text: string): void {
  writeFileSync(NOT_COMPARED_PATH, text);
}
