/**
 * The application handle returned by `mountMtek` (`spec/runtime-abi.md` sections 6.2, 7, 9 and 10).
 *
 * It owns the scheduler, the resize and visibility listeners, the failure overlay and the lifetime of
 * every GPU resource (through the registry). Everything it adds is removed by `dispose()`.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import { closeImages, decodeImages, loadAssets, type LoadedAssets } from "../assets/loader.js";
import { MtekMountError, makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";
import type { DevTools } from "../dev/tools.js";
import type { AcquiredDevice } from "../gpu/device.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { MtekProgramScene } from "../abi/program.js";
import { attachInputListeners } from "../input/dom.js";
import { loadPhysicsBackend, physicsModuleUrl } from "../physics/load.js";
import { PhysicsSystem, type CollisionEventName } from "../physics/system.js";
import type { PhysicsBackend } from "../physics/types.js";
import { InputState } from "../input/input.js";
import { isMappedKeyCode } from "../input/keys.js";
import { copy } from "../math/copy.js";
import { startScene, type Scene } from "../render/startup.js";
import { Behaviors } from "../scene/behavior.js";
import { ExecutionBudgetExceeded, WHILE_ITERATION_CAP } from "../scene/budget.js";
import { INERT_GAME, GameLink, type GameHooks } from "../scene/game.js";
import { Xoshiro128 } from "../random/xoshiro.js";
import type { EntityRef } from "../scene/slots.js";
import { Scheduler, type FramePhases } from "../schedule/scheduler.js";
import { checkProgram } from "../scene/program.js";
import { resolveStructure } from "../scene/structure.js";
import type { CpuServices, World } from "../scene/world.js";
import type { FetchResponseLike, HostEnvironment, ResizeObserverLike } from "./environment.js";
import { resolveSpan, type DiagnosticSink } from "./failures.js";
import { GameSaves, MemorySaveStorage, persistentEntries, type SaveProblem, type SaveStorage } from "../scene/saves.js";
import { HostOutputs } from "./outputs.js";
import {ExtensionHost,sceneAccess,type MtekExtension} from "./extensions.js";
import type {MtekRenderingOptions} from "../render/options.js";
import { HostInputs, unknownInputResult } from "./inputs.js";
import type { FailureOverlay } from "./overlay.js";
import {
  findStructuralChange,
  migrateWorld,
  prefabNames,
  restartDiagnostic,
  stateIdentity,
  type StructuralChange,
} from "./reload.js";
import { loadCandidateShaders, loadStartupShaders } from "./shaders.js";
import type { Surface } from "./surface.js";
import type { MtekApp, MtekAppState, MtekDebug, MtekInputResult, MtekMountProgram, MtekTestOptions } from "./types.js";

export { unknownInputResult };

/** Device recovery makes at most this many attempts per loss (`spec/runtime-abi.md` section 9.4). */
export const RECOVERY_ATTEMPTS = 3;

/** The delays before attempts 1 to 3, in milliseconds. */
export const DEFAULT_RECOVERY_DELAYS_MS: readonly [number, number, number] = [250, 1000, 4000];

/** The callbacks a freshly requested device reports to. */
export interface DeviceHandlers {
  readonly onDeviceLost: (info: GPUDeviceLostInfo) => void;
  readonly onUncapturedError: (event: GPUUncapturedErrorEvent) => void;
}

/**
 * How {@link MountedApp.prepareProgram} prepares a program: a hot-reload candidate migrated into the running world
 * (`followScene`: a build whose entry is not the running scene reloads the running scene instead), or the scene of
 * `go_to`/`reset` started afresh (`carry`: the shared state carries over, decision 0141).
 */
type PrepareMode =
  | { readonly kind: "reload"; readonly followScene: boolean }
  | { readonly kind: "fresh"; readonly carry: boolean; readonly seed: number };

/**
 * What the scene of a `go_to`/`reset` owns while it is prepared in the background (decision 0176): its own game
 * hooks and its own random generator, so its `init` neither pauses, saves or loads the scene that still runs nor
 * draws from that scene's random stream. At the swap the hooks connect to the application.
 */
interface Preparation {
  /** The CPU services of the new world: the application's, with its own `game` and `random`. */
  readonly services: CpuServices;
  readonly link: GameLink;
  /** `pause()`/`resume()` called by the new scene's `init`: applied at the swap (`undefined`: not called). */
  held: boolean | undefined;
  /** Known once the manifest is read and the world exists. */
  manifest: MtekManifest | undefined;
  world: World | undefined;
}

/** The URL of a scene module of a multi-scene build, with the build id so a hot reload never imports a stale copy. */
function sceneModuleUrl(baseUrl: URL, module: string, buildId: string): string {
  const url = new URL(module, baseUrl);
  url.searchParams.set("build", buildId);
  return url.href;
}

/** The program a scene module exports (its default export; a module namespace without one is checked as is). */
function programOfModule(module: unknown): MtekMountProgram<Record<string, unknown>> {
  const candidate = typeof module === "object" && module !== null && "default" in module ? module.default : module;
  if (typeof candidate !== "object" || candidate === null) throw new Error("the scene module does not export a program");
  return candidate as MtekMountProgram<Record<string, unknown>>;
}

/** A copy of a state value for another world: records and arrays are copied, vectors and colours are frozen, a `mat4` stays a matrix. */
function carryValue(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) return copy(value);
  if (Array.isArray(value)) return value.map(carryValue);
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, carryValue(item)]));
  }
  return value;
}

/** Thrown inside a recovery attempt when the application was disposed or failed while it was running. */
class RecoveryAbandoned extends Error {}

export interface AppDependencies {
  readonly continuousCollision?:boolean;
  readonly rendering?:MtekRenderingOptions;
  /** Mutable: updated on a successful hot-reload swap. */
  manifest: MtekManifest;
  /** Mutable: replaced by the recreated device after a device loss. */
  device: GPUDevice;
  /** Requests a new adapter and device with the manifest's required capabilities (device recovery). */
  readonly acquireDevice: (handlers: DeviceHandlers) => Promise<AcquiredDevice>;
  /** Fetches shader files; remembers earlier responses so the rebuild after a device loss needs no network. */
  readonly fetchShaderFile: (url: string, reuseFrom?: string) => Promise<FetchResponseLike>;
  /**
   * The verified bytes of the program's asset files. The meshes and textures made from them are rebuilt from
   * these after a device loss, without the network (decision 0060). Mutable: a hot-reload swap replaces it.
   */
  assets: LoadedAssets;
  /** True with `devicePixelRatio: "auto"`: a change of the pixel ratio resizes the backing store. */
  readonly watchPixelRatio: boolean;
  readonly registry: ResourceRegistry;
  readonly surface: Surface;
  readonly sink: DiagnosticSink;
  /** `null` with `failureDisplay: "none"`. */
  readonly overlay: FailureOverlay | null;
  /** The development overlay and GPU timer; always `null` in a release runtime (decision 0055). */
  readonly devTools: DevTools | null;
  readonly environment: HostEnvironment;
  readonly canvas: HTMLCanvasElement;
  readonly pauseWhenHidden: boolean;
  readonly test: MtekTestOptions | undefined;
  /** The resolved `random()` seed (the generator itself is in the CPU services). */
  readonly seed: number;
  /** The input state `random`/`is_key_down` services and the DOM listeners share. */
  readonly input: InputState;
  /** CPU services passed into `startScene` (including hot-reload candidates). */
  readonly services: CpuServices;
  /** The entry scene's generated functions (lifecycle functions and handlers). Mutable on reload. */
  sceneFunctions: MtekProgramScene;
  /** The initialised scene: world, material arenas, pipelines and renderer. Mutable on hot reload. */
  scene: Scene;
  /** The physics subsystem of `scene`; `undefined` for a program without bodies. Replaced by a hot-reload swap. */
  physics: PhysicsSystem | undefined;
  /** The loaded physics module, kept so a reload that still has bodies does not import it again. */
  physicsModule: { readonly url: string; readonly backend: PhysicsBackend } | undefined;
  /** Shader modules by hash; reused across reloads when the WGSL is unchanged. */
  modules: Map<string, GPUShaderModule>;
  /** The mounted program module; updated on a successful hot-reload swap. */
  program: MtekMountProgram<Record<string, unknown>>;
  /** The game services the CPU services forward to (decisions 0140, 0141, 0143); the application connects them. */
  readonly game?: GameLink;
  /** Where saved state and settings are kept (decisions 0145, 0146); default: in memory. */
  readonly saveStorage?: SaveStorage;
  /** The page's storage could not be reached, so `saveStorage` is in memory: the first save reports `W5403`. */
  readonly saveStorageUnavailable?: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.message === "" ? error.name : error.message) : String(error);
}

