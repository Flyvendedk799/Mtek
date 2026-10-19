// The diagnostics report of `mtek check|build --format json` (spec/diagnostics.md section 2.2,
// spec/diagnostic.schema.json) and its rendering for a repair prompt: the envelope entry plus the
// source lines around it (spec/ai-and-benchmarks.md section 4.1, "localized diagnostics").
import { canonicalJson, type Json } from "./canonical.ts";

export interface SourceSpan {
  file: string;
  startByte: number;
  endByte: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** One diagnostic: the fields the harness reads are typed, the rest is kept as sent. */
export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "note";
  message: string;
  phase: string;
  source: SourceSpan | null;
  [key: string]: unknown;
}

export interface DiagnosticsReport {
  compilerVersion: string | null;
  project: string | null;
  diagnostics: Diagnostic[];
  summary: { errors: number; warnings: number; notes: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSource(value: unknown): value is SourceSpan {
  if (!isRecord(value)) return false;
  return (
    typeof value["file"] === "string" &&
    ["startByte", "endByte", "startLine", "startColumn", "endLine", "endColumn"].every((key) => typeof value[key] === "number")
  );
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!isRecord(value)) return false;
  return (
    typeof value["code"] === "string" &&
    (value["severity"] === "error" || value["severity"] === "warning" || value["severity"] === "note") &&
    typeof value["message"] === "string" &&
    typeof value["phase"] === "string" &&
    (value["source"] === null || isSource(value["source"]))
  );
}

/** Parses the report a command printed on stdout; null when it is not a report of schema version 1. */
export function parseDiagnosticsReport(stdout: string): DiagnosticsReport | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isRecord(value) || value["schemaVersion"] !== 1 || !Array.isArray(value["diagnostics"])) return null;
  const list = value["diagnostics"] as unknown[];
  if (!list.every(isDiagnostic)) return null;
  const summary = value["summary"];
  if (!isRecord(summary)) return null;
  const count = (key: string): number | null => (typeof summary[key] === "number" ? summary[key] : null);
  const errors = count("errors");
  const warnings = count("warnings");
  const notes = count("notes");
  if (errors === null || warnings === null || notes === null) return null;
  return {
    compilerVersion: typeof value["compilerVersion"] === "string" ? value["compilerVersion"] : null,
    project: typeof value["project"] === "string" ? value["project"] : null,
    diagnostics: list,
    summary: { errors, warnings, notes },
  };
}

/**
 * The lines `from..to` (1-based, inclusive) of `source` with `context` lines around, numbered, the
 * lines inside the span marked with `>`.
 */
export function excerpt(source: string, from: number, to: number, context = 2): string {
  const lines = source.split("\n");
  const first = Math.max(1, from - context);
  const last = Math.min(lines.length, to + context);
  const width = String(last).length;
  const out: string[] = [];
  for (let n = first; n <= last; n += 1) {
    const marker = n >= from && n <= to ? ">" : " ";
    out.push(`${marker} ${String(n).padStart(width)} | ${lines[n - 1] ?? ""}`);
  }
  return out.join("\n");
}

export interface RenderOptions {
  /** At most this many error diagnostics are rendered; the rest are counted. */
  maxDiagnostics: number;
  /** Lines of context around the span. */
  context: number;
}

export const DEFAULT_RENDER: RenderOptions = { maxDiagnostics: 12, context: 2 };

/**
 * Renders the error diagnostics for a repair prompt: per diagnostic the envelope entry (compact JSON,
 * so every field the compiler gave, `suggestedEdits` included, reaches the model) and the source lines
 * around its span, read from the candidate as it is now. Warnings and notes are summarised by count.
 */
export function renderDiagnostics(
  report: readonly Diagnostic[],
  readFile: (path: string) => string | undefined,
  options: RenderOptions = DEFAULT_RENDER,
): string {
  const errors = report.filter((d) => d.severity === "error");
  const shown = errors.slice(0, options.maxDiagnostics);
  const parts = shown.map((d, i) => {
    const lines = [`diagnostic ${String(i + 1)} of ${String(errors.length)}:`, typeof d["rendered"] === "string" ? d["rendered"] : canonicalJson(d as unknown as Json)];
    if (d.source !== null) {
      const text = readFile(d.source.file);
      if (text !== undefined) lines.push(`${d.source.file} around line ${String(d.source.startLine)}:`, excerpt(text, d.source.startLine, d.source.endLine, options.context));
    }
    return lines.join("\n");
  });
  if (errors.length > shown.length) parts.push(`(${String(errors.length - shown.length)} more error diagnostics not shown)`);
  const other = report.length - errors.length;
  if (other > 0) parts.push(`(${String(other)} warnings and notes not shown)`);
  return parts.join("\n\n");
}
