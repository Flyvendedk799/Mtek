import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLATEAU_GROWTH_PERCENT,
  THRESHOLD_PERCENT,
  combineRuns,
  loadRun,
  resourceSeries,
  slope,
  summarizePair,
  verdictFor,
  type Impl,
  type PairSummary,
} from "./analyze.ts";
import { collect, fmtBytes, fmtMs, fmtPercent, renderReport, reportPaths } from "./report.ts";
import { stringifyCompact } from "./json.ts";
import { RAW_DIR, RESULTS_DIR, WORKLOADS } from "./paths.ts";
import { samplesWithP95, syntheticRun } from "./synthetic.ts";

describe("statistics over runs", () => {
  it("takes the median of the per-run percentiles and keeps their range", () => {
    const combined = combineRuns([samplesWithP95(600, 1), samplesWithP95(600, 3), samplesWithP95(600, 2)]);
    expect(combined.runs).toBe(3);
    expect(combined.samplesPerRun).toBe(600);
    expect(combined.median.p95).toBeCloseTo(2, 12);
    expect(combined.min.p95).toBeCloseTo(1, 12);
    expect(combined.max.p95).toBeCloseTo(3, 12);
  });

  it("slope is the least-squares slope against the index", () => {
    expect(slope([1, 2, 3, 4])).toBeCloseTo(1, 12);
    expect(slope([5, 5, 5])).toBe(0);
    expect(slope([7])).toBe(0);
  });

  it("classifies a resource series: zero, plateau or growing (decision 0098)", () => {
    expect(resourceSeries("x", "bytes", new Array<number>(50).fill(0)).classification).toBe("zero");
    expect(resourceSeries("x", "bytes", new Array<number>(50).fill(1000)).classification).toBe("plateau");
    // Warm-up for 5 cycles, then flat.
    expect(resourceSeries("x", "bytes", Array.from({ length: 50 }, (_, i) => 1000 + 100 * Math.min(i, 5))).classification).toBe("plateau");
    // 1 % of the mean per half would be 250 bytes over 25 cycles = 10 per cycle: 20 per cycle is growing.
    expect(resourceSeries("x", "bytes", Array.from({ length: 50 }, (_, i) => 1000 + 20 * i)).classification).toBe("growing");
    expect(PLATEAU_GROWTH_PERCENT).toBe(1);
  });

  it("reports the values at cycles 1, 10, 25 and the last", () => {
    const series = resourceSeries("x", "objects", Array.from({ length: 50 }, (_, i) => i + 1));
    expect(series.at).toEqual({ "cycle 1": 1, "cycle 10": 10, "cycle 25": 25, "cycle 50": 50 });
  });
});

describe("the 20 percent investigation threshold", () => {
  const verdictAt = (factor: number): ReturnType<typeof verdictFor> => {
    const run = syntheticRun({ mtekFactor: factor });
    const pairs = Object.fromEntries((["mtek", "direct", "three"] as const).map((i) => [i, summarizePair(run, "constant-scene", i)])) as Record<Impl, PairSummary>;
    return verdictFor("frames", "constant-scene", pairs);
  };

  it("is within at +19 percent and exceeds at +21 percent", () => {
    expect(THRESHOLD_PERCENT).toBe(20);
    const within = verdictAt(1.19);
    expect(within.outcome).toBe("within");
    expect(within.mtekOverDirectPercent).toBeCloseTo(19, 6);
    const exceeds = verdictAt(1.21);
    expect(exceeds.outcome).toBe("exceeds");
    expect(exceeds.mtekOverDirectPercent).toBeCloseTo(21, 6);
  });

  it("uses the p95, not the mean or the p50", () => {
    const v = verdictAt(2);
    // The median of three runs whose p95 are 0.4, 0.404 and 0.408.
    expect(v.mtek).toBeCloseTo(0.404, 12);
    expect(v.direct).toBeCloseTo(0.2, 12);
  });

  it("is not-measured, never within, when Mtek or the reference has no data", () => {
    const run = syntheticRun({ missing: ["constant-scene--mtek"] });
    const pairs = Object.fromEntries((["mtek", "direct", "three"] as const).map((i) => [i, summarizePair(run, "constant-scene", i)])) as Record<Impl, PairSummary>;
    expect(verdictFor("frames", "constant-scene", pairs).outcome).toBe("not-measured");
  });
});

