// The numeric probe generator without the compiler or a GPU (task M2-08): the project reaches every
// library function, the plan covers every case with its own slots, and the harness calls each
// compiled function through its argument and result encoders.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_PATH,
  NO_FUNCTION,
  PROBE_WIDTH,
  caseWords,
  compiledPrefix,
  functionName,
  libraryFunctions,
  planProbe,
  probeHarness,
  probeProjectSource,
} from "./numeric-probe.ts";
import { loadTable } from "./numeric-test-data.ts";
import { argTypes, componentCount, decodeTyped } from "./numeric-values.ts";

const library = readFileSync(LIBRARY_PATH, "utf8");
const functions = libraryFunctions(library);
const table = loadTable();

describe("numeric probe", () => {
  it("finds a library function of the right signature for every case of cpu.json", () => {
    const byName = new Map(functions.map((f) => [f.name, f]));
    for (const row of table.cases) {
      const f = byName.get(functionName(row));
      expect(f, row.id).toBeDefined();
      expect(f?.params).toEqual(argTypes(row));
      expect(f?.result).toBe(decodeTyped(row.expect, row.id).type);
    }
  });

  it("reaches every library function from the probe material's fragment stage", () => {
    const source = probeProjectSource(library);
    const stage = source.slice(source.indexOf("material Probe {"));
    for (const f of functions) expect(stage).toContain(`        ${f.name}(`);
    expect(source).not.toContain("scene Table");
    expect(source).toContain("material: Probe {};");
  });

  it("gives every case its own slots and arguments", () => {
    const plan = planProbe(table, functions, "u_fn_0123abcd_");
    expect(plan.cases.map((c) => c.id)).toEqual(table.cases.map((c) => c.id));
    const slots = plan.cases.flatMap((c) => c.slots);
    expect(new Set(slots).size).toBe(slots.length);
    expect(plan.slotTable).toHaveLength(plan.width * plan.height * 4);
    expect(plan.width).toBe(PROBE_WIDTH);
    plan.cases.forEach((planned, index) => {
      const row = table.cases[index];
      if (row === undefined) throw new Error("missing row");
      const resultWords = componentCount(decodeTyped(row.expect, row.id).type);
      expect(planned.slots).toHaveLength(Math.ceil(resultWords / 4));
      planned.slots.forEach((slot, part) => {
        expect(plan.slotTable.slice(slot * 4, slot * 4 + 3)).toEqual([planned.fn, planned.argAt, part]);
      });
    });
    const used = new Set(slots);
    for (let slot = 0; slot < plan.width * plan.height; slot++) {
      if (!used.has(slot)) expect(plan.slotTable[slot * 4]).toBe(NO_FUNCTION);
    }
    // Reading back: the words of a case's slots, in order.
    const words = Array.from({ length: plan.width * plan.height * 4 }, (_, i) => i);
    const matrixCase = plan.cases.findIndex((c) => c.slots.length === 4);
    expect(caseWords(plan, words, matrixCase)).toHaveLength(16);
  });

  it("generates a harness that calls every compiled function", () => {
    const plan = planProbe(table, functions, "u_fn_0123abcd_");
    const harness = probeHarness(plan);
    functions.forEach((f, index) => {
      expect(harness).toContain(`fn probe_case_${index}(at: u32, part: u32) -> vec4<u32> {`);
      expect(harness).toContain(`u_fn_0123abcd_${f.name}(`);
      expect(harness).toContain(`case ${index}u: { return probe_case_${index}(slot.y, slot.z); }`);
    });
    expect(harness).toContain("@group(3) @binding(0) var<storage, read> probe_words: array<u32>;");
    expect(harness).not.toMatch(/\bmtek_/);
  });

  it("finds the module-qualified function prefix of the compiled shader", () => {
    const first = functions[0]?.name ?? "";
    expect(compiledPrefix(`fn mtek_x() {}\nfn u_fn_e2cab98b_${first}(u_p_a: f32) -> f32 {`, functions)).toBe("u_fn_e2cab98b_");
    expect(() => compiledPrefix("fn other() {}", functions)).toThrow();
  });
});
