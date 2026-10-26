# Matched independent-character workloads

This suite compares Mtek and Three.js 0.186.1 on WebGPU using 1, 10 and 50
independently animated actors at two original mesh complexities. It is separate
from the seven frozen runtime workloads and from the frozen AI evidence archive.

The [recorded increment and results](../../../evidence/platform-step/matched-animation-progress.md)
include the complete three-repeat matrix, raw evidence and current limitations.

| Character | Vertices per actor | Joints | Measured clip |
|---|---:|---:|---|
| Fox | 1,728 | 24 | Walk |
| Cesium Man | 3,273 | 19 | animation_0 |

The [originals and their licenses](assets/README.md) are pinned to a Khronos asset
repository commit. Geometry, influences, inverse binds, hierarchy and animation
data are unchanged. Preparation explicitly replaces materials for both engines.
Original import diagnostics are retained: Fox's geometry/animation imports;
Cesium Man's original mixed min/mag sampler is rejected by the current profile.
This is a declared conversion workflow, not a claim that all original glTF
materials are supported. Textured demonstrations use the unchanged embedded
base-color image with explicit linear/repeat, level-zero unlit sampling.

## Running

Build the current runtime and CLI first, with at most two Cargo jobs. From the
repository root:

```sh
node benchmarks/runtime/animation/prepare.ts
node benchmarks/runtime/animation/run.ts --smoke
node benchmarks/runtime/animation/freeze.ts --record
node benchmarks/runtime/animation/run.ts --out=evidence/platform-step/matched-animation/<run-id>
node benchmarks/runtime/animation/report.ts --run=evidence/platform-step/matched-animation/<run-id>
node benchmarks/runtime/animation/report.ts --run=evidence/platform-step/matched-animation/<run-id> --check
```

Set `MTEK_GPU_LOCK_DIR` to a lock directory outside the generated site to coordinate
GPU work with other local runners. Close or park other animated views before a
measurement. Reportable runs require a real hardware adapter, a complete matrix,
unchanged frozen definitions and unchanged prepared artifacts. CPU load is recorded
before/during each pass. Busy windows wait without collecting samples; passes
that exceed the during-pass limit retain rejected attempts and retry in fresh
contexts. The limits remain 30% before and 50% during a pass. Elapsed time can
therefore exceed active benchmark time when the computer is busy. Smoke output stays in ignored
scratch storage and cannot generate a performance report. Model subsets are only
allowed for smoke debugging, for example `--smoke --model=Fox`.

The standalone visual comparison runs with:

```sh
node benchmarks/runtime/animation/serve.ts
```

Open [the character comparison](http://127.0.0.1:5185/demo.html). Pause really stops
rendering work; the side-by-side view itself is not a benchmark. Clip selection
uses the original animations. Its visible credits identify all model authors.

## Matching and measurement scope

The same authored geometry, weighted influences and clip drive both engines.
Each actor has its own animation player/mixer and deterministic initial phase.
There are no shared-pose cohorts, distant-pose throttles or automatic instancing.
Both use the same flat opaque color, sRGB target, dimensions, camera, transforms,
frame delta and actor placement. Cesium Man's mesh-local import explicitly applies
both authored parent bind rotations; Three.js loads those original parent nodes.

The primary timing workload draws every actor with frustum culling disabled on
both sides. Before timings, four poses must pass world-joint and image comparisons.
Separate camera-edge probes compare culled/unculled Mtek output and the Three.js
reference using real animated limbs. These correctness probes are also mandatory.
Both images must contain a visible character. Pixel-error limits apply per phase
to the full target and to the foreground union, preventing a small missing actor
from passing against a mostly empty background. Tolerance, counts, warm-up,
frames and run order are in `protocol.json`; source
hashes are frozen before reportable measurements.

CPU passes install device capture only. They bracket the full synchronous
update/render/submit call and await queue completion outside that interval. A
separate RAF pass records callback intervals with normal queued submissions; it
does not establish physical presented-frame cadence. The isolated page enables
the high-resolution CPU clock and records its observed quantum.

GPU passes instrument every render **and compute** pass across every submitted
encoder. This includes Mtek's separately submitted skinning pass. The harness
rejects a Mtek sample with no captured compute pass. Its regression specifically
covers encoders produced through a factory bound before timer installation.
GPU totals sum pass execution intervals; transfer operations outside passes,
inter-pass barriers/queue gaps, presentation and query readback are excluded.
CPU timing never pays for these query/counter wrappers.

Counting passes record all observed WebGPU uploads and draw calls. Memory passes
record logical live GPU buffer bytes and GC-controlled JS heap/backing storage
while the application is alive, then capture post-disposal state. These are not
physical VRAM, driver memory, process RSS or a browser-wide memory guarantee.
Each engine has its own page bundle; Mtek does not load Three.js code, and the
Three.js side does not load a Mtek manifest merely to obtain its joint oracle.
Original retained GLB bytes and compiler-packed representation can differ in size.

Raw records identify actual application adapters, features, host load, compiled
program and source hashes, runtime provenance, package-lock and compiler hashes.
Three per-run p95 values are retained and their median is reported. No general
superiority claim follows from two characters on one physical computer.

## Maintenance

`PREPARED.json` detects stale/altered generated artifacts. `FROZEN.json` records
the source definitions. If a measurement input changes, prepare and freeze again,
then rerun affected measurements; preserve earlier reports as historical evidence.
The original runtime workload freeze remains unchanged.
