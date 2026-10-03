/**
 * The public host API types of `spec/runtime-abi.md` section 6 as implemented. The hand-maintained
 * `src/runtime.d.ts` declares the same shapes for programs and hosts; `runtime-dts.test.ts` proves
 * the two agree in both directions.
 */
import type { MtekDiagnostic } from "../diagnostics/types.js";

/** `spec/runtime-abi.md` section 10.2. */
export interface MtekTestOptions {
  /** No `requestAnimationFrame`; frames run only through `app.debug.step`. */
  manualClock?: boolean;
  /** Render into an offscreen `rgba8unorm-srgb` texture of this size (fixed format on every platform). */
  renderTarget?: { width: number; height: number };
}

/** `spec/runtime-abi.md` section 10.2. */
export interface MtekDebug {
  /** Runs `frames` frames with the given delta (clamped to `maxFrameDelta`). Requires `test.manualClock`. */
  step(frames: number, dtSeconds: number): void;
  /** Requires `test.renderTarget`. Returns tightly packed rows. */
  readPixels(): Promise<{ width: number; height: number; format: "rgba8unorm-srgb"; data: Uint8Array }>;
  counters(): Readonly<Record<string, number>>;
  /** Input injection arrives with M3; calling it before then throws. */
  pressKey(code: string): void;
  releaseKey(code: string): void;
  /** Arrives with M2/M3; calling it before then throws. */
  setParam(entityName: string, param: string, value: unknown): void;
  scene(): { state: Record<string, unknown>; entities: Array<{ name: string; position: unknown; rotation: unknown }> };
}

export type MtekInputResult = { ok: true } | { ok: false; error: { code: string; message: string } };

export type MtekAppState = "running" | "paused" | "recovering" | "failed" | "disposed";

export interface MtekApp<I = Record<string, unknown>> {
  setInput<K extends keyof I & string>(name: K, value: I[K]): MtekInputResult;
  pause(): void;
  resume(): void;
  /** Synchronous release (`spec/runtime-abi.md` section 9.3). */
  dispose(): void;
  readonly state: MtekAppState;
  readonly debug?: MtekDebug;
  replaceProgram?(
    candidate: MtekMountProgram<I>,
  ): Promise<{ ok: true } | { ok: false; diagnostics: readonly MtekDiagnostic[] }>;
}

export interface MtekMountOptions<I = Record<string, unknown>> {
  inputs?: Partial<I>;
  onDiagnostic?: (d: MtekDiagnostic) => void;
  failureDisplay?: "overlay" | "none";
  seed?: number;
  pauseWhenHidden?: boolean;
  devicePixelRatio?: number | "auto";
  test?: MtekTestOptions;
}

/**
 * The program as `mountMtek` accepts it: the shape of the default export of `app.js`
 * (`spec/runtime-abi.md` section 3). M1 reads only `abi`, `baseUrl` and `manifestUrl`; the members
 * that carry generated code are opaque until M3.
 */
export interface MtekMountProgram<I = Record<string, unknown>> {
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
