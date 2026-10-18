/**
 * The application handle returned by `mountMtek` (`spec/runtime-abi.md` sections 6.2, 7, 9 and 10).
 *
 * It owns the scheduler, the resize and visibility listeners, the failure overlay and the lifetime of
 * every GPU resource (through the registry). Everything it adds is removed by `dispose()`.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import { closeImages, decodeImages, loadAssets, type LoadedAssets } from "../assets/loader.js";
import { MtekMountError, makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import type { DevTools } from "../dev/tools.js";
import type { AcquiredDevice } from "../gpu/device.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { MtekProgramScene } from "../abi/program.js";
import { attachInputListeners } from "../input/dom.js";
import { InputState } from "../input/input.js";
import { isMappedKeyCode } from "../input/keys.js";
import { startScene, type Scene } from "../render/startup.js";
import { Behaviors } from "../scene/behavior.js";
import { Scheduler, type FramePhases } from "../schedule/scheduler.js";
import { checkProgram } from "../scene/program.js";
import { resolveStructure } from "../scene/structure.js";
import type { CpuServices } from "../scene/world.js";
import type { FetchResponseLike, HostEnvironment, ResizeObserverLike } from "./environment.js";
import type { DiagnosticSink } from "./failures.js";
import { HostInputs, unknownInputResult } from "./inputs.js";
import type { FailureOverlay } from "./overlay.js";
import {
  findStructuralChange,
  migrateWorld,
  prefabNames,
  restartDiagnostic,
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

/** Thrown inside a recovery attempt when the application was disposed or failed while it was running. */
class RecoveryAbandoned extends Error {}

export interface AppDependencies {
  /** Mutable: updated on a successful hot-reload swap. */
  manifest: MtekManifest;
  /** Mutable: replaced by the recreated device after a device loss. */
  device: GPUDevice;
  /** Requests a new adapter and device with the manifest's required capabilities (device recovery). */
  readonly acquireDevice: (handlers: DeviceHandlers) => Promise<AcquiredDevice>;
  /** Fetches shader files; remembers earlier responses so the rebuild after a device loss needs no network. */
  readonly fetchShaderFile: (url: string) => Promise<FetchResponseLike>;
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
  /** Shader modules by hash; reused across reloads when the WGSL is unchanged. */
  modules: Map<string, GPUShaderModule>;
  /** The mounted program module; updated on a successful hot-reload swap. */
  program: MtekMountProgram<Record<string, unknown>>;
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

export class MountedApp<I = Record<string, unknown>> implements MtekApp<I> {
  readonly debug?: MtekDebug;
  readonly seed: number;

  private current: MtekAppState = "running";
  private pausedByVisibility = false;
  private readonly scheduler: Scheduler;
  private readonly input: InputState;
  private behaviors: Behaviors;
  private readonly resizeObserver: ResizeObserverLike | undefined;
  private frameStartMs = 0;
  private renderStartMs = 0;
  private frameTimeMs = 0;
  private cpuUpdateMs = 0;
  private renderPrepMs = 0;
  private hostInputs: HostInputs;
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
      }
    | undefined;

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
  private injectedDeviceFailures: number;
  private readonly recoveryDelaysMs: readonly number[];

