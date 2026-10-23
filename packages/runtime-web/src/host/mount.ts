/**
 * `mountMtek` (`spec/runtime-abi.md` section 6.1, M1 subset).
 *
 * Steps, in order: check the program's `abi`; fetch and validate the manifest (compatibility first, then
 * the schema); resolve the scene structure and check the program module against the manifest; acquire
 * the device with the manifest's required capabilities; compare the wgsl language features; configure the
 * canvas with the preferred format and its sRGB view format; create the depth texture; load every startup
 * shader and await its compilation info; start the scene (material arenas, the world, `init(ctx)`,
 * transforms, mesh uploads, every startup pipeline, the renderer: `render/startup.ts`); flush pending
 * validation results; resolve with the application handle.
 *
 * The startup assets (`manifest.assets`, `assets/loader.ts`) are fetched, verified and decoded while the
 * shaders compile; the scene is only started when every one is `ready`, and a file that is missing, altered
 * or undecodable rejects the mount with `asset-failed` (decision 0060).
 *
 * A program whose manifest says `subsystems.physics` also imports its physics module (`physics/load.ts`) while the
 * device is acquired and the shaders compile; a program without bodies never requests it. After `init` the bodies of
 * the scene are created from the manifest (`physics/system.ts`, `spec/scenes.md` section 11 step 5); a module that
 * does not load, or an engine that does not start, rejects the mount with `physics-failed` (`E8102`, decision 0066).
 *
 * Every failure rejects with an `MtekMountError` of the documented kind, reports its diagnostics through
 * `onDiagnostic`, shows the overlay (unless `failureDisplay: "none"`), and leaves no live resource,
 * listener or device behind.
 */
