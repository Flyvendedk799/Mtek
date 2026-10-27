# Material and lighting comparisons

This separate suite addresses platform scorecard areas 3 and 9. It leaves the
existing runtime/animation workload definitions and frozen evidence unchanged.
**Current state: desktop visual comparisons and a qualified measurement runner;
the complete performance run remains pending.**

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
visual correctness alone cannot qualify performance measurements.
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

The shared WebGPU counter instrument comes from the existing runtime harness.
Its format table now includes RG16Float and its logical texture storage includes
every mip, fixed array layers and shrinking 3D depth. Existing frozen animation
definitions and evidence are unchanged; old reported byte counts are not rewritten.
Separate lazy engine chunks keep the unused renderer out of a page; network
records assert that isolation. Both output paths explicitly use LDR buffers.
Setup retains metadata from the actual adapter creating each renderer device.
Every scene destroys its own device at disposal. Mtek's public
resource counters must also reach zero. Raw counter fields describe explicit
resource creates/destroys: residual object-byte counts after Three destroys its
device are not evidence of live GPU allocation. Device retirement and explicit
destruction are recorded separately.

## Measurement and report verification

Protocol 3 builds release packages and requires 240 accepted passes: ten cases,
two engines, four separate instruments and three counterbalanced repeats, with
120 warmup frames and 600 samples each. Setup durations collected with correctness
instrumentation are diagnostic values. CPU submission excludes GPU completion
waits; GPU timing covers every render/compute pass across all frame encoders and
is cross-checked against the independent counter pass. Logical GPU descriptor
bytes are reported; instrument-contaminated JS heap comparisons are excluded.

```powershell
node benchmarks/material-lighting/measure.mjs .out/material-preflight --preflight
node benchmarks/material-lighting/measure.mjs .out/material-run --visual=.out/material-hardware/hardware.json
node benchmarks/material-lighting/measure.mjs .out/material-run --resume
node benchmarks/material-lighting/report.mjs .out/material-run
node benchmarks/material-lighting/report.mjs .out/material-candidate --baseline=.out/material-run
```

The visual report must exercise the exact current protocol, harness and compiler
packages. A preflight uses eight product/low passes and cannot establish a
performance result. Resume preserves rejected/interrupted attempts and requires
identical measurement sources, source snapshots and built packages. A live run's
lock cannot be stolen. Noisy passes retain raw CPU/GPU observations and retry up
to three times per invocation; missing counters never imply an idle machine.

Presentation uses visible native canvases and pinned Intel PresentMon 2.6.0 ETW
displayed timestamps for one isolated browser GPU process and one unambiguous
swapchain. The portable tool is hash/signature verified; it installs no service
and stops only its uniquely named capture session. Existing ETW permission is
required (administrator or Performance Log Users); the runner changes no Windows
security settings. RAF is recorded separately. Clock uncertainty/drift, hidden
or clipped canvases, reported ETW loss, and disagreement with the same engine's
offscreen image reject the pass. OS display cadence does not establish per-frame
JavaScript latency or physical pixel scanout. Both engines use the same explicit
sRGB browser display profile, without changing the OS profile or fitting colours.
Three's readback path uses public `setOutputRenderTarget`, preserving the native
linear output buffer and colour-conversion pass. A plain `setRenderTarget`
previously bypassed that pass and produced different dark-channel quantization;
those rejected native/readback comparisons remain in their own attempts.

The report independently re-reads artifacts and source/package hashes, recomputes
qualification, verifies raw host observations and displayed cadence, and checks
complete pass coverage. Only complete qualified reports can establish or compare
regression budgets. Comparisons require the same measurement definition, assets,
reference version, physical CPU/GPU/driver, browser and protocol. A regression
exceeds both 15% and 0.02 ms for CPU/GPU, or 15% and 0.1 ms for cadence; logical
memory allows 1%, while draw/upload counts allow no increase. A complete hardware
timing report does not close the separately failed software product gate or the
wider-device/reference requirements.

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
The protocol-2 hardware matrix passes, including the unchanged product and its
normal-map control at both profiles. On SwiftShader, the eight non-product cases
pass, but the Three.js product normal-map visibility controls fail the unchanged
gate (zero low-profile pixels and three standard-profile pixels change by more
than eight channel values). The Mtek controls pass. The software matrix remains
failed; it is not accepted as complete product-comparison evidence.

At the 2026-10-27 pause checkpoint, the corrected native/output-target path has
exact product/low native/readback images in both engines and a passing RAF-only
negative control. It has not yet completed a fresh protocol-3 visual matrix or
the full 240-pass qualified performance run. The latest strict preflight retained
eight interference attempts with no accepted measurements. Earlier partial
preflights are diagnostic history, not published performance comparisons.

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
