import { afterEach, describe, expect, it, vi } from "vitest";
import { MtekMountError } from "../diagnostics/types.js";
import { FakeAdapter, FakeGpu, asGpu, type FakeAdapterOptions } from "../test-support/fake-gpu.js";
import { acquireDevice, isLittleEndianPlatform } from "./device.js";

function gpuWith(options: FakeAdapterOptions = {}): { gpu: GPU; adapter: FakeAdapter; fake: FakeGpu } {
  const adapter = new FakeAdapter(options);
  const fake = new FakeGpu(adapter);
  return { gpu: asGpu<GPU>(fake), adapter, fake };
}

async function failureOf(promise: Promise<unknown>): Promise<MtekMountError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof MtekMountError) return e;
    throw e;
  }
  throw new Error("expected acquireDevice to reject with MtekMountError");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("acquireDevice success", () => {
  it("requests a high-performance adapter and a device with exactly the required features and limits", async () => {
    const { gpu, adapter, fake } = gpuWith({
      features: ["timestamp-query"],
      limits: { maxBufferSize: 1_000_000_000 },
    });
    const acquired = await acquireDevice({
      requiredFeatures: ["timestamp-query"],
      requiredLimits: { maxBufferSize: 500_000_000 },
      environment: { gpu },
    });
    expect(fake.adapterRequests).toEqual([{ powerPreference: "high-performance" }]);
    expect(adapter.deviceRequests).toEqual([
      { requiredFeatures: ["timestamp-query"], requiredLimits: { maxBufferSize: 500_000_000 } },
    ]);
    expect(acquired.adapter).toBe(adapter);
    expect(acquired.device).toBe(adapter.devices[0]);
  });

  it("reads adapter information from adapter.info", async () => {
    const { gpu } = gpuWith({
      info: { vendor: "acme", architecture: "gen9", device: "x1", description: "Acme X1", isFallbackAdapter: true },
    });
    const { adapterInfo } = await acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu } });
    expect(adapterInfo).toEqual({
      vendor: "acme",
      architecture: "gen9",
      device: "x1",
      description: "Acme X1",
      isFallbackAdapter: true,
    });
  });

  it("reports isFallbackAdapter as null when the browser does not provide it", async () => {
    const { gpu } = gpuWith({ info: { vendor: "v", architecture: "a", device: "d", description: "s" } });
    const { adapterInfo } = await acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu } });
    expect(adapterInfo.isFallbackAdapter).toBeNull();
  });

  it("tolerates a browser without adapter.info (empty strings, null fallback flag)", async () => {
    const { gpu } = gpuWith({ info: undefined });
    const { adapterInfo } = await acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu } });
    expect(adapterInfo).toEqual({ vendor: "", architecture: "", device: "", description: "", isFallbackAdapter: null });
  });

  it("registers the caller's device.lost and uncaptured error callbacks", async () => {
    const { gpu } = gpuWith();
    const lost = vi.fn();
    const uncaptured = vi.fn();
    const { device } = await acquireDevice({
      requiredFeatures: [],
      requiredLimits: {},
      onDeviceLost: lost,
      onUncapturedError: uncaptured,
      environment: { gpu },
    });
    const fakeDevice = device as unknown as {
      loseDevice(reason: string, message: string): void;
      onuncapturederror: ((e: unknown) => void) | null;
    };
    expect(fakeDevice.onuncapturederror).not.toBeNull();
    fakeDevice.onuncapturederror?.({ error: { message: "boom" } });
    expect(uncaptured).toHaveBeenCalledWith({ error: { message: "boom" } });
    fakeDevice.loseDevice("unknown", "gpu reset");
    await Promise.resolve();
    await Promise.resolve();
    expect(lost).toHaveBeenCalledWith({ reason: "unknown", message: "gpu reset" });
  });

  it("works without callbacks", async () => {
    const { gpu } = gpuWith();
    await expect(acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu } })).resolves.toBeDefined();
  });

  it("uses navigator.gpu when no environment is injected", async () => {
    const { gpu, adapter } = gpuWith();
    vi.stubGlobal("navigator", { gpu });
    const acquired = await acquireDevice({ requiredFeatures: [], requiredLimits: {} });
    expect(acquired.adapter).toBe(adapter);
  });
});