  constructor(private readonly deps: AppDependencies) {
    const { manifest, environment, registry, test } = deps;
    this.seed = deps.seed;
    this.injectedDeviceFailures = test?.recovery?.failDeviceRequests ?? 0;
    this.recoveryDelaysMs = test?.recovery?.delaysMs ?? DEFAULT_RECOVERY_DELAYS_MS;
    this.input = deps.input;
    this.behaviors = new Behaviors(deps.sceneFunctions, deps.scene.world);
    this.hostInputs = new HostInputs(manifest);
    registry.phase = "runtime:render";
    if (test?.disableCulling === true) deps.scene.renderer.setFrustumCulling(false);

    const manual = test?.manualClock === true;
    this.scheduler = new Scheduler(
      manifest.runtimeConfig,
      this.createPhases(),
      manual ? null : { request: (cb) => environment.requestAnimationFrame(cb), cancel: (h) => { environment.cancelAnimationFrame(h); } },
      (error) => {
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
      handledKeys: this.behaviors.handledKeys(),
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
      }
    }

    if (test !== undefined) this.debug = this.createDebug(manual);
    this.scheduler.start();
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

  /**
   * Candidate-based hot reload (`spec/runtime-abi.md` section 11): validate the candidate fully;
   * on failure discard it and keep the running program; on success queue an atomic swap for the
   * next frame start.
   */
  async replaceProgram(
    candidate: MtekMountProgram<I>,
  ): Promise<{ ok: true } | { ok: false; diagnostics: readonly MtekDiagnostic[] }> {
    if (this.current === "disposed" || this.current === "failed" || this.current === "recovering") {
      const diagnostic = makeRuntimeDiagnostic("E8050", {
        phase: "runtime:reload",
        message: `replaceProgram was called while the application is ${this.current}.`,
      });
      this.report(diagnostic);
      return { ok: false, diagnostics: [diagnostic] };
    }

    const { environment, device, registry, surface, services } = this.deps;
    const epoch = this.deviceEpoch;
    const createdModules: GPUShaderModule[] = [];
    try {
      if ((candidate.abi as number) !== 1) {
        const diagnostic = makeRuntimeDiagnostic("E8003", {
          phase: "runtime:reload",
          message: `Incompatible program: the program module's \`abi\` is ${String(candidate.abi)}, this runtime implements 1.`,
          notes: ["field: abi"],
        });
        this.report(diagnostic);
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
          this.report(diagnostic);
          return { ok: false, diagnostics: [diagnostic] };
        }
        text = await response.text();
      } catch (error) {
        const diagnostic = makeRuntimeDiagnostic("E8006", {
          phase: "runtime:reload",
          message: `The candidate manifest could not be loaded from ${candidate.manifestUrl.href}: ${errorText(error)}`,
          notes: ["field: manifestUrl"],
        });
        this.report(diagnostic);
        return { ok: false, diagnostics: [diagnostic] };
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        const diagnostic = makeRuntimeDiagnostic("E8006", {
          phase: "runtime:reload",
          message: `The candidate manifest is not valid JSON: ${errorText(error)}`,
          notes: ["field: manifest"],
        });
        this.report(diagnostic);
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
        for (const diagnostic of diagnostics) this.report(diagnostic);
        return { ok: false, diagnostics };
      }
      const manifest = checkedManifest.manifest;

      const structure = resolveStructure(manifest);
      if (!structure.ok) {
        for (const diagnostic of structure.diagnostics) this.report(diagnostic);
        return { ok: false, diagnostics: structure.diagnostics };
      }
      const checked = checkProgram(candidate, manifest);
      if (!checked.ok) {
        for (const diagnostic of checked.diagnostics) this.report(diagnostic);
        return { ok: false, diagnostics: checked.diagnostics };
      }

      const shaders = await loadCandidateShaders(
        {
          manifest,
          baseUrl: candidate.baseUrl,
          device,
          registry,
          fetch: (url) => environment.fetch(url),
          phase: "runtime:reload",
        },
        this.deps.modules,
      );
      createdModules.push(...shaders.created);
      if (shaders.diagnostics.length > 0) {
        for (const module of shaders.created) registry.release(module);
        for (const diagnostic of shaders.diagnostics) this.report(diagnostic);
        return { ok: false, diagnostics: shaders.diagnostics };
      }

      const restart = findStructuralChange(
        this.deps.manifest.scene,
        manifest.scene,
        prefabNames(this.deps.program.prefabs),
        prefabNames(candidate.prefabs),
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
        for (const diagnostic of loaded.diagnostics) this.report(diagnostic);
        return { ok: false, diagnostics: loaded.diagnostics };
      }

      let started: Awaited<ReturnType<typeof startScene>>;
      try {
        started = await startScene({
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
          pipelineCache: this.deps.scene.pipelines,
          bindingPlan: this.deps.scene.plan,
          assets: { files: loaded.assets, images: loaded.images },
          ...(this.deps.test?.textures === undefined ? {} : { textures: this.deps.test.textures }),
          ...(this.deps.test?.disableInstancing === true ? { instancing: false } : {}),
        });
      } finally {
        closeImages(loaded.images);
      }
      if (!started.ok) {
        for (const module of shaders.created) registry.release(module);
        for (const diagnostic of started.diagnostics) this.report(diagnostic);
        return { ok: false, diagnostics: started.diagnostics };
      }

      // A device loss during the preparation: the candidate's resources belong to the lost device (the
      // registry already dropped them), so it cannot become the live scene.
      const now = this.stateNow();
      if (this.deviceEpoch !== epoch || now === "recovering" || now === "disposed" || now === "failed") {
        const diagnostic = makeRuntimeDiagnostic("E8050", {
          phase: "runtime:reload",
          message: `The candidate was discarded: the GPU device was lost while it was prepared (application ${now}).`,
        });
        this.report(diagnostic);
        return { ok: false, diagnostics: [diagnostic] };
      }

      if (this.pendingSwap !== undefined) {
        this.pendingSwap.scene.materials.dispose();
        this.pendingSwap.scene.meshes.dispose();
        this.pendingSwap.scene.renderer.dispose();
      }
      this.pendingSwap = {
        scene: started.scene,
        manifest,
        program: candidate as MtekMountProgram<Record<string, unknown>>,
        modules: new Map(shaders.modules),
        assets: loaded.assets,
        sceneFunctions: checked.program.scene,
        restart,
      };
      return { ok: true };
    } catch (error) {
      for (const module of createdModules) {
        try {
          registry.release(module);
        } catch {
          // Already released or never registered.
        }
      }
      const diagnostic = makeRuntimeDiagnostic("E8050", {
        phase: "runtime:reload",
        message: `replaceProgram failed: ${errorText(error)}`,
      });
      this.report(diagnostic);
      return { ok: false, diagnostics: [diagnostic] };
    }
  }

