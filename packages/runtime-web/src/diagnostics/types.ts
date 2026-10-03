/**
 * Diagnostic types of the runtime (`spec/diagnostics.md` section 2) and the mount error
 * (`spec/runtime-abi.md` section 6.1).
 */

/**
 * A byte/line/column range in a source file (`spec/diagnostics.md` section 2.1). Lines and columns are
 * 1-based, except that runtime diagnostics, which know byte offsets only, set them to `0` for
 * "unresolved" (decision 0018).
 */
export interface MtekSourceSpan {
  readonly file: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** A secondary location with its own message. */
export interface MtekRelatedSpan {
  readonly message: string;
  readonly source: MtekSourceSpan;
}

/** A validated, mechanical edit (`spec/diagnostics.md` section 6). */
export interface MtekSuggestedEdit {
  readonly description: string;
  readonly edits: readonly {
    readonly file: string;
    readonly startByte: number;
    readonly endByte: number;
    readonly replacement: string;
  }[];
}

export type MtekSeverity = "error" | "warning" | "note";

/** Scheduler phase (or mount) in which a runtime diagnostic arose (`spec/diagnostics.md` section 2.3). */
export type MtekRuntimePhase =
  | "runtime:mount"
  | "runtime:input"
  | "runtime:tick"
  | "runtime:update"
  | "runtime:bindings"
  | "runtime:render"
  | "runtime:reload"
  | "runtime:device";

export type MtekDiagnosticPhase = "parse" | "check" | "emit" | "validate" | MtekRuntimePhase;

/** One diagnostic: exactly the JSON shape of `spec/diagnostics.md` section 2.1. */
export interface MtekDiagnostic {
  readonly schemaVersion: 1;
  /** `MTEK-` + severity letter + four digits, e.g. `MTEK-E8004`. */
  readonly code: string;
  readonly severity: MtekSeverity;
  /** The catalogue title of the code. */
  readonly title: string;
  readonly message: string;
  /** Primary location; `null` for diagnostics without a file (all pure device/platform diagnostics). */
  readonly source: MtekSourceSpan | null;
  readonly expected?: string;
  readonly actual?: string;
  readonly related: readonly MtekRelatedSpan[];
  readonly notes: readonly string[];
  readonly suggestedEdits: readonly MtekSuggestedEdit[];
  readonly phase: MtekDiagnosticPhase;
  /** Anchor into `spec/diagnostics.md`. */
  readonly docs: string;
}

/**
 * The runtime part (`8xxx`) of the catalogue of `spec/diagnostics.md` section 5.8, in the order of
 * that table. A test asserts that this list equals the table. Ranges of codes defined in other
 * documents (physics runtime codes) are added when those documents' milestones land.
 */
export const RUNTIME_DIAGNOSTIC_CATALOGUE = {
  E8001: "unsupported platform endianness",
  E8002: "device below target profile",
  E8003: "incompatible program",
  E8004: "WebGPU unavailable",
  E8005: "no suitable adapter",
  E8006: "manifest invalid",
  E8011: "invalid camera value",
  W8030: "index clamped",
  E8030: "named entity cannot be destroyed",
  W8031: "command for pending entity dropped",
  W8032: "entity already destroyed",
  E8033: "entity limit reached",
  E8040: "unknown host input",
  E8041: "host input has wrong type",
  E8050: "uncaptured GPU validation error",
  E8051: "shader or pipeline creation failed",
  W8060: "GPU device lost",
  W8061: "GPU device recovered",
  E8062: "GPU device recovery failed",
  E8063: "GPU allocation failed",
  W8070: "scene restarted on reload",
  E8080: "execution budget exceeded",
  E8090: "invalid scale value",
  E8100: "non-opaque color value",
} as const;

export type RuntimeDiagnosticCode = keyof typeof RUNTIME_DIAGNOSTIC_CATALOGUE;

export interface RuntimeDiagnosticInit {
  readonly message: string;
  readonly phase: MtekRuntimePhase;
  readonly source?: MtekSourceSpan | null;
  readonly expected?: string;
  readonly actual?: string;
  readonly related?: readonly MtekRelatedSpan[];
  readonly notes?: readonly string[];
}

function severityOf(code: RuntimeDiagnosticCode): MtekSeverity {
  return code.startsWith("W") ? "warning" : "error";
}

/** Builds a runtime diagnostic for a catalogue code; the title and severity come from the catalogue. */
export function makeRuntimeDiagnostic(code: RuntimeDiagnosticCode, init: RuntimeDiagnosticInit): MtekDiagnostic {
  const base = {
    schemaVersion: 1 as const,
    code: `MTEK-${code}`,
    severity: severityOf(code),
    title: RUNTIME_DIAGNOSTIC_CATALOGUE[code],
    message: init.message,
    source: init.source ?? null,
  };
  const optional: { expected?: string; actual?: string } = {};
  if (init.expected !== undefined) optional.expected = init.expected;
  if (init.actual !== undefined) optional.actual = init.actual;
  return {
    ...base,
    ...optional,
    related: init.related ?? [],
    notes: init.notes ?? [],
    suggestedEdits: [],
    phase: init.phase,
    docs: `spec/diagnostics.md#mtek-${code.toLowerCase()}`,
  };
}

/** Why a mount failed (`spec/runtime-abi.md` section 6.1). */
export type MtekMountErrorKind =
  | "webgpu-unavailable"
  | "adapter-unavailable"
  | "device-failed"
  | "incompatible-program"
  | "manifest-invalid"
  | "shader-failed"
  | "asset-failed"
  | "allocation-failed";

const MOUNT_KIND_BY_CODE: Readonly<Record<string, MtekMountErrorKind>> = {
  E8001: "webgpu-unavailable",
  E8004: "webgpu-unavailable",
  E8005: "adapter-unavailable",
  E8002: "device-failed",
  E8003: "incompatible-program",
  E8006: "manifest-invalid",
  E8051: "shader-failed",
  E7030: "asset-failed",
  E7031: "asset-failed",
  E8063: "allocation-failed",
};

/**
 * The normative code to kind mapping of `spec/runtime-abi.md` section 6.1. `code` is the bare code
 * (`"E8004"`, not `"MTEK-E8004"`). Returns `undefined` for codes that do not fail a mount. A rejected
 * `requestDevice` is reported as `E8002` and therefore maps to `device-failed`.
 */
export function mountErrorKindForCode(code: string): MtekMountErrorKind | undefined {
  return Object.hasOwn(MOUNT_KIND_BY_CODE, code) ? MOUNT_KIND_BY_CODE[code] : undefined;
}

/** `mountMtek` rejects with this error (`spec/runtime-abi.md` section 6.1). */
export class MtekMountError extends Error {
  readonly kind: MtekMountErrorKind;
  readonly diagnostics: readonly MtekDiagnostic[];

  constructor(kind: MtekMountErrorKind, diagnostics: readonly MtekDiagnostic[]) {
    const first = diagnostics[0];
    super(first === undefined ? `Mounting failed (${kind}).` : `${first.code}: ${first.message}`);
    this.name = "MtekMountError";
    this.kind = kind;
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}
