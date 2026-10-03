// Mtek runtime host API (ABI 1). Hand-maintained: the public types of spec/runtime-abi.md section 6,
// nothing else. `npm run build` copies this file to dist/runtime.d.ts; the compiler writes it into every
// program's dist/ next to app.d.ts, which imports from it. Keep it self-contained (no imports) so it
// compiles in a host project with only the DOM library.

/** A byte/line/column range in a source file. Lines and columns are 1-based; 0 means "unresolved" (a runtime diagnostic knows byte offsets only). */
export interface MtekSourceSpan {
  readonly file: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface MtekRelatedSpan {
  readonly message: string;
  readonly source: MtekSourceSpan;
}

export interface MtekSuggestedEdit {
  readonly description: string;
  readonly edits: readonly {
    readonly file: string;
    readonly startByte: number;
    readonly endByte: number;
    readonly replacement: string;
  }[];
}

/** One diagnostic: the JSON shape of spec/diagnostics.md section 2.1, delivered to onDiagnostic by the runtime. */
export interface MtekDiagnostic {
  readonly schemaVersion: 1;
  /** `MTEK-` + severity letter + four digits, e.g. "MTEK-E8004". */
  readonly code: string;
  readonly severity: "error" | "warning" | "note";
  readonly title: string;
  readonly message: string;
  readonly source: MtekSourceSpan | null;
  readonly expected?: string;
  readonly actual?: string;
  readonly related: readonly MtekRelatedSpan[];
  readonly notes: readonly string[];
  readonly suggestedEdits: readonly MtekSuggestedEdit[];
  readonly phase:
    | "parse"
    | "check"
    | "emit"
    | "validate"
    | "runtime:mount"
    | "runtime:input"
    | "runtime:tick"
    | "runtime:update"
    | "runtime:bindings"
    | "runtime:render"
    | "runtime:reload"
    | "runtime:device";
  readonly docs: string;
}

/** `mountMtek` rejects with this error. */
export declare class MtekMountError extends Error {
  readonly kind:
    | "webgpu-unavailable"
    | "adapter-unavailable"
    | "device-failed"
    | "incompatible-program"
    | "manifest-invalid"
    | "shader-failed"
    | "asset-failed"
    | "allocation-failed";
  /** Mapped to Mtek source where possible. */
  readonly diagnostics: readonly MtekDiagnostic[];
  constructor(kind: MtekMountError["kind"], diagnostics: readonly MtekDiagnostic[]);
}

/**
 * The type of the default export of app.js. The type parameter only carries the Inputs interface for
 * typing setInput; at run time inputs are always validated by the generated codecs.
 */
export interface MtekProgram<I = Record<string, unknown>> {
  readonly abi: 1;
  readonly baseUrl: URL;
  readonly manifestUrl: URL;
  readonly writers: unknown;
  readonly functions: unknown;
  readonly scenes: unknown;
  readonly prefabs: unknown;
  /** Phantom, never present at run time. */
  readonly __inputs?: I;
}

export type MtekInputResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }; // code: "MTEK-E8040" unknown input, "MTEK-E8041" wrong type, "MTEK-E8100" non-opaque colour

export interface MtekTestOptions {
  /** No requestAnimationFrame; frames run only through app.debug.step. */
  manualClock?: boolean;
  /** Render into an offscreen rgba8unorm-srgb texture of this size. */
  renderTarget?: { width: number; height: number };
}

export interface MtekDebug {
  step(frames: number, dtSeconds: number): void;
  readPixels(): Promise<{ width: number; height: number; format: "rgba8unorm-srgb"; data: Uint8Array }>;
  counters(): Readonly<Record<string, number>>;
  pressKey(code: string): void;
  releaseKey(code: string): void;
  setParam(entityName: string, param: string, value: unknown): void;
  scene(): { state: Record<string, unknown>; entities: Array<{ name: string; position: unknown; rotation: unknown }> };
}

export interface MtekApp<I = Record<string, unknown>> {
  /** Never throws; the value is queued and applied at the next frame start. */
  setInput<K extends keyof I & string>(name: K, value: I[K]): MtekInputResult;
  pause(): void;
  resume(): void;
  /** Synchronous release. */
  dispose(): void;
  readonly state: "running" | "paused" | "recovering" | "failed" | "disposed";
  /** Present only when options.test is set. */
  readonly debug?: MtekDebug;
  /** Present only in dev builds. */
  replaceProgram?(candidate: MtekProgram<I>): Promise<{ ok: true } | { ok: false; diagnostics: readonly MtekDiagnostic[] }>;
}

export interface MtekMountOptions<I = Record<string, unknown>> {
  /** Initial host inputs (validated like setInput). */
  inputs?: Partial<I>;
  /** Every runtime diagnostic, including warnings. */
  onDiagnostic?: (d: MtekDiagnostic) => void;
  /** Default "overlay". */
  failureDisplay?: "overlay" | "none";
  /** random() seed; default derived from time. */
  seed?: number;
  /** Default from the manifest runtimeConfig. */
  pauseWhenHidden?: boolean;
  /** Default "auto". */
  devicePixelRatio?: number | "auto";
  /** Omit in production. */
  test?: MtekTestOptions;
}

export declare function mountMtek<I = Record<string, unknown>>(
  canvas: HTMLCanvasElement,
  program: MtekProgram<I>,
  options?: MtekMountOptions<I>,
): Promise<MtekApp<I>>;