import { FontRegistry, browserFontPage } from "../hud/fonts.js";
import {
  checkDeviceCapabilities,
  checkManifest,
  type DeviceCapabilities,
  type MtekManifest,
} from "../abi/index.js";
import { closeImages, loadAssets, type DecodedImages, type LoadedAssets } from "../assets/loader.js";
import { MtekMountError, makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { acquireDevice, type AcquiredDevice } from "../gpu/device.js";
import { ResourceRegistry } from "../gpu/registry.js";
import { MountedApp, RECOVERY_ATTEMPTS } from "./app.js";
import { defaultEnvironment, isWithinBase, restrictToBase, type FetchResponseLike, type HostEnvironment } from "./environment.js";
import { DiagnosticSink, abiFailureToDiagnostic, mountError, resolveSpan } from "./failures.js";
import { FailureOverlay } from "./overlay.js";
import { GpuTimer, hasTimestampQuery, TIMESTAMP_FEATURE } from "../dev/gpu-timer.js";
import { DevTools } from "../dev/tools.js";
import { loadStartupShaders } from "./shaders.js";
import { checkTestTextures } from "../render/resources.js";
import { startScene } from "../render/startup.js";
import { InputState } from "../input/input.js";
import { loadPhysicsBackend, type PhysicsLoadResult } from "../physics/load.js";
import { PhysicsSystem } from "../physics/system.js";
import { Xoshiro128 } from "../random/xoshiro.js";
import { AudioSystem, browserAudioBackend, type ListenerPose } from "../audio/audio.js";
import { HudSystem, type HudCanvas, type HudDocument } from "../hud/hud.js";
import { ExecutionBudgetExceeded } from "../scene/budget.js";
import { defaultSaveStorage, MemorySaveStorage } from "../scene/saves.js";
import { GameLink } from "../scene/game.js";
import type { CpuServices } from "../scene/world.js";
import { checkProgram } from "../scene/program.js";
import { resolveStructure } from "../scene/structure.js";
import { Surface, srgbViewFormat, type CanvasFormat } from "./surface.js";
import type { MtekApp, MtekMountOptions, MtekMountProgram } from "./types.js";

function errorText(error: unknown): string {
  return error instanceof Error ? (error.message === "" ? error.name : error.message) : String(error);
}

function mountDiagnostic(
  code: "E8002" | "E8003" | "E8004" | "E8006" | "E8050",
  message: string,
  notes: readonly string[] = [],
): MtekDiagnostic {
  return makeRuntimeDiagnostic(code, { phase: "runtime:mount", message, notes });
}

/** `E8080` for a loop of `init` that spent the last iteration of the preview's budget (decision 0075). */
function budgetDiagnostic(manifest: MtekManifest, error: ExecutionBudgetExceeded): MtekDiagnostic {
  if (error.whileCap) {
    return makeRuntimeDiagnostic("E8080", {
      phase: "runtime:mount",
      message: "A `while` loop ran more than 1000000 iterations while the scene was initialised.",
      source: resolveSpan(manifest, error.spanId),
      notes: ["help: make sure the condition becomes false (every `while` is capped, decision 0144)"],
    });
  }
  const limit = manifest.preview?.loopBudget;
  return makeRuntimeDiagnostic("E8080", {
    phase: "runtime:mount",
    message:
      limit === undefined
        ? "A loop ran past the execution budget of this preview while the scene was initialised."
        : `A loop ran past the execution budget of ${String(limit)} iterations while the scene was initialised.`,
    source: resolveSpan(manifest, error.spanId),
    notes: ["help: bound the loop, or build the preview with a larger --loop-budget if the program really needs the iterations"],
  });
}

function validateOptions(options: MtekMountOptions<never>): void {
  const { failureDisplay, devicePixelRatio, seed, test } = options;
  if (failureDisplay !== undefined && failureDisplay !== "overlay" && failureDisplay !== "none") {
    throw new TypeError(`mountMtek: failureDisplay must be "overlay" or "none", got ${String(failureDisplay)}`);
  }
  if (devicePixelRatio !== undefined && devicePixelRatio !== "auto" && !(Number.isFinite(devicePixelRatio) && devicePixelRatio > 0)) {
    throw new RangeError(`mountMtek: devicePixelRatio must be "auto" or a positive finite number, got ${String(devicePixelRatio)}`);
  }
  if (seed !== undefined && !Number.isFinite(seed)) {
    throw new RangeError(`mountMtek: seed must be a finite number, got ${String(seed)}`);
  }
  if (test?.textures !== undefined) checkTestTextures(test.textures);
  if (test?.onAssetState !== undefined && typeof test.onAssetState !== "function") {
    throw new TypeError("mountMtek: test.onAssetState must be a function");
  }
  const target = test?.renderTarget;
  if (target !== undefined) {
    for (const [name, value] of [["width", target.width], ["height", target.height]] as const) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`mountMtek: test.renderTarget.${name} must be a positive integer, got ${String(value)}`);
      }
    }
  }
  if (test?.canvasRenderTarget === true && target !== undefined) {
    throw new TypeError("mountMtek: test.canvasRenderTarget and test.renderTarget exclude each other");
  }
  const recovery = test?.recovery;
  if (recovery?.delaysMs !== undefined) {
    const delays: readonly unknown[] = recovery.delaysMs;
    if (delays.length !== RECOVERY_ATTEMPTS || !delays.every((delay) => typeof delay === "number" && Number.isFinite(delay) && delay >= 0)) {
      throw new RangeError(
        `mountMtek: test.recovery.delaysMs must be ${String(RECOVERY_ATTEMPTS)} non-negative finite numbers, got ${JSON.stringify(recovery.delaysMs)}`,
      );
    }
  }
  const injected = recovery?.failDeviceRequests;
  if (injected !== undefined && !(Number.isInteger(injected) && injected >= 0)) {
    throw new RangeError(`mountMtek: test.recovery.failDeviceRequests must be a non-negative integer, got ${String(injected)}`);
  }
}

/**
 * Fetches shader files and remembers the text of every success, so rebuilding the shaders after a device
 * loss does not depend on the network (decision 0056). Shader URLs are named by content hash, so a cached
 * body never goes stale.
 */
