import { describe, expect, it, vi } from "vitest";
import type { AbiFailure } from "../abi/index.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { MtekMountError, makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { DiagnosticSink, abiFailureToDiagnostic, mountError, resolveSpan, spanOfSymbol } from "./failures.js";

function manifest(): MtekManifest {
  return minimalManifestJson() as unknown as MtekManifest;
}

describe("abiFailureToDiagnostic", () => {
  it("keeps the code and message and names the mismatching field in a note", () => {
    const cases: Array<[AbiFailure, string, string]> = [
      [{ code: "E8003", field: "runtimeAbi", message: "Incompatible program: ..." }, "MTEK-E8003", "incompatible program"],
      [{ code: "E8006", field: "scene.entities[0].name", message: "Invalid manifest ..." }, "MTEK-E8006", "manifest invalid"],
      [{ code: "E8002", field: "requiredCapabilities.limits.maxBufferSize", message: "limit" }, "MTEK-E8002", "device below target profile"],
    ];
    for (const [failure, code, title] of cases) {
      const d = abiFailureToDiagnostic(failure);
      expect(d.code).toBe(code);
      expect(d.title).toBe(title);
      expect(d.message).toBe(failure.message);
      expect(d.notes).toEqual([`field: ${failure.field}`]);
      expect(d.phase).toBe("runtime:mount");
      expect(d.severity).toBe("error");
      expect(d.source).toBeNull();
      expect(d.docs).toBe(`spec/diagnostics.md#mtek-${failure.code.toLowerCase()}`);
    }
  });
});

describe("resolveSpan and spanOfSymbol", () => {
  it("copies the byte range and the line/column range of the span verbatim", () => {
    expect(resolveSpan(manifest(), 2)).toEqual({
      file: "src/main.mtek",
      startByte: 40,
      endByte: 58,
      startLine: 2,
      startColumn: 1,
      endLine: 2,
      endColumn: 19,
    });
  });

  it("returns null for an unknown span id or a span of an unknown file", () => {
    expect(resolveSpan(manifest(), 999)).toBeNull();
    expect(resolveSpan(manifest(), -1)).toBeNull();
    const broken = { ...manifest(), sources: [] } as MtekManifest;
    expect(resolveSpan(broken, 0)).toBeNull();
  });

  it("looks a symbol up by its id", () => {
    expect(spanOfSymbol(manifest(), "src/main.mtek::Demo.Cube")).toBe(2);
    expect(spanOfSymbol(manifest(), "src/main.mtek::Nope")).toBeUndefined();
  });
});

describe("mountError", () => {
  it("picks the kind of the first diagnostic with a mapping (spec/runtime-abi.md 6.1)", () => {
    const table: Array<[Parameters<typeof makeRuntimeDiagnostic>[0], string]> = [
      ["E8001", "webgpu-unavailable"],
      ["E8004", "webgpu-unavailable"],
      ["E8005", "adapter-unavailable"],
      ["E8002", "device-failed"],
      ["E8003", "incompatible-program"],
      ["E8006", "manifest-invalid"],
      ["E8051", "shader-failed"],
      ["E8063", "allocation-failed"],
    ];
    for (const [code, kind] of table) {
      const error = mountError([makeRuntimeDiagnostic(code, { phase: "runtime:mount", message: "m" })]);
      expect(error).toBeInstanceOf(MtekMountError);
      expect(error.kind, code).toBe(kind);
      expect(error.diagnostics).toHaveLength(1);
    }
  });

  it("refuses diagnostics that fail no mount instead of inventing a kind", () => {
    const warning = makeRuntimeDiagnostic("W8060", { phase: "runtime:device", message: "lost" });
    expect(() => mountError([warning])).toThrow(/no mount error kind.*W8060/);
    expect(() => mountError([])).toThrow(/no mount error kind/);
  });
});

describe("DiagnosticSink", () => {
  const at = (start: number): MtekDiagnostic =>
    makeRuntimeDiagnostic("E8051", {
      phase: "runtime:mount",
      message: `m${String(start)}`,
      source: { file: "a.mtek", startByte: start, endByte: start + 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
    });

  it("delivers each distinct (code, span) once per mount", () => {
    const seen: MtekDiagnostic[] = [];
    const sink = new DiagnosticSink((d) => seen.push(d));
    expect(sink.report(at(1))).toBe(true);
    expect(sink.report(at(1))).toBe(false);
    expect(sink.report(at(2))).toBe(true);
    expect(sink.report(makeRuntimeDiagnostic("E8050", { phase: "runtime:render", message: "x", source: at(1).source }))).toBe(true);
    expect(seen).toHaveLength(3);
    expect(sink.all).toEqual(seen);
  });

  it("tells span-less diagnostics apart by message", () => {
    const sink = new DiagnosticSink(undefined);
    const make = (message: string): MtekDiagnostic => makeRuntimeDiagnostic("E8040", { phase: "runtime:input", message });
    expect(sink.report(make("a"))).toBe(true);
    expect(sink.report(make("a"))).toBe(false);
    expect(sink.report(make("b"))).toBe(true);
  });

  it("keeps working when the host callback throws", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    try {
      const sink = new DiagnosticSink(() => {
        throw new Error("host bug");
      });
      expect(sink.report(at(1))).toBe(true);
      expect(sink.report(at(2))).toBe(true);
      expect(reportError).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
