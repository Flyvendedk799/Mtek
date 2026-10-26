# Authored vertex deformation on production characters

Date: 2026-10-26. Areas 3, 5 and 10 of the [scorecard](scorecard.md).
The [shader-authoring plan](shader-authoring-plan.md) and full platform roadmap
remain in progress. Animation optimization and sustained CPU/GPU performance
measurements remain deferred; this increment uses small correctness targets.

## Delivered behavior and import fix

The [character example](../../examples/vertex-deformation/characters/README.md)
combines GPU skinning with authored position/normal/UV results, a typed fragment
payload, textures, finite bounds and directional shadows. It reuses the original
pinned Fox (1,728 vertices, 24 joints) and CesiumMan (3,273 vertices, 19 joints)
assets. Preparation checks their original hashes before making ignored local
copies. Original GLBs, licenses and frozen animation benchmark sources remain
unchanged. The CPU reference uses the same sampled palette with CPU linear-blend
skinning, then renders static positions/normals through ordinary object transforms.
Its visible reference characters execute no GPU skinning or authored vertex stage.

Fox has no authored normals and is textured/unlit. CesiumMan exercises lit normal
deformation, including inverse stretch after skinning. The example does not invent
missing normals. UV remapping and a smooth mask payload affect both characters.

The original CesiumMan import exposed a sampler limitation: its magnification and
minification filters differ. Mtek now preserves independent specified filters,
including all six minification/mip choices and both supported address modes.
The compiler, strict manifest schema and runtime agree on twelve additional
internal resource names. Existing source sampler constructors are unchanged.
Mirrored repeat and differing U/V modes remain unsupported.
[Decision 0200](../../spec/decisions/0200-independent-gltf-sampler-filters.md)
records this contract. A byte-identical mixed-filter fixture is promoted from
rejection to positive material use.

## Rendered evidence

Each backend passes 32 authored-character cases: Fox's Survey/Walk/Run and
CesiumMan's animation_0, two paused times, two positive stretch settings and
shadows off/on. Each image is compared independently with an ordinary-transform
GPU-skinned reference and a CPU-skinned static-mesh reference. All comparisons
have **zero maximum pixel error**. Two additional native-material cases per
backend render CesiumMan through its original imported Pbr material and sampler,
again matching the CPU-skinned reference exactly.

The matrix also proves:

- Animation changes at least 146 pixels for Fox and 314 for CesiumMan in the
  recorded per-character pose comparisons. Shadows change at least 58 pixels
  in every shadowed authored case.
- Every sampled final CPU vertex lies inside its authored local sphere; the
  largest observed distance/radius ratio is below 0.498. This is sampled evidence,
  not a proof for every possible pose or material input.
- Sixteen bounds transitions per backend exercise exits/reentries with unchanged
  object transforms and conservative radius-zero fallback.
- Four device recoveries per backend preserve identical frames with nondefault
  deformation/position inputs and paused animated poses.
- Twelve replacements per backend reproduce the reference after explicitly
  reselecting a paused pose. Animation-controller migration is not claimed.
  Three cycles include one warm-up and two observed resource counts; the latter
  stay stable. Disposal returns all tracked live GPU resources/listeners to zero.

There are **132 character/lifecycle cases across the two backends**. Another
**72 mixed-sampler comparisons** match explicit WebGPU descriptors exactly at
2-, 3- and 17-pixel targets. Eight control draws prove both minification and
magnification affect the image: changing the filter changes 9 and 289 pixels,
respectively. Sampler probe devices and their owned buffers/textures are disposed.

Accepted [hardware](shader-authoring/characters-2026-10-26/verified-native/hardware.json)
and [software](shader-authoring/characters-2026-10-26/verified-native/software.json)
records retain palettes' hashes, source/output hashes, manifests, numeric image
gates, bounds, counters and diagnostics. Earlier passing runs are retained as
the verifier gained shadow/sampler/native-material gates. The final records use
one Radeon RX 7900 XTX desktop and SwiftShader on that same host, Chromium
153.0.8010.12. They do not establish another physical-device tier or performance
superiority. Main image targets are 97-by-97 with no animation-frame loop.

## Other validation

- 919 compiler unit tests and 111 integration checks across assets, package build,
  semantic fixtures and registry/schema suites pass. Existing generated goldens
  remain compatible. Compiler/CLI Clippy passes.
- 196 focused runtime/ABI/asset/declaration tests and all 11 asset-audit unit tests
  pass. TypeScript and workspace lint pass; the browser probes have a separate
  strict TypeScript configuration.
- The refreshed [16-input asset audit](shader-authoring/characters-2026-10-26/asset-audit/report.md)
  passes all 30 expected checks. Original CesiumMan now passes declaration,
  mesh, material and clip use; the mixed-filter fixture passes import/material use.
  Expected rejections elsewhere remain rejections. The audit alone makes no
  rendered-compatibility claim; the separate character records supply that scope.
- Asset generation consistency, formatting, diff checks and embedded-runtime
  consistency pass. Compiler jobs/test threads are capped at two and Vitest uses
  one worker. The asset audit uses an existing compiler serially.

All eleven existing example package budgets pass with unchanged limits. Each
folder grows 3,868 bytes against the preceding bounds increment. Generated
coverage passes with 404 features, 219 positive fixture programs and 247 diagnostic
codes; release-documentation comparisons pass. Original model/license hashes and
all retained example source/output hashes match their records.
[Validation](shader-authoring/characters-2026-10-26/validation.json),
[package sizes](shader-authoring/characters-2026-10-26/budgets.json) and
[binding inspection](shader-authoring/characters-2026-10-26/inspect-bindings.json)
retain the remaining details.

## Remaining scope

Combined authored shared-pose instancing, broader production animation
compositions (layers/transitions/root motion/constraints), world-space bounds
overlays and wider physical devices remain. These checks sample one view and a
bounded set of poses/stretch inputs. They are not whole-rig productivity evidence,
long-session unloading evidence or a matched external-engine rendering benchmark.

**Mtek-authored compute is still unimplemented (`E4901`).** Its resource/dispatch,
workgroup/synchronization/lifetime contract, implementation, examples and full
validation remain required. All other open scorecard work is retained.
