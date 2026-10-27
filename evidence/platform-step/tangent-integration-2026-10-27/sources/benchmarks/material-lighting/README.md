# Material and lighting comparisons

This separate suite addresses platform scorecard areas 3 and 9. It leaves the
existing runtime/animation workload definitions and frozen evidence unchanged.
**Current state: correctness preparation and desktop visual comparisons; the
complete performance run and presented-frame evidence are still pending.**

The versioned [protocol](protocol.json) defines five categories at low and standard
quality: textured products, indoor lighting, outdoor lighting, transparent PBR
panels and particle effects. Both engines consume one byte-identical generated
uncompressed GLB. It contains common geometry and base-colour, normal,
metallic/roughness, occlusion and emissive maps. Three.js is pinned to 0.186.1 and
uses its WebGPU backend. Mtek packages are built through ordinary source analysis.

Run from the repository root after building the runtime and CLI:

```powershell
node benchmarks/material-lighting/test.mjs
node benchmarks/material-lighting/prepare.mjs
node benchmarks/material-lighting/verify.mjs hardware .out/material-hardware
node benchmarks/material-lighting/verify.mjs software .out/material-software
```

Each verifier refuses to overwrite its result file. Optional `--scene=product`
and `--quality=low` filters are preflights; a filtered run cannot qualify a full
matrix. Even an unfiltered passing report records `performanceEligible: false`:
the unchanged product asset and complete measurement protocol are still pending.
`MTEK_BIN` can name an isolated CLI copy, which
avoids Windows executable locks during independent compiler work.

The visual gate is declared before timing. It evaluates the whole foreground and
projected rectangles around representative objects, without image registration,
fitted colour transforms or renderer-specific pixel tolerances. Particles also
have independently projected sample regions, exact draw-instance checks and
same-engine controls retaining the scene/markers but omitting particle simulation.
Their effects must change a minimum number of pixels. Rejected attempts retain
their own protocol/build hashes and are not promoted into passing evidence.

## What is matched

- Geometry, transforms, cameras, materials, texture bytes, lights, light volume,
  image dimensions, exposure and LDR colour encoding come from shared definitions.
  Low quality reduces image dimensions and sphere complexity. Three groups
  repeated opaque geometry/material pairs into public `InstancedMesh` objects;
  transparent objects remain separate for sorting. Its shadow pass may instance
  those groups, whereas Mtek currently submits individual shadow casters.
- Both shadow profiles use nearest comparisons over the same square tap pattern:
  one sample at 512 square, or nine at 1024 square. Three uses a public TSL
  `LightShadow.filterNode`; its default Vogel-disk PCF is a different filter.
  Source Y–X–Z rotations, shadow bias signs, front-face shadow casting and receiver
  offset are converted explicitly into each engine's public API conventions.
- Both receive the same linear panorama. Mtek uses its native SH/GGX prefilter and
  LUT; Three uses native PMREM and PBR. Three's input is uploaded as filterable
  half-float with the vertical-storage convention adjusted by `flipY`; Mtek takes
  the original float32 input. Their common level-zero cube sizes are 64 or 128.
  These are native preprocessing paths, not identical internal algorithms.
- No tone mapper is fitted to either output. Linear radiance is encoded once into
  LDR sRGB. Native BRDF, indirect-light approximations and point-light range-window
  differences remain observable in the images and are disclosed in reports.
- Transparent panels are source/host PBR materials with the same straight alpha.
  The current GLB import profile requires OPAQUE materials; this suite does not
  relabel GLB BLEND/MASK imports as supported or claim transmission/refraction.
- Particles use the declared seeded stream, fixed update step, lifetime, capacity,
  velocity/gravity equations and ordering. Their common mesh is a local XZ quad
  with +Y normal. Mtek's billboard basis is right/toward-camera/minus-up; Three
  receives the equivalent instance matrices through its public instancing API.

The shared WebGPU counter instrument is imported unchanged from the existing
runtime harness. Separate lazy engine chunks keep the unused renderer out of a
page; network records assert that isolation so heap measurements cannot include
both libraries on just one side. Both output paths explicitly use LDR buffers.
Setup retains metadata from the actual adapter creating each renderer device.
Every scene destroys its own device at disposal. Mtek's public
resource counters must also reach zero. Raw counter fields describe explicit
resource creates/destroys: residual object-byte counts after Three destroys its
device are not evidence of live GPU allocation. Device retirement and explicit
destruction are recorded separately.

## Boundaries before timing

The CPU/count/GPU page interfaces exist for developing the runner. They are not a
published benchmark, and setup durations collected with correctness instrumentation
are diagnostic values. GPU timing must cover every render/compute pass across all
frame encoders, with no skipped encoders. Counts, CPU submission, GPU duration and
presentation/cadence need separate passes and raw samples. A RAF callback interval
alone does not prove a physical frame was presented. Instrument correctness,
host-load checks, repeated measurement order, report generation and regression
budgets remain required before closing the performance work.

The original preflight exposed the PBR alpha bug fixed by
[decision 0210](../../spec/decisions/0210-pbr-colour-alpha.md). Both the built-in
material and generated lighting helper had overwritten opacity with one. The
corrected transparent comparison retains its original visual tolerance. Another
preflight supplied an XY particle mesh to the XZ billboard convention. The
corrected mesh and stronger contribution/instance/sample-region gates prevent a
large static floor from hiding a missing effect. Neither change relaxes a gate.

Protocol 2 adds the unchanged pinned Khronos WaterBottle as the central product.
The original GLB, provenance and upstream author/license metadata are in
`assets/WaterBottle/`. Both profiles retain all 2,549 vertices and 13,530 indices,
original tangents, images/material and the authored node rotation. Preparation
compares every packed vertex/index stream byte for byte with the original
accessors. The native reference hashes the actual received GLB before parsing it.
Projected product regions use its original bounds; the same-engine control
disables only normal-map strength and must produce a visible local difference.
The complete hardware matrix passes, including the unchanged product and its
normal-map control at both profiles. On SwiftShader, the eight non-product cases
pass, but the Three.js product normal-map visibility controls fail the unchanged
gate (zero low-profile pixels and three standard-profile pixels change by more
than eight channel values). The Mtek controls pass. The software matrix remains
failed; it is not accepted as complete product-comparison evidence.

`node benchmarks/material-lighting/diagnose-product-mips.mjs software .out/product-mips-software`
(or `hardware`) records native normal-texture mip hashes and channel statistics.
This diagnostic adds COPY_SRC to texture usage and is ineligible for performance
claims. Level-zero bytes and shader sources match between backends; generated
native mip bytes differ. This identifies a preprocessing difference, not proof
that it is the only cause of the visibility failure. The reference engine and
visibility gate have not been changed to obtain a pass. See the
[tangent integration](../../evidence/platform-step/tangent-progress.md).

The remaining scenes use deterministic procedural content. These cases do not
replace the varied asset corpus, streaming/long-session workloads, a second
maintained reference runtime beyond Three, or additional physical-device tiers.
Earlier protocol-1 candidates used `performanceEligible` to mean visual
prerequisites only. They contain no qualified performance measurement; current
reports state this boundary explicitly. Historical rejected tangent imports and
calibration records remain unchanged in their checkpoints.
