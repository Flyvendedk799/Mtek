# M7-04: runtime benchmark, summary of the result

This page summarises `benchmarks/results/runtime/report.md`, which is generated from the stored raw results in `benchmarks/results/runtime/raw/20261019T052132Z/` (`node benchmarks/runtime/tools/report.ts --check` fails when the report is not what the generator prints from them). Method: decisions [0095](../../spec/decisions/0095-runtime-benchmark-measurement.md) to [0099](../../spec/decisions/0099-runtime-benchmark-findings.md); definitions frozen by tree hash `eb4cc9428208b5eaa47656305d55721d19ebb8b9cc672a98a422a7f546c086e1` (`benchmarks/runtime/FROZEN.json`) before any reported number.

## Run

- One run on the recorded hardware: AMD Radeon RX 7900 XTX, `isFallbackAdapter` false, Windows 11, Chromium 153, headless, offscreen 640 x 360 target.
- 120 warm-up frames and 1200 measured frames per timing run, 3 timing runs per implementation, every pass holding the machine's GPU lock; 427 passes in a shuffled order, 14 of them repeated because other load disturbed them (every attempt is kept in the raw results).
- Every implementation of every workload ran to completion in every pass: no page error, no uncaptured GPU validation error, no device loss.

## Result (CPU p95 frame time, except where stated)

The investigation threshold of `spec/ai-and-benchmarks.md` section 7 is a proposal, not a speed guarantee: p95 more than 20 % above the direct-WebGPU reference on the same machine means the cause is investigated before release copy says anything about performance.

| Workload | Mtek | direct WebGPU | three.js | Mtek vs direct | 20 % threshold |
| --- | --- | --- | --- | --- | --- |
| Constant scene | 0.115 ms | 0.035 ms | 0.430 ms | +228.6 % | exceeds |
| 1,000 changing transforms | 1.360 ms | 0.145 ms | 2.410 ms | +837.9 % | exceeds |
| 500 changing material params | 0.670 ms | 0.150 ms | 1.235 ms | +346.7 % | exceeds |
| 2,000 repeated meshes | 0.245 ms | 0.065 ms | 0.130 ms | +276.9 % | exceeds |
| Asset-heavy startup (p95 startup latency) | 223.9 ms | 204.4 ms | 328.9 ms | +9.6 % | within |
| 300 physics bodies | 1.830 ms | 1.320 ms | 2.105 ms | +38.6 % | exceeds |
| 50 mount/reload/dispose cycles (p95 per cycle) | 23.45 ms | 10.65 ms | 12.23 ms | +120.1 % | exceeds |

Of 7 workloads, 6 exceed the threshold and 1 is within it. No workload was removed or relaxed after a failure.

## What it shows and does not show

- The cost is on the CPU. The report's counters for the 1,000 changing transforms show 1001 `writeBuffer` calls per frame for Mtek against 1 for the direct reference, and a per-frame JavaScript allocation of 1.77 MiB against 93.9 KiB; GPU time is a few microseconds. The follow-up candidates are in decision 0099; nothing in the runtime or the compiler was changed by this work item.
- After every dispose the GPU and registry resources are exactly zero, in the 50 cycles and in an 800-cycle supplementary run. The JavaScript heap does not plateau by the 1 % rule in any of the three implementations; a heap-snapshot comparison (`benchmarks/results/runtime/heap-diff/`) attributes the growth to compiled code and DevTools bookkeeping, not to retained JavaScript objects. That is a hypothesis, not a proof that nothing leaks.
- Limits: one machine, one browser, one run on a shared workstation (the load of every pass is recorded); frame time is CPU time, not display cadence; the direct reference is written once and not tuned, so it is not a ceiling; the reload step is not like for like (Mtek validates a candidate program, the others rebuild their scene); GPU memory and Mtek's physics sleep state are not observable.
- This result makes no performance claim for v0.1 and the release notes make none.