describe("acquireDevice failures", () => {
  it("E8001 on a big-endian platform, before touching WebGPU", async () => {
    const { gpu, fake } = gpuWith();
    const e = await failureOf(
      acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu, littleEndian: false } }),
    );
    expect(e.kind).toBe("webgpu-unavailable");
    expect(e.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8001"]);
    expect(e.diagnostics[0]?.phase).toBe("runtime:mount");
    expect(fake.adapterRequests).toEqual([]);
  });

  it("detects the real platform endianness", () => {
    expect(isLittleEndianPlatform()).toBe(true);
  });

  it("E8004 when navigator.gpu is absent", async () => {
    vi.stubGlobal("navigator", {});
    const e = await failureOf(acquireDevice({ requiredFeatures: [], requiredLimits: {} }));
    expect(e.kind).toBe("webgpu-unavailable");
    expect(e.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8004"]);
  });

  it("E8004 when there is no navigator at all", async () => {
    vi.stubGlobal("navigator", undefined);
    const e = await failureOf(acquireDevice({ requiredFeatures: [], requiredLimits: {} }));
    expect(e.kind).toBe("webgpu-unavailable");
    expect(e.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8004"]);
  });

  it("E8004 when the injected environment has no gpu", async () => {
    const e = await failureOf(acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu: null } }));
    expect(e.kind).toBe("webgpu-unavailable");
  });

  it("E8005 when requestAdapter resolves null", async () => {
    const gpu = asGpu<GPU>(new FakeGpu(null));
    const e = await failureOf(acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu } }));
    expect(e.kind).toBe("adapter-unavailable");
    expect(e.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8005"]);
  });

  it("E8005 with the browser message as a note when requestAdapter rejects", async () => {
    const gpu = asGpu<GPU>({ requestAdapter: () => Promise.reject(new Error("adapter exploded")) });
    const e = await failureOf(acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu } }));
    expect(e.kind).toBe("adapter-unavailable");
    expect(e.diagnostics[0]?.notes.join(" ")).toContain("adapter exploded");
  });

  it("E8002 for a missing required feature, naming the feature", async () => {
    const { gpu, adapter } = gpuWith({ features: [] });
    const e = await failureOf(
      acquireDevice({ requiredFeatures: ["timestamp-query"], requiredLimits: {}, environment: { gpu } }),
    );
    expect(e.kind).toBe("device-failed");
    expect(e.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8002"]);
    expect(e.diagnostics[0]?.message).toContain("timestamp-query");
    expect(adapter.deviceRequests).toEqual([]);
  });

  it("E8002 for a limit the adapter cannot meet, with expected and actual", async () => {
    const { gpu, adapter } = gpuWith({ limits: { maxUniformBufferBindingSize: 32768 } });
    const e = await failureOf(
      acquireDevice({ requiredFeatures: [], requiredLimits: { maxUniformBufferBindingSize: 65536 }, environment: { gpu } }),
    );
    expect(e.kind).toBe("device-failed");
    const d = e.diagnostics[0];
    expect(d?.code).toBe("MTEK-E8002");
    expect(d?.message).toContain("maxUniformBufferBindingSize");
    expect(d?.expected).toBe("65536");
    expect(d?.actual).toBe("32768");
    expect(adapter.deviceRequests).toEqual([]);
  });

  it("treats alignment limits as lower-is-better", async () => {
    const ok = gpuWith({ limits: { minUniformBufferOffsetAlignment: 64 } });
    await expect(
      acquireDevice({
        requiredFeatures: [],
        requiredLimits: { minUniformBufferOffsetAlignment: 256 },
        environment: { gpu: ok.gpu },
      }),
    ).resolves.toBeDefined();

    const bad = gpuWith({ limits: { minUniformBufferOffsetAlignment: 256 } });
    const e = await failureOf(
      acquireDevice({
        requiredFeatures: [],
        requiredLimits: { minUniformBufferOffsetAlignment: 64 },
        environment: { gpu: bad.gpu },
      }),
    );
    expect(e.diagnostics[0]?.code).toBe("MTEK-E8002");
  });

  it("E8002 for a limit name the adapter does not know", async () => {
    const { gpu } = gpuWith();
    const e = await failureOf(
      acquireDevice({ requiredFeatures: [], requiredLimits: { maxNotARealLimit: 1 }, environment: { gpu } }),
    );
    expect(e.diagnostics[0]?.code).toBe("MTEK-E8002");
    expect(e.diagnostics[0]?.message).toContain("maxNotARealLimit");
  });

  it("reports every mismatch, features first, in input order", async () => {
    const { gpu } = gpuWith({ limits: { maxBufferSize: 10, maxBindGroups: 1 } });
    const e = await failureOf(
      acquireDevice({
        requiredFeatures: ["depth-clip-control", "indirect-first-instance"],
        requiredLimits: { maxBufferSize: 20, maxBindGroups: 2 },
        environment: { gpu },
      }),
    );
    expect(e.diagnostics.map((d) => d.code)).toEqual(Array(4).fill("MTEK-E8002"));
    const messages = e.diagnostics.map((d) => d.message);
    expect(messages[0]).toContain("depth-clip-control");
    expect(messages[1]).toContain("indirect-first-instance");
    expect(messages[2]).toContain("maxBufferSize");
    expect(messages[3]).toContain("maxBindGroups");
  });

  it("device-failed (E8002) with the browser message as a note when requestDevice rejects", async () => {
    const { gpu } = gpuWith({ requestDeviceError: new Error("device creation refused") });
    const e = await failureOf(acquireDevice({ requiredFeatures: [], requiredLimits: {}, environment: { gpu } }));
    expect(e.kind).toBe("device-failed");
    expect(e.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8002"]);
    expect(e.diagnostics[0]?.notes.join(" ")).toContain("device creation refused");
  });

  it("never reads the user agent", async () => {
    const { gpu } = gpuWith();
    const userAgent = vi.fn(() => "Mozilla/5.0");
    vi.stubGlobal("navigator", {
      gpu,
      get userAgent() {
        return userAgent();
      },
    });
    await acquireDevice({ requiredFeatures: [], requiredLimits: {} });
    expect(userAgent).not.toHaveBeenCalled();
  });
});
