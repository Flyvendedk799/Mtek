// The hardware-only rule of spec/ai-and-benchmarks.md section 7: the runtime benchmark reports numbers only from recorded
// hardware (`isFallbackAdapter === false`) with the environment record attached. Anything else is NOT-RUN, never a pass.
import type { EnvironmentRecord } from "../../../tests/browser/support/environment-types.ts";

export type AdapterVerdict =
  | { readonly status: "hardware"; readonly description: string; readonly timestampQuery: boolean }
  | { readonly status: "not-run"; readonly reason: string };

/** Decides whether a probed environment may produce reportable numbers. */
export function assessAdapter(record: Pick<EnvironmentRecord, "gpu">): AdapterVerdict {
  const { gpu } = record;
  if (!gpu.navigatorGpu) {
    return { status: "not-run", reason: `NOT-RUN: WebGPU is not available in this browser (${gpu.reason ?? "navigator.gpu is undefined"})` };
  }
  const adapter = gpu.adapter;
  if (adapter === null) {
    return { status: "not-run", reason: `NOT-RUN: no WebGPU adapter (${gpu.reason ?? "unknown reason"})` };
  }
  if (adapter.info.isFallbackAdapter) {
    return {
      status: "not-run",
      reason: `NOT-RUN: the adapter is a fallback (software) adapter (${adapter.info.description || adapter.info.vendor || "unnamed"}); the runtime benchmark runs on recorded hardware only`,
    };
  }
  return {
    status: "hardware",
    description: adapter.info.description || `${adapter.info.vendor} ${adapter.info.architecture}`,
    timestampQuery: adapter.adapterFeatures.includes("timestamp-query"),
  };
}
