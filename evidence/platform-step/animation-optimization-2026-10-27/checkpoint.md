# Animation optimization and resumed GPU validation

Date: 2026-10-27. The user explicitly re-enabled CPU/GPU testing and animation
optimization, including while doing other work. Nothing remains deferred because
of that earlier workstation-use restriction. This increment does not complete
the full platform roadmap.

## Implementation

- Cache palette matrix views for each player and normalize pose quaternions
  without creating typed-array views/iterators in each evaluation. Reuse the
  affine inverse-mesh matrix's invariant last row.
- Store each joint's bind-space box as center/extents once. Transform its exact
  affine AABB using `M*center+t` and `abs(M)*extent` instead of eight corners.
  Keep the existing weight/f32 tolerance. Independent corner-oracle and weighted
  vertex-enclosure tests cover reflection, shear and scale.
- Skip animated bounds work for opaque draws when culling is disabled. Translucent
  sorting and enabled culling still update bounds. Off-camera shadow casters
  still deform before the shadow pass.
- Select position-only skinning when compiler-declared material attributes do
  not read normals. Normal-reading materials keep inverse-transpose deformation.
  Distinct position/normal cohorts prevent one material from borrowing an
  incomplete output. Both variants are lazy and share a compute pass with
  explicit pipeline switching; original immutable normal buffers retain their
  original owner. No dummy normal buffer is needed for meshes without normals.

The primary benchmark still uses independent poses, original geometry/joints,
palette-only animated uploads and compute deformation. No sharing, throttling,
vertex-skinning substitution or workload reduction was introduced. The opaque
flat material already did not read normals before the optimization.

## Correctness and package checks

- 1,652 runtime unit tests across 107 files pass with one worker. The new bounds
  oracle and independent position/normal cohort lifetime checks are included.
- Runtime/browser TypeScript and lint pass. The final browser harness unit suite
  passes 314 tests across 29 files, including the composite compute references.
- 35 hardware and 35 software browser checks pass, zero NOT-RUN. These cover
  1/10/50-actor skinning, all actor readbacks, partial workgroups, normal and
  position-only variants, mixed-pipeline switching, cohort detach/rejoin and
  recovery, locomotion/grips, culling/shadows, HDR lighting and resource disposal.
- The previously deferred lighting-studio inspector check now passes on both
  backends: edit, undo, redo, reset and panel removal. Its screenshot was visually
  inspected. The browser fixture now serves the built inspector module matching
  the standalone dev server. The original missing-module failure is retained in
  `correctness/rejected-studio-setup/`; 33 other checks passed in that attempt.
- All eleven existing package budgets hold without increasing limits. The
  tightest ZIP is stage-show, 739,910 / 740,000 bytes (90 bytes remaining).
  [Budget record](package-budgets.json). Prebuilt runtime matches built outputs
  and current source provenance. Runtime.min.js is 694,425 bytes.
- The compute numerical and geometry/recovery probes pass again on the candidate
  runtime on both backends; records are in the separate
  [compute checkpoint](../shader-authoring/compute-gpu-2026-10-27/checkpoint.md).

The bounded browser records and screenshots are retained under `correctness/`.
Copied JSON records are sanitized without changing numbers/statuses. The software
backend is SwiftShader on the same PC, not a second physical-device tier.
Commands, source/evidence hashes and final check counts are in
[validation.json](validation.json). Snapshot hashes and retained report counts
were independently rechecked after recording them.

## Matched measurements

The fresh pre-optimization [baseline](baseline/run-01/report.md) passes all 210
checks and its report regeneration check. Its runtime and affected production
sources are snapshotted separately from the candidate under `baseline/` and
`optimized/`, with source hashes and prebuilt provenance. The candidate also
passes all 210 checks; both reports regenerate exactly. Before/after GPU idle
utilization is zero for both runs. The [full comparison](comparison.md) includes
both engines, every actor count and raw JSON metrics.

At 50 independently animated actors:

| Asset | GPU pass-sum p95 before → after | Logical GPU buffers before → after | Whole-frame CPU p95 before → after |
|---|---:|---:|---:|
| Fox | 0.09728 → 0.08844 ms (−9.1%) | 2,296,960 → 1,239,424 B (−46.0%) | 1.365 → 1.850 ms (+35.5%) |
| CesiumMan | 0.11016 → 0.10136 ms (−8.0%) | 4,258,416 → 2,294,616 B (−46.1%) | 1.180 → 1.150 ms (−2.5%) |

Palette uploads are unchanged (76,800 / 60,800 bytes per frame), as are 50 draws.
Retained JS heap increases by about 43.6 / 33.1 kB (0.84% / 0.64%), consistent
with the retained palette views and pipeline metadata; this is an observed cost,
not a causal heap attribution. Runtime.min.js grows 1,078 bytes over the baseline.

**No whole-frame CPU improvement is established.** Results are mixed, and the
unchanged Three.js 50-actor CPU controls also move from 0.910 → 1.760 ms (Fox) and
0.805 → 1.165 ms (CesiumMan). Host-load admission limits were satisfied, but they
do not isolate every source of scheduling/JIT/driver variation. The Fox regression
is retained and not explained away or replaced by selected samples. Three.js GPU
time and buffer use still remain lower in these workloads.

A separate [alternating paired pose diagnostic](pose-only.json), reproduced by
`node evidence/platform-step/animation-optimization-2026-10-27/profile-pose.mjs`,
runs the two snapshotted production runtimes in Node. It measures 50 independent
controllers over 1,800 frames after 300 warmups, alternates order on every pair
and checks exact poses/palettes outside timing. Pose-only p95 changes from
1.1010 → 0.8530 ms (Fox, −22.5%) and 2.1100 → 1.6844 ms (CesiumMan, −20.2%).
This narrower diagnostic excludes bounds, rendering, GPU/driver work and Three.js;
it supports the pose hot-path change, not a browser whole-frame CPU claim.

The frozen report's mixed-sampler rejection sentence is historical: both new
build records show successful original imports for both assets. The comparison
states this correction without altering the frozen template or workload.

Frozen animation definitions remain
`0897d7e5d5e7aa19ccf6cd49faf640e4001762b10faa9baa24e2db23590d0c6a`.
The frozen runner/report, original assets, AI archive, load limits and measurement
thresholds are unchanged. Noisy samples are retained and retried without
cancelling the run due to other work. The comparison generator is outside the
frozen directory: `node evidence/platform-step/animation-optimization-2026-10-27/compare.mjs`.

Wider device tiers, PBR workload parity, presented-frame measurement, broader
authored-rig animation compositions and remaining roadmap acceptance remain open.