function rememberingFetch(environment: HostEnvironment): (url: string, reuseFrom?: string) => Promise<FetchResponseLike> {
  const bodies = new Map<string, string>();
  return async (url, reuseFrom) => {
    const known = bodies.get(url) ?? (reuseFrom === undefined ? undefined : bodies.get(reuseFrom));
    if (known !== undefined) {
      bodies.set(url, known);
      return { ok: true, status: 200, text: () => Promise.resolve(known) };
    }
    const response = await environment.fetch(url);
    if (!response.ok) return response;
    const text = await response.text();
    bodies.set(url, text);
    return { ok: true, status: response.status, text: () => Promise.resolve(text) };
  };
}

async function loadManifest(environment: HostEnvironment, url: URL): Promise<MtekManifest> {
  let text: string;
  try {
    const response = await environment.fetch(url.href);
    if (!response.ok) {
      throw mountError([
        mountDiagnostic("E8006", `The manifest could not be loaded: HTTP ${String(response.status)} for ${url.href}.`, ["field: manifestUrl"]),
      ]);
    }
    text = await response.text();
  } catch (error) {
    if (error instanceof MtekMountError) throw error;
    throw mountError([
      mountDiagnostic("E8006", `The manifest could not be loaded from ${url.href}: ${errorText(error)}`, ["field: manifestUrl"]),
    ]);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw mountError([mountDiagnostic("E8006", `The manifest is not valid JSON: ${errorText(error)}`, ["field: manifest"])]);
  }
  const result = checkManifest(json);
  if (!result.ok) throw mountError(result.failures.map((failure) => abiFailureToDiagnostic(failure)));
  return result.manifest;
}

function deviceCapabilities(acquired: AcquiredDevice, gpu: GPU): DeviceCapabilities {
  const limits = acquired.adapter.limits as unknown as Readonly<Record<string, unknown>>;
  return {
    hasFeature: (name) => acquired.adapter.features.has(name),
    hasWgslLanguageFeature: (name) => gpu.wgslLanguageFeatures.has(name),
    limit: (name) => {
      const value = limits[name];
      return typeof value === "number" ? value : undefined;
    },
  };
}

/** Mounts `program` on `canvas` using the real browser environment. */
export function mountMtek<I = Record<string, unknown>, O = Record<string, unknown>>(
  canvas: HTMLCanvasElement,
  program: MtekMountProgram<I, O>,
  options?: MtekMountOptions<I>,
): Promise<MtekApp<I, O>> {
  return mountMtekWith(defaultEnvironment(), canvas, program, options);
}

