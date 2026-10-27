# Authored deformation with production-character pose cohorts

Date: 2026-10-27. Continues the shader track and areas 1, 2, 3 and 10 of the
[platform scorecard](../../scorecard.md). The full roadmap remains open.

## Delivered example and composition

The [cohort example](../../../../examples/vertex-deformation/cohorts/README.md)
compiles through ordinary Mtek source analysis and spawns single-entity Fox or
CesiumMan prefabs. The host uses public extension API 1 to assign independently
sampled poses or explicitly shared groups. Each actor retains its own transform
and authored final-local sphere. Authored stages stretch positions, remap UVs,
pass a typed mask and, for lit CesiumMan, apply inverse-stretch normals. Fox
retains its original lack of authored normals and uses a textured unlit material.

The live demo controls asset, 1/10/50 actors, pose groups, shared/independent
animation, proportions, authored/transform-reference rendering, shadow quality
and pause. Rebuild/disposal uses the public mounted host. Its status reports
observed draws; it is not a frame-time benchmark. Nested prefab assemblies are
still static-only. This increment does not extend the spawn language contract.

The existing runtime already supported this composition. No compiler/runtime
implementation or bundle change was required. The new proof closes the explicit
authored shared-pose instancing gap without treating it as a separate future API.

## Independent correctness evidence

The [validation index](validation.json) retains hashes, raw numeric reports,
environment/adapter details, rejected/intermediate attempts and byte-identical
PNGs. Accepted reports are [hardware](accepted/hardware.json) and
[software](accepted/software.json). Radeon RX 7900 XTX and SwiftShader run on the
same PC, so these are two backends, not two physical-device tiers.

Each backend passes 12 matrix cases: both original assets × populations 1/10/50
with 1/1/5 distinct sampled pose groups × shadows off/on. Each compares:

- Independent players and individual authored draws.
- Shared poses with individual authored draws and with instanced authored draws.
- Ordinary object stretching with fragment-only reference materials.
- Independently CPU-skinned, fragment-only reference geometry for each pose group.

The CPU reference reads the sampled palettes and original immutable vertex data,
never GPU-skinned output. It bakes each pose into a separate content-addressed
mesh, then routes the compiled scene's ordinary reference spawns to those meshes.
Positions/counts and material initialization still come from source. Reference
culling is disabled, so source spheres do not determine reference visibility.

All authored shared/independent and partial-culling comparisons have zero maximum
pixel error on both backends. Hardware CPU references also have zero maximum
error; SwiftShader's largest CPU-reference difference is one 8-bit colour step.
Every case passes the existing two-step per-channel tolerance, with no pixel over
that limit. The tolerance was present before these measurements and was not relaxed.

Palette hashes prove that the five groups are distinct. CPU positions after the
authored stretch fit their actual declared spheres. Character pixels differ from
a floor-only control (25–3,911 pixels in the hardware cases), preventing empty-scene
successes. Moving every third actor outside the camera culls 1/4/17 actors for
the three populations and matches independent rendering exactly. Original
transforms are restored before lifecycle checks.

At 50 actors/five groups, colour draws decrease from 51 to six including the floor.
With shadows, total draws decrease from 102 to 57. The shadow pass still submits
individual casters; this proves matching shadows, not shadow instancing or a
whole-frame performance improvement.

Four lifecycle cases per backend (both assets, shadows off/on) repeat held-pose
detach/rejoin four times, require one extra colour draw while detached, exact
pixels after rejoin, stable resource counts and exact device-recovery pixels.
Host grouping/pose is explicitly reapplied to reconstructed players. All five
capture variants return all seven tracked ownership categories to zero at disposal.

The actual demo confirms 50 actors use five player objects when shared and 50
when independent. Population/group/asset controls, pause, reference rebuild,
identity proportions and shadows-off run without page errors. The initial and
final UI mounts dispose with zero ownership counters. Both accepted demo
screenshots were visually reviewed; the character groups and shadows are visible.

## Retained failures and checks

The first HTTP helper sent success headers before awaiting a file read; its error
handler then raised ERR_HTTP_HEADERS_SENT. Its initially empty report and failure
description remain under `rejected/http-harness/`. The server now reads first.
The next CPU-reference helper used an invalid mesh ID; strict manifest validation
rejected it with E8006. Reference IDs now follow the unchanged `mesh:<number>`
contract. These are harness failures, not accepted renderer results.

Two demo attempts retained under `rejected/` called manual debug stepping on a
normal-clock mount. The demo now lets the host frame loop initialize the crowd
and pauses after grouping is ready. The earlier GPU-only and intermediate passing
runs remain separate from the accepted final source/provenance runs. An initial
type-aware lint check also found three redundant assertions, unsafe Reflect return
typing and array interpolation in an error string; these are corrected. Final
TypeScript and type-aware ESLint pass.

Ordinary CLI check, canonical formatting, test packaging and release packaging
pass with zero source errors/warnings. The pinned GBNF validator accepts the actual
source. Coverage and generated release-document audits pass. This adds an example
to those audits, without adding language capabilities or diagnostic exceptions.

All five prebuilt artifacts plus provenance remain byte-identical to the preceding
[inspection validation](../../inspection-2026-10-27/validation.json), and the
against-dist check passes. The earlier eleven package budget results remain
associated with those same runtime bytes. Broad Rust/runtime suites were not
rerun for this example/reference-only increment; the preceding checkpoint retains
their complete results. Frozen animation definitions remain
`0897d7e5d5e7aa19ccf6cd49faf640e4001762b10faa9baa24e2db23590d0c6a`,
and original assets and the frozen AI archive are unchanged.

Broader authored-rig animation compositions, other physical-device tiers and the
rest of the platform roadmap remain open. This bounded cohort proof does not
establish arbitrary crowd animation, all rigs/poses or comparative performance.
