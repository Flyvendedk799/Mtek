// The shape of the raw results a run publishes (`benchmarks/results/runtime/raw/<run-id>/`), and the report generator's input.
//
//   run.json                       RawRunMeta: what ran, when, under which commit and frozen definitions, with the protocol
//   environment.json               the environment record of the browser test harness (OS, browser, adapter, toolchain)
//   sizes.json                     bundle sizes of every workload and implementation
//   <workload>--<impl>.json        RawPairFile: every pass of one implementation of one workload
//   parity/<workload>--<impl>.png  the picture each implementation drew after the workload's parity frames
//   floor.json                     the harness floor (an application that draws nothing), as a RawPairFile
import type { HostLoad } from "./host-load.ts";
import type { PassName, Protocol } from "./plan.ts";

export interface RawJob {
  readonly pass: PassName;
  readonly run: number;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly hostLoad: HostLoad;
  /** Milliseconds this pass waited for the GPU lock; null when no lock directory was configured. */
  readonly gpuLockWaitedMs: number | null;
  readonly status: "ok" | "error";
  readonly error?: string;
  readonly pageErrors: readonly string[];
  readonly consoleWarnings: number;
  /** The page's answer, as returned by `__bench.run` (parity pictures are stripped and stored as PNG files). */
  readonly result?: unknown;
  /** The allocation pass only: the sampling heap profiler's total, taken by the runner. */
  readonly allocation?: { readonly sampledBytes: number; readonly profileNodes: number; readonly samplingIntervalBytes: number };
}

export interface RawPairFile {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly workload: string;
  readonly implementation: string;
  readonly jobs: readonly RawJob[];
}

export interface RawRunMeta {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly smoke: boolean;
  readonly status: "complete" | "not-run";
  readonly notRunReason?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly gitCommit: string;
  readonly gitDirty: boolean;
  /** The tree hash of the frozen definitions this run used, and the one recorded in FROZEN.json. */
  readonly frozen: { readonly treeHash: string; readonly recordedHash: string | null; readonly matches: boolean };
  readonly protocol: Protocol;
  readonly seed: number;
  readonly workloads: readonly string[];
  readonly implementations: readonly string[];
  /** The order the passes ran in (`workload/implementation/pass#run`). */
  readonly order: readonly string[];
  readonly versions: { readonly mtek: string; readonly three: string; readonly rapier: string; readonly runtimeWeb: string };
  readonly gpuLockConfigured: boolean;
  readonly quietLimitPercent: number;
  /** The command line of the run. */
  readonly arguments: readonly string[];
}
