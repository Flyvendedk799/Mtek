# Shadows and environment lighting

A [2026-10-27 comparison increment](material-lighting-2026-10-27/checkpoint.md)
fixes source-authored PBR opacity and passes five procedural material/lighting
calibration categories at two qualities on both desktop backends. The unchanged
textured-product import currently rejects authored tangents. That implementation,
qualified timings/presentation and regression budgets remain open; these passing
visual checks do not close full matched material acceptance.

2026-10-25. Implements the next rendering increment of the platform roadmap.
The full roadmap remains incomplete; see the [scorecard](scorecard.md).
The user reported a PC crash during the work. Saved changes and completed logs
survived reboot; no cause of the crash has been established. Subsequent checks
used at most two build/test workers, with one GPU worker.

## Delivered behavior

- Optional scene lighting ABI 1 in shader group 3, advertised by `shaders[].lighting`.
  Structured compiler IR emits ordinary and mapped PBR with directional shadow
  visibility and diffuse/specular image-based lighting. Old manifests remain valid.
- One directional-light shadow map, configurable fixed volume, depth/normal bias,
  512/1024/2048 resolution and 1/9/25 PCF taps. Visible opaque entities cast even
  outside the camera frustum, with skeletal deformation updated before casting.
- Copied linear HDR panoramas, Radiance RGBE decoding, energy-preserving diffuse
  SH integration, GPU GGX prefilter mips and a correlated Smith-GGX split-sum LUT.
  Intensity, yaw and quality controls; resources rebuilt on device recovery.
- Compiler texture/sampler reservations propagate through imported user functions.
  Runtime checks binding limits, directional-light names and input ranges.
- Shadow and colour passes share a frame encoder. Available GPU timestamps cover
  shadow-pass begin through colour-pass end; draw counters include shadow draws.
  Separate skinning/preprocessing submissions and post effects are outside that interval.
- Lossless coalescing of identical source-map intervals reduces metadata size.
  Exhaustive position lookup checks cover mixed spans, gaps, ties and a real shader.
- A standalone [lighting studio](../../examples/lighting-studio/README.md) with
  material/light controls, local HDR loading, quality selection and pause/resume.

## Retained evidence

The [final GPU report](scene-lighting/verified/test-results.json) records **64 passed,
0 failed, 0 not-run**: 32 RX 7900 XTX and 32 SwiftShader checks on the same Windows
computer. These are two adapters on one host, not independent physical-device tiers.
The run includes all shadow qualities, off-camera rigid and animated casters,
timestamp-enabled frames, resource-boundary shaders, input rejection, the actual
studio UI and local HDR controls, environment direction/yaw and roughness filtering,
an independent hemisphere-integration reference for constant IBL, identical device
recovery pixels, disposal and existing animation/material regressions.

Sanitized per-probe JSON is alongside the report. Studio PNGs are stored byte-for-byte
with [SHA-256 hashes](scene-lighting/verified/images.json). The earlier
[12-check report](scene-lighting/initial/test-results.json) is retained as historical
evidence; the final run supersedes it for the final shader and frame integration.

## Regression validation

[Successful command logs](scene-lighting/validation-runs.json) retain individual
completed runs; they do not claim one clean invocation of the entire workspace suite.

- Full runtime: 1,564 tests across 99 files. Full code generation: 1,953 tests
  across 16 files. Browser support units: 307 tests across 26 files.
- Compiler library: 906 tests. Affected integration targets: build 35, context 34,
  cold-start context 16, semantic/syntax fixture harness 23, inspection 7,
  manifest model 3, shader lowering 9 and standard-library schema 6.
  Final runs use ordinary assertions, without snapshot blessing.
- CLI integration: 41 tests. Release documentation units: 127; coverage units: 51. Generated release documentation validates
  260 registry features and 246 diagnostic codes. Coverage audit records 403
  combined features, 214 positive fixture programs and 246 diagnostic codes,
  with none missing a negative test or documented exception.
- Workspace format, Clippy, TypeScript, lint, naming, task/asset generation and
  embedded runtime provenance checks pass. No frozen AI evidence was changed.

The broader library run caught a stale assertion that exported shader maps must
retain the original entry count. It now checks source lookup at every position
of a real emitted shader, as well as asserting compaction. Clippy also caught a
collapsible conditional. Both were fixed before the successful final runs.

All eleven existing folder/zip budgets pass unchanged. The
[package record](scene-lighting/package-sizes.json) preserves the measured sizes;
the minified runtime is 693,856 bytes. No budget or pixel tolerance was increased.

## Scope and reproduction

See [decision 0195](../../spec/decisions/0195-shadows-and-environment-lighting.md)
for coordinates, formats, input limits, host options and supported resource limits.
After building, the final GPU selection can be reproduced with:

```sh
npm run test -w @mtek/browser-tests -- specs/m4/scene-lighting.spec.ts specs/animation/rendering.spec.ts specs/m4/configurator-variants.spec.ts specs/m4/pbr-maps.spec.ts specs/m4/pbr.spec.ts --project=hardware --project=software
```

Output remains LDR. Cascaded/point shadows, HDR display/post effects, authored
tangent compatibility, matched-engine visual/performance comparisons and the
other roadmap areas remain. Correctness probes establish neither speed nor
visual parity with an external renderer. Serialize CLI rebuilds and CLI consumers
on Windows to avoid executable replacement locks.
