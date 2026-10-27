# Authored tangent deformation foundation

2026-10-27. Continues the full platform plan through the unchanged product asset's
authored-tangent gap. **Import, material rendering and production-product
acceptance remain incomplete.** This internal increment does not remove E7009
or claim that the WaterBottle now imports.

CPU skinning and an optional GPU kernel now transform packed tangent frames.
Normals retain inverse-transpose transformation; tangents use the linear blend
matrix, are re-orthogonalized and normalized, and flip handedness under a
reflection. Zero/singular/unavailable frames produce an explicit sentinel.
The new GPU variant uses exactly eight storage bindings, within the default
eight-binding devices recorded in these tests. Position-only and normal-only
variants remain separate. The public source/manifest/host ABI is unchanged.
See [decision 0211](../../../spec/decisions/0211-tangent-frame-deformation.md).

Six CPU tests cover analytical nonuniform scale, both UV handedness signs and
reflection, shear/orthogonalization, three weighted blends against a generic
pivoted matrix-inversion oracle, singular/unavailable frames and invalid storage.
The oracle does not call the runtime's cofactor or deformation helpers.

Actual GPU readback covers 1, 10 and 50 actors at 63 and 1025 vertices, with
nonuniform scale, shear, reflected and singular palettes, both handedness signs,
zero tangents and unavailable-frame inputs. A separate six-actor case switches
all three pipeline variants in one submission. Every tangent word is compared
with the independent inverse-based frame reference; CPU output is checked
against the same oracle. Raw input, influences, palettes, GPU, CPU and reference
binary32 buffers are retained in the compressed probe records.

Per-update uploads remain exactly actors × 3 joints × 64 bytes. Output allocation
counts match position/normal/tangent streams. Five invalid tangent requests fail
before allocation. After releasing instances, sources and the engine, a real GPU
copy proves borrowed mesh tangent input remains usable. All created buffer,
shader-module, pipeline and bind-group ownership counters return to zero.
This establishes numerical and resource behavior, not rendered material quality
or a performance advantage.

Final validation:

- 114 browser checks pass, 57 per Radeon RX 7900 XTX / SwiftShader backend on one
  PC. These include all sixteen tangent cases with allocation/borrowed-input
  checks, old skinning variants, animation/cohorts, directional shadows, HDR
  environment, PBR maps/opacity and sprite ordering. No failures or NOT-RUN.
- The earlier focused deformation run passes 22 checks per backend; its results
  precede the final borrowed-input check and are kept as intermediate evidence.
- All 1,667 runtime units pass, including the six new mathematical tests.
  CLI integration and prebuilt checks pass 41 + 2 tests. TypeScript, focused
  runtime/browser lint, release consistency and prebuilt/source parity pass.
- All eleven existing package budgets hold. Minified runtime cost grows by
  1,720 bytes in the existing game packages; stage-show's zip is
  715,027 / 740,000 bytes. No limit is increased.
- The current rebuilt CLI still explicitly rejects the unchanged WaterBottle
  tangent attribute with E7009. This expected rejection is retained, not counted
  as successful asset compatibility. No grammar/compiler source behavior changed
  in this increment, so no new full Rust workspace/conformance run is claimed.

The initial TypeScript readonly report-shape errors and one unnecessary-assertion
lint failure are preserved separately from the successful final checks. Earlier
checkpoints, the frozen animation workload and frozen AI archive are unchanged.
See [validation.json](validation.json) and [summary.json](summary.json).

Next work remains the full [tangent integration](../tangent-progress.md): import/
packing/schema validation, runtime mesh and shader attributes, static/model/
instance frames, authored vertex output rules, mapped-PBR fallback, recovery/
shadow/reference rendering and the unchanged product workload. Matched qualified
costs and all other open platform-scorecard requirements remain required.
