/**
 * The public host API types of `spec/runtime-abi.md` section 6 as implemented. The hand-maintained
 * `src/runtime.d.ts` declares the same shapes for programs and hosts; `runtime-dts.test.ts` proves
 * the two agree in both directions.
 */
import type { MtekDiagnostic } from "../diagnostics/types.js";
import type { MtekExtension } from "./extensions.js";
import type { MtekPhysics } from "./physics-api.js";
import type {MtekRenderingOptions} from "../render/options.js";
import type { MtekComputeHandle } from "../compute/host.js";

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
  /**
   * Draw every entity with its own draw call, as if compatible instancing did not exist (decision 0059):
   * lets a test compare an instanced frame with an individually drawn one. Parameter blocks are still shared;
   * no instanced pipeline and no instance buffer are created. `instancedDraws` stays 0.
   */
  disableInstancing?: boolean;
  /** Replace the pixels of a built-in texture (a generated texture for a test; no asset needed). */
  textures?: { "texture.white"?: MtekTestTexture; "texture.black"?: MtekTestTexture };
  /**
   * Called for every state change of every asset file of the program (`spec/assets.md` section 5): all files
   * `pending` first, then `ready` or `failed` as each finishes, before `mountMtek` settles (decision 0060).
   */
  onAssetState?: (event: MtekAssetStateEvent) => void;
}

/** One state change of one asset file: `pending`, then `ready` or `failed`. */
export interface MtekAssetStateEvent {
  /** The file's `url` in the manifest's `assets` table. */
  readonly url: string;
  readonly kind: "mesh-data" | "image" | "audio" | "font";
  readonly state: "pending" | "ready" | "failed";
}

/** An asset file and its state, as `debug.assets()` lists it. */
export interface MtekAssetStatus extends MtekAssetStateEvent {
  /** The file's byte length. */
  readonly bytes: number;
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
   * without `bind`: uploaded by the next frame, never creates a shader, pipeline or bind group; a colour with
   * alpha below 1 makes the draw translucent (decision 0138). A wrong entity, param or value throws (decision 0046).
   */
  setParam(entityName: string, param: string, value: unknown): void;
  /**
   * Destroys the GPU device. The `lost` event that follows has reason `destroyed`, which the runtime
   * ignores when it comes from `dispose()`; this call marks it as a loss to recover from (decision 0056).
   */
  loseDevice(): void;
  /** Reports `E8063` as an out-of-memory error scope would, so the failure path can be driven on hardware. */
  failAllocation(): void;
  /** Every asset file of the running program with its state: after a successful mount all are `ready` (decision 0060). */
  assets(): readonly MtekAssetStatus[];
  /**
   * The scene's state, its named entities and, in spawn order, the spawned entities that exist (decision 0064): the
   * prefab's name, the slot and generation of its `entity_ref`, whether it is alive (not pending removal), its pose,
   * visibility, state and material params.
   */
  scene(): {
    state: Record<string, unknown>;
    entities: Array<{ name: string; position: unknown; rotation: unknown }>;
    spawned: Array<{
      prefab: string;
      slot: number;
      gen: number;
      alive: boolean;
      position: unknown;
      rotation: unknown;
      scale: unknown;
      visible: boolean;
      state: Record<string, unknown>;
      mat?: { p: Record<string, unknown> };
    }>;
  };
}

export type MtekInputResult = { ok: true } | { ok: false; error: { code: string; message: string } };

export type MtekAppState = "running" | "paused" | "recovering" | "failed" | "disposed";

export interface MtekApp<I = Record<string, unknown>, O = Record<string, unknown>> {
  /** Create an owned instance of a packaged compute declaration, by qualified symbol. */
  createCompute(id: string, params?: Readonly<Record<string, unknown>>): Promise<MtekComputeHandle>;
  setInput<K extends keyof I & string>(name: K, value: I[K]): MtekInputResult;
  /**
   * Initial snapshot after the next settled frame, then only value changes. Returns an idempotent
   * unsubscribe. Vector/color values are frozen copies; color components are linear RGBA.
   * Throws for an undeclared name, a non-function listener, or a failed/disposed app.
   */
  onOutput<K extends keyof O & string>(name: K, listener: (value: O[K]) => void): () => void;
  pause(): void;
  resume(): void;
  /** Synchronous release (`spec/runtime-abi.md` section 9.3). */
  dispose(): void;
  readonly state: MtekAppState;
  /**
   * Ray and shape casts, contacts and collision groups by entity ID (decision 0217); `undefined` while the running
   * program has no physics. Queries see the world as of the last completed tick.
   */
  readonly physics?: MtekPhysics | undefined;
  readonly debug?: MtekDebug;
  replaceProgram?(
    candidate: MtekMountProgram<I, O>,
  ): Promise<{ ok: true } | { ok: false; diagnostics: readonly MtekDiagnostic[] }>;
}

export interface MtekMountOptions<I = Record<string, unknown>> {
  physics?:{readonly continuousCollision?:boolean};
  rendering?:MtekRenderingOptions;
  extensions?: readonly MtekExtension[];
  hostServices?: Readonly<Record<string,unknown>>;
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
  /**
   * Where `saved state` and `setting state` are kept (decisions 0145 and 0146). Default: the page's
   * `localStorage`, or an in-memory store when `test` is given, so that test runs never read or write the
   * page's storage. `null` keeps saves in memory only, for the life of the application.
   */
  storage?: MtekSaveStorage | null;
  test?: MtekTestOptions;
}

/** The part of the Web Storage API that saves use (`localStorage` satisfies it). */
export interface MtekSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The program as `mountMtek` accepts it: the shape of the default export of `app.js`
 * (`spec/runtime-abi.md` section 3). M1 reads only `abi`, `baseUrl` and `manifestUrl`; the members
 * that carry generated code are opaque until M3.
 */
export interface MtekMountProgram<I = Record<string, unknown>, O = Record<string, unknown>> {
  readonly abi: 1;
  readonly baseUrl: URL;
  readonly manifestUrl: URL;
  readonly writers: unknown;
  readonly functions: unknown;
  readonly scenes: unknown;
  readonly prefabs: unknown;
  /** Phantom, never present at run time. */
  readonly __inputs?: I;
  /** Phantom, never present at run time. Map interface keys so single-generic hosts accept generated Outputs. */
  readonly __outputs?: { readonly [K in keyof O]: O[K] };
}
