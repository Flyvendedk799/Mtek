# Rendering channels increment — validation record

Date: 2026-10-25. Base commit: `14a46eec`. This is the second implementation
increment against the supplied platform request. The entire roadmap remains
incomplete; its outstanding acceptance criteria are in [the scorecard](scorecard.md).
The user's testing pause ended before the final checks below.

## Delivered behavior

- Core glTF metallic-roughness, normal, occlusion and emissive maps, their sampler
  choices and factors, through validation, typed material access, packaging and GPU
  shading. Imported materials retain the concrete `Pbr` schema for named writes.
- Base-colour/emissive images use sRGB decoding; MR/normal/AO use linear data.
  Packaging deduplicates image content within a colour space. MR reads blue/green,
  AO reads red and affects ambient light only; emission precedes exposure.
- Derivative normal frames handle regular, mirrored and degenerate UVs. This is
  not authored MikkTSpace parity; authored tangents are still rejected.
- `sample_mip` makes runtime-generated mip chains effective in material draws.
  Existing `sample` still reads level zero. Twelve sampler presets represent
  base-only and nearest/linear mip filtering. GLB non-mip filters remain base-only.
- `E4042` rejects derivative calls outside a fragment's initial straight-line
  prefix. This conservative rule deliberately rejects some uniform programs.
- `Pbr` retains its original parameters and adds four map/sampler pairs and three
  values. The combined material resource limit is sixteen, with a diagnostic at
  the seventeenth. Hand-authored normal maps require an explicit `normal_scale`;
  imported maps use their file scale, default one.
- Compact starter JSON preserves the complete API in the existing 30,000-byte
  budget, including the required 1,000-byte allowance for project symbols.
  Smaller budgets retain the existing ordered, explicit truncation behavior.
- Compact release/preview manifest and WGSL map JSON preserves all diagnostic
  values and source mappings. Development/test metadata stays readable. All
  eleven existing example package budgets pass without raising any limit.

Contract and limitations: [decision 0194](../../spec/decisions/0194-gltf-material-channels.md).
Generated language documentation, highlighting, schemas and snapshots are updated.

## GPU evidence

The [final report](rendering-channels/final/test-results.json) records **42 passed,
zero failed, zero not-run**: twenty-one hardware and twenty-one software checks.
[Hardware environment](rendering-channels/final/environment-hardware.json): Windows
11, Chromium 153.0.8010.12, AMD RX 7900 XTX, no fallback adapter.
[Software environment](rendering-channels/final/environment-software.json):
SwiftShader on the same computer. These are not separate physical-device tiers.

The final run covers imported channels against an independent f64 BRDF oracle,
regular/mirrored/degenerate UVs, factor writes, colour-space handling, indirect-only
occlusion, minified mip selection versus base-only sampling, existing PBR cases,
device recovery and disposal. Pixel tolerance is at most 3/255. Recovery requires
identical full images and zero retained tracked resources/listeners after dispose.
Per-project pixel and recovery records are alongside the final report.

An initial run found a real derivative-frame orientation error: regular and
mirrored normal maps were reversed under WebGPU's screen orientation. Its
[36-pass/4-fail report](rendering-channels/before-normal-orientation-fix.json) is
retained. The corrected [40-check run](rendering-channels/verified/test-results.json)
and [8-check lifecycle run](rendering-channels/lifecycle/test-results.json) passed
before the final combined rerun. All records are sanitized without changing
numbers, statuses or timestamps.

The final GPU run follows the final shader source edit. Production JSON compaction
was added afterwards; it changes whitespace only, with parsed production/development
metadata equality, package schema and code-generation checks. Shader bytes are
unchanged by that packaging optimization.

## Regression validation

The [final command logs](rendering-channels/validation-runs.json) retain successful
checks without machine-specific paths. These are individual runs and focused reruns, not a claim of one clean full-suite
invocation. The broad Rust run passed grammar conformance on 44,163 inputs and the
backend smoke test, but initially failed three targets. Their causes and resolutions:

- Compiler build snapshots: updated for the expanded standard material. The final
  build target passes 35 tests, including package reproducibility across the fixture
  corpus, manifest schema checks and lossless metadata compaction.
- Starter context: the full reference exceeded its byte budget. Compact JSON fixes
  the actual overflow. All 16 cold-start tests pass, checking every field/signature,
  the project allowance, deterministic output and truncation, plus a new lossless
  serialization check. The ordinary context target passes 34 tests.
- CLI output comparison: refreshed expected compiler output; all 41 CLI tests pass.

Other checks:

- Assets 19, inspection 7, IR goldens 6, shader lowering 9, manifest model 3,
  registry schema 6; semantic/syntax fixture harness 23. Registry tests passed 25.
- Runtime units 1,554 and physics units 81 passed in the broad JavaScript run.
  Editor units now pass all 79 after splitting an emissive expression to preserve
  canonical indentation. Focused browser asset/profile units pass 29.
- The four previously failed/blocked codegen suites pass 89 tests after serializing
  builds on Windows. After production compaction, `app.test.ts` passes all 81.
- Coverage units pass 51, release documentation units 127. Documentation generation
  validates 260 registry features and 246 diagnostics. The coverage audit records
  403 combined features, 207 positive fixtures and 246 diagnostics, with none
  missing a negative test or a documented exception. These feature counts use
  different definitions and must not be substituted for each other.
- Workspace TypeScript, Rust formatting/Clippy, lint, naming, task/asset generation,
  stored baseline consistency and embedded-runtime provenance were checked.

The original parallel broad run also hit Windows executable locking while CLI
consumers and rebuilds overlapped. Focused reruns serialize those operations.
No test expectation, shader oracle tolerance or package budget was relaxed to
accept a failed runtime result.

## Package cost

The minified runtime grows by 2,076 bytes versus the preceding embedded bundle.
[Measured package sizes](rendering-channels/package-sizes.json) compare the same
mapped-material feature set before/after compact production metadata, rather than
claiming a comparison with the base commit. Whitespace removal saves 13,211 to
122,643 folder bytes across the eleven examples; their existing folder and zip
budgets all hold. Source maps, symbols and diagnostics are retained.

## Remaining roadmap scope

Shadows, environment lighting, HDR, authored tangent compatibility, a broader
material/lighting reference corpus and matched-engine performance/visual comparisons
remain. GPU correctness probes establish neither speed nor visual parity with a
maintained external renderer. Other gaps across animation, content streaming,
movement, real-device coverage, authoring and productivity studies remain in the
[platform scorecard](scorecard.md).
