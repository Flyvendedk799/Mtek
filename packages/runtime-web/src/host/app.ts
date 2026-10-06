/**
 * The application handle returned by `mountMtek` (`spec/runtime-abi.md` sections 6.2, 7, 9 and 10).
 *
 * It owns the scheduler, the resize and visibility listeners, the failure overlay and the lifetime of
 * every GPU resource (through the registry). Everything it adds is removed by `dispose()`.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { startScene, type Scene } from "../render/startup.js";
import { Scheduler, type FramePhases } from "../schedule/scheduler.js";
import { checkProgram } from "../scene/program.js";
import { resolveStructure } from "../scene/structure.js";
import type { HostEnvironment, ResizeObserverLike } from "./environment.js";
import type { DiagnosticSink } from "./failures.js";
import type { FailureOverlay } from "./overlay.js";
import {
  findStructuralChange,
  migrateWorld,
  prefabNames,
  restartDiagnostic,
  type StructuralChange,
} from "./reload.js";
import { loadCandidateShaders } from "./shaders.js";
import type { Surface } from "./surface.js";
import type { MtekApp, MtekAppState, MtekDebug, MtekInputResult, MtekMountProgram, MtekTestOptions } from "./types.js";
import { HostInputs } from "./inputs.js";

export { unknownInputResult } from "./inputs.js";

export interface AppDependencies {
  /** Mutable: updated on a successful hot-reload swap. */
  manifest: MtekManifest;
  readonly device: GPUDevice;
  readonly registry: ResourceRegistry;
  readonly surface: Surface;
  readonly sink: DiagnosticSink;
  /** `null` with `failureDisplay: "none"`. */
  readonly overlay: FailureOverlay | null;
  readonly environment: HostEnvironment;
  readonly canvas: HTMLCanvasElement;
  readonly pauseWhenHidden: boolean;
  readonly test: MtekTestOptions | undefined;
  /** The resolved `random()` seed (consumed by the CPU runtime from M3 on). */
  readonly seed: number;
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

export class MountedApp<I = Record<string, unknown>> implements MtekApp<I> {
  readonly debug?: MtekDebug;
  readonly seed: number;