  pause(): void {
    if (this.current !== "running") return;
    this.current = "paused";
    this.pausedByVisibility = false;
    this.input.pause();
    this.scheduler.pause();
  }

  resume(): void {
    if (this.current !== "paused") return;
    this.current = "running";
    this.pausedByVisibility = false;
    this.input.resume();
    this.scheduler.resume();
  }

  /**
   * Synchronous release (`spec/runtime-abi.md` section 9.3): stops the frame loop, removes every listener
   * and observer, destroys every buffer and texture, removes the overlay, unconfigures the canvas and
   * destroys the device. Idempotent.
   */
  dispose(): void {
    if (this.current === "disposed") return;
    this.current = "disposed";
    if (this.pendingSwap !== undefined) {
      this.pendingSwap.scene.materials.dispose();
      this.pendingSwap.scene.meshes.dispose();
      this.pendingSwap.scene.renderer.dispose();
      this.pendingSwap = undefined;
    }
    const { device, registry, surface, overlay } = this.deps;
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
    this.scheduler.stop();
    this.clearRecoveryTimer();
    this.deps.sink.report(cause);
    this.deps.overlay?.add(cause);
    if (__MTEK_DEV__) this.deps.devTools?.recordError(cause);
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
        this.frameStartMs = now();
        const { world } = this.deps.scene;
        world.setFrame(this.scheduler.activeTime, this.scheduler.delta, this.scheduler.frameIndex);
        this.hostInputs.applyQueued({ state: world.sceneState });
        this.behaviors.dispatchInput(this.input.deliver());
      },
      phase2_tick: (step) => {
        this.behaviors.fixedUpdate(step);
      },
      phase3_update: (delta) => {
        this.behaviors.update(delta);
      },
      phase4_flush: () => undefined,
      phase5_bindings: () => {
        this.deps.scene.bindings.evaluate();
      },
      phase6_transforms: () => {
        this.deps.scene.world.propagate();
      },
      phase7_render: () => {
        this.renderStartMs = now();
        this.deps.scene.renderer.frame();
        const end = now();
        this.cpuUpdateMs = this.renderStartMs - this.frameStartMs;
        this.renderPrepMs = end - this.renderStartMs;
        this.frameTimeMs = end - this.frameStartMs;
        if (__MTEK_DEV__) this.deps.devTools?.afterFrame(this.frameTimeMs, () => this.counters());
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

    if (pending.restart === undefined) {
      migrateWorld(previous.world, previousManifest, pending.scene.world, pending.manifest);
    } else {
      const diagnostic = restartDiagnostic(pending.manifest, pending.restart);
      this.deps.sink.report(diagnostic);
      this.deps.overlay?.add(diagnostic);
      if (__MTEK_DEV__) this.deps.devTools?.recordError(diagnostic);
    }

    if (this.deps.test?.disableCulling === true) pending.scene.renderer.setFrustumCulling(false);
    if (__MTEK_DEV__) this.deps.devTools?.setProgram(pending.manifest);
    this.deps.scene = pending.scene;
    this.deps.manifest = pending.manifest;
    this.deps.program = pending.program;
    this.deps.modules = pending.modules;
    this.deps.assets = pending.assets;
    this.deps.sceneFunctions = pending.sceneFunctions;
    this.behaviors = new Behaviors(pending.sceneFunctions, pending.scene.world);
    this.hostInputs = new HostInputs(pending.manifest);

    previous.materials.dispose();
    previous.renderer.dispose();
    previous.meshes.dispose();
  }

  private createDebug(manual: boolean): MtekDebug {
    return {
      step: (frames, dtSeconds) => {
        if (!manual) throw new Error("debug.step requires mountMtek options test.manualClock");
        this.scheduler.stepManual(frames, dtSeconds);
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
      }),
    };
  }

  private counters(): Readonly<Record<string, number>> {
    const registry = this.deps.registry.snapshot();
    const { renderer, materials, world } = this.deps.scene;
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
      sharedParamBlocks: materials.sharedParamBlocks,
      ownedParamBlocks: materials.ownedParamBlocks,
      discardedSteps: this.scheduler.discardedSteps,
      liveEntities: world.entities.length,
      framesRendered: this.deps.surface.framesRendered,
      framesSkipped: this.deps.surface.framesSkipped,
      deviceLosses: this.losses,
      deviceRecoveries: this.recoveries,
      recoveryAttempts: this.recoveryAttemptsMade,
    };
  }
}
