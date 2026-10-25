# Platform step implementation scorecard

Date: 2026-10-25. This records an implementation increment against the supplied
ten-item platform request. **The entire request is not complete.** Existing frozen
AI benchmark evidence was not modified or used as source examples.

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

## Request acceptance status

| Area | Status | Remaining work before the requested acceptance criteria are met |
|---|---|---|
| 1. Scalable skeletal animation | Partial | True crowd instancing/shared animation palettes, mounted-scene distance policy, complete matched rendering workloads with Three.js, p95 CPU/GPU/memory results across mesh complexities and hardware tiers. |
| 2. Composable/adaptable animation | Partial | Dedicated locomotion blend trees, orientation/joint-limit IK, arbitrary humanoid retargeting, production asset demonstrations, and full transition/root-motion combinations. Host APIs currently implement compatible-rig local transfer and bounded positional IK. |
| 3. Core rendering/materials | Partial | Shadow quality levels, normal/metallic/roughness/occlusion/emissive glTF channels, environment lighting, HDR effects and a matched material/lighting reference suite. |
| 4. Incremental adoption | Partial | Animation and content can be consumed independently and a real Three.js integration exists. A separately packaged external extension and published compatibility/release policy still need evidence. Custom render passes are currently LDR WGSL effects, not arbitrary access to renderer internals. |
| 5. Asset/content pipeline | Partial | Morphs, cubic splines, compression, compiler-integrated async scene streaming, LOD and a varied compatibility corpus. The new pool is an independent host capability; it does not change the strict GLB profile. |
| 6. Movement/spatial queries | Partial | Broader stairs/slope/platform/obstacle corpus, variable-rate movement tests and published operating ranges. CCD coverage remains case-specific; automatic moving-platform carry is not implemented. |
| 7. Browser/device contract | Partial | The CLI's Node version mismatch was fixed and existing hardware/SwiftShader browser coverage was exercised. No new real-device CI or mobile/integrated-GPU evidence was obtained. WebGPU remains required. |
| 8. Inspection/authoring | Partial | The integration demo includes skeleton overlays and pose CPU p95. A mounted scene inspector, collision/IK target overlays, transition timeline, resource diagnosis and end-to-end authoring workflows remain. |
| 9. Fair workload evidence | Pending | No claim of general superiority, no new complete rendering comparison, no second maintained baseline runtime and no long-session/hardware-tier scorecard. Correctness probes are not performance benchmarks. |
| 10. Language/compiler advantage | Pending | No new language syntax, compiler asset optimization, reproducible release process or human/AI productivity study was added. Existing token-efficiency claims gain no support from this increment. |

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
