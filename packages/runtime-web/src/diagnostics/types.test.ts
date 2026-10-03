import { describe, expect, it } from "vitest";
import specText from "../../../../spec/diagnostics.md?raw";
import {
  MtekMountError,
  RUNTIME_DIAGNOSTIC_CATALOGUE,
  makeRuntimeDiagnostic,
  mountErrorKindForCode,
  type MtekDiagnostic,
} from "./types.js";

/** Rows of the table in `spec/diagnostics.md` section 5.8 (the single-code ones). */
function specRuntimeRows(): Array<{ code: string; title: string }> {
  const start = specText.indexOf("### 5.8 Runtime");
  const end = specText.indexOf("### 5.9");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const rows: Array<{ code: string; title: string }> = [];
  for (const line of specText.slice(start, end).split("\n")) {
    const m = /^\| ([EW]8\d{3}) \| ([^|]+?) \|/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) rows.push({ code: m[1], title: m[2] });
  }
  return rows;
}

describe("runtime diagnostic catalogue", () => {
  it("lists exactly the codes and titles of spec/diagnostics.md section 5.8", () => {
    const fromSpec = specRuntimeRows();
    expect(fromSpec.length).toBeGreaterThan(20);
    const fromCode = Object.entries(RUNTIME_DIAGNOSTIC_CATALOGUE).map(([code, title]) => ({ code, title }));
    expect(fromCode).toEqual(fromSpec);
  });
});

describe("makeRuntimeDiagnostic", () => {
  it("builds the exact JSON shape of spec/diagnostics.md section 2.1", () => {
    const d = makeRuntimeDiagnostic("E8004", {
      message: "WebGPU is not available in this browser.",
      phase: "runtime:mount",
    });
    expect(d).toEqual({
      schemaVersion: 1,
      code: "MTEK-E8004",
      severity: "error",
      title: "WebGPU unavailable",
      message: "WebGPU is not available in this browser.",
      source: null,
      related: [],
      notes: [],
      suggestedEdits: [],
      phase: "runtime:mount",
      docs: "spec/diagnostics.md#mtek-e8004",
    });
    // Key order follows the specification's example (stable for goldens).
    expect(Object.keys(d)).toEqual([
      "schemaVersion",
      "code",
      "severity",
      "title",
      "message",
      "source",
      "related",
      "notes",
      "suggestedEdits",
      "phase",
      "docs",
    ]);
  });

  it("derives the severity from the code letter", () => {
    expect(makeRuntimeDiagnostic("W8060", { message: "m", phase: "runtime:device" }).severity).toBe("warning");
    expect(makeRuntimeDiagnostic("E8062", { message: "m", phase: "runtime:device" }).severity).toBe("error");
  });

  it("carries expected, actual, notes and source when given", () => {
    const source = { file: "src/main.mtek", startByte: 1, endByte: 2, startLine: 1, startColumn: 2, endLine: 1, endColumn: 3 };
    const d = makeRuntimeDiagnostic("E8002", {
      message: "limit too small",
      phase: "runtime:mount",
      expected: ">= 65536",
      actual: "32768",
      notes: ["a note"],
      source,
    });
    expect(d.expected).toBe(">= 65536");
    expect(d.actual).toBe("32768");
    expect(d.notes).toEqual(["a note"]);
    expect(d.source).toEqual(source);
  });
});

describe("mountErrorKindForCode", () => {
  it("implements the normative code to kind mapping of spec/runtime-abi.md section 6.1", () => {
    expect(mountErrorKindForCode("E8001")).toBe("webgpu-unavailable");
    expect(mountErrorKindForCode("E8004")).toBe("webgpu-unavailable");
    expect(mountErrorKindForCode("E8005")).toBe("adapter-unavailable");
    expect(mountErrorKindForCode("E8002")).toBe("device-failed");
    expect(mountErrorKindForCode("E8003")).toBe("incompatible-program");
    expect(mountErrorKindForCode("E8006")).toBe("manifest-invalid");
    expect(mountErrorKindForCode("E8051")).toBe("shader-failed");
    expect(mountErrorKindForCode("E8063")).toBe("allocation-failed");
  });

  it("returns undefined for codes that do not fail a mount", () => {
    expect(mountErrorKindForCode("E8040")).toBeUndefined();
    expect(mountErrorKindForCode("W8060")).toBeUndefined();
  });
});

describe("MtekMountError", () => {
  const diagnostic: MtekDiagnostic = makeRuntimeDiagnostic("E8005", {
    message: "No suitable GPU adapter was found.",
    phase: "runtime:mount",
  });

  it("is an Error with kind and readonly diagnostics", () => {
    const e = new MtekMountError("adapter-unavailable", [diagnostic]);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MtekMountError);
    expect(e.name).toBe("MtekMountError");
    expect(e.kind).toBe("adapter-unavailable");
    expect(e.diagnostics).toEqual([diagnostic]);
    expect(e.message).toContain("MTEK-E8005");
    expect(e.message).toContain("No suitable GPU adapter was found.");
    expect(Object.isFrozen(e.diagnostics)).toBe(true);
  });

  it("does not alias the caller's array", () => {
    const list = [diagnostic];
    const e = new MtekMountError("adapter-unavailable", list);
    list.push(diagnostic);
    expect(e.diagnostics).toHaveLength(1);
  });

  it("has a fallback message without diagnostics", () => {
    expect(new MtekMountError("device-failed", []).message).toContain("device-failed");
  });
});