describe("the report", () => {
  it("is a pure function of the raw run: the same input prints the same bytes, twice", () => {
    const run = syntheticRun();
    expect(renderReport(run).markdown).toBe(renderReport(run).markdown);
    expect(stringifyCompact(renderReport(run).summary)).toBe(stringifyCompact(renderReport(run).summary));
  });

  it("has a section and a row in the summary for every workload, also those that fail", () => {
    const { markdown } = renderReport(syntheticRun({ mtekFactor: 5 }));
    for (const name of WORKLOADS) expect(markdown).toContain(`<a id="${name}"></a>`);
    expect(markdown).toContain("**exceeds 20 %**");
    // Mtek is five times direct on every metric of the synthetic run: every workload exceeds the threshold, none is dropped.
    expect(markdown.match(/\*\*exceeds 20 %\*\*/g)?.length).toBe(WORKLOADS.length);
  });

  it("lists a failed implementation instead of dropping it, and the workload stays in the tables", () => {
    const run = syntheticRun({ failing: [{ pair: "physics-bodies--mtek", pass: "timing" }] });
    const { markdown } = renderReport(run);
    expect(markdown).toContain("Implementations that errored or are missing");
    expect(markdown).toContain("300 physics bodies, Mtek: error; timing#0: the page threw: synthetic failure");
    expect(markdown).toContain('<a id="physics-bodies"></a>');
  });

  it("lists a missing implementation as missing", () => {
    const { markdown } = renderReport(syntheticRun({ missing: ["repeated-meshes--three"] }));
    expect(markdown).toContain("2,000 repeated meshes, three.js: missing; no raw result for this implementation");
  });

  it("labels GPU time unavailable with its reason and never prints a number for it", () => {
    const { markdown } = renderReport(syntheticRun({ noGpuTime: true }));
    expect(markdown).toContain("unavailable (the device has no timestamp-query feature)");
  });

  it("explains the plateaus it classified, naming the series that still grow", () => {
    const flat = renderReport(syntheticRun()).markdown;
    expect(flat).toContain("No series is still growing over the last half of the 50 cycles.");
    const leaky = renderReport(syntheticRun({ mtekHeapGrowthPerCycle: 50_000 })).markdown;
    expect(leaky).toContain("Still growing over the last half of 50 cycles: JavaScript heap in use after a forced collection.");
  });

  it("every number of a workload table follows from the pair summaries (no hand-typed figures)", () => {
    const run = syntheticRun({ mtekFactor: 3 });
    const { reports } = collect(run);
    const constant = reports.find((r) => r.name === "constant-scene");
    expect(constant?.pairs.mtek.frame?.cpu.median.p95).toBeCloseTo(0.6 * 1.01, 9);
    const { markdown } = renderReport(run);
    expect(markdown).toContain(fmtMs(0.6 * 1.01));
    expect(fmtMs(0.0456)).toBe("0.046 ms");
    expect(fmtPercent(-3.04)).toBe("-3.0 %");
    expect(fmtBytes(1536)).toBe("1.5 KiB");
  });
});

describe("the published results", () => {
  const runs = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((n) => existsSync(join(RAW_DIR, n, "run.json"))).sort() : [];

  it("exist: raw results of a run, the generated report and its summary", () => {
    expect(runs.length, "run `node benchmarks/runtime/tools/run.ts --publish` on hardware").toBeGreaterThan(0);
    expect(existsSync(reportPaths().report)).toBe(true);
    expect(existsSync(reportPaths().summary)).toBe(true);
  });

  it("report.md and summary.json are exactly what the generator prints from the newest raw run (reproducible from the stored data)", () => {
    const id = runs[runs.length - 1] as string;
    const run = loadRun(join(RAW_DIR, id));
    const { markdown, summary } = renderReport(run);
    expect(readFileSync(reportPaths().report, "utf8")).toBe(markdown);
    expect(readFileSync(reportPaths().summary, "utf8")).toBe(stringifyCompact(summary));
  });

  it("the newest run is a real result: complete, on hardware, with the frozen definitions, not a smoke run", () => {
    const run = loadRun(join(RAW_DIR, runs[runs.length - 1] as string));
    expect(run.meta.status).toBe("complete");
    expect(run.meta.smoke).toBe(false);
    expect(run.meta.frozen.matches).toBe(true);
    expect(run.environment.gpu.adapter?.info.isFallbackAdapter).toBe(false);
    expect(run.environment.gpu.navigatorGpu).toBe(true);
    expect(run.meta.protocol.timingFrames).toBeGreaterThanOrEqual(600);
    expect(run.meta.protocol.warmupFrames).toBeGreaterThanOrEqual(120);
  });

  it("every workload has a raw result for every implementation and at least 600 measured frames after 120 warm-up frames in each timing run", () => {
    const run = loadRun(join(RAW_DIR, runs[runs.length - 1] as string));
    for (const workload of WORKLOADS) {
      for (const impl of ["mtek", "direct", "three"]) {
        const file = run.pairs.get(`${workload}--${impl}`);
        expect(file, `${workload}--${impl}`).toBeDefined();
        const timing = (file?.jobs ?? []).filter((j) => j.pass === "timing");
        if (workload !== "mount-reload-dispose") expect(timing.length, `${workload}--${impl}`).toBeGreaterThanOrEqual(1);
        for (const j of timing) {
          const result = j.result as { warmupFrames: number; cpuMs: number[] } | undefined;
          expect(result?.warmupFrames).toBeGreaterThanOrEqual(120);
          expect(result?.cpuMs.length).toBeGreaterThanOrEqual(600);
        }
      }
    }
  });

  it("no absolute path of the machine that produced the results was committed", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(json|md)$/.test(entry.name)) files.push(full);
      }
    };
    if (existsSync(RESULTS_DIR)) walk(RESULTS_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/[A-Za-z]:[\\/](?:Users|Windows|Program Files)/);
      expect(text, file).not.toMatch(/\/(?:home|Users)\/[A-Za-z0-9_.-]+\//);
    }
  });
});
