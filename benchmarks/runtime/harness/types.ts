// The contract between the measurement page (`page.ts`) and the three implementations of a workload.
//
// An implementation module (`<workload>/direct/main.ts`, `<workload>/three/main.ts`, or the generic Mtek adapter
// `mtek-adapter.ts` around `<workload>/mtek/`) exports `create(context)`. The page calls `frame(dt)` once per
// frame and times it from outside; everything else here is optional information the page records.

export type Implementation = "mtek" | "direct" | "three";
export const IMPLEMENTATIONS: readonly Implementation[] = ["mtek", "direct", "three"];

export interface BenchContext {
  readonly workload: string;
  readonly implementation: Implementation;
  /** Absolute URL path of the directory with the workload's generated assets (`.out/site/assets/<workload>/`), with a trailing slash. */
  readonly assetBase: string;
  /** Mtek only: absolute URL of the built program module (`app.js`), and of the edited program of the reload step. */
  readonly programUrl: string;
  readonly editedProgramUrl: string | null;
}

/** The CPU time of the last frame, split the way the runtime's counters split it. */
export interface FrameSplit {
  /** Input, fixed ticks / physics, update functions, bindings, transform propagation (application work). */
  readonly updateMs: number;
  /** Culling, draw-list construction, uploads, command encoding and submission (render preparation). */
  readonly renderPrepMs: number;
}

export interface PixelsRgba {
  readonly width: number;
  readonly height: number;
  /** RGBA8, sRGB-encoded, top row first, `width * 4` bytes per row. */
  readonly data: Uint8Array;
}

export interface BenchApp {
  /** Advances the application by `dtSeconds` and renders one frame into the offscreen target; submits before it returns. */
  frame(dtSeconds: number): void;
  /** The split of the last `frame` call. */
  split(): FrameSplit;
  readPixels(): Promise<PixelsRgba>;
  /** Releases everything the application created, including its device where it owns one. */
  dispose(): Promise<void> | void;
  /** Mtek only: the runtime's own counters (`app.debug.counters()`), for the cross-check against the harness' instrument. */
  runtimeCounters?(): Readonly<Record<string, number>>;
  /** Mount-reload-dispose: applies the edited program to the running application (hot reload, or a rebuild of the scene). */
  reload?(): Promise<void>;
  /** Implementation-specific observations the page records verbatim (for example how many bodies Rapier has asleep). */
  info?(): Record<string, unknown>;
}

export type Create = (context: BenchContext) => Promise<BenchApp>;

/** What the node-side runner asks the page to do (one pass per page load). */
export type PassSpec =
  | { readonly pass: "timing"; readonly warmupFrames: number; readonly frames: number; readonly frameDeltaSeconds: number }
  | { readonly pass: "counts"; readonly warmupFrames: number; readonly frames: number; readonly frameDeltaSeconds: number }
  | { readonly pass: "gpu-time"; readonly warmupFrames: number; readonly frames: number; readonly frameDeltaSeconds: number }
  | { readonly pass: "allocation"; readonly warmupFrames: number; readonly frames: number; readonly frameDeltaSeconds: number }
  | { readonly pass: "parity"; readonly frames: number; readonly frameDeltaSeconds: number }
  | { readonly pass: "startup"; readonly frameDeltaSeconds: number }
  | { readonly pass: "cycles"; readonly cycles: number; readonly framesPerPhase: number; readonly frameDeltaSeconds: number };

/** The shape of `window.__bench`, which the runner drives with `page.evaluate`. */
export interface BenchPageApi {
  /** Resolves when the bundle has registered its `create` function. */
  readonly ready: true;
  run(spec: PassSpec, context: BenchContext): Promise<unknown>;
}

/**
 * The allocation pass needs the Chrome DevTools Protocol sampling heap profiler, which only the runner can drive: the page
 * calls the function the runner exposes as `window.__benchGate("begin")` after its warm-up and `("end")` after the measured frames.
 */
export type BenchGate = (stage: "begin" | "end") => Promise<void>;
