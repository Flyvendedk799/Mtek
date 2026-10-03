/**
 * `mountMtek` (`spec/runtime-abi.md` section 6.1, M1 subset).
 *
 * Steps, in order: check the program's `abi`; fetch and validate the manifest (compatibility first, then
 * the schema); acquire the device with the manifest's required capabilities; compare the wgsl language
 * features; configure the canvas with the preferred format and its sRGB view format; create the depth
 * texture; load every startup shader and await its compilation info; flush pending validation results;
 * resolve with the application handle.
 *
 * Pipeline creation is wired in by M1-18; until then the mount resolves after the shader modules exist.
 * Startup assets are not loaded yet either (no M1 program has any that the runtime reads before M1-18).
 *
 * Every failure rejects with an `MtekMountError` of the documented kind, reports its diagnostics through
 * `onDiagnostic`, shows the overlay (unless `failureDisplay: "none"`), and leaves no live resource,
 * listener or device behind.
 */
import {
  checkDeviceCapabilities,
  checkManifest,
  type DeviceCapabilities,
  type MtekManifest,
} from "../abi/index.js";
import { MtekMountError, makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { acquireDevice, type AcquiredDevice } from "../gpu/device.js";
import { ResourceRegistry } from "../gpu/registry.js";
import { MountedApp, unknownInputResult } from "./app.js";
import { defaultEnvironment, type HostEnvironment } from "./environment.js";
import { DiagnosticSink, abiFailureToDiagnostic, mountError } from "./failures.js";
import { FailureOverlay } from "./overlay.js";
import { loadStartupShaders } from "./shaders.js";
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
  const target = test?.renderTarget;
  if (target !== undefined) {
    for (const [name, value] of [["width", target.width], ["height", target.height]] as const) {
      if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`mountMtek: test.renderTarget.${name} must be a positive integer, got ${String(value)}`);
      }
    }
  }
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
export function mountMtek<I = Record<string, unknown>>(
  canvas: HTMLCanvasElement,
  program: MtekMountProgram<I>,
  options?: MtekMountOptions<I>,
): Promise<MtekApp<I>> {
  return mountMtekWith(defaultEnvironment(), canvas, program, options);
}

/** `mountMtek` with an injected environment: the test seam (not part of the public API). */
export async function mountMtekWith<I = Record<string, unknown>>(
  environment: HostEnvironment,
  canvas: HTMLCanvasElement,
  program: MtekMountProgram<I>,
  options: MtekMountOptions<I> = {},
): Promise<MtekApp<I>> {
  validateOptions(options as MtekMountOptions<never>);
  FailureOverlay.removeFor(canvas);
  const sink = new DiagnosticSink(options.onDiagnostic);
  const overlay = options.failureDisplay === "none" ? null : new FailureOverlay(canvas);

  // Everything acquired so far, for cleanup on failure.
  let acquired: AcquiredDevice | undefined;
  let registry: ResourceRegistry | undefined;
  let surface: Surface | undefined;
  let app: MountedApp<I> | undefined;
  // A holder object, because the callbacks below assign it and TypeScript does not track that.
  const early: { lost?: GPUDeviceLostInfo } = {};
  const allocationFailures: MtekDiagnostic[] = [];

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

    // Device. Capabilities come from the adapter's features and limits, never from the user agent.
    const required = manifest.requiredCapabilities;
    acquired = await acquireDevice({
      requiredFeatures: [...required.features] as GPUFeatureName[],
      requiredLimits: { ...required.limits },
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
    surface = new Surface({
      canvas,
      context,
      device,
      registry,
      format: format as CanvasFormat,
      renderTarget: options.test?.renderTarget,
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

    // Startup shaders.
    const shaders = await loadStartupShaders({
      manifest,
      baseUrl: program.baseUrl,
      device,
      registry,
      fetch: (url) => environment.fetch(url),
    });
    if (shaders.diagnostics.length > 0) throw mountError(shaders.diagnostics);

    // Allocation errors arrive asynchronously (the out-of-memory scopes pop after a round trip); wait
    // for the queue so none is missed. This is a mount-time wait only; ordinary frames never wait.
    await device.queue.onSubmittedWorkDone();
    if (allocationFailures.length > 0) throw mountError(allocationFailures);
    if (early.lost !== undefined) {
      throw mountError([
        mountDiagnostic("E8002", `The GPU device was lost while mounting (${early.lost.reason}): ${early.lost.message}`),
      ]);
    }

    // Host inputs: M1 manifests declare none, so every key is unknown. Reported, not fatal.
    for (const name of Object.keys(options.inputs ?? {}).sort()) {
      sink.report(
        makeRuntimeDiagnostic("E8040", {
          phase: "runtime:input",
          message: unknownInputResult(name).error.message,
        }),
      );
    }

    const seed = options.seed === undefined ? (Math.floor(environment.now() * 1000) ^ Date.now()) >>> 0 : Math.trunc(options.seed) >>> 0;
    app = new MountedApp<I>({
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
      seed,
    });
    return app;
  } catch (error) {
    // Release everything acquired so far, then make the failure visible.
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
