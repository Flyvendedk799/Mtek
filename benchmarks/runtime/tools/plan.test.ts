import { describe, expect, it } from "vitest";
import protocol from "../protocol.json" with { type: "json" };
import { passesFor, planJobs, seededRandom, shuffle, smokeProtocol, specFor } from "./plan.ts";

describe("the protocol meets the floor of spec/ai-and-benchmarks.md section 7", () => {
  it("measures at least 600 frames after at least 120 warm-up frames, in every frame pass", () => {
    expect(protocol.warmupFrames).toBeGreaterThanOrEqual(protocol.minimumWarmupFrames);
    expect(protocol.minimumWarmupFrames).toBe(120);
    expect(protocol.timingFrames).toBeGreaterThanOrEqual(protocol.minimumTimingFrames);
    expect(protocol.minimumTimingFrames).toBe(600);
    expect(protocol.gpuTimeFrames).toBeGreaterThanOrEqual(protocol.minimumTimingFrames);
    for (const pass of ["timing", "gpu-time"] as const) {
      const spec = specFor(pass, protocol, { parityFrames: 5 });
      expect(spec).toMatchObject({ pass });
      expect((spec as { warmupFrames: number }).warmupFrames).toBeGreaterThanOrEqual(120);
      expect((spec as { frames: number }).frames).toBeGreaterThanOrEqual(600);
    }
  });

  it("uses the investigation threshold of 20 percent and one fixed tick per frame", () => {
    expect(protocol.thresholdPercent).toBe(20);
    expect(protocol.frameDeltaSeconds).toBe(0.016666668);
  });

  it("the smoke protocol is smaller than the real one in every count (it is never a result)", () => {
    const smoke = smokeProtocol(protocol);
    expect(smoke.timingFrames).toBeLessThan(protocol.minimumTimingFrames);
    expect(smoke.warmupFrames).toBeLessThan(protocol.minimumWarmupFrames);
  });
});

describe("the job plan", () => {
  const workloads = [
    { name: "a", kind: "frames" as const },
    { name: "b", kind: "startup" as const },
    { name: "c", kind: "cycles" as const },
  ];

  it("has every pass of every kind for every implementation, the right number of times", () => {
    const jobs = planJobs(workloads, ["mtek", "direct", "three"], protocol, 1);
    for (const w of workloads) {
      for (const implementation of ["mtek", "direct", "three"]) {
        for (const { pass, repeats } of passesFor(w.kind, protocol)) {
          const n = jobs.filter((j) => j.workload === w.name && j.implementation === implementation && j.pass === pass).length;
          expect(n).toBe(repeats);
        }
      }
    }
    expect(passesFor("frames", protocol).find((p) => p.pass === "timing")?.repeats).toBe(protocol.timingRuns);
    expect(passesFor("frames", protocol).find((p) => p.pass === "startup")?.repeats).toBe(protocol.startupRuns);
    expect(passesFor("cycles", protocol).map((p) => p.pass)).toEqual(["cycles", "cycles-long", "counts", "parity"]);
  });

  it("is a permutation of the jobs, the same for the same seed and different for another", () => {
    const a = planJobs(workloads, ["mtek", "direct", "three"], protocol, 7);
    const b = planJobs(workloads, ["mtek", "direct", "three"], protocol, 7);
    const c = planJobs(workloads, ["mtek", "direct", "three"], protocol, 8);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
    expect(new Set(c.map((j) => JSON.stringify(j)))).toEqual(new Set(a.map((j) => JSON.stringify(j))));
  });

  it("seeded randomness and shuffles are reproducible", () => {
    const r1 = seededRandom(3);
    const r2 = seededRandom(3);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    expect(shuffle([1, 2, 3, 4, 5, 6], 9)).toEqual(shuffle([1, 2, 3, 4, 5, 6], 9));
    expect([...shuffle([1, 2, 3, 4, 5, 6], 9)].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("gives the page the parity frames of the workload and the cycles of the protocol", () => {
    expect(specFor("parity", protocol, { parityFrames: 10 })).toMatchObject({ pass: "parity", frames: 10 });
    expect(specFor("cycles", protocol, { parityFrames: 10 })).toMatchObject({ cycles: protocol.cycles });
    expect(specFor("cycles-long", protocol, { parityFrames: 10 })).toMatchObject({ cycles: protocol.longCycles });
  });
});
