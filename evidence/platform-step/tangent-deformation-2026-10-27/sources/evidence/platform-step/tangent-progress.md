# Authored tangent integration

2026-10-27. Required for the unchanged textured-product workload in scorecard
areas 3 and 9. **Still incomplete: public import, material shading and product
acceptance are not delivered.** The unchanged WaterBottle preflight remains an
E7009 rejection; the asset is not stripped or relabelled as compatible.

The [deformation foundation](tangent-deformation-2026-10-27/checkpoint.md)
implements optional CPU/GPU tangent-frame skinning with linear tangent transforms,
inverse-transpose normals, re-orthogonalization, reflected handedness and an
explicit unavailable-frame sentinel. It passes independent numerical and
ownership checks on both desktop backends. This is internal data-path evidence.

Required next integration:

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
  budgets. Procedural calibration alone does not satisfy product acceptance.

The full platform roadmap remains open beyond these items. This list does not
replace the other scorecard requirements.
