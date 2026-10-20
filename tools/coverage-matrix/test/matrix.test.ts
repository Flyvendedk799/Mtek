import { describe, expect, it } from "vitest";
import { FORMS } from "../src/forms.ts";
import { AREAS, areasOf } from "../src/guards.ts";
import { auditCodes, type CatalogueEntry, type DiagnosticFixture } from "../src/diagnostics.ts";
import { buildMatrix, PRESSURES, type MatrixInput } from "../src/matrix.ts";
import { DEMONSTRATIONS, OTHER_EXAMPLES } from "../src/projects.ts";
import { render } from "../src/render.ts";
import { program } from "./helpers.ts";

const [CFG = "", PHY = "", MOD = ""] = DEMONSTRATIONS;

const fixture = (file: string, message = ""): DiagnosticFixture => ({ file, fixture: file, suite: "semantics-fail", messages: [message] });
const catalogue: CatalogueEntry[] = ["E0013", "E9010"].map((code) => ({ code, title: code, trigger: "", mark: null }));

/** Every pressure fact plus `extra`, shared the way the real demonstrations share them. */
function input(overrides: { demos?: Record<string, string[]>; features?: string[]; fixtures?: ReturnType<typeof program>[] } = {}): MatrixInput {
  const demos = overrides.demos ?? {};
  const projects = [
    program(CFG, "demonstration", [...(PRESSURES[CFG] ?? []), "only-cfg", ...(demos[CFG] ?? [])]),
    program(PHY, "demonstration", [...(PRESSURES[PHY] ?? []), "only-phy", ...(demos[PHY] ?? [])]),
    program(MOD, "demonstration", [...(PRESSURES[MOD] ?? []), "only-mod", ...(demos[MOD] ?? [])]),
    // The M3 example covers every form here, so that only what a test removes is missing.
    program("examples/pulse-cube", "example", ["functions", ...FORMS.map((form) => form.id)]),
    ...OTHER_EXAMPLES.filter((id) => id !== "examples/pulse-cube").map((id) => program(id, "example", [])),
    ...(overrides.fixtures ?? []),
  ];
  const fixtureCodes = new Map<string, DiagnosticFixture[]>([
    ["MTEK-E0013", [fixture("tests/syntax/fail/reserved.diag.json", "`while` is reserved for a future version")]],
    ["MTEK-E9010", [fixture("tests/semantics/fail/gate")]],
  ]);
  const codes = auditCodes(catalogue, fixtureCodes, { notYetImplemented: [], reserved: [], unreachable: [], coveredElsewhere: [] }, () => null);
  return {
    supported: { features: overrides.features ?? ["functions"], notSupported: ["while", "non-constant-initial-values"], languageVersion: "0.1" },
    projects,
    codes,
    fixtureCodes,
  };
}

/** Problems that concern the demonstrations, the features and the neighbours, not the area table. */
const relevant = (problems: readonly string[]): string[] => problems.filter((p) => !p.includes("negative-test area") && !p.startsWith("area "));

