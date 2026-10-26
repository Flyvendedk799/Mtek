# Platform step implementation scorecard

Date: 2026-10-26. This records an implementation increment against the supplied
ten-item platform request. **The entire request is not complete.** Existing frozen
AI benchmark evidence was not modified or used as source examples.

A [second rendering increment is validated](rendering-channels-progress.md):
core glTF material maps, mip-aware sampling and lossless metadata compaction.
Its separate record includes 42 passing hardware/software GPU checks and package
budgets. The historical checks below describe the preceding committed increment.

A [third rendering increment](lighting-progress.md) adds directional shadow
quality levels and HDR environment lighting, validated by 64 hardware/software
GPU checks. It includes a standalone lighting studio and preserves all eleven
existing example package budgets.

An [animation increment](animation-progress.md) adds synchronized locomotion, mounted
distance policies, orientation/hinge IK, explicit retarget frames and shared-pose
crowd instancing. Its final GPU run passes 40 hardware/software checks.

A [matched animation/character increment](matched-animation-progress.md) adds two
pinned authored assets, a textured clip demo and a complete 210-pass comparison
against Three.js WebGPU. Correctness gates pass; the report records higher Mtek
CPU/GPU time and GPU buffer use, with lower JS heap in these workloads. CPU noise
waits/retries without relaxing the measurement limits.

An [external inspector/SDK increment](inspector-progress.md) adds a separately
packaged optional panel, transform history, animation inspection and local-tarball
compatibility evidence. Eleven focused tests and GPU-disabled DOM checks pass.
Its real studio rendering check and animation performance optimization are
**deferred while the user is doing CPU/GPU-heavy work**, not cancelled.

## Delivered behavior

- GPU skeletal deformation, shared immutable geometry/influences, palette-only
  animated uploads, conservative animated bounds, and deformation after culling.
- Independent animation controller with explicit pose throttling, ordered masks,
  override/additive layers, procedural overrides, bounded positional IK, base
  translation root-motion ownership and validated compatible-rig retargeting.
- A working [Three.js integration](../../examples/incremental-animation/README.md)
  demonstrating upper-body actions, feet on different heights, two hand grips,
  different proportions, pose throttling and skeleton overlays.
- Extension API 1, lifecycle rollback/disposal, frame-hook isolation, copied scene
  snapshots and validated batched transform updates, plus supplied host services.
- An independent asynchronous asset pool with custom loader API 1, shared leases,
  streaming progress, cancellation, origin capabilities, integrity checks and
  deterministic resource release.
- Linear-light asset mipmaps, including NPOT edges, additive material selection,
  and ordered custom WGSL LDR post effects with bounded scratch resources.
- Optional adapter shape sweeps, collision filtering, character movement queries,
  contact inspection and opt-in CCD for dynamic bodies through the mounted host.
- Correct Node type-stripping version boundaries in the CLI runner/npm engine range,
  and editor highlighting synchronized with the existing animation namespace.

An [asset-audit increment](asset-audit-progress.md) adds a 16-input pinned corpus,
separate import/use reporting and retained compiler diagnostics. Its 26 serial
checks match their expected outcomes and 11 focused tests pass without Cargo/GPU
work. Expected rejections are not compatibility successes.

## Explicit shader-authoring track

[Mtek-authored vertex and compute shaders](shader-authoring-plan.md) are now an
explicit required workstream, added at the user's request on 2026-10-26. A [first vertex increment](shader-authoring-progress.md) implements authored
local-position functions, vertex-visible resources, conservative culling,
instancing and matching directional shadows. A [structured-output increment](shader-authoring-structured-progress.md) adds normal/UV outputs and typed varying payloads with location/interpolation checks.
An [authored-bounds increment](shader-authoring-bounds-progress.md) adds bindable final local spheres, culling/sorting and copied inspection. A [production-character increment](shader-authoring-characters-progress.md) validates bounded skin/deformation/shadow/recovery cases against CPU-skinned references and preserves original mixed-filter samplers. World-space overlays, combined authored shared-pose instancing, broader animation compositions and wider physical-device evidence remain; source compute still awaits acceptance (`E4901`). The plan
retains compute resources/dispatch, lifecycle/recovery and full validation.
Runtime-internal compute and host WGSL effects do not satisfy this requirement.
A [compute-backend increment](shader-authoring-compute-progress.md) adds typed
entries/builtins, explicit storage access and independently checked memory
layouts. Source declarations/resources/kernels now parse and type-check, with GPU
effects and bounded workgroups. E4901 still blocks runnable packaging; kernel
lowering, manifest/runtime dispatch, lifecycle and end-to-end evidence remain required.
Heavy compiler/GPU validation remains deferred during the user's heavy work.
An [additional compute lowering/editor checkpoint](shader-authoring/compute-lowering-2026-10-26/checkpoint.md)
connects checked declarations to typed IR and Naga-validated kernel WGSL, while
retaining the public E4901 packaging gate. Editor continuation indentation now
passes the formatter corpus, 81 unit tests and 11 real VS Code integration tests.
Compute GPU acceptance and the compute-to-render path remain unfinished.
An [artifact/resource-owner increment](shader-authoring/compute-ownership-2026-10-26/checkpoint.md)
adds validated compute artifacts with separately content-addressed maps, shared
compiler/runtime layouts, and internal owners for upload/dispatch/readback,
replacement, cancellation and device recovery. A subsequent
[packaging/mounted increment](shader-authoring/compute-packaging-2026-10-26/checkpoint.md)
connects manifest/schema packaging, generated source-default writers, inspection,
public host handles, shader loading, replacement and device recovery. All eleven
example package budgets hold without raising limits. Ordinary source analysis
still emits E4901 until numerical GPU/render acceptance; CPU fake checks do not
establish it. The planner packaging guard is removed.

