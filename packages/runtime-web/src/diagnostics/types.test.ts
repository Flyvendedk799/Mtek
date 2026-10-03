import { describe, expect, it } from "vitest";
import specText from "../../../../spec/diagnostics.md?raw";
import {
  MtekMountError,
  RUNTIME_DIAGNOSTIC_CATALOGUE,
  makeRuntimeDiagnostic,
  mountErrorKindForCode,
  type MtekDiagnostic,
  type RuntimeDiagnosticCode,
} from "./types.js";

interface SpecRuntimeRow {
  readonly code: string;
  readonly title: string;
  /** The id of the `<a id="...">` anchor in the code cell, if the row has one. */
  readonly anchor: string | undefined;
}

/** The section 5.8 part of `spec/diagnostics.md`. */
function runtimeSection(): string {
  const start = specText.indexOf("### 5.8 Runtime");
  const end = specText.indexOf("### 5.9");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return specText.slice(start, end);
}

/**
 * Rows of the table in `spec/diagnostics.md` section 5.8 (the single-code ones), with or without
 * an anchor in the code cell: `| <a id="mtek-e8004"></a>E8004 | WebGPU unavailable | ... |`.
 */
function specRuntimeRows(): SpecRuntimeRow[] {
  const rows: SpecRuntimeRow[] = [];
  for (const line of runtimeSection().split("\n")) {
    const m = /^\| (?:<a id="([^"]*)"><\/a>)?([EW]8\d{3}) \| ([^|]+?) \|/.exec(line);
    if (m?.[2] !== undefined && m[3] !== undefined) rows.push({ code: m[2], title: m[3], anchor: m[1] });
  }
  return rows;
}

/** The fragment of a runtime code's `docs` field, as `makeRuntimeDiagnostic` builds it. */
function docsFragment(code: RuntimeDiagnosticCode): string {
  const docs = makeRuntimeDiagnostic(code, { message: "m", phase: "runtime:mount" }).docs;
  const prefix = "spec/diagnostics.md#";
  expect(docs.startsWith(prefix)).toBe(true);
  return docs.slice(prefix.length);
}

function isRuntimeCode(code: string): code is RuntimeDiagnosticCode {
  return Object.hasOwn(RUNTIME_DIAGNOSTIC_CATALOGUE, code);
}

describe("runtime diagnostic catalogue", () => {
  it("lists exactly the codes and titles of spec/diagnostics.md section 5.8", () => {
    const fromSpec = specRuntimeRows().map(({ code, title }) => ({ code, title }));
    expect(fromSpec.length).toBeGreaterThan(20);
    const fromCode = Object.entries(RUNTIME_DIAGNOSTIC_CATALOGUE).map(([code, title]) => ({ code, title }));
    expect(fromCode).toEqual(fromSpec);
  });

  it("gives every runtime code exactly one anchor, in its row, equal to its docs fragment", () => {
    const rows = specRuntimeRows();
    const allIds = [...specText.matchAll(/<a id="([^"]*)"><\/a>/g)].map((m) => m[1]);
    for (const row of rows) {
      expect(isRuntimeCode(row.code)).toBe(true);
      if (!isRuntimeCode(row.code)) continue;
      const fragment = docsFragment(row.code);
      expect(row.anchor, row.code).toBe(fragment);
      expect(allIds.filter((id) => id === fragment), row.code).toHaveLength(1);
    }
    // No anchor in section 5.8 that is not a runtime code's row anchor.
    const sectionIds = [...runtimeSection().matchAll(/<a id="([^"]*)"><\/a>/g)].map((m) => m[1]);
    expect(sectionIds).toEqual(rows.map((row) => row.anchor));
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