describe("buildMatrix", () => {
  it("passes when every demonstration has its pressure and a feature of its own, and every feature is covered", () => {
    const matrix = buildMatrix(input());
    expect(relevant(matrix.problems)).toEqual([]);
    expect(matrix.distinct.map((d) => d.unique.includes(`only-${["cfg", "phy", "mod"][matrix.distinct.indexOf(d)]}`))).toEqual([true, true, true]);
  });

  it("fails when a demonstration exercises nothing the other two do not", () => {
    // The modular scene exercises only what the physics playground exercises.
    const base = input();
    const projects = base.projects.map((p) => (p.id === MOD ? { ...p, ir: new Set(PRESSURES[PHY] ?? []) } : p));
    const matrix = buildMatrix({ ...base, projects });
    expect(matrix.problems).toContain(`${MOD} exercises no feature that the other two demonstrations do not`);
  });

  it("fails when another demonstration also exercises a pressure", () => {
    const matrix = buildMatrix(input({ demos: { [PHY]: ["project/host-inputs"] } }));
    expect(matrix.problems).toContain(`project/host-inputs is a pressure of ${CFG} but ${PHY} also exercises it`);
  });

  it("fails when a demonstration does not exercise its pressure", () => {
    const base = input();
    const projects = base.projects.map((p) => (p.id === PHY ? { ...p, ir: new Set(["only-phy"]) } : p));
    const matrix = buildMatrix({ ...base, projects });
    expect(matrix.problems.some((p) => p.includes(`${PHY} does not exercise entity/body`))).toBe(true);
  });

  it("names a feature that no demonstration and no positive fixture exercises", () => {
    const matrix = buildMatrix(input({ features: ["functions", "function:never_used"] }));
    expect(matrix.problems).toContain("no demonstration and no positive fixture exercises the feature function:never_used");
  });

  it("does not count a fixture that does not compile", () => {
    const broken = program("tests/semantics/pass/x", "fixture", ["function:sin"], false);
    const matrix = buildMatrix(input({ features: ["functions", "function:sin"], fixtures: [broken] }));
    expect(matrix.problems).toContain("no demonstration and no positive fixture exercises the feature function:sin");
    expect(matrix.excluded).toEqual([{ id: "tests/semantics/pass/x", note: "does not check" }]);
  });

  it("names the fixture for a feature that only a fixture exercises, preferring the most focused one", () => {
    const wide = program("tests/semantics/pass/wide", "fixture", ["function:sin", "a", "b", "c"]);
    const narrow = program("tests/semantics/pass/narrow", "fixture", ["function:sin"]);
    const matrix = buildMatrix(input({ features: ["functions", "function:sin"], fixtures: [wide, narrow] }));
    const row = matrix.features.find((f) => f.id === "function:sin");
    expect(row?.fixtures).toEqual(["tests/semantics/pass/narrow", "tests/semantics/pass/wide"]);
    expect(relevant(matrix.problems)).toEqual([]);
  });

  it("requires every reserved word to be named by an E0013 fixture and every gate to have an E9010 fixture", () => {
    const base = input();
    const matrix = buildMatrix({ ...base, supported: { ...base.supported, notSupported: ["while", "yield", "some-gate"] }, fixtureCodes: new Map([["MTEK-E0013", [fixture("x", "`while` is reserved")]]]) });
    expect(matrix.problems).toContain("the reserved word yield has no E0013 fixture that names it");
    expect(matrix.problems).toContain("the gate some-gate has no E9010 fixture");
  });

  it("flags a code with no negative test and a feature outside every area", () => {
    const base = input({ features: ["functions", "something-new"] });
    const withE3001 = [...catalogue, { code: "E3001", title: "type mismatch", trigger: "", mark: null }];
    const codes = auditCodes(withE3001, base.fixtureCodes, { notYetImplemented: [], reserved: [], unreachable: [], coveredElsewhere: [] }, () => null);
    const matrix = buildMatrix({ ...base, codes });
    expect(matrix.problems).toContain("the feature something-new belongs to no negative-test area (tools/coverage-matrix/src/guards.ts)");
    expect(matrix.problems).toContain("area types: E3001 has no negative test");
    expect(matrix.problems).toContain("the diagnostic code E3001 has no fail fixture, no named negative test and no registry mark");
  });
});

describe("render", () => {
  it("prints the same text twice and marks a failing assertion", () => {
    const matrix = buildMatrix(input({ features: ["functions", "function:never_used"] }));
    expect(render(matrix)).toBe(render(matrix));
    expect(render(matrix)).toContain("FAILS");
    expect(render(matrix)).not.toMatch(/\b[A-Za-z]:\\[A-Za-z]/);
  });
});

describe("the negative-test areas", () => {
  it("have unique ids, at least one code each, and match the features they say", () => {
    expect(new Set(AREAS.map((a) => a.id)).size).toBe(AREAS.length);
    for (const area of AREAS) expect(area.codes.length, area.id).toBeGreaterThan(0);
    expect(areasOf("function:sin").map((a) => a.id)).toContain("math");
    expect(areasOf("module/cross-file-call").map((a) => a.id)).toEqual(["modules"]);
    expect(areasOf("no-such-feature")).toEqual([]);
  });
});