/** `mountMtek` with an injected environment: the test seam (not part of the public API). */
export async function mountMtekWith<I = Record<string, unknown>, O = Record<string, unknown>>(
  environment: HostEnvironment,
  canvas: HTMLCanvasElement,
  program: MtekMountProgram<I, O>,
  options: MtekMountOptions<I> = {},
): Promise<MtekApp<I, O>> {
  validateOptions(options as MtekMountOptions<never>);
  FailureOverlay.removeFor(canvas);
  const sink = new DiagnosticSink(options.onDiagnostic);
  const overlay = options.failureDisplay === "none" ? null : new FailureOverlay(canvas);

  // Everything acquired so far, for cleanup on failure.
  let acquired: AcquiredDevice | undefined;
  let registry: ResourceRegistry | undefined;
  let surface: Surface | undefined;
  let app: MountedApp<I, O> | undefined;
  // Decoded images wait here until the scene has uploaded them; closed in every case (idempotent).
  let images: DecodedImages | undefined;
  // The physics world, freed on every failure after it exists.
  let physics: PhysicsSystem | undefined;
  let audio: AudioSystem | undefined;
  let hud: HudSystem | undefined;
  // A holder object, because the callbacks below assign it and TypeScript does not track that.
  const early: { lost?: GPUDeviceLostInfo } = {};
  const allocationFailures: MtekDiagnostic[] = [];
  const earlyReports: MtekDiagnostic[] = [];

  try {
    if ((program.abi as number) !== 1) {
      throw mountError([
        mountDiagnostic(
          "E8003",
          `Incompatible program: the program module's \`abi\` is ${String(program.abi)}, this runtime implements 1.`,
          ["field: abi"],
        ),
      ]);
    }

    const manifest = await loadManifest(environment, program.manifestUrl);

    // An untrusted preview (decision 0075): from here on the runtime requests nothing outside `baseUrl`, whatever
    // the manifest names. The manifest itself must have come from there.
    if (manifest.preview !== undefined) {
      if (!isWithinBase(program.manifestUrl.href, program.baseUrl)) {
        throw mountError([
          mountDiagnostic("E8006", `The manifest of a preview was fetched from ${program.manifestUrl.href}, outside baseUrl ${program.baseUrl.href}.`, [
            "field: manifestUrl",
          ]),
        ]);
      }
      environment = restrictToBase(environment, program.baseUrl);
    }

    // The scene structure and the program module, before any device work: a broken or mismatched
    // program fails fast. The structure is checked first (E8006 before E8003).
    const structure = resolveStructure(manifest);
    if (!structure.ok) throw mountError(structure.diagnostics);
    const checked = checkProgram(program, manifest);
    if (!checked.ok) throw mountError(checked.diagnostics);

    // The physics module, imported while the device is acquired and the shaders compile, and only when the
    // program has bodies (`spec/physics.md` section 1). The result never rejects, so a mount that fails first
    // leaves nothing dangling.
    const physicsLoad: Promise<PhysicsLoadResult> | undefined = manifest.subsystems.physics
      ? loadPhysicsBackend({ manifest, baseUrl: program.baseUrl, importModule: (url) => environment.importModule(url), phase: "runtime:mount" })
      : undefined;

    // Device. Capabilities come from the adapter's features and limits, never from the user agent.
    const required = manifest.requiredCapabilities;
    acquired = await acquireDevice({
      requiredFeatures: [...required.features] as GPUFeatureName[],
      requiredLimits: { ...required.limits },
      // Development builds ask for timestamp-query when the adapter has it (section 8.1); never required.
      ...(__MTEK_DEV__ ? { optionalFeatures: [TIMESTAMP_FEATURE] as GPUFeatureName[] } : {}),
      onDeviceLost: (info) => {
        if (app !== undefined) app.handleDeviceLost(info);
        else if (info.reason !== "destroyed") early.lost = info;
      },
      onUncapturedError: (event) => {
        if (app !== undefined) app.handleUncapturedError(event.error);
        else sink.report(mountDiagnostic("E8050", `A GPU validation error was not captured by an error scope: ${event.error.message}`));
      },
      environment: {
        gpu: environment.gpu,
        ...(environment.littleEndian === undefined ? {} : { littleEndian: environment.littleEndian }),
      },
    });
    const { device } = acquired;
    const gpu = environment.gpu;
    if (gpu === null) throw new Error("internal error: a device was acquired without WebGPU");

    // acquireDevice compared features and limits; the wgsl language features are compared here.
    const unmet = checkDeviceCapabilities(required, deviceCapabilities(acquired, gpu));
    if (unmet.length > 0) throw mountError(unmet.map((failure) => abiFailureToDiagnostic(failure)));

    registry = new ResourceRegistry(device, {
      phase: "runtime:mount",
      onAllocationFailure: (diagnostic) => {
        if (app !== undefined) app.handleAllocationFailure(diagnostic);
        else allocationFailures.push(diagnostic);
      },
    });

    // Surface: preferred format, its sRGB view format, opaque alpha, depth.
    const context = canvas.getContext("webgpu");
    if (context === null) {
      throw mountError([
        mountDiagnostic("E8004", "The canvas could not provide a WebGPU context.", [
          "help: the canvas may already have a different context type (2d, webgl)",
        ]),
      ]);
    }
    const format = gpu.getPreferredCanvasFormat();
    if (srgbViewFormat(format) === undefined) {
      throw mountError([
        mountDiagnostic("E8002", `The preferred canvas format '${format}' has no sRGB view format; Mtek needs bgra8unorm or rgba8unorm.`),
      ]);
    }
    const dprOption = options.devicePixelRatio ?? "auto";
    // GPU time is measured only when the development overlay was asked for and the device has the feature;
    // otherwise no timer exists and GPU time is reported as unavailable (section 10.1).
    const timer = __MTEK_DEV__ && options.devOverlay === true && hasTimestampQuery(device) ? new GpuTimer(device, registry) : null;
    surface = new Surface({
      timer: timer ?? undefined,
      canvas,
      context,
      device,
      registry,
      format: format as CanvasFormat,
      renderTarget: options.test?.renderTarget,
      canvasRenderTarget: options.test?.canvasRenderTarget === true,
      devicePixelRatio: typeof dprOption === "number" ? () => dprOption : () => environment.devicePixelRatio(),
    });
    const maxDimension = device.limits.maxTextureDimension2D;
    const target = options.test?.renderTarget;
    if (target !== undefined && (target.width > maxDimension || target.height > maxDimension)) {
      throw new RangeError(`mountMtek: test.renderTarget exceeds the device limit maxTextureDimension2D (${String(maxDimension)})`);
    }
    try {
      surface.configure();
    } catch (error) {
      throw mountError([mountDiagnostic("E8002", "Configuring the canvas for WebGPU failed.", [`browser message: ${errorText(error)}`])]);
    }
    try {
      surface.allocate();
    } catch (error) {
      // The registry reports a failed allocation (E8063) before rethrowing; that report is the diagnosis.
      if (allocationFailures.length === 0) throw error;
      throw mountError(allocationFailures);
    }

    // Startup shaders and assets, concurrently. The shader files are remembered for the rebuild after a device
    // loss; the verified asset bytes are retained for the same purpose (decision 0060). Every failure of
    // either is reported, shaders first.
    const fetchShaderFile = rememberingFetch(environment);
    const [shaders, loadedAssets, loadedPhysics] = await Promise.all([
      loadStartupShaders({
        manifest,
        baseUrl: program.baseUrl,
        device,
        registry,
        fetch: fetchShaderFile,
      }),
      loadAssets({
        manifest,
        baseUrl: program.baseUrl,
        environment,
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        ...(options.test?.onAssetState === undefined ? {} : { onState: options.test.onAssetState }),
      }),
      physicsLoad ?? Promise.resolve(undefined),
    ]);
    images = loadedAssets.images;
    const startupFailures = [...shaders.diagnostics, ...loadedAssets.diagnostics, ...(loadedPhysics?.ok === false ? loadedPhysics.diagnostics : [])];
    if (startupFailures.length > 0) throw mountError(startupFailures);
    const assets: LoadedAssets = loadedAssets.assets;

    // The CPU services generated code reaches through ctx, from `init` on: the seeded generator, the
    // delivered key state and the development console.
    const seed = options.seed === undefined ? (Math.floor(environment.now() * 1000) ^ Date.now()) >>> 0 : Math.trunc(options.seed) >>> 0;
    const generator = new Xoshiro128(seed);
    const input = new InputState();
    // `go_to`, `reset`, `pause`, `resume`, `paused` (decisions 0140, 0141, 0143): the application connects the link.
    const game = new GameLink();
    // Saved state and settings (decisions 0145, 0146): the page's localStorage unless the host chose; never under test.
    const pageStorage = options.storage === undefined && options.test === undefined ? defaultSaveStorage() : null;
    const saveStorage = options.storage ?? pageStorage ?? new MemorySaveStorage();
    const saveStorageUnavailable = options.storage === undefined && options.test === undefined && pageStorage === null;
    // Audio (decision 0130): decoded now, played after the first user gesture unlocks it.
    // The listener is the camera of the scene that runs: the first world only until the application exists.
    const listening: { world?: { readonly camera: ListenerPose } } = {};
    // What diagnostics resolve against and where bytes come from follows the scene that runs (`go_to` changes both).
    const manifestNow = (): MtekManifest => app?.currentManifest() ?? manifest;
    // The first key press, click or touch unlocks audio (browser autoplay policy, spec/audio.md section 5). The
    // listeners capture on the document, so they run inside the gesture even when the canvas or a HUD button handles
    // the event and stops it (decision 0176). A program without sounds has none; a reload can add the first sound.
    let unlockInstalled = false;
    const installUnlock = (): void => {
      if (unlockInstalled || audio === undefined || registry === undefined) return;
      unlockInstalled = true;
      const unlocking = audio;
      const unlock = (): void => {
        unlocking.unlock();
      };
      for (const type of ["pointerdown", "touchend", "mousedown"]) {
        registry.addEventListener(canvas, type, unlock, { capture: true });
        if (environment.document !== undefined) registry.addEventListener(environment.document, type, unlock, { capture: true });
      }
      if (environment.document !== undefined) registry.addEventListener(environment.document, "keydown", unlock, { capture: true });
    };
    const assetsNow = (): LoadedAssets => app?.currentAssets() ?? assets;
    audio = new AudioSystem({
      manifest,
      manifestNow,
      onFirstSound: () => {
        installUnlock();
      },
      bytes: (url) => (assetsNow().has(url) ? assetsNow().bytes(url) : undefined),
      backend: environment.audio === undefined ? browserAudioBackend() : (environment.audio ?? undefined),
      report: (diagnostic) => {
        if (app !== undefined) app.report(diagnostic);
        else earlyReports.push(diagnostic);
      },
      listener: () => (app === undefined ? listening.world?.camera : app.listenerPose()),
    });
    // The HUD (decision 0134): a DOM layer over the canvas, when there is a document.
    hud =
      environment.document === undefined
        ? undefined
        : new HudSystem({
            canvas: canvas as unknown as HudCanvas,
            document: environment.document as unknown as HudDocument,
            manifest,
            manifestNow,
            report: (diagnostic) => {
              if (app !== undefined) app.report(diagnostic);
              else earlyReports.push(diagnostic);
            },
            // Fonts of `asset.font(..)` (decision 0139), registered with the page on first use.
            fontFamily: (() => {
              const fonts = new FontRegistry({
                manifest,
                manifestNow,
                bytes: (url) => (assetsNow().has(url) ? assetsNow().bytes(url) : undefined),
                page: browserFontPage(environment.document),
                report: (diagnostic) => {
                  if (app !== undefined) app.report(diagnostic);
                  else earlyReports.push(diagnostic);
                },
              });
              return (source: string) => fonts.family(source);
            })(),
          });
    const services: CpuServices = {
      game,
      random: () => generator.nextF32(),
      isKeyDown: (code) => input.isKeyDown(code),
      keyPressed: (code) => input.keyPressed(code),
      keyReleased: (code) => input.keyReleased(code),
      pointerPosition: () => input.pointerPosition(),
      isPointerDown: (button) => input.isPointerDown(button),
      print: (message) => {
        environment.log?.(message);
      },
      audio,
      ...(hud === undefined ? {} : { hud }),
    };

    // The scene: init(ctx), meshes and every startup pipeline. Run-time diagnostics of init (E8090,
    // E8011, E8100) are not fatal; they are delivered once the application exists.
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
          if (app !== undefined) app.report(diagnostic);
          else earlyReports.push(diagnostic);
        },
        assets: { files: assets, images },
        ...(options.test?.textures === undefined ? {} : { textures: options.test.textures }),
        ...(options.test?.disableInstancing === true ? { instancing: false } : {}),
      });
    } catch (error) {
      // An allocation the registry reported (E8063) is the diagnosis of the exception it rethrew.
      if (allocationFailures.length > 0) throw mountError(allocationFailures);
      // `init` ran past the loop budget of a preview (decision 0075): the mount fails, naming the loop.
      if (error instanceof ExecutionBudgetExceeded) throw mountError([budgetDiagnostic(manifest, error)]);
      throw error;
    }
    // The textures are filled: the bitmaps are no longer needed (the bytes stay for the rebuild after a device loss).
    closeImages(images);
    if (!started.ok) throw mountError(started.diagnostics);
    listening.world = started.scene.world;
    if (audio.hasSounds) installUnlock();

    // The bodies of the scene, now that `init`, the bindings and the transforms have given every entity its pose
    // (`spec/scenes.md` section 11, step 5). Collision events reach the application's handlers once it exists.
    if (loadedPhysics?.ok === true) {
      try {
        physics = new PhysicsSystem({
          backend: loadedPhysics.backend,
          manifest,
          world: started.scene.world,
          report: (diagnostic) => {
            if (app !== undefined) app.report(diagnostic);
            else earlyReports.push(diagnostic);
          },
          deliver: (kind, slot, other) => {
            app?.deliverCollision(kind, slot, other);
          },
        });
        started.scene.world.bodies = physics;
        physics.createNamedBodies();
      } catch (error) {
        throw mountError([
          makeRuntimeDiagnostic("E8102", {
            phase: "runtime:mount",
            message: `The physics module could not be loaded: creating the physics world and its bodies failed (${errorText(error)}).`,
            notes: [`module: ${loadedPhysics.url}`],
          }),
        ]);
      }
    }

    // Allocation errors arrive asynchronously (the out-of-memory scopes pop after a round trip); wait
    // for the queue so none is missed. This is a mount-time wait only; ordinary frames never wait.
    await device.queue.onSubmittedWorkDone();
    if (allocationFailures.length > 0) throw mountError(allocationFailures);
    if (early.lost !== undefined) {
      throw mountError([
        mountDiagnostic("E8002", `The GPU device was lost while mounting (${early.lost.reason}): ${early.lost.message}`),
      ]);
    }

    // The development overlay (development flavour only; `options.devOverlay`): its key listener goes
    // through the registry, so it is counted and removed by dispose.
    const live = registry;
    const devTools =
      __MTEK_DEV__ && options.devOverlay === true && environment.document !== undefined
        ? new DevTools({
            canvas,
            keyTarget: environment.document,
            listen: (target, type, listener) => {
              live.addEventListener(target, type, listener);
            },
            manifest,
            timer,
          })
        : null;

    app = new MountedApp<I, O>({
      devTools,
      manifest,
      device,
      registry,
      surface,
      sink,
      overlay,
      environment,
      canvas,
      pauseWhenHidden: options.pauseWhenHidden ?? manifest.runtimeConfig.pauseWhenHidden,
      test: options.test,
      watchPixelRatio: dprOption === "auto",
      fetchShaderFile,
      assets,
      acquireDevice: (handlers) =>
        acquireDevice({
          requiredFeatures: [...required.features] as GPUFeatureName[],
          requiredLimits: { ...required.limits },
          onDeviceLost: handlers.onDeviceLost,
          onUncapturedError: handlers.onUncapturedError,
          environment: {
            gpu: environment.gpu,
            ...(environment.littleEndian === undefined ? {} : { littleEndian: environment.littleEndian }),
          },
        }),
      seed,
      input,
      services,
      game,
      saveStorage,
      saveStorageUnavailable,
      sceneFunctions: checked.program.scene,
      scene: started.scene,
      physics,
      physicsModule: loadedPhysics?.ok === true ? { url: loadedPhysics.url, backend: loadedPhysics.backend } : undefined,
      modules: new Map(shaders.modules),
      program: program as import("./types.js").MtekMountProgram<Record<string, unknown>>,
    });
    // Initial host inputs: validated like setInput (queued for the first phase 1).
    for (const name of Object.keys(options.inputs ?? {}).sort()) {
      const value = (options.inputs as Record<string, unknown>)[name];
      const result = app.setInput(name as keyof I & string, value as I[keyof I & string]);
      if (!result.ok) {
        sink.report(
          makeRuntimeDiagnostic(result.error.code === "MTEK-E8100" ? "E8100" : result.error.code === "MTEK-E8041" ? "E8041" : "E8040", {
            phase: "runtime:input",
            message: result.error.message,
          }),
        );
      }
    }
    for (const diagnostic of earlyReports) app.report(diagnostic);
    return app;
  } catch (error) {
    // Release everything acquired so far, then make the failure visible.
    if (images !== undefined) closeImages(images);
    audio?.dispose();
    hud?.dispose();
    physics?.dispose();
    surface?.dispose();
    registry?.destroyAll();
    if (acquired !== undefined) {
      acquired.device.onuncapturederror = null;
      acquired.device.destroy();
    }
    if (error instanceof MtekMountError) {
      for (const diagnostic of error.diagnostics) sink.report(diagnostic);
      overlay?.show(error.diagnostics);
    }
    throw error;
  }
}