  private current: MtekAppState = "running";
  private pausedByVisibility = false;
  private readonly scheduler: Scheduler;
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
        readonly restart: StructuralChange | undefined;
      }
    | undefined;

  constructor(private readonly deps: AppDependencies) {
    const { manifest, environment, registry, test } = deps;
    this.seed = deps.seed;
    this.hostInputs = new HostInputs(manifest);
    registry.phase = "runtime:render";

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

    if (environment.document !== undefined && deps.pauseWhenHidden) {
      registry.addEventListener(environment.document, "visibilitychange", () => {
        this.onVisibilityChange();
      });
      if (environment.document.visibilityState === "hidden") {
        this.current = "paused";
        this.pausedByVisibility = true;
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
    if (this.current === "disposed" || this.current === "failed") {
      const diagnostic = makeRuntimeDiagnostic("E8050", {
        phase: "runtime:reload",
        message: `replaceProgram was called while the application is ${this.current}.`,
      });
      this.report(diagnostic);
      return { ok: false, diagnostics: [diagnostic] };
    }

    const { environment, device, registry, surface } = this.deps;
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

      const started = await startScene({
        manifest,
        structure: structure.structure,
        program: checked.program,
        device,
        registry,
        surface,
        modules: shaders.modules,
        report: (diagnostic) => {
          this.report(diagnostic);
        },
        pipelineCache: this.deps.scene.pipelines,
        bindingPlan: this.deps.scene.plan,
      });
      if (!started.ok) {
        for (const module of shaders.created) registry.release(module);
        // Pipelines newly created for a failing overall start stay in the shared cache by hash;
        // they remain valid for a later successful candidate with the same shader.
        for (const diagnostic of started.diagnostics) this.report(diagnostic);
        return { ok: false, diagnostics: started.diagnostics };
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
    this.scheduler.pause();
  }

  resume(): void {
    if (this.current !== "paused") return;
    this.current = "running";
    this.pausedByVisibility = false;
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
    this.resizeObserver?.disconnect();
    surface.dispose();
    overlay?.remove();
    registry.destroyAll();
    device.onuncapturederror = null;
    device.destroy();
  }

  /** Called when `device.lost` resolves. A loss caused by `dispose()` (reason `destroyed`) is ignored. */
  handleDeviceLost(info: GPUDeviceLostInfo): void {
    if (this.current === "disposed" || info.reason === "destroyed") return;
    // Bounded recovery (spec/runtime-abi.md 9.4) is task M4-09; until then a lost device is terminal.
    this.fail(
      makeRuntimeDiagnostic("W8060", {
        phase: "runtime:device",
        message: `The GPU device was lost (${info.reason}): ${info.message}`,
        notes: ["This runtime build cannot recover from device loss yet; the application has stopped (recovery arrives with M4-09)."],
      }),
    );
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

  /** Called when a registry allocation fails after mount (`E8063`): the scene stops rather than render stale data. */
  handleAllocationFailure(diagnostic: MtekDiagnostic): void {
    if (this.current === "disposed") return;
    this.fail(diagnostic);
  }

  /** Delivers a diagnostic to the host; errors also appear in the overlay. */
  report(diagnostic: MtekDiagnostic): void {
    if (!this.deps.sink.report(diagnostic)) return;
    if (diagnostic.severity === "error") this.deps.overlay?.add(diagnostic);
  }

  /** Reports the cause, stops the frame loop and shows the overlay (whatever the severity of the cause). */
  private fail(cause: MtekDiagnostic): void {
    if (this.current === "disposed" || this.current === "failed") return;
    this.current = "failed";
    this.scheduler.stop();
    // The cause is always shown, whatever its severity (a lost device is reported as the warning W8060).
    this.deps.sink.report(cause);
    this.deps.overlay?.add(cause);
  }

  private onResize(): void {
    if (this.current === "disposed" || this.current === "failed") return;
    try {
      this.deps.surface.resize();
      this.deps.overlay?.reposition();
    } catch (error) {
      // An allocation failure was already reported (and failed the app) by the registry callback.
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
      if (this.current === "running") {
        this.current = "paused";
        this.pausedByVisibility = true;
        this.scheduler.pause();
      }
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
        this.hostInputs.applyQueued(world);
        world.setFrame(this.scheduler.activeTime, this.scheduler.delta, this.scheduler.frameIndex);
      },
      // Fixed ticks, updates, the lifecycle queue and bindings run generated code from M3 on.
      phase2_tick: () => undefined,
      phase3_update: () => undefined,
      phase4_flush: () => undefined,
      phase5_bindings: () => undefined,
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
      // W8070 explains the restart over the still-visible new scene.
      this.deps.overlay?.add(diagnostic);
    }

    this.deps.scene = pending.scene;
    this.deps.manifest = pending.manifest;
    this.deps.program = pending.program;
    this.deps.modules = pending.modules;
    this.hostInputs = new HostInputs(pending.manifest);

    // Retire GPU resources of the previous scene (pipelines and reused shader modules stay alive).
    previous.materials.dispose();
    previous.renderer.dispose();
    // Mesh buffers of the previous scene: release when the MeshStore supports dispose.
    previous.meshes.dispose();
  }

  private createDebug(manual: boolean): MtekDebug {
    const notYet = (what: string, milestone: string): Error =>
      new Error(`debug.${what} is not available before ${milestone}: this runtime build has no input or material state yet.`);
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
      pressKey: () => {
        throw notYet("pressKey", "M3");
      },
      releaseKey: () => {
        throw notYet("releaseKey", "M3");
      },
      setParam: () => {
        throw notYet("setParam", "M3");
      },
      scene: () => ({
        state: { ...this.deps.scene.world.state },
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
    return {
      ...registry,
      frameTimeMs: this.frameTimeMs,
      cpuUpdateMs: this.cpuUpdateMs,
      renderPrepMs: this.renderPrepMs,
      drawCalls: renderer.drawCalls,
      // Instancing and culling arrive with M4.
      instancedDraws: 0,
      culledObjects: 0,
      sharedParamBlocks: materials.sharedParamBlocks,
      ownedParamBlocks: materials.ownedParamBlocks,
      discardedSteps: this.scheduler.discardedSteps,
      liveEntities: world.entities.length,
      framesRendered: this.deps.surface.framesRendered,
      framesSkipped: this.deps.surface.framesSkipped,
    };
  }
}
