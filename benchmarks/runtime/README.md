# Runtime benchmark (M7-04)

The runtime benchmark of blueprint section 12.3 and `spec/ai-and-benchmarks.md` section 7: seven workloads, each as an
**Mtek program**, a **hand-written direct-WebGPU reference** and a **three.js baseline**; a measurement harness; frozen
definitions; raw results and a generated report. Method and choices: decisions 0095 (measurement), 0096 (workloads),
0097 (freezing), 0098 (results, report, plateaus), 0099 (what it showed). **Nothing here is a speed guarantee.**

Published results: [`../results/runtime/report.md`](../results/runtime/report.md), raw data in `../results/runtime/raw/`.

## The workloads

| Directory | What it is |
|---|---|
| `constant-scene/` | 400 unlit boxes in 8 colours; nothing changes (the controlled core-rendering workload) |
| `changing-transforms/` | 1,000 boxes whose position and rotation change every frame |
| `changing-material-params/` | 500 boxes whose colour parameter changes every frame |
| `repeated-meshes/` | 2,000 boxes of one mesh and material (the instancing path) |
| `asset-heavy-startup/` | 12 textured spheres from 4 generated GLB meshes (21,600 triangles each) and 8 generated 512 x 512 PNGs; startup latency |
| `physics-bodies/` | 300 dynamic boxes under Rapier 0.21.0, kept awake by a periodic force |
| `mount-reload-dispose/` | 50 cycles of mount, frames, reload (edited program), frames, dispose (plus 800 in a supplementary run) |

Each directory has `workload.json` (the numbers), `mtek/` (the Mtek program, **generated** by `tools/gen-mtek.ts`;
do not edit), `direct/main.ts` and `three/main.ts`. The scene formulas are in `common/layout.ts`, the protocol (frames,
runs, threshold) in `protocol.json`.

## Layout

```
protocol.json            the measurement protocol (frozen)
common/layout.ts         scene formulas shared by all implementations and the Mtek generator (frozen)
FROZEN.json              tree hash of the definitions, with a rationale per entry (decision 0097)
harness/
  page.ts                the measurement page: one pass per page load (timing, counts, gpu-time, allocation, parity, startup, cycles)
  instrument.ts          the WebGPU wrappers: counters, device capture, GPU timer
  stats.ts               nearest-rank percentiles
  mtek-adapter.ts        mounts an `mtek build` program under a manual clock into an offscreen target
  floor.ts               an application that draws nothing: the harness floor
  kit/direct.ts, kit/three.ts   what the direct and three.js implementations are written on
tools/
  prepare.ts             builds programs, assets, page bundles and sizes into .out/site/
  run.ts                 the runner (refuses without a real adapter: NOT-RUN, exit code 3)
  report.ts              raw results -> report.md and summary.json (--check verifies the committed ones)
  freeze.ts              the tree hash of the definitions (--check, --record "<why>")
  analyze.ts             raw results -> numbers (what the report prints)
  gen-mtek.ts, assets.ts the generators of the Mtek programs and of the assets
```

## Commands

```bash
npm ci
npm run build                                       # runtime and physics bundles, the mtek executable
npm run test:unit -w @mtek/runtime-benchmarks       # statistics, instrument, freeze, generators, report reproducibility
node benchmarks/runtime/tools/prepare.ts            # build everything a run serves into .out/site/
MTEK_GPU_LOCK_DIR=<dir> node benchmarks/runtime/tools/run.ts --smoke      # prove the machinery (never a result)
MTEK_REQUIRE_GPU=1 node benchmarks/runtime/tools/run.ts --publish        # the real run: raw results into ../results/runtime/raw/<run-id>/
node benchmarks/runtime/tools/report.ts             # regenerate report.md and summary.json from the first published run (MAIN_REPORT_RUN in tools/report.ts)
node benchmarks/runtime/tools/report.ts --check     # fail unless the committed report follows from the raw results
node benchmarks/runtime/tools/report.ts --after=<run-id> --label=<label>          # report of a later run, compared with the first: report-after-<label>.md
node benchmarks/runtime/tools/report.ts --after=<run-id> --label=<label> --check  # fail unless it follows from the two runs' raw results
node benchmarks/runtime/tools/freeze.ts --check     # the definitions are the frozen ones
```

`run.ts` takes `--workload=a,b`, `--impl=mtek,direct,three`, `--smoke` (with `--set=cycles=50,...` to override protocol
numbers), `--out=<dir>`, `--no-floor`, `--prepare`. `MTEK_GPU_LOCK_DIR` names a directory the runner creates (atomically)
around every pass so that several GPU users on one machine take turns; without it there is no lock.

A change to anything listed in decision 0097 is a change of the frozen definitions: record it with a rationale
(`node tools/freeze.ts --record "<why>"`) in the same commit, and run the affected workloads again.