## Request acceptance status

| Area | Status | Remaining work before the requested acceptance criteria are met |
|---|---|---|
| 1. Scalable skeletal animation | Implemented + measured on one desktop | GPU skinning, animated culling, shared-pose cohorts and distance policies are implemented. The requested 1/10/50 independent-character comparison at two mesh complexities now has complete p95 CPU/GPU/upload/memory and correctness evidence. Mtek costs more CPU/GPU time and GPU buffers in these unlit workloads; independent-crowd optimization remains planned but deferred during the user’s CPU/GPU-heavy work; wider hardware evidence remains. |
| 2. Composable/adaptable animation | Partial | Synchronized 1D locomotion, orientation targets, hinge limits and explicit local/world-frame retargeting are implemented. Two authored-character clip demonstrations now exist; broader authored-rig combinations of transitions, root motion and constraints still need evidence. General 2D blend spaces, anatomical constraints and automatic humanoid mapping are possible extensions beyond the original compatible-rig workflow. |
| 3. Core rendering/materials | Partial | Core glTF texture channels, mip-aware sampling, directional shadow quality levels and HDR environment lighting are implemented and tested. Authored position/normal/UV results and typed varying payloads are implemented. Authored finite spheres now drive culling and sorting. Original Fox/CesiumMan skin/deformation/shadow cases now match CPU references; imported mixed min/mag samplers are preserved. Combined authored shared-pose instancing, broader animation compositions, bound overlays, wider physical-device evidence and Mtek-authored compute remain in the shader-authoring track. HDR display/effects, cascaded/point shadows, authored tangent compatibility and a matched material/lighting reference suite remain. |
| 4. Incremental adoption | API/package proof delivered; rendering check deferred | Animation/content APIs and the Three.js integration exist. The optional inspector is separately packaged, installed and strictly type-checked without source aliases, with mounted lifecycle/version tests and a documented compatibility policy. Its opt-in lighting-studio rendering check is deferred. Packages remain private development snapshots; stable release/external adoption evidence remains. |
| 5. Asset/content pipeline | Partial | A pinned 16-input compatibility corpus and serial audit tool now separate declaration import from named mesh/material/clip use; the original 26 checks matched expected outcomes. A subsequent [30-check run](shader-authoring/characters-2026-10-26/asset-audit/report.md) now accepts original CesiumMan mesh/material/clip use and mixed min/mag filters, retaining the original provenance. Morphs, cubic-spline playback, compression, compiler-integrated async scene streaming, LOD, unloading/plateau evidence and a broader production corpus remain. The independent pool does not change the strict GLB profile. |
| 6. Movement/spatial queries | Partial | Broader stairs/slope/platform/obstacle corpus, variable-rate movement tests and published operating ranges. CCD coverage remains case-specific; automatic moving-platform carry is not implemented. |
| 7. Browser/device contract | Partial | The CLI's Node version mismatch was fixed and existing hardware/SwiftShader browser coverage was exercised. No new real-device CI or mobile/integrated-GPU evidence was obtained. WebGPU remains required. |
| 8. Inspection/authoring | Partial | An optional public-API inspector now supports selection, local transform edits/history, animation scrubbing, mesh-local joints and optional host metrics; fake-GPU mounted and GPU-disabled DOM checks pass. Its real studio check is deferred. World-space IK/collision overlays, transition/layer diagnosis, resource provenance/history, persistent authored IDs and end-to-end workflows remain. |
| 9. Fair workload evidence | Partial | A frozen animation-only comparison against pinned Three.js now retains 210 accepted passes, three-repeat p95s, live memory, rejected attempts and visual gates on one desktop. It shows current costs as well as smaller JS heap. Matched material/lighting, streaming and long-session workloads, regression budgets, a second maintained runtime, presented-frame measurements and other hardware tiers remain. No general superiority claim follows. |
| 10. Language/compiler advantage | Partial; shader-authoring in progress | Mtek source now authors position/normal/UV vertex functions and typed fragment payloads, with GPU effects, source mapping, inspected interpolation/locations and matched transform-reference checks. Authored finite bounds and copied inspection are implemented; sampled production-character skin/deformation/recovery cases now match CPU references. Combined authored shared-pose instancing, broader animation compositions, bound overlays, wider physical-device evidence and compute resources/dispatch remain required work, alongside compiler asset optimization, reproducible release process and human/AI productivity evidence. Existing token-efficiency claims gain no support from these increments. |