/** Why an attempt failed, with the browser's own words: a rejected device request carries them in the notes. */
function attemptFailureText(error: unknown): string {
  if (error instanceof MtekMountError) {
    return error.diagnostics.map((diagnostic) => [diagnostic.message, ...diagnostic.notes].join(" ")).join(" ");
  }
  return errorText(error);
}

export class MountedApp<I = Record<string, unknown>, O = Record<string, unknown>> implements MtekApp<I, O> {
  private extensions: ExtensionHost | undefined;
  installExtensions(extensions: readonly MtekExtension[],services:Readonly<Record<string,unknown>>={}):void {
    const access=sceneAccess(()=>this.deps.scene.world,()=>{if(this.current==="disposed"||this.current==="failed")throw new Error(`The application is ${this.current}`);});
    this.extensions=new ExtensionHost({apiVersion:1,...access,service:<T>(name:string)=>services[name] as T|undefined},(id,error)=>{
      this.report(makeRuntimeDiagnostic("E8050",{phase:"runtime:update",message:`Extension '${id}' failed and was disabled: ${errorText(error)}`}));
    });
    this.extensions.install(extensions);
  }
  readonly debug?: MtekDebug;
  readonly seed: number;

  private current: MtekAppState = "running";
  private pausedByVisibility = false;
  private readonly scheduler: Scheduler;
  private readonly input: InputState;
  private behaviors: Behaviors;
  private readonly resizeObserver: ResizeObserverLike | undefined;
  private frameStartMs = 0;
  /** The scheduler phase that is running (or ran last): the `phase` of an `E8080`. */
  private framePhase: MtekRuntimePhase = "runtime:input";
  private renderStartMs = 0;
  private frameTimeMs = 0;
  private cpuUpdateMs = 0;
  private renderPrepMs = 0;
  private hostInputs: HostInputs;
  private readonly hostOutputs: HostOutputs;
  /** Retained modules can outlive the current manifest; recovery needs their cached WGSL provenance. */
  private readonly shaderSources = new Map<string, string>();
  /** Validated candidate waiting to become the live scene at the next frame start. */
  private pendingSwap:
    | {
        readonly scene: Scene;
        readonly manifest: MtekManifest;
        readonly program: MtekMountProgram<Record<string, unknown>>;
        readonly modules: Map<string, GPUShaderModule>;
        readonly assets: LoadedAssets;
        readonly sceneFunctions: MtekProgramScene;
        readonly restart: StructuralChange | undefined;
        /** The physics module the candidate needs (loaded by `replaceProgram`), if it has bodies. */
        readonly physicsModule: { readonly url: string; readonly backend: PhysicsBackend } | undefined;
        /** A scene of `go_to`/`reset`: no migration; `carry` copies the shared state (decision 0141). */
        readonly fresh?: { readonly carry: boolean; readonly preparation: Preparation };
      }
    | undefined;
  /** The scene change being prepared or queued: later `go_to`/`reset` calls are ignored until it is applied or fails. */
  private sceneRequest: { readonly kind: "go_to" | "reset"; readonly scene: string } | undefined;
  /** The game hooks of the live scene (decisions 0140, 0141, 0143). */
  private readonly hooks: GameHooks;
  /** The CPU services the live world was started with: the application's, or those of its own `Preparation`. */
  private liveServices: CpuServices;
  /** The DOM codes some handler of the live scene names (rebuilt at every swap); polled keys are added on top. */
  private handlerKeys: ReadonlySet<string>;
  /** What `attachInputListeners` asks: is the default action of this key suppressed? */
  private readonly keyGuard = {
    has: (code: string): boolean => this.handlerKeys.has(code) || this.input.isPolled(code),
  };

  /** Identifies the current device: a `lost` event of an older one is stale (decision 0056). */
  private deviceEpoch = 0;
  /** The epoch whose `destroyed` loss was requested by `debug.loseDevice` and is therefore a loss to recover from. */
  private simulatedLossEpoch = -1;
  private losses = 0;
  private recoveries = 0;
  private recoveryAttemptsMade = 0;
  private recoveryTimer: unknown;
  /** Why the running attempt must fail although nothing threw: the new device was lost, an allocation failed. */
  private attemptProblem: string | undefined;
  /** What the application was doing when the device was lost, to restore it afterwards. */
  private beforeLoss = { paused: false, byVisibility: false };
  /** Saved state and settings (decisions 0145, 0146). */
  private readonly saves: GameSaves;
  private injectedDeviceFailures: number;
  private readonly recoveryDelaysMs: readonly number[];

  constructor(private readonly deps: AppDependencies) {
    const { manifest, environment, registry, test } = deps;
    this.seed = deps.seed;
    this.injectedDeviceFailures = test?.recovery?.failDeviceRequests ?? 0;
    this.recoveryDelaysMs = test?.recovery?.delaysMs ?? DEFAULT_RECOVERY_DELAYS_MS;
    this.input = deps.input;
    this.behaviors = new Behaviors(deps.sceneFunctions, deps.scene.world);
    this.handlerKeys = this.behaviors.handledKeys();
    this.liveServices = deps.services;
    this.hooks = this.gameHooks();
    this.hostInputs = new HostInputs(manifest);
    this.hostOutputs = new HostOutputs(manifest);
    for (const shader of manifest.shaders) {
      if (!this.shaderSources.has(shader.hash)) this.shaderSources.set(shader.hash, new URL(shader.url, deps.program.baseUrl).href);
    }
    registry.phase = "runtime:render";
    if (test?.disableCulling === true) deps.scene.renderer.setFrustumCulling(false);

    const manual = test?.manualClock === true;
    this.scheduler = new Scheduler(
      manifest.runtimeConfig,
      this.createPhases(),
      manual ? null : { request: (cb) => environment.requestAnimationFrame(cb), cancel: (h) => { environment.cancelAnimationFrame(h); } },
      (error) => {
        if (error instanceof ExecutionBudgetExceeded) {
          this.failBudget(error);
          return;
        }
        this.fail(
          makeRuntimeDiagnostic("E8050", {
            phase: "runtime:render",
            message: `The frame loop stopped because a frame threw: ${errorText(error)}`,
          }),
        );
      },
    );

    const ResizeObserverCtor = environment.ResizeObserver;
    if (ResizeObserverCtor !== undefined) {
      this.resizeObserver = new ResizeObserverCtor(() => {
        this.onResize();
      });
      this.resizeObserver.observe(deps.canvas);
    }
    if (deps.watchPixelRatio) this.watchPixelRatio();

    attachInputListeners(this.input, {
      canvas: deps.canvas,
      document: environment.document,
      window: environment.window,
      registry,
      handledKeys: this.keyGuard,
    });

    if (environment.document !== undefined) {
      registry.addEventListener(environment.document, "visibilitychange", () => {
        this.onVisibilityChange();
      });
      if (deps.pauseWhenHidden && environment.document.visibilityState === "hidden") {
        this.current = "paused";
        this.pausedByVisibility = true;
        this.input.pause();
        this.scheduler.pause();
        deps.services.audio?.setSuspended?.(true);
      }
    }

    if (test !== undefined) this.debug = this.createDebug(manual);
    this.saves = new GameSaves(
      deps.saveStorage ?? new MemorySaveStorage(),
      manifest.game?.storage,
      (problem) => {
        this.reportSaveProblem(problem);
      },
      deps.saveStorageUnavailable === true,
      manifest.game?.legacyStorage,
    );
    // The scene starts from its saved values (decision 0145): after `init`, before the first frame.
    this.saves.restore(persistentEntries(manifest.scene.state), deps.scene.world.sceneState);
    if (deps.game !== undefined) deps.game.target = this.hooks;
    this.scheduler.start();
  }

