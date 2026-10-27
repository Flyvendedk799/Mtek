# Authored tangent integration

2026-10-27. Required for the unchanged textured-product workload in scorecard
areas 3 and 9. **Authored tangent integration is implemented. The full comparison
protocol remains open.** The implementation preserves original packed tangent
bytes, renders static/skinned mapped PBR, exposes vertex/surface fields, and
handles authored replacements, instances and missing-frame fallback. Historical
E7009 records remain unchanged; WaterBottle has not been stripped or converted.

The [integration checkpoint](tangent-integration-2026-10-27/checkpoint.md) records
32 focused hardware/software checks (including all shadow qualities), 114 broader
rendering/animation checks, 18 current compute checks and 1,672 runtime units.
All eleven package budgets hold. Diagnostics/context/LSP/schema/release/coverage
are aligned; the asset audit now pins 21 inputs and passes all 38 expected checks.

The unchanged WaterBottle passes the complete hardware material matrix at both
profiles, including original vertex/index bytes, textures, node rotation and
visible normal-map controls. The software matrix passes its eight other cases,
but the native Three product control fails the unchanged visibility gate at both
profiles. Mtek's product controls pass. Readback diagnostics show identical source
image/shader bytes and different native generated mip bytes across backends;
this does not establish the only cause. That comparison gate remains open,
alongside qualified CPU/GPU/count/presentation measurements and regression budgets.

The [deformation foundation](tangent-deformation-2026-10-27/checkpoint.md)
implements optional CPU/GPU tangent-frame skinning with linear tangent transforms,
inverse-transpose normals, re-orthogonalization, reflected handedness and an
explicit unavailable-frame sentinel. It passes independent numerical and
ownership checks on both desktop backends. This is internal data-path evidence.

Delivered integration scope (complete platform acceptance is not claimed):

- Validate and pack original FLOAT/VEC4 tangents with position/normal/UV data;
  preserve handedness and source bytes. Extend manifest/schema/runtime checks
  without invalidating old packages or accepting malformed attribute regions.
- Add the stream to static/skinned meshes, including CPU fallback, source sharing,
  pose cohorts, buffer lifetime and recovery. Avoid tangent work for consumers
  that need only position/normal output. Explicitly account for fallback storage.
- Add source vertex/surface tangent fields and structured authored tangent output.
  Reserve locations without colliding with instance matrices or typed payloads.
  Existing authored deformations without a replacement frame need an explicit
  derivative fallback rather than an incorrect retained original frame.
- Transform model/instance tangent frames correctly under nonuniform/reflected
  transforms; use the authored frame for mapped PBR and the derivative frame when
  unavailable. Preserve source alpha and normal-map scale/colour-space behavior.
- Check static/skinned/mirrored UV, authored deformation, instancing, shadows,
  culling, device recovery and disposal against independent render references.
  Align context, LSP, coverage, diagnostics, documentation and package budgets.
- Import and render the unchanged pinned WaterBottle in both material comparison
  engines, verify model/material identity and visible map contributions, then
  complete qualified CPU/GPU/count/presentation measurements and regression
  budgets. The current software native-reference control remains failed, and
  those measurements remain open. Procedural calibration alone does not satisfy
  product acceptance.

The full platform roadmap remains open beyond these items. This list does not
replace the other scorecard requirements.
