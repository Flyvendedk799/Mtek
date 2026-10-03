import { MtekMountError, makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";

/** Adapter identification as reported by the browser (`GPUAdapterInfo`); never used as capability evidence. */
export interface MtekAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  /** `null` when the browser does not report the flag. */
  readonly isFallbackAdapter: boolean | null;
}

export interface AcquiredDevice {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly adapterInfo: MtekAdapterInfo;
}

/** Test seam: replaces the platform facts `acquireDevice` would otherwise read from the environment. */
export interface AcquireEnvironment {
  /** The `GPU` entry point; `null` simulates a browser without WebGPU. Default: `navigator.gpu`. */
  readonly gpu?: GPU | null;
  /** Default: detected from the platform. */
  readonly littleEndian?: boolean;
}

export interface AcquireDeviceOptions {
  /** Optional WebGPU features the program needs (`manifest.requiredCapabilities.features`). */
  readonly requiredFeatures: GPUFeatureName[];
  /** Limits above the defaults the program needs (`manifest.requiredCapabilities.limits`). */
  readonly requiredLimits: Record<string, number>;
  /** Called when `device.lost` resolves (including for reason `"destroyed"`; the caller decides). */
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
  /** Installed as `device.onuncapturederror`. */
  readonly onUncapturedError?: (event: GPUUncapturedErrorEvent) => void;
  readonly environment?: AcquireEnvironment;
}

/** WebGPU limits of the "alignment" class: smaller is better, so the adapter value must be `<=` the requirement. */
const ALIGNMENT_LIMITS: ReadonlySet<string> = new Set(["minUniformBufferOffsetAlignment", "minStorageBufferOffsetAlignment"]);

/** True when typed arrays on this platform are little-endian (WebGPU buffer contents are little-endian). */
export function isLittleEndianPlatform(): boolean {
  return new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
}

function mountFailure(diagnostics: MtekDiagnostic[], kind: MtekMountError["kind"]): MtekMountError {
  return new MtekMountError(kind, diagnostics);
}

function errorText(e: unknown): string {
  return e instanceof Error ? (e.message === "" ? e.name : e.message) : String(e);
}

function navigatorGpu(): GPU | undefined {
  if (typeof navigator === "undefined") return undefined;
  const holder: Partial<Pick<Navigator, "gpu">> = navigator;
  return holder.gpu;
}

function readAdapterInfo(adapter: GPUAdapter): MtekAdapterInfo {
  // Older browsers lack `adapter.info`, and some omit `isFallbackAdapter`.
  const info = (adapter as { info?: GPUAdapterInfo | undefined }).info;
  if (info === undefined) {
    return { vendor: "", architecture: "", device: "", description: "", isFallbackAdapter: null };
  }
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter: typeof info.isFallbackAdapter === "boolean" ? info.isFallbackAdapter : null,
  };
}

function unmetRequirements(adapter: GPUAdapter, opts: AcquireDeviceOptions): MtekDiagnostic[] {
  const out: MtekDiagnostic[] = [];
  for (const feature of opts.requiredFeatures) {
    if (!adapter.features.has(feature)) {
      out.push(
        makeRuntimeDiagnostic("E8002", {
          phase: "runtime:mount",
          message: `The GPU adapter does not support the required WebGPU feature '${feature}'.`,
          expected: feature,
          actual: "unsupported",
        }),
      );
    }
  }
  // Browsers expose `GPUSupportedLimits` as prototype accessors, so limits are read by name (never spread).
  const supported = adapter.limits as unknown as Readonly<Record<string, unknown>>;
  for (const [name, required] of Object.entries(opts.requiredLimits)) {
    const actual = supported[name];
    if (typeof actual !== "number") {
      out.push(
        makeRuntimeDiagnostic("E8002", {
          phase: "runtime:mount",
          message: `The GPU adapter does not report the required limit '${name}'.`,
          expected: String(required),
          actual: "unknown limit",
        }),
      );
      continue;
    }
    const satisfied = ALIGNMENT_LIMITS.has(name) ? actual <= required : actual >= required;
    if (!satisfied) {
      out.push(
        makeRuntimeDiagnostic("E8002", {
          phase: "runtime:mount",
          message: `The GPU adapter's limit '${name}' is ${String(actual)}, but the program requires ${ALIGNMENT_LIMITS.has(name) ? "at most" : "at least"} ${String(required)}.`,
          expected: String(required),
          actual: String(actual),
        }),
      );
    }
  }
  return out;
}

/**
 * Acquires a WebGPU adapter and device (`spec/runtime-abi.md` section 8.1) or rejects with an
 * `MtekMountError` whose diagnostics follow the code to kind mapping of section 6.1.
 *
 * Checks, in order: platform endianness (`E8001`), `navigator.gpu` (`E8004`), `requestAdapter`
 * (`E8005`), the adapter's features and limits against the requirements (`E8002`), `requestDevice`
 * (`E8002`, the browser's message as a note). Capability decisions use only WebGPU feature and limit
 * queries, never the user agent.
 */
export async function acquireDevice(opts: AcquireDeviceOptions): Promise<AcquiredDevice> {
  const env = opts.environment ?? {};

  const littleEndian = env.littleEndian ?? isLittleEndianPlatform();
  if (!littleEndian) {
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8001", {
          phase: "runtime:mount",
          message: "This platform is big-endian; WebGPU buffer contents are little-endian, so Mtek cannot run here.",
        }),
      ],
      "webgpu-unavailable",
    );
  }

  const gpu = env.gpu === undefined ? navigatorGpu() : env.gpu;
  if (gpu === undefined || gpu === null) {
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8004", {
          phase: "runtime:mount",
          message: "WebGPU is not available: navigator.gpu is missing.",
          notes: ["help: use a browser with WebGPU enabled, served from a secure context (https or localhost)"],
        }),
      ],
      "webgpu-unavailable",
    );
  }

  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (e) {
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8005", {
          phase: "runtime:mount",
          message: "Requesting a GPU adapter failed.",
          notes: [`browser message: ${errorText(e)}`],
        }),
      ],
      "adapter-unavailable",
    );
  }
  if (adapter === null) {
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8005", {
          phase: "runtime:mount",
          message: "No suitable GPU adapter was found (requestAdapter() returned null).",
        }),
      ],
      "adapter-unavailable",
    );
  }

  const unmet = unmetRequirements(adapter, opts);
  if (unmet.length > 0) throw mountFailure(unmet, "device-failed");

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({
      requiredFeatures: opts.requiredFeatures,
      requiredLimits: opts.requiredLimits,
    });
  } catch (e) {
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8002", {
          phase: "runtime:mount",
          message: "The GPU device could not be created with the program's required features and limits.",
          notes: [`browser message: ${errorText(e)}`],
        }),
      ],
      "device-failed",
    );
  }

  const { onDeviceLost, onUncapturedError } = opts;
  if (onDeviceLost !== undefined) {
    void device.lost.then(onDeviceLost);
  }
  if (onUncapturedError !== undefined) {
    device.onuncapturederror = onUncapturedError;
  }

  return { adapter, device, adapterInfo: readAdapterInfo(adapter) };
}
