// Page-side half of the environment record. Bundled with esbuild into `.out/env-probe.js` by the
// global setup and loaded by `pages/env.html`. It must never throw: a missing WebGPU is a result,
// not an error.
import {
  RENDER_TARGET_SIZE,
  type AdapterRecord,
  type PageEnvironment,
} from "./environment-types.ts";

/** The adapter limits Mtek relies on (spec/gpu-layout.md, spec/runtime-abi.md). */
const RELIED_ON_LIMITS = [
  "maxTextureDimension2D",
  "maxBindGroups",
  "maxBindingsPerBindGroup",
  "maxUniformBufferBindingSize",
  "maxStorageBufferBindingSize",
  "minUniformBufferOffsetAlignment",
  "minStorageBufferOffsetAlignment",
  "maxBufferSize",
  "maxVertexBuffers",
  "maxVertexAttributes",
  "maxColorAttachments",
  "maxColorAttachmentBytesPerSample",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupSizeY",
  "maxComputeWorkgroupSizeZ",
  "maxComputeWorkgroupsPerDimension",
] as const;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

async function probeAdapter(
  gpu: GPU,
): Promise<{ adapter: AdapterRecord | null; reason: string | null }> {
  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    return { adapter: null, reason: `requestAdapter threw: ${String(error)}` };
  }
  if (adapter === null) {
    return { adapter: null, reason: "navigator.gpu.requestAdapter() resolved to null" };
  }
  const info = adapter.info;
  const limits: Record<string, number> = {};
  const adapterLimits = adapter.limits as unknown as Record<string, unknown>;
  for (const name of RELIED_ON_LIMITS) {
    const value = adapterLimits[name];
    if (typeof value === "number") limits[name] = value;
  }
  let deviceFeatures: string[];
  try {
    const device = await adapter.requestDevice();
    deviceFeatures = sorted(device.features);
    device.destroy();
  } catch (error) {
    return { adapter: null, reason: `requestDevice threw: ${String(error)}` };
  }
  return {
    adapter: {
      info: {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: info.isFallbackAdapter,
      },
      adapterFeatures: sorted(adapter.features),
      deviceFeatures,
      limits,
    },
    reason: null,
  };
}

export async function collectEnvironment(): Promise<PageEnvironment> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  const base = {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    renderTargetSize: { ...RENDER_TARGET_SIZE },
  };
  if (gpu === undefined) {
    return {
      ...base,
      gpu: {
        navigatorGpu: false,
        reason: "navigator.gpu is undefined",
        adapter: null,
        wgslLanguageFeatures: [],
      },
    };
  }
  const { adapter, reason } = await probeAdapter(gpu);
  return {
    ...base,
    gpu: {
      navigatorGpu: true,
      reason,
      adapter,
      wgslLanguageFeatures: sorted(gpu.wgslLanguageFeatures),
    },
  };
}

(window as unknown as { mtekCollectEnvironment: typeof collectEnvironment }).mtekCollectEnvironment =
  collectEnvironment;
