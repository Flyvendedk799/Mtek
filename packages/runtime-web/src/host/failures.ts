/**
 * Turning typed failures into diagnostics, resolving manifest spans, and delivering diagnostics to the
 * host (`spec/runtime-abi.md` sections 6.1 and 12, `spec/diagnostics.md` section 2.3).
 */
import type { AbiFailure } from "../abi/index.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import {
  MtekMountError,
  makeRuntimeDiagnostic,
  mountErrorKindForCode,
  type MtekDiagnostic,
  type MtekRuntimePhase,
  type MtekSourceSpan,
} from "../diagnostics/types.js";

/**
 * Turns an `AbiFailure` of M1-13 (`E8002`, `E8003`, `E8006`) into the diagnostic of the same code. The
 * mismatching field is named in a note, as `spec/runtime-abi.md` section 5.1 requires.
 */
export function abiFailureToDiagnostic(failure: AbiFailure, phase: MtekRuntimePhase = "runtime:mount"): MtekDiagnostic {
  return makeRuntimeDiagnostic(failure.code, {
    phase,
    message: failure.message,
    notes: [`field: ${failure.field}`],
  });
}

/**
 * Resolves a span id of the manifest `spans` table to a source span. The table carries the byte range and
 * the 1-based line and column of both ends (decision 0019), so the runtime copies them verbatim and needs
 * no source text. Returns `null` for an unknown span id or source id.
 */
export function resolveSpan(manifest: MtekManifest, spanId: number): MtekSourceSpan | null {
  const span = manifest.spans[spanId];
  if (span === undefined) return null;
  const source = manifest.sources.find((candidate) => candidate.id === span.file);
  if (source === undefined) return null;
  return {
    file: source.path,
    startByte: span.start,
    endByte: span.end,
    startLine: span.startLine,
    startColumn: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn,
  };
}

/** The span id of a symbol (`normalised path :: qualified name`), if the manifest has it. */
export function spanOfSymbol(manifest: MtekManifest, symbol: string): number | undefined {
  return manifest.symbols.find((candidate) => candidate.id === symbol)?.span;
}

/**
 * Builds the `MtekMountError` for fatal diagnostics. The kind is the one of the first diagnostic whose
 * code maps to a kind (`spec/runtime-abi.md` section 6.1); every fatal diagnostic produced by the mount
 * code maps, so a missing mapping is a bug and throws.
 */
export function mountError(diagnostics: readonly MtekDiagnostic[]): MtekMountError {
  for (const diagnostic of diagnostics) {
    const kind = mountErrorKindForCode(diagnostic.code.replace(/^MTEK-/, ""));
    if (kind !== undefined) return new MtekMountError(kind, diagnostics);
  }
  throw new Error(
    `internal error: no mount error kind for diagnostics ${diagnostics.map((d) => d.code).join(", ") || "(none)"}`,
  );
}

function sourceKey(d: MtekDiagnostic): string {
  return d.source === null ? "-" : `${d.source.file}:${String(d.source.startByte)}:${String(d.source.endByte)}`;
}

/**
 * Delivers diagnostics to `onDiagnostic` and remembers them. Each distinct `(code, span)` is delivered
 * once per mount (`spec/runtime-abi.md` section 12); a diagnostic without a span is distinguished by its
 * message instead, so two different unknown inputs are both reported.
 */
export class DiagnosticSink {
  private readonly seen = new Set<string>();
  private readonly delivered: MtekDiagnostic[] = [];

  constructor(private readonly onDiagnostic: ((diagnostic: MtekDiagnostic) => void) | undefined) {}

  /** Every diagnostic delivered so far, in order. */
  get all(): readonly MtekDiagnostic[] {
    return this.delivered;
  }

  /** Returns false (and delivers nothing) when the diagnostic is a duplicate. */
  report(diagnostic: MtekDiagnostic): boolean {
    const key = `${diagnostic.code}|${sourceKey(diagnostic)}|${diagnostic.source === null ? diagnostic.message : ""}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.delivered.push(diagnostic);
    if (this.onDiagnostic !== undefined) {
      try {
        this.onDiagnostic(diagnostic);
      } catch (error) {
        // A throwing host callback must not break the runtime; surface it as an uncaught error instead.
        if (typeof reportError === "function") reportError(error);
        else console.error(error);
      }
    }
    return true;
  }
}
