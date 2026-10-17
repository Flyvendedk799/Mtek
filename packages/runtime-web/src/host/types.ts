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
  /**
   * Render into an offscreen `rgba8unorm-srgb` texture that always has the canvas's backing size, so
   * resize, pixel ratio and zero-size handling can be read back (decision 0056). Excludes `renderTarget`.
   */
  canvasRenderTarget?: boolean;
  /** Device recovery (`spec/runtime-abi.md` section 9.4, decision 0056). */
  recovery?: {
    /** Delays before recovery attempts 1 to 3, in milliseconds. Default `[250, 1000, 4000]`. */
    delaysMs?: [number, number, number];
    /** The next `n` device requests of a recovery attempt fail as if `requestDevice` had rejected. */
    failDeviceRequests?: number;
  };
  /**
   * Draw every visible entity, as if frustum culling did not exist (`spec/runtime-abi.md` section 8.4):
   * lets a test compare a culled frame with an unculled one. `culledObjects` stays 0.
   */
  disableCulling?: boolean;
  /** Replace the pixels of a built-in texture (a generated texture for a test; no asset needed). */
  textures?: { "texture.white"?: MtekTestTexture; "texture.black"?: MtekTestTexture };
}

/** `spec/runtime-abi.md` section 10.2. */
export interface MtekTestTexture {
  width: number;
  height: number;
  /** Tightly packed RGBA8 texels, row-major, top row first: width x height x 4 bytes. */
  data: Uint8Array;
  /** `"srgb"` (default): an `rgba8unorm-srgb` texture, sampled as linear values. `"linear"`: `rgba8unorm`, as stored. */
  colorSpace?: "srgb" | "linear";
}

/** `spec/runtime-abi.md` section 10.2. */
export interface MtekDebug {
  /** Runs `frames` frames with the given delta (clamped to `maxFrameDelta`). Requires `test.manualClock`. */
  step(frames: number, dtSeconds: number): void;
  /** Requires `test.renderTarget`. Returns tightly packed rows. */
  readPixels(): Promise<{ width: number; height: number; format: "rgba8unorm-srgb"; data: Uint8Array }>;
  counters(): Readonly<Record<string, number>>;
  /**
   * Inject a key transition as the browser would: `code` is a DOM `KeyboardEvent.code` of a `Key` member
   * (anything else throws). Delivered in phase 1 of the next frame; ignored while paused.
   */
  pressKey(code: string): void;
  releaseKey(code: string): void;
  /**
   * Writes a material param of the named entity (its name, or its qualified symbol when the name is shared)
   * without `bind`: uploaded by the next frame, never creates a shader, pipeline or bind group; a non-opaque
   * colour is `E8100` and the previous value stays. A wrong entity, param or value throws (decision 0046).
   */
  setParam(entityName: string, param: string, value: unknown): void;
  /**
   * Destroys the GPU device. The `lost` event that follows has reason `destroyed`, which the runtime
   * ignores when it comes from `dispose()`; this call marks it as a loss to recover from (decision 0056).
   */
  loseDevice(): void;
  /** Reports `E8063` as an out-of-memory error scope would, so the failure path can be driven on hardware. */
  failAllocation(): void;
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
  /**
   * Show the development overlay (`spec/tooling.md` section 9) and measure GPU time when the device has
   * `timestamp-query`. Honoured only by the development flavour of the runtime; the release flavour
   * contains no overlay code and ignores it. `mtek dev` pages pass `true` (decision 0055).
   */
  devOverlay?: boolean;
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
