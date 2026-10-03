import { describe, expect, it } from "vitest";
import { analyse, blankDirectives } from "./type-experiment-report.ts";

describe("blankDirectives", () => {
  it("replaces directive lines and keeps the line count", () => {
    const text = "a();\n  // @ts-expect-error rejected by tsc\nb();\n";
    const blanked = blankDirectives(text);
    expect(blanked.split("\n")).toHaveLength(text.split("\n").length);
    expect(blanked).not.toContain("@ts-expect-error");
  });
});

describe("analyse", () => {
  const text = ["// CASE 01: first", "bad1();", "", "// CASE 02: second", "bad2();"].join("\n");

  it("attributes a diagnostic to the case whose statement it falls in", () => {
    const outcomes = analyse(text, [{ line: 5, code: 2322, message: "nope" }]);
    expect(outcomes.map((o) => [o.id, o.rejected])).toEqual([
      ["01", false],
      ["02", true],
    ]);
    expect(outcomes[1]?.code).toBe(2322);
  });

  it("marks cases described as 'not a mistake' so they are not counted as wrong usages", () => {
    const outcomes = analyse("// CASE 01: not a mistake: fine code\nok();", []);
    expect(outcomes[0]?.mistake).toBe(false);
    expect(analyse(text, [])[0]?.mistake).toBe(true);
  });

  it("reports every case as not rejected without diagnostics", () => {
    expect(analyse(text, []).every((o) => !o.rejected)).toBe(true);
  });
});