## Reproducible checks

Unit coverage lives beside the implementation in `packages/runtime-web/src/` and
`packages/physics-rapier/src/queries.test.ts`. Hardware arithmetic/pixel probes are:

```
npm run build
npm run test -w @mtek/browser-tests -- specs/animation --project=hardware
npm run test -w @mtek/browser-tests -- specs/m5/physics-tunnelling.spec.ts --project=hardware
```

The GPU deformation matrix covers 1, 10 and 50 independent actors with 63 and 1025
vertices (both exercise partial workgroups), compares position/normal readback
against CPU inverse-transpose skinning, asserts exactly actors × joints × 64 bytes
per palette update, and verifies zero retained tracked resources. These are
synthetic correctness/transfer checks, not character-quality or timing benchmarks.

Hardware probes ran on Windows 11, Chromium 153.0.8010.12, AMD Radeon RX 7900 XTX,
with no fallback adapter: [environment](rx7900xtx/environment.json). SwiftShader
ran on the same host: [software environment](rx7900xtx/software-environment.json).
These are not separate physical-device tiers. New runs used Node 22.23.2.

Sanitized records preserve numbers, statuses and timestamps:

PNG attachments from the broader run are stored byte-for-byte in
[`rx7900xtx/attachments/`](rx7900xtx/attachments/manifest.json), with SHA-256 hashes;
the report references these files instead of embedding their base64 bodies.

- [Initial targeted checks](rx7900xtx/tests.json): 10 passed, 0 failed, 0 NOT-RUN.
- [Broader browser run](rx7900xtx/full-regression-before-node-fix.json): 504 passed,
  21 failed, 15 intentionally skipped. All 21 failures came from the CLI's old
  Node-24-only gate; no renderer test failed. The failure record is retained.
- [CLI cases after the version fix](rx7900xtx/cli-regression-after-node-fix.json):
  23 passed, 0 failed, 15 intentionally skipped. This reruns every prior failure.
- [Graphics after the layered-transition fix](rx7900xtx/graphics-after-continuity-fix.json):
  16 passed, 0 failed, 0 NOT-RUN across hardware and SwiftShader. This includes
  post-effect device recovery, disposal and invalid-WGSL rejection.
- [CCD lane data](rx7900xtx/ccd-lanes.json) preserves the moving-plate limitation.
  In particular D06 (x=3.065 m, 9 m/s) still passes the plate with mounted all-body
  CCD enabled. The isolated adapter regression at 240 m/s passes, so the results
  do not establish a general tunnelling fix.

The complete Rust workspace suite passed, including 43,183 grammar-conformance
inputs and the backend smoke test. Subsequent runner-version and prerequisite
tests, embedded-runtime/provenance tests and Clippy passed. The final runtime
unit run passed 1,554 tests; the physics adapter passed 81. Editor tests passed
79 and release-documentation tests 127. One parallel type-checking test hit its
old 5-second timeout; its isolated rerun passed, its integration timeout was made
explicit, and the complete runtime suite then passed with four workers.

Build, TypeScript, lint, generated release documentation, feature coverage,
asset generation, baseline consistency and package budgets were checked. The
embedded runtime was regenerated and checked byte-for-byte against the built files.
The minified runtime grew by 34,007 bytes and declarations by 6,095 bytes versus
the previous embedded files. Non-physics package limits were increased by a fixed
40,000 bytes for this feature cost, retaining approximately their existing margin;
physics-playground's limit was not increased. This is a cost, not an optimization.

The standalone integration was opened in Chromium, all controls were exercised
and a screenshot inspected. No browser page errors were observed. The demo's live
p95 display measures only its pose CPU work and is not a matched-engine result.

![Independent animation integration](incremental-animation.png)
