// How busy the machine is, from the cumulative CPU times the operating system reports. A benchmark pass records the busy
// share before it starts and over its whole duration, so a reader can see whether something else was running.
import { cpus } from "node:os";

export interface CpuTimes {
  readonly idle: number;
  readonly total: number;
}

export function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { idle, total };
}

/** Percent of all logical CPUs that were busy between two readings (0 when no time passed). */
export function busyPercent(before: CpuTimes, after: CpuTimes): number {
  const total = after.total - before.total;
  if (total <= 0) return 0;
  return (100 * (total - (after.idle - before.idle))) / total;
}

export interface HostLoad {
  /** Busy percent of the machine in the quarter second before the pass. */
  readonly busyBeforePercent: number;
  /** Busy percent over the pass itself (includes the benchmark's own browser). */
  busyDuringPercent: number;
  /** How long the runner waited for the machine to calm down before this pass, in milliseconds. */
  readonly waitedForQuietMs: number;
  /** True when the machine was still busier than the limit after the wait. */
  readonly noisy: boolean;
  logicalCpus: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sampleBusy(ms: number): Promise<number> {
  const before = readCpuTimes();
  await sleep(ms);
  return busyPercent(before, readCpuTimes());
}

/** Waits until the machine's busy share (measured over 250 ms) is at most `limitPercent`, up to `maxWaitMs`. */
export async function waitForQuiet(limitPercent: number, maxWaitMs: number): Promise<Pick<HostLoad, "busyBeforePercent" | "waitedForQuietMs" | "noisy">> {
  const start = Date.now();
  let busy = await sampleBusy(250);
  while (busy > limitPercent && Date.now() - start < maxWaitMs) {
    await sleep(1_000);
    busy = await sampleBusy(250);
  }
  return { busyBeforePercent: busy, waitedForQuietMs: Date.now() - start, noisy: busy > limitPercent };
}
