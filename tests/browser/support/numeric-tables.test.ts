// tests/semantics/numeric/tolerances.json against cpu.json, without a GPU (task M2-08, decision 0043):
// every entry cites WGSL, every case resolves to an entry, every CPU expectation lies inside the
// interval WGSL allows for its inputs, and gpu-not-compared.json is current.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExpr } from "./numeric-accuracy.ts";
import { compareRow, notComparedCases, resolveEntry } from "./numeric-compare.ts";
import { NOT_COMPARED_PATH, blessing, loadEvaluator, loadTable, notComparedListing, writeNotComparedListing } from "./numeric-test-data.ts";
import { decodeTyped, f32Bits, isFloatType } from "./numeric-values.ts";

const table = loadTable();
const evaluator = loadEvaluator();
const tolerances = evaluator.tolerances;

/** The CPU's own words for a case: the comparison of the CPU with itself. */
function cpuWords(id: string): number[] {
  const row = table.cases.find((c) => c.id === id);
  if (row === undefined) throw new Error(`no case ${id}`);
  const expect = decodeTyped(row.expect, id);
  return expect.components.map((c) => (isFloatType(expect.type) ? f32Bits(c) : c >>> 0));
}

describe("tolerances.json", () => {
  it("cites the WGSL section, anchor and text of every entry and rule", () => {
    expect(tolerances.source).toMatchObject({ ref: "S5", url: "https://www.w3.org/TR/WGSL/" });
    for (const citation of [...tolerances.rules, ...tolerances.entries.flatMap((e) => e.cite)]) {
      expect(citation.section).toMatch(/^\d+(\.\d+)*$/);
      expect(citation.anchor).toMatch(/^[A-Za-z0-9-]+$/);
      expect(citation.quote.length).toBeGreaterThan(5);
    }
    for (const entry of tolerances.entries) {
      expect(entry.cite.length, entry.key).toBeGreaterThan(0);
      // Every bound transcribed from the accuracy section cites it.
      if (entry.compare === "tolerance" || entry.accuracy.kind === "correctlyRounded") {
        expect(entry.cite.some((c) => c.section.startsWith("15.7.4")), `${entry.key} cites 15.7.4`).toBe(true);
      }
      if (entry.compare === "tolerance") expect(tolerances.cpuRoundingUlp).toBe(1);
    }
  });

  it("parses every inherited expression and refers only to entries that exist", () => {
    const names = new Set(tolerances.entries.flatMap((e) => [e.wgslOp, e.helper]).filter((n) => n !== undefined));
    for (const entry of tolerances.entries) {
      if (entry.accuracy.kind !== "inherited") continue;
      const texts = [entry.accuracy.expr, ...(entry.accuracy.lets ?? []).map((b) => b.slice(b.indexOf("=") + 1))];
      for (const text of texts) {
        expect(() => parseExpr(text), `${entry.key}: ${text}`).not.toThrow();
        for (const [, call] of text.matchAll(/([A-Za-z_]\w*)\(/g)) {
          if (call === undefined || ["select", "sum_of_products"].includes(call)) continue;
          expect(names.has(call), `${entry.key}: ${call}`).toBe(true);
        }
      }
    }
  });

  it("has an entry for every case of cpu.json, and every entry is used", () => {
    const used = new Set(table.cases.map((row) => resolveEntry(row, evaluator).key));
    const referenced = new Set<string>();
    for (const entry of tolerances.entries) {
      if (entry.accuracy.kind !== "inherited") continue;
      const text = [entry.accuracy.expr, ...(entry.accuracy.lets ?? [])].join(" ");
      for (const other of tolerances.entries) {
        const names = [other.wgslOp, other.helper].filter((n) => n !== undefined);
        if (names.some((name) => text.includes(`${name}(`) || (/^[-+*/]$/.test(name) && text.includes(` ${name} `)))) referenced.add(other.key);
      }
    }
    const unused = tolerances.entries.map((e) => e.key).filter((key) => !used.has(key) && !referenced.has(key));
    expect(unused).toEqual([]);
  });

  it("puts every portable CPU expectation inside the interval WGSL allows for its inputs", () => {
    const failures = table.cases
      .map((row) => compareRow(row, cpuWords(row.id), evaluator))
      .filter((result) => result.status === "fail" || result.status === "known-deviation")
      .map((result) => `${result.id}: ${result.reason ?? ""}`);
    expect(failures).toEqual([]);
  });

  it("lists exact rows only for portable rows of tolerance entries", () => {
    for (const exact of tolerances.exactRows ?? []) {
      const row = table.cases.find((c) => c.id === exact.id);
      expect(row?.portable, exact.id).toBe(true);
      if (row !== undefined) expect(resolveEntry(row, evaluator).compare, exact.id).toBe("tolerance");
      expect(exact.decision).toMatch(/^\d{4}$/);
    }
  });

  it("lists known deviations only for portable tolerance rows", () => {
    for (const deviation of tolerances.knownDeviations) {
      const row = table.cases.find((c) => c.id === deviation.id);
      expect(row?.portable, deviation.id).toBe(true);
      if (row !== undefined) expect(resolveEntry(row, evaluator).compare).toBe("tolerance");
      expect(deviation.decision).toMatch(/^\d{4}$/);
    }
  });
});

describe("gpu-not-compared.json", () => {
  it("lists every case the GPU comparison does not compare, with its reason", () => {
    const text = notComparedListing(table, evaluator);
    if (blessing()) writeNotComparedListing(text);
    expect(readFileSync(NOT_COMPARED_PATH, "utf8"), "stale: MTEK_BLESS=1 npm run test:unit -w @mtek/browser-tests").toBe(text);
    const listed = notComparedCases(table.cases, evaluator);
    expect(listed.filter((c) => table.cases.find((row) => row.id === c.id)?.portable === false)).toHaveLength(
      table.cases.filter((row) => !row.portable).length,
    );
  });
});