  /**
   * The game services of generated code (decisions 0140, 0141 and 0143). `pause()` holds the game clock, not the
   * application: input handlers, bindings and rendering go on (the hook UI code uses for a pause menu, see
   * `spec/scenes.md` section 15.4); `app.pause()` stops everything.
   */
  private gameHooks(): GameHooks {
    return {
      goTo: (scene, spanId) => {
        this.requestScene("go_to", scene, spanId);
      },
      reset: () => {
        this.requestScene("reset", this.deps.manifest.scene.name, -1);
      },
      pause: () => {
        this.scheduler.pauseGame();
      },
      resume: () => {
        this.scheduler.resumeGame();
      },
      paused: () => this.scheduler.gamePaused,
      save: () => {
        this.saves.save(persistentEntries(this.deps.manifest.scene.state), this.deps.scene.world.sceneState);
      },
      load: () => this.saves.restore(persistentEntries(this.deps.manifest.scene.state), this.deps.scene.world.sceneState),
      clearSaved: () => {
        this.saves.clear();
      },
    };
  }

  /**
   * The hooks of a scene that is being prepared (decision 0176): its `pause()`/`resume()` are remembered and applied
   * when it becomes the live scene, its `save()`/`load()` read and write its own state, and a scene change it asks for
   * is ignored, because one is pending already.
   */
  private preparingHooks(preparation: Preparation): GameHooks {
    const entries = (): ReturnType<typeof persistentEntries> => persistentEntries(preparation.manifest?.scene.state ?? []);
    return {
      goTo: () => undefined,
      reset: () => undefined,
      pause: () => {
        preparation.held = true;
      },
      resume: () => {
        preparation.held = false;
      },
      paused: () => preparation.held === true,
      save: () => {
        if (preparation.world !== undefined) this.saves.save(entries(), preparation.world.sceneState);
      },
      load: () => (preparation.world === undefined ? false : this.saves.restore(entries(), preparation.world.sceneState)),
      clearSaved: () => {
        this.saves.clear();
      },
    };
  }

  /** `W5402` and `W5403` (decision 0145): warnings, the scene goes on. */
  private reportSaveProblem(problem: SaveProblem): void {
    this.report(makeRuntimeDiagnostic(problem.code, { phase: "runtime:update", message: problem.message }));
  }

  /**
   * `go_to(scene)` and `reset()`: the scene is prepared in the background while the current one keeps running, and
   * becomes the live scene at the start of a frame (like a hot reload). The first request wins until it is applied
   * or fails; a failure reports `E5401` and the current scene goes on (decision 0141).
   */
  private requestScene(kind: "go_to" | "reset", scene: string, spanId: number): void {
    if (this.sceneRequest !== undefined || (this.current !== "running" && this.current !== "paused")) return;
    const request = { kind, scene };
    this.sceneRequest = request;
    // The new scene draws from a generator of its own, seeded by one draw of the live scene's stream at the call: the
    // draws do not depend on how long the preparation takes (decision 0176).
    const seed = Math.floor(this.liveServices.random() * 4294967296) >>> 0;
    void this.changeScene(request, spanId, seed).catch((error: unknown) => {
      this.sceneChangeFailed(request, spanId, [], errorText(error));
    });
  }

  private async changeScene(request: { readonly kind: "go_to" | "reset"; readonly scene: string }, spanId: number, seed: number): Promise<void> {
    const current = this.deps.manifest;
    let candidate: MtekMountProgram<Record<string, unknown>>;
    if (request.scene === current.scene.name) {
      candidate = this.deps.program;
    } else {
      const entry = current.game?.scenes?.find((scene) => scene.name === request.scene);
      if (entry === undefined) {
        this.sceneChangeFailed(request, spanId, [], `the build has no scene \`${request.scene}\``);
        return;
      }
      try {
        candidate = programOfModule(
          await this.deps.environment.importModule(sceneModuleUrl(this.deps.program.baseUrl, entry.module, current.buildId)),
        );
      } catch (error) {
        this.sceneChangeFailed(request, spanId, [], `its module ${entry.module} could not be loaded (${errorText(error)})`);
        return;
      }
    }
    const diagnostics: MtekDiagnostic[] = [];
    const prepared = await this.prepareProgram(candidate, { kind: "fresh", carry: request.kind === "go_to", seed }, (diagnostic) => {
      diagnostics.push(diagnostic);
    });
    if (!prepared.ok) this.sceneChangeFailed(request, spanId, diagnostics, "the scene could not be prepared");
  }

  private sceneChangeFailed(
    request: { readonly kind: "go_to" | "reset"; readonly scene: string },
    spanId: number,
    causes: readonly MtekDiagnostic[],
    why: string,
  ): void {
    if (this.sceneRequest === request) this.sceneRequest = undefined;
    if (this.current === "disposed") return;
    const action = request.kind === "go_to" ? `go_to(${request.scene})` : `reset() of ${request.scene}`;
    this.report(
      makeRuntimeDiagnostic("E5401", {
        phase: "runtime:update",
        message: `${action} failed: ${why}. The current scene keeps running.`,
        source: spanId < 0 ? null : resolveSpan(this.deps.manifest, spanId),
        notes: causes.map((cause) => `${cause.code}: ${cause.message}`),
      }),
    );
  }

  get state(): MtekAppState {
    return this.current;
  }

  /** Time since mount excluding paused time, in seconds (`frame.time` before conversion to f32). */
  get activeTime(): number {
    return this.scheduler.activeTime;
  }

  /** Never throws. Valid values are queued and applied in phase 1 of the next frame. */
  setInput<K extends keyof I & string>(name: K, value: I[K]): MtekInputResult {
    return this.hostInputs.setInput(name, value);
  }

  onOutput<K extends keyof O & string>(name: K, listener: (value: O[K]) => void): () => void {
    return this.hostOutputs.subscribe(name, listener as (value: unknown) => void);
  }

  /**
   * Candidate-based hot reload (`spec/runtime-abi.md` section 11): validate the candidate fully;
   * on failure discard it and keep the running program; on success queue an atomic swap for the
   * next frame start.
   */
  async replaceProgram(
    candidate: MtekMountProgram<I, O>,
  ): Promise<{ ok: true } | { ok: false; diagnostics: readonly MtekDiagnostic[] }> {
    if (this.current === "disposed" || this.current === "failed" || this.current === "recovering") {
      const diagnostic = makeRuntimeDiagnostic("E8050", {
        phase: "runtime:reload",
        message: `replaceProgram was called while the application is ${this.current}.`,
      });
      this.report(diagnostic);
      return { ok: false, diagnostics: [diagnostic] };
    }

    return this.prepareProgram(candidate as MtekMountProgram<Record<string, unknown>>, { kind: "reload", followScene: true }, (diagnostic) => {
      this.report(diagnostic);
    });
  }

