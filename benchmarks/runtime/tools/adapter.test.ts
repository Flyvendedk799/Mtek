import { describe, expect, it } from "vitest";
import type { EnvironmentRecord } from "../../../tests/browser/support/environment-types.ts";
import { assessAdapter } from "./adapter.ts";

type Gpu = Pick<EnvironmentRecord, "gpu">;

const hardware: Gpu = {
  gpu: {
    navigatorGpu: true,
    reason: null,
    wgslLanguageFeatures: [],
    adapter: {
      info: { vendor: "amd", architecture: "rdna-3", device: "0x744c", description: "AMD Radeon RX 7900 XTX", isFallbackAdapter: false },
      adapterFeatures: ["timestamp-query"],
      deviceFeatures: [],
      limits: {},
    },
  },
};

describe("the hardware-only rule", () => {
  it("accepts a real adapter and says whether it has timestamp-query", () => {
    expect(assessAdapter(hardware)).toEqual({ status: "hardware", description: "AMD Radeon RX 7900 XTX", timestampQuery: true });
    const without: Gpu = { gpu: { ...hardware.gpu, adapter: { ...(hardware.gpu.adapter as NonNullable<Gpu["gpu"]["adapter"]>), adapterFeatures: [] } } };
    expect(assessAdapter(without)).toMatchObject({ status: "hardware", timestampQuery: false });
  });

  it("refuses a fallback (software) adapter: NOT-RUN, never a pass", () => {
    const software: Gpu = {
      gpu: {
        ...hardware.gpu,
        adapter: {
          ...(hardware.gpu.adapter as NonNullable<Gpu["gpu"]["adapter"]>),
          info: { vendor: "google", architecture: "swiftshader", device: "", description: "SwiftShader", isFallbackAdapter: true },
        },
      },
    };
    const verdict = assessAdapter(software);
    expect(verdict.status).toBe("not-run");
    expect((verdict as { reason: string }).reason).toMatch(/^NOT-RUN: .*fallback/);
  });

  it("refuses a browser without an adapter and a browser without WebGPU", () => {
    const none = assessAdapter({ gpu: { ...hardware.gpu, adapter: null, reason: "requestAdapter() resolved to null" } });
    expect(none).toMatchObject({ status: "not-run" });
    expect((none as { reason: string }).reason).toContain("requestAdapter() resolved to null");
    const noGpu = assessAdapter({ gpu: { navigatorGpu: false, reason: "navigator.gpu is undefined", adapter: null, wgslLanguageFeatures: [] } });
    expect(noGpu).toMatchObject({ status: "not-run" });
    expect((noGpu as { reason: string }).reason).toContain("not available");
  });
});
