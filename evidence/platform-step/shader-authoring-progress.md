# Authored vertex stages: first implementation

Date: 2026-10-26. Historical first increment; [structured outputs and typed varying payloads are now implemented](shader-authoring-structured-progress.md). Areas 3 and 10 of the [scorecard](scorecard.md).
The [full shader-authoring plan](shader-authoring-plan.md) remains required work.
**This increment does not complete vertex or compute authoring acceptance.**

## Implemented behavior

A material can now write `vertex(input: VertexInput) -> vec3` alongside its
required fragment stage. The result modifies mesh-local position after skeletal
deformation and before model/instance and camera transforms. `VertexInput` provides
position, normal and UV. Material values and level-zero texture sampling are
available in the authored function; implicit derivatives retain their fragment
restriction. GPU reachability includes vertex callees, with existing capture,
purity, loop-bound and GPU type checks.

Vertex-only attribute requirements are separate from fragment varyings. GLB
attributes used only by a vertex stage still receive `E7010` when missing. Source
mapping, IR/shader inspection, the registry, LSP completion and editor highlighting
include the new stage/type. Fragment-only shader goldens remain unchanged.

Manifest `vertexDeformation: 1` selects vertex-visible material bindings and
conservative camera culling. Directional shadow passes run the same authored
entry using the light projection and live material values. Static compatible
draws can instance in the color pass. Extra shadow resources belong to the scene
registry and are released with it. [Decision 0197](../../spec/decisions/0197-authored-position-stages.md)
defines the bounded contract.

The [source example](../../examples/vertex-deformation/README.md) starts mesh
origins outside the camera and moves vertices into view. It compares against
ordinary object translations, including moving uniforms, vertex texture reads,
instanced/uninstanced draws and directional shadows. Its UI renders only when a
control changes.

## Validation

- 910 compiler unit tests and 134 tests across eight relevant integration suites
  pass, covering semantic fixtures, shader lowering, assets, context, grammar and
  registry/schema alignment. The existing context-size reserve is preserved.
- 22 LSP completion tests, 211 focused runtime/ABI tests and 51 editor grammar
  tests pass.
- The final GPU record has **12 hardware and 12 SwiftShader cases**. Every
  authored/reference pixel matches exactly. Geometry changes at least 169 pixels;
  enabling shadows changes at least 299 pixels. Instancing executes in the
  enabled cases; unbounded authored draws remain visible; disposal leaves zero
  tracked buffers, textures and pipelines.
- This is one Radeon RX 7900 XTX desktop and one software backend on the same
  host, using Chromium 153.0.8010.12. It is not evidence for another physical
  device tier or for performance superiority.
- All 11 existing example package budgets pass. TypeScript, workspace lint,
  compiler/CLI Clippy, generated docs/coverage, naming/task/asset checks and
  prebuilt-runtime consistency pass. Compiler jobs are capped at two; focused
  Vitest checks use one worker. Coverage probes can now be serialized with
  `MTEK_COVERAGE_JOBS=1`.

The retained records are under [vertex-2026-10-26](shader-authoring/vertex-2026-10-26/):

- [hardware](shader-authoring/vertex-2026-10-26/verified/hardware.json) and
  [software](shader-authoring/vertex-2026-10-26/verified/software.json) retain
  per-case gates/counters, manifest, emitted file hashes and example/tool hashes;
- [inspection](shader-authoring/vertex-2026-10-26/inspect.json),
  [package budgets](shader-authoring/vertex-2026-10-26/budgets.json) and
  [validation](shader-authoring/vertex-2026-10-26/validation.json) record the rest.

An initial headless-shell attempt found no adapter. It remains in `attempt-1`;
the verifier now selects the shared Chromium channel. Earlier `attempt-2`
records are retained separately from the final stronger image gates.

## Required follow-up

This subset returns position only. Normal/UV outputs, custom varyings and their
interpolation/linkage, authored finite bounds, and broader skinned/recovery/device
evidence remain. Normals/UVs retain mesh values; the translation example preserves
their correctness. Displaced translucent geometry still sorts approximately from
the original object centers.

**Mtek-authored compute is still unimplemented (`E4901`).** Its typed resource,
dispatch/workgroup, synchronization and lifetime contract, CPU-reference readback,
compute-to-render example, matched direct-WGSL evidence and tooling remain in the
plan. Internal skinning compute and host WGSL do not satisfy those criteria.

Animation performance optimization and sustained CPU/GPU performance runs remain
deferred while the user is doing heavy work. These short correctness checks do not
replace the remaining performance work. The overall roadmap remains incomplete.
