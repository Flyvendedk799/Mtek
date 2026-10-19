// Which passes run for which workload, how many times, in what order. Pure, so the plan is tested without a browser.
import protocol from "../protocol.json" with { type: "json" };
import type { PassSpec } from "../harness/types.ts";

export type Protocol = typeof protocol;
export type WorkloadKind = "frames" | "startup" | "cycles";
export type PassName = PassSpec["pass"];

export interface Job {
  readonly workload: string;
  readonly implementation: string;
  readonly pass: PassName;
  /** 0-based repetition of this pass for this workload and implementation. */
  readonly run: number;
}

export interface PassRepeat {
  readonly pass: PassName;
  readonly repeats: number;
}

/** The passes of a workload kind: frame workloads and the startup workload run the frame passes; cycles run the cycle pass. */
export function passesFor(kind: WorkloadKind, p: Protocol): PassRepeat[] {
  if (kind === "cycles") {
    return [
      { pass: "cycles", repeats: 1 },
      { pass: "counts", repeats: 1 },
      { pass: "parity", repeats: 1 },
    ];
  }
  return [
    { pass: "timing", repeats: p.timingRuns },
    { pass: "counts", repeats: 1 },
    { pass: "gpu-time", repeats: 1 },
    { pass: "allocation", repeats: 1 },
    { pass: "parity", repeats: 1 },
    { pass: "startup", repeats: p.startupRuns },
  ];
}

/** mulberry32: a small seeded generator, so the pass order of a run is reproducible from its recorded seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function planJobs(
  workloads: ReadonlyArray<{ readonly name: string; readonly kind: WorkloadKind }>,
  implementations: readonly string[],
  p: Protocol,
  seed: number,
): Job[] {
  const jobs: Job[] = [];
  for (const workload of workloads) {
    for (const implementation of implementations) {
      for (const { pass, repeats } of passesFor(workload.kind, p)) {
        for (let run = 0; run < repeats; run += 1) jobs.push({ workload: workload.name, implementation, pass, run });
      }
    }
  }
  return shuffle(jobs, seed);
}

/** The page's pass specification for a job. */
export function specFor(pass: PassName, p: Protocol, workload: { readonly parityFrames: number }): PassSpec {
  const dt = p.frameDeltaSeconds;
  switch (pass) {
    case "timing":
      return { pass, warmupFrames: p.warmupFrames, frames: p.timingFrames, frameDeltaSeconds: dt };
    case "counts":
      return { pass, warmupFrames: p.warmupFrames, frames: p.countFrames, frameDeltaSeconds: dt };
    case "gpu-time":
      return { pass, warmupFrames: p.warmupFrames, frames: p.gpuTimeFrames, frameDeltaSeconds: dt };
    case "allocation":
      return { pass, warmupFrames: p.warmupFrames, frames: p.allocationFrames, frameDeltaSeconds: dt };
    case "parity":
      return { pass, frames: workload.parityFrames, frameDeltaSeconds: dt };
    case "startup":
      return { pass, frameDeltaSeconds: dt };
    case "cycles":
      return { pass, cycles: p.cycles, framesPerPhase: p.cycleFramesPerPhase, frameDeltaSeconds: dt };
  }
}

/** The smoke protocol: the same passes with a handful of frames, to prove the machinery on any adapter. Never reported. */
export function smokeProtocol(p: Protocol): Protocol {
  return {
    ...p,
    warmupFrames: 10,
    timingFrames: 30,
    timingRuns: 1,
    countFrames: 10,
    gpuTimeFrames: 20,
    allocationFrames: 20,
    startupRuns: 2,
    cycles: 3,
  };
}