  /**
   * Validates and prepares a program for the next frame start: a hot-reload candidate (`mode.kind` `"reload"`,
   * migrated into the running world) or the scene of `go_to`/`reset` (`"fresh"`, started from its initial values,
   * decisions 0140 and 0141). Every diagnostic goes to `report`; nothing is reported elsewhere.
   */
  private async prepareProgram(
    candidate: MtekMountProgram<Record<string, unknown>>,
    mode: PrepareMode,
    report: (diagnostic: MtekDiagnostic) => void,
  ): Promise<{ ok: true } | { ok: false; diagnostics: readonly MtekDiagnostic[] }> {
    const { environment, device, registry, surface } = this.deps;
    let services = this.liveServices;
    let preparation: Preparation | undefined;
    if (mode.kind === "fresh") {
      const generator = new Xoshiro128(mode.seed);
      const link = new GameLink();
      services = { ...this.deps.services, game: link, random: () => generator.nextF32() };
      preparation = { services, link, held: undefined, manifest: undefined, world: undefined };
      link.target = this.preparingHooks(preparation);
    }
    const epoch = this.deviceEpoch;
    const generation = registry.generation;
    const assertActive = (): void => {
      if (this.deviceEpoch !== epoch || registry.generation !== generation || (this.current !== "running" && this.current !== "paused")) {
        throw new Error(`The candidate was discarded because its application or GPU device is no longer current (application ${this.current}).`);
      }
    };
    const createdModules: GPUShaderModule[] = [];
    let preparedScene: Scene | undefined;
    try {
      if ((candidate.abi as number) !== 1) {
        const diagnostic = makeRuntimeDiagnostic("E8003", {
          phase: "runtime:reload",
          message: `Incompatible program: the program module's \`abi\` is ${String(candidate.abi)}, this runtime implements 1.`,
          notes: ["field: abi"],
        });
        report(diagnostic);
        return { ok: false, diagnostics: [diagnostic] };
      }

      let text: string;
      try {
        const response = await environment.fetch(candidate.manifestUrl.href);
        if (!response.ok) {
          const diagnostic = makeRuntimeDiagnostic("E8006", {
            phase: "runtime:reload",
            message: `The candidate manifest could not be loaded: HTTP ${String(response.status)} for ${candidate.manifestUrl.href}.`,
            notes: ["field: manifestUrl"],
          });
          report(diagnostic);
          return { ok: false, diagnostics: [diagnostic] };
        }
        text = await response.text();
      } catch (error) {
        const diagnostic = makeRuntimeDiagnostic("E8006", {
          phase: "runtime:reload",
          message: `The candidate manifest could not be loaded from ${candidate.manifestUrl.href}: ${errorText(error)}`,
          notes: ["field: manifestUrl"],
        });
        report(diagnostic);
        return { ok: false, diagnostics: [diagnostic] };
      }
      assertActive();

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        const diagnostic = makeRuntimeDiagnostic("E8006", {
          phase: "runtime:reload",
          message: `The candidate manifest is not valid JSON: ${errorText(error)}`,
          notes: ["field: manifest"],
        });
        report(diagnostic);
        return { ok: false, diagnostics: [diagnostic] };
      }

      const checkedManifest = checkManifest(json);
      if (!checkedManifest.ok) {
        const diagnostics = checkedManifest.failures.map((failure) =>
          makeRuntimeDiagnostic(failure.code, {
            phase: "runtime:reload",
            message: failure.message,
            notes: [`field: ${failure.field}`],
          }),
        );
        for (const diagnostic of diagnostics) report(diagnostic);
        return { ok: false, diagnostics };
      }
      const manifest = checkedManifest.manifest;
      if (preparation !== undefined) preparation.manifest = manifest;

      // Hot reload while another scene than the entry runs (decision 0141): the new build of that scene replaces it.
      if (mode.kind === "reload" && mode.followScene && manifest.scene.name !== this.deps.manifest.scene.name) {
        const running = manifest.game?.scenes?.find((scene) => scene.name === this.deps.manifest.scene.name);
        if (running !== undefined) {
          const module = await environment.importModule(sceneModuleUrl(candidate.baseUrl, running.module, manifest.buildId));
          assertActive();
          return await this.prepareProgram(programOfModule(module), { kind: "reload", followScene: false }, report);
        }
      }

      const structure = resolveStructure(manifest);
      if (!structure.ok) {
        for (const diagnostic of structure.diagnostics) report(diagnostic);
        return { ok: false, diagnostics: structure.diagnostics };
      }
      const checked = checkProgram(candidate, manifest);
      if (!checked.ok) {
        for (const diagnostic of checked.diagnostics) report(diagnostic);
        return { ok: false, diagnostics: checked.diagnostics };
      }

      // Reused modules need their retained source at the candidate's URL for recovery, even when
      // the build moved. Only WGSL is interchangeable by hash; span maps belong to their build.
      for (const shader of manifest.shaders) {
        const source = this.shaderSources.get(shader.hash);
        if (source === undefined) continue;
        const target = new URL(shader.url, candidate.baseUrl).href;
        if (source !== target) {
          await this.deps.fetchShaderFile(target, source);
          assertActive();
          const mapUrl = new URL(shader.map, candidate.baseUrl).href;
          // Maps are optional. Retain this build's map when available; never alias the old one.
          try { await this.deps.fetchShaderFile(mapUrl); } catch { /* Recovery falls back to the material declaration. */ }
          assertActive();
        }
      }

      const shaders = await loadCandidateShaders(
        {
          manifest,
          baseUrl: candidate.baseUrl,
          device,
          registry,
          fetch: this.deps.fetchShaderFile,
          phase: "runtime:reload",
          assertActive,
        },
        this.deps.modules,
      );
      createdModules.push(...shaders.created);
      assertActive();
      if (shaders.diagnostics.length > 0) {
        for (const module of shaders.created) registry.release(module);
        for (const diagnostic of shaders.diagnostics) report(diagnostic);
        return { ok: false, diagnostics: shaders.diagnostics };
      }
      for (const shader of manifest.shaders) this.shaderSources.set(shader.hash, new URL(shader.url, candidate.baseUrl).href);

      const restart = findStructuralChange(
        this.deps.manifest.scene,
        manifest.scene,
        prefabNames(this.deps.program.prefabs),
        prefabNames(candidate.prefabs),
        this.deps.manifest.prefabs ?? [],
        manifest.prefabs ?? [],
      );

      // Asset files that did not change (same url, hash and length) are not fetched again.
      const loaded = await loadAssets({
        manifest,
        baseUrl: candidate.baseUrl,
        environment,
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        phase: "runtime:reload",
        previous: this.deps.assets,
      });
      if (loaded.diagnostics.length > 0) {
        for (const module of shaders.created) registry.release(module);
        for (const diagnostic of loaded.diagnostics) report(diagnostic);
        return { ok: false, diagnostics: loaded.diagnostics };
      }
      services.audio?.adopt?.(manifest, (url) => (loaded.assets.has(url) ? loaded.assets.bytes(url) : undefined));

      // A candidate with bodies needs the physics module: the one already loaded when it is the same file,
      // otherwise it is imported now, so a candidate whose physics cannot load is discarded like any other.
      let started: Awaited<ReturnType<typeof startScene>>;
      let physicsModule = this.deps.physicsModule;
      try {
        assertActive();
        if (!manifest.subsystems.physics) {
          physicsModule = undefined;
        } else if (physicsModule === undefined || physicsModule.url !== physicsModuleUrl(manifest, candidate.baseUrl)) {
          const loadedPhysics = await loadPhysicsBackend({
            manifest,
            baseUrl: candidate.baseUrl,
            importModule: (url) => environment.importModule(url),
            phase: "runtime:reload",
          });
          if (!loadedPhysics.ok) {
            for (const module of shaders.created) registry.release(module);
            for (const diagnostic of loadedPhysics.diagnostics) report(diagnostic);
            return { ok: false, diagnostics: loadedPhysics.diagnostics };
          }
          physicsModule = { url: loadedPhysics.url, backend: loadedPhysics.backend };
        }
        assertActive();

        started = await startScene({
          ...(this.deps.rendering===undefined?{}:{rendering:this.deps.rendering}),
          assertActive,
          manifest,
          structure: structure.structure,
          program: checked.program,
          device,
          registry,
          surface,
          modules: shaders.modules,
          services,
          report: (diagnostic) => {
            report(diagnostic);
          },
          pipelineCache: this.deps.scene.pipelines,
          bindingPlan: this.deps.scene.plan,
          ...(preparation === undefined
            ? {}
            : {
                onWorld: (world: World) => {
                  preparation.world = world;
                },
              }),
          assets: { files: loaded.assets, images: loaded.images },
          ...(this.deps.test?.textures === undefined ? {} : { textures: this.deps.test.textures }),
          ...(this.deps.test?.disableInstancing === true ? { instancing: false } : {}),
        });
      } finally {
        closeImages(loaded.images);
      }
      if (!started.ok) {
        for (const module of shaders.created) registry.release(module);
        for (const diagnostic of started.diagnostics) report(diagnostic);
        return { ok: false, diagnostics: started.diagnostics };
      }
      preparedScene = started.scene;

      // A device loss during the preparation: the candidate's resources belong to the lost device (the
      // registry already dropped them), so it cannot become the live scene.
      assertActive();

      if (this.pendingSwap !== undefined) {
        this.pendingSwap.scene.materials.dispose();
        this.pendingSwap.scene.meshes.dispose();
        this.pendingSwap.scene.renderer.dispose();
        // A queued scene change replaced by a reload (or the other way round) is not applied.
        if (this.pendingSwap.fresh !== undefined) this.sceneRequest = undefined;
      }
      this.pendingSwap = {
        scene: started.scene,
        manifest,
        program: candidate,
        modules: new Map(shaders.modules),
        assets: loaded.assets,
        sceneFunctions: checked.program.scene,
        restart: mode.kind === "reload" ? restart : undefined,
        physicsModule,
        ...(mode.kind === "fresh" && preparation !== undefined ? { fresh: { carry: mode.carry, preparation } } : {}),
      };
      preparedScene = undefined;
      return { ok: true };
    } catch (error) {
      if (registry.generation === generation) {
        preparedScene?.materials.dispose();
        preparedScene?.meshes.dispose();
        preparedScene?.renderer.dispose();
        for (const module of createdModules) {
          try {
            registry.release(module);
          } catch {
            // Already released or never registered.
          }
        }
      }
      const diagnostic = makeRuntimeDiagnostic("E8050", {
        phase: "runtime:reload",
        message: mode.kind === "reload" ? `replaceProgram failed: ${errorText(error)}` : `Preparing the scene failed: ${errorText(error)}`,
      });
      report(diagnostic);
      return { ok: false, diagnostics: [diagnostic] };
    }
  }

  pause(): void {
    if (this.current !== "running") return;
    this.current = "paused";
    this.pausedByVisibility = false;
    this.input.pause();
    this.scheduler.pause();
    // The host's pause stops the sound too (decision 0176); the program's `pause()` leaves it to the program.
    this.deps.services.audio?.setSuspended?.(true);
  }

  resume(): void {
    if (this.current !== "paused") return;
    this.current = "running";
    this.pausedByVisibility = false;
    this.input.resume();
    this.scheduler.resume();
    this.deps.services.audio?.setSuspended?.(false);
  }

  /** The manifest of the scene that runs (it changes at a scene change and a hot reload). */
  currentManifest(): MtekManifest {
    return this.deps.manifest;
  }

  /** The verified asset files of the scene that runs. */
  currentAssets(): LoadedAssets {
    return this.deps.assets;
  }

  /** The active camera's pose of the scene that runs: where the listener of positional sound is. */
  listenerPose(): World["camera"] {
    return this.deps.scene.world.camera;
  }

  /**
   * Synchronous release (`spec/runtime-abi.md` section 9.3): stops the frame loop, removes every listener
   * and observer, destroys every buffer and texture, removes the overlay, unconfigures the canvas and
   * destroys the device. Idempotent.
   */
  dispose(): void {
    if (this.current === "disposed") return;
    this.current = "disposed";
    this.extensions?.dispose();
    if (this.deps.game !== undefined) this.deps.game.target = INERT_GAME;
    this.hostOutputs.dispose();
    if (this.pendingSwap !== undefined) {
      this.pendingSwap.scene.materials.dispose();
      this.pendingSwap.scene.meshes.dispose();
      this.pendingSwap.scene.renderer.dispose();
      this.pendingSwap = undefined;
    }
    const { device, registry, surface, overlay } = this.deps;
    // `spec/runtime-abi.md` section 9.3: the physics world, with every body, collider and the event queue.
    this.deps.physics?.dispose();
    this.deps.services.audio?.dispose?.();
    this.deps.services.hud?.dispose?.();
    this.scheduler.stop();
    this.clearRecoveryTimer();
    this.resizeObserver?.disconnect();
    surface.dispose();
    overlay?.remove();
    if (__MTEK_DEV__) this.deps.devTools?.dispose();
    registry.destroyAll();
    device.onuncapturederror = null;
    device.destroy();
  }

  /**
   * Called when `device.lost` resolves (`spec/runtime-abi.md` section 9.4, decision 0056). `epoch` names the
   * device the event belongs to; the first device is epoch 0. A loss caused by `dispose()` or by the runtime
   * discarding a failed attempt's device (reason `destroyed`) is ignored; so is the loss of a device that was
   * already replaced. Otherwise the frame loop pauses, `W8060` is reported and a bounded rebuild starts.
   */
  handleDeviceLost(info: GPUDeviceLostInfo, epoch = 0): void {
    if (this.current === "disposed" || this.current === "failed") return;
    if (info.reason === "destroyed" && epoch !== this.simulatedLossEpoch) return;
    if (epoch !== this.deviceEpoch) return;
    if (this.current === "recovering") {
      // The device of the running attempt was lost; the attempt notices when it next checks.
      this.attemptProblem ??= `the new device was lost (${info.reason}): ${info.message}`;
      return;
    }
    this.beginRecovery(info);
  }

  /** Called for validation errors no error scope captured. */
  handleUncapturedError(error: { readonly message: string }): void {
    if (this.current === "disposed") return;
    this.report(
      makeRuntimeDiagnostic("E8050", {
        phase: "runtime:render",
        message: `A GPU validation error was not captured by an error scope: ${error.message}`,
      }),
    );
  }

  /**
   * Called when a registry allocation fails after mount (`E8063`): the scene stops rather than render stale
   * data. During a device recovery the failure is the attempt's: it fails and the next one may succeed.
   */
  handleAllocationFailure(diagnostic: MtekDiagnostic): void {
    if (this.current === "disposed") return;
    if (this.current === "recovering") {
      this.attemptProblem ??= diagnostic.message;
      return;
    }
    this.fail(diagnostic);
  }

  /**
   * A material whose shader or pipeline failed after mount (hot reload, device recovery): the diagnostic
   * is reported and the material is no longer drawn; the scene keeps running (`spec/runtime-abi.md` section 12).
   * Mount-time failures never get here: they reject `mountMtek` with `shader-failed`.
   */
  handleMaterialFailure(materialId: string, diagnostic: MtekDiagnostic): void {
    if (this.current === "disposed") return;
    this.deps.scene.renderer.failMaterial(materialId, diagnostic);
  }

  /** Called by the physics subsystem, in the order of `spec/physics.md` section 6: runs one entity's collision handlers. */
  deliverCollision(kind: CollisionEventName, slot: number, other: EntityRef): void {
    this.behaviors.collision(kind, slot, other);
  }

  /** Delivers a diagnostic to the host; errors also appear in the overlay. */
  report(diagnostic: MtekDiagnostic): void {
    if (!this.deps.sink.report(diagnostic)) return;
    if (diagnostic.severity === "error") {
      this.deps.overlay?.add(diagnostic);
      if (__MTEK_DEV__) this.deps.devTools?.recordError(diagnostic);
    }
  }

  /** Reports the cause, stops the frame loop and shows the overlay (whatever the severity of the cause). */
  private fail(cause: MtekDiagnostic): void {
    if (this.current === "disposed" || this.current === "failed") return;
    this.current = "failed";
    this.hostOutputs.dispose();
    this.scheduler.stop();
    this.clearRecoveryTimer();
    this.deps.sink.report(cause);
    this.deps.overlay?.add(cause);
    if (__MTEK_DEV__) this.deps.devTools?.recordError(cause);
  }

  /**
   * `E8080` (decision 0075): a loop spent the last iteration of the frame's budget. The handler, the tick and the
   * frame were abandoned where they stood, which leaves the scene half updated, so the scene stops (the overlay
   * names the loop) instead of running on from a state no program produced.
   */
  private failBudget(error: ExecutionBudgetExceeded): void {
    if (error.whileCap) {
      this.fail(
        makeRuntimeDiagnostic("E8080", {
          phase: this.framePhase,
          message: `A \`while\` loop ran more than ${String(WHILE_ITERATION_CAP)} iterations, so the frame was abandoned and the scene stopped.`,
          source: resolveSpan(this.deps.manifest, error.spanId),
          notes: [
            "every `while` is capped at 1000000 iterations each time it is reached (decision 0144)",
            "help: make sure the condition becomes false; a loop that waits for something across frames belongs in `update` or a timer",
          ],
        }),
      );
      return;
    }
    const limit = this.deps.manifest.preview?.loopBudget;
    this.fail(
      makeRuntimeDiagnostic("E8080", {
        phase: this.framePhase,
        message:
          limit === undefined
            ? "A loop ran past the execution budget of this preview, so the frame was abandoned and the scene stopped."
            : `A loop ran past the execution budget of ${String(limit)} iterations per frame, so the frame was abandoned and the scene stopped.`,
        source: resolveSpan(this.deps.manifest, error.spanId),
        notes: [
          "the budget counts the iterations of every loop of every handler, lifecycle function and binding that runs in one frame",
          "help: bound the loop, or build the preview with a larger --loop-budget if the program really needs the iterations",
        ],
      }),
    );
  }

  private stateNow(): MtekAppState {
    return this.current;
  }

  /** A device was lost: pause, report `W8060`, and schedule attempt 1 (`spec/runtime-abi.md` section 9.4). */
  private beginRecovery(info: GPUDeviceLostInfo): void {
    this.losses += 1;
    const notes = [
      `Recovery: up to ${String(RECOVERY_ATTEMPTS)} attempts, after ${this.recoveryDelaysMs.map((delay) => `${String(delay)} ms`).join(", ")}; the application is paused until one succeeds.`,
    ];
    if (this.pendingSwap !== undefined) {
      // Its resources belong to the lost device; the next build of the dev server replaces it.
      this.pendingSwap = undefined;
      notes.push("A hot-reload candidate that was waiting for the next frame was discarded.");
    }
    this.beforeLoss = { paused: this.current === "paused", byVisibility: this.pausedByVisibility };
    if (this.current === "running") {
      this.input.pause();
      this.scheduler.pause();
    }
    this.current = "recovering";
    this.deps.device.onuncapturederror = null;
    this.deps.registry.phase = "runtime:device";
    const nth = this.losses === 1 ? "" : ` (device loss ${String(this.losses)})`;
    this.report(
      makeRuntimeDiagnostic("W8060", {
        phase: "runtime:device",
        message: `The GPU device was lost (${info.reason}): ${info.message}${nth}`,
        notes,
      }),
    );
    this.scheduleAttempt(1, []);
  }

  private scheduleAttempt(attempt: number, failures: readonly string[]): void {
    const delay = this.recoveryDelaysMs[attempt - 1] ?? 0;
    this.recoveryTimer = this.deps.environment.setTimeout(() => {
      this.recoveryTimer = undefined;
      void this.runAttempt(attempt, failures, delay);
    }, delay);
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer === undefined) return;
    this.deps.environment.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  /** One rebuild attempt. A failure schedules the next attempt, or ends in `E8062` after the last. */
  private async runAttempt(attempt: number, failures: readonly string[], delay: number): Promise<void> {
    this.recoveryAttemptsMade += 1;
    try {
      await this.rebuild();
    } catch (error) {
      if (error instanceof RecoveryAbandoned) {
        // Disposed (or failed) while the attempt ran: whatever it created after that is released here.
        if (this.stateNow() === "disposed") this.deps.registry.destroyAll();
        return;
      }
      this.retryOrFail(attempt, failures, delay, attemptFailureText(error));
      return;
    }
    this.finishRecovery(attempt);
  }

  private retryOrFail(attempt: number, failures: readonly string[], delay: number, problem: string): void {
    const all = [...failures, `attempt ${String(attempt)} (after ${String(delay)} ms) failed: ${problem}`];
    if (attempt < RECOVERY_ATTEMPTS) {
      this.scheduleAttempt(attempt + 1, all);
      return;
    }
    this.deps.registry.phase = "runtime:render";
    this.fail(
      makeRuntimeDiagnostic("E8062", {
        phase: "runtime:device",
        message: `The GPU device could not be recovered after ${String(RECOVERY_ATTEMPTS)} attempts; the application has stopped.`,
        notes: [...all, "help: reload the page to start again"],
      }),
    );
  }

  private ensureRecovering(): void {
    if (this.current !== "recovering") throw new RecoveryAbandoned();
  }

  /**
   * Requests a new device and rebuilds every GPU resource on it from the manifest and the retained CPU state
   * (the world with its entity records, mirrors and scene state, the bindings, the scheduler's time): the
   * registry forgets the lost device's objects, the surface is configured again, the shaders are created from
   * the remembered WGSL, and `startScene` runs in recover mode. Nothing of the application changes until the
   * whole rebuild succeeded; on any failure the new device is destroyed and the error propagates.
   */
  private async rebuild(): Promise<void> {
    const { registry, surface, services } = this.deps;
    if (this.injectedDeviceFailures > 0) {
      this.injectedDeviceFailures -= 1;
      throw new Error("requesting a GPU device failed (injected by test.recovery.failDeviceRequests)");
    }
    this.attemptProblem = undefined;
    const epoch = ++this.deviceEpoch;
    const acquired = await this.deps.acquireDevice({
      onDeviceLost: (info) => {
        this.handleDeviceLost(info, epoch);
      },
      onUncapturedError: (event) => {
        this.handleUncapturedError(event.error);
      },
    });
    const { device } = acquired;
    let committed = false;
    try {
      this.ensureRecovering();
      registry.recycle(device);
      surface.recover(device);
      await surface.preparePostProcessing();

      const manifest = this.deps.manifest;
      const structure = resolveStructure(manifest);
      if (!structure.ok) throw new Error(structure.diagnostics.map((diagnostic) => diagnostic.message).join(" "));
      const checked = checkProgram(this.deps.program, manifest);
      if (!checked.ok) throw new Error(checked.diagnostics.map((diagnostic) => diagnostic.message).join(" "));
      const shaders = await loadStartupShaders({
        manifest,
        baseUrl: this.deps.program.baseUrl,
        device,
        registry,
        fetch: this.deps.fetchShaderFile,
        phase: "runtime:device",
      });
      this.ensureRecovering();
      // A shader that does not build takes its material out of the scene (E8051); it does not fail the rebuild.
      for (const diagnostic of shaders.diagnostics) this.report(diagnostic);

      // The images are decoded again from the bytes the mount verified: the rebuild needs no network (decision 0060).
      const decoded = await decodeImages({
        manifest,
        baseUrl: this.deps.program.baseUrl,
        environment: this.deps.environment,
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        phase: "runtime:device",
        assets: this.deps.assets,
      });
      let scene: Scene | undefined;
      try {
        if (decoded.diagnostics.length > 0) throw new Error(decoded.diagnostics.map((diagnostic) => diagnostic.message).join(" "));
        this.ensureRecovering();

        const { world, bindings } = this.deps.scene;
        const started = await startScene({
          ...(this.deps.rendering===undefined?{}:{rendering:this.deps.rendering}),
          manifest,
          structure: structure.structure,
          program: checked.program,
          device,
          registry,
          surface,
          modules: shaders.modules,
          services,
          report: (diagnostic) => {
            this.report(diagnostic);
          },
          recover: { world, bindings },
          assets: { files: this.deps.assets, images: decoded.images },
          ...(this.deps.test?.textures === undefined ? {} : { textures: this.deps.test.textures }),
          ...(this.deps.test?.disableInstancing === true ? { instancing: false } : {}),
        });
        if (!started.ok) throw new Error(started.diagnostics.map((diagnostic) => diagnostic.message).join(" "));
        scene = started.scene;
      } finally {
        closeImages(decoded.images);
      }
      this.ensureRecovering();

      // Out-of-memory results arrive after a round trip (as at mount), and the new device may have been lost meanwhile.
      await device.queue.onSubmittedWorkDone();
      this.ensureRecovering();
      if (this.attemptProblem !== undefined) throw new Error(this.attemptProblem);

      const lost = this.deps.device;
      this.deps.device = device;
      this.deps.modules = new Map(shaders.modules);
      if (scene === undefined) throw new Error("internal error: the rebuild produced no scene");
      this.deps.scene = scene;
      committed = true;
      lost.onuncapturederror = null;
      lost.destroy();
    } finally {
      if (!committed) {
        device.onuncapturederror = null;
        device.destroy();
      }
    }
  }

  /** The rebuilt scene is live: restore what the application was doing and report `W8061`. */
  private finishRecovery(attempts: number): void {
    const { registry, environment } = this.deps;
    registry.phase = "runtime:render";
    this.recoveries += 1;
    if (__MTEK_DEV__) this.deps.devTools?.deviceRecovered();

    const hidden = this.deps.pauseWhenHidden && environment.document?.visibilityState === "hidden";
    const heldByHost = this.beforeLoss.paused && !this.beforeLoss.byVisibility;
    this.current = "paused";
    this.pausedByVisibility = !heldByHost && hidden === true;
    if (!heldByHost && hidden !== true) this.resume();

    // The canvas may have changed size while the rebuild ran (resize callbacks are ignored meanwhile).
    this.onResize();
    if (this.stateNow() === "failed") return;

    const nth = this.recoveries === 1 ? "" : ` (recovery ${String(this.recoveries)})`;
    this.report(
      makeRuntimeDiagnostic("W8061", {
        phase: "runtime:device",
        message: `The GPU device was recovered on attempt ${String(attempts)} of ${String(RECOVERY_ATTEMPTS)}; every GPU resource was recreated from the manifest and the retained scene state.${nth}`,
      }),
    );
  }

  /**
   * Watches the resolution media query of the current pixel ratio: when it stops matching the ratio changed
   * (the window moved to another display, the page zoom changed) and the backing store is recomputed. The
   * query names the ratio, so it is renewed after every change.
   */
  private watchPixelRatio(): void {
    const { environment, registry } = this.deps;
    const query = environment.matchMedia?.(`(resolution: ${String(environment.devicePixelRatio())}dppx)`);
    if (query === undefined) return;
    const remove = registry.addEventListener(query, "change", () => {
      remove();
      if (this.current === "disposed") return;
      this.onResize();
      this.watchPixelRatio();
    });
  }

  private onResize(): void {
    // While recovering the surface is rebuilt at the size the canvas has then.
    if (this.current === "disposed" || this.current === "failed" || this.current === "recovering") return;
    try {
      this.deps.surface.resize();
      this.deps.overlay?.reposition();
      if (__MTEK_DEV__) this.deps.devTools?.reposition();
    } catch (error) {
      if (this.state !== "failed") {
        this.fail(
          makeRuntimeDiagnostic("E8050", {
            phase: "runtime:render",
            message: `Resizing the canvas failed: ${errorText(error)}`,
          }),
        );
      }
    }
  }

  private onVisibilityChange(): void {
    const document = this.deps.environment.document;
    if (document === undefined) return;
    if (document.visibilityState === "hidden") {
      this.input.focusLost();
      if (this.current === "running" && this.deps.pauseWhenHidden) {
        this.current = "paused";
        this.pausedByVisibility = true;
        this.input.pause();
        this.scheduler.pause();
        this.deps.services.audio?.setSuspended?.(true);
      }
    } else if (!this.deps.pauseWhenHidden) {
      return;
    } else if (this.pausedByVisibility && this.current === "paused") {
      this.resume();
    }
  }

  private createPhases(): FramePhases {
    const now = (): number => this.deps.environment.now();
    return {
      phase1_input: () => {
        this.applyPendingSwap();
        this.framePhase = "runtime:input";
        this.frameStartMs = now();
        const { world } = this.deps.scene;
        // The budget is per frame: every handler, tick, update and binding of this frame draws on one counter.
        world.resetBudget();
        world.setFrame(this.scheduler.activeTime, this.scheduler.delta, this.scheduler.frameIndex);
        this.extensions?.frame("beforeFrame",this.scheduler.delta);
        this.hostInputs.applyQueued({ state: world.sceneState });
        // The HUD (decision 0134) is drawn again by every frame's handlers, ticks and update.
        this.deps.services.hud?.beginFrame?.();
          this.deps.services.gamepads?.poll();
          this.behaviors.dispatchInput(this.input.deliver());
      },
      phase2_tick: (step) => {
        this.framePhase = "runtime:tick";
        // (a) of `spec/scenes.md` section 10: the lifecycle queue is applied before each tick (spawned bodies are
        // created and destroyed ones removed by the physics listener), then (b) the commands, once.
        this.deps.scene.world.dynamic.flush();
        const physics = this.deps.physics;
        physics?.applyCommands();
        // (c) `fixed_update`; the commands it issues apply in the next tick.
        this.behaviors.fixedUpdate(step);
        // (d) step, (e) write the poses back, (f) deliver the collision events to the handlers.
        physics?.stepAndDeliver();
      },
      phase3_update: (delta) => {
        this.framePhase = "runtime:update";
        // Clips and particles run in phase 3, so pause stops them, and `update` sees the new count
        // (decisions 0155 and 0156). Timers follow (decision 0142).
        this.deps.scene.world.advanceClips(delta);
        this.deps.scene.world.advanceParticles(delta);
        this.deps.scene.world.advanceTimers(delta);
        this.behaviors.update(delta);
      },
      phase3_ui: (delta) => {
        this.framePhase = "runtime:update";
        this.behaviors.ui(delta);
      },
      phase4_flush: () => {
        this.deps.scene.world.dynamic.flush();
      },
      phase5_bindings: () => {
        this.framePhase = "runtime:bindings";
        this.deps.scene.bindings.evaluate();
        // The spawned entities' bindings follow the scene's (decision 0064).
        this.deps.scene.world.dynamic.evaluateBindings();
      },
      phase6_transforms: () => {
        this.deps.scene.world.propagate();
      },
      phase7_render: () => {
        this.renderStartMs = now();
        this.deps.scene.renderer.frame();
        this.deps.services.hud?.present?.();
        this.extensions?.frame("afterFrame",this.scheduler.delta);
        const end = now();
        this.cpuUpdateMs = this.renderStartMs - this.frameStartMs;
        this.renderPrepMs = end - this.renderStartMs;
        this.frameTimeMs = end - this.frameStartMs;
        if (__MTEK_DEV__) this.deps.devTools?.afterFrame(this.frameTimeMs, () => this.counters());
        this.hostOutputs.publish(this.deps.scene.world.sceneState);
        // Settings are written when they changed this frame (decision 0146).
        this.saves.autosave(persistentEntries(this.deps.manifest.scene.state), this.deps.scene.world.sceneState);
      },
    };
  }

  /** Applies a queued candidate at the start of the next frame, before phase 1 work. */
  private applyPendingSwap(): void {
    const pending = this.pendingSwap;
    if (pending === undefined) return;
    this.pendingSwap = undefined;

    const previous = this.deps.scene;
    const previousManifest = this.deps.manifest;

    // Physics follows the new world (decision 0066). The system is made first, so it hears about the spawned
    // entities the migration re-creates; the bodies of the named entities are made after the migration carried
    // their poses over. Velocities and queued commands do not survive a reload: the new world starts at rest.
    let physics: PhysicsSystem | undefined;
    if (pending.physicsModule !== undefined) {
      try {
        physics = new PhysicsSystem({
          ...(this.deps.continuousCollision===undefined?{}:{continuousCollision:this.deps.continuousCollision}),
          backend: pending.physicsModule.backend,
          manifest: pending.manifest,
          world: pending.scene.world,
          report: (diagnostic) => {
            this.report(diagnostic);
          },
          deliver: (kind, slot, other) => {
            this.deliverCollision(kind, slot, other);
          },
        });
      } catch (error) {
        pending.scene.materials.dispose();
        pending.scene.meshes.dispose();
        pending.scene.renderer.dispose();
        const cause = makeRuntimeDiagnostic("E8102", {
          phase: "runtime:reload",
          message: `The candidate was discarded: creating its physics world failed (${errorText(error)}).`,
          notes: [`module: ${pending.physicsModule.url}`],
        });
        const request = this.sceneRequest;
        if (pending.fresh !== undefined && request !== undefined) {
          // A scene change must never leave the request behind: it would ignore every later `go_to` and `reset()`.
          this.sceneChangeFailed(request, -1, [cause], "creating its physics world failed");
        } else {
          this.sceneRequest = undefined;
          this.report(cause);
        }
        return;
      }
      pending.scene.world.bodies = physics;
    }

    if (pending.fresh !== undefined) {
      // `go_to`/`reset` (decisions 0140, 0141): the new world keeps its initial values, except the shared state of
      // the same name and type, which carries over on `go_to`. A new scene starts with the game running.
      this.sceneRequest = undefined;
      // Saved state and settings first (decision 0145), then the shared state, which is newer.
      this.saves.restore(persistentEntries(pending.manifest.scene.state), pending.scene.world.sceneState);
      if (pending.fresh.carry) {
        const before = new Map(previousManifest.scene.state.filter((entry) => entry.shared === true).map((entry) => [entry.name, entry]));
        for (const entry of pending.manifest.scene.state) {
          const old = before.get(entry.name);
          if (entry.shared !== true || old === undefined || stateIdentity(old) !== stateIdentity(entry)) continue;
          pending.scene.world.sceneState[entry.name] = carryValue(previous.world.sceneState[entry.name]);
        }
      }
      previous.world.timers.clear();
      // A new scene starts with the game running, unless its own `init` paused it (decision 0176).
      pending.fresh.preparation.link.target = this.deps.game ?? INERT_GAME;
      this.liveServices = pending.fresh.preparation.services;
      if (pending.fresh.preparation.held === true) this.scheduler.pauseGame();
      else this.scheduler.resumeGame();
      // A click on a button of the old scene must not be claimed by a button of the new one.
      this.deps.services.hud?.clearClicks?.();
      this.input.clearPolled();
    } else if (pending.restart === undefined) {
      migrateWorld(previous.world, previousManifest, pending.scene.world, pending.manifest);
    } else {
      const diagnostic = restartDiagnostic(pending.manifest, pending.restart);
      this.deps.sink.report(diagnostic);
      this.deps.overlay?.add(diagnostic);
      if (__MTEK_DEV__) this.deps.devTools?.recordError(diagnostic);
    }

    if (this.deps.test?.disableCulling === true) pending.scene.renderer.setFrustumCulling(false);
    if (__MTEK_DEV__) this.deps.devTools?.setProgram(pending.manifest);
    physics?.createNamedBodies();
    this.deps.physics?.dispose();
    this.deps.physics = physics;
    this.deps.physicsModule = pending.physicsModule;
    this.deps.scene = pending.scene;
    this.deps.manifest = pending.manifest;
    this.deps.program = pending.program;
    this.deps.modules = pending.modules;
    this.deps.assets = pending.assets;
    this.deps.sceneFunctions = pending.sceneFunctions;
    this.behaviors = new Behaviors(pending.sceneFunctions, pending.scene.world);
    this.handlerKeys = this.behaviors.handledKeys();
    this.hostInputs = new HostInputs(pending.manifest);
    this.hostOutputs.replace(pending.manifest);

    previous.materials.dispose();
    previous.renderer.dispose();
    previous.meshes.dispose();
  }

  private createDebug(manual: boolean): MtekDebug {
    return {
      step: (frames, dtSeconds) => {
        if (!manual) throw new Error("debug.step requires mountMtek options test.manualClock");
        try {
          this.scheduler.stepManual(frames, dtSeconds);
        } catch (error) {
          // A program that ran past its budget fails like it does on the animation-frame loop (reported, scene
          // stopped, overlay); every other error of a manual frame still propagates (`Scheduler.stepManual`).
          if (!(error instanceof ExecutionBudgetExceeded)) throw error;
          this.failBudget(error);
        }
      },
      readPixels: () => {
        if (this.current === "disposed") return Promise.reject(new Error("readPixels: the application is disposed"));
        return this.deps.surface.readPixels();
      },
      counters: () => this.counters(),
      pressKey: (code) => {
        if (!isMappedKeyCode(code)) throw new RangeError(`debug.pressKey: '${String(code)}' is not the DOM code of a Key member`);
        this.input.keyDown(code);
      },
      releaseKey: (code) => {
        if (!isMappedKeyCode(code)) throw new RangeError(`debug.releaseKey: '${String(code)}' is not the DOM code of a Key member`);
        this.input.keyUp(code);
      },
      setParam: (entityName, param, value) => {
        if (this.current === "disposed" || this.current === "failed") {
          throw new Error(`debug.setParam: the application is ${this.current}`);
        }
        this.deps.scene.world.setParamByName(entityName, param, value);
      },
      loseDevice: () => {
        if (this.current !== "running" && this.current !== "paused") throw new Error(`debug.loseDevice: the application is ${this.current}`);
        this.simulatedLossEpoch = this.deviceEpoch;
        this.deps.device.destroy();
      },
      assets: () => this.deps.assets.statuses(),
      failAllocation: () => {
        if (this.current === "disposed" || this.current === "failed") throw new Error(`debug.failAllocation: the application is ${this.current}`);
        this.deps.registry.reportAllocationFailure("Allocating the GPU buffer 'debug.failAllocation' failed: out of memory (simulated).", [
          "injected by debug.failAllocation",
        ]);
      },
      scene: () => ({
        state: { ...this.deps.scene.world.sceneState },
        entities: this.deps.scene.world.entities.map((record, index) => ({
          name: this.deps.manifest.scene.entities[index]?.name ?? String(index),
          position: record.position,
          rotation: record.rotation,
          ...(record.mat === null ? {} : { mat: { p: { ...record.mat.p } } }),
        })),
        spawned: this.deps.scene.world.dynamic.live.map((entity) => ({
          prefab: entity.prefab.resolved.name,
          slot: entity.ref.slot,
          gen: entity.ref.gen,
          alive: !entity.removing,
          position: entity.record.position,
          rotation: entity.record.rotation,
          scale: entity.record.scale,
          visible: entity.record.visible,
          state: { ...entity.record.state },
          ...(entity.record.mat === null ? {} : { mat: { p: { ...entity.record.mat.p } } }),
        })),
      }),
    };
  }

  private counters(): Readonly<Record<string, number>> {
    const registry = this.deps.registry.snapshot();
    const { renderer, materials, world } = this.deps.scene;
    // Bodies and colliders in the physics world; zero without physics and after dispose (spec/physics.md section 7).
    const physics = this.deps.physics?.counts() ?? { bodies: 0, colliders: 0 };
    // GPU time exists only with timestamp-query in a development runtime that was asked to measure it;
    // otherwise the key is absent and `gpuTimeAvailable` is 0 (never CPU time under another name).
    const gpuTimeMs = __MTEK_DEV__ ? (this.deps.devTools?.gpuTimeMs ?? null) : null;
    return {
      ...registry,
      frameTimeMs: this.frameTimeMs,
      cpuUpdateMs: this.cpuUpdateMs,
      renderPrepMs: this.renderPrepMs,
      ...(gpuTimeMs === null ? {} : { gpuTimeMs }),
      gpuTimeAvailable: gpuTimeMs === null ? 0 : 1,
      drawCalls: renderer.drawCalls,
      drawCallsTotal: renderer.drawCallsCumulative,
      failedMaterials: renderer.failedMaterialCount,
      instancedDraws: renderer.instancedDraws,
      instancedDrawsTotal: renderer.instancedDrawsCumulative,
      culledObjects: renderer.culledObjects,
      culledObjectsTotal: renderer.culledObjectsCumulative,
      rebatchesTotal: renderer.rebatchesCumulative,
      sharedParamBlocks: materials.sharedParamBlocks,
      ownedParamBlocks: materials.ownedParamBlocks,
      discardedSteps: this.scheduler.discardedSteps,
      liveEntities: world.dynamic.aliveCount,
      pendingSpawns: world.dynamic.pendingSpawns,
      pendingRemovals: world.dynamic.pendingRemovals,
      entitySlots: world.dynamic.slotCapacity,
      entitiesSpawned: world.dynamic.spawned,
      entitiesDestroyed: world.dynamic.destroyed,
      physicsBodies: physics.bodies,
      physicsColliders: physics.colliders,
      physicsSteps: this.deps.physics?.steps ?? 0,
      physicsFrozenBodies: this.deps.physics?.frozenBodies ?? 0,
      framesRendered: this.deps.surface.framesRendered,
      framesSkipped: this.deps.surface.framesSkipped,
      deviceLosses: this.losses,
      deviceRecoveries: this.recoveries,
      recoveryAttempts: this.recoveryAttemptsMade,
    };
  }
}
