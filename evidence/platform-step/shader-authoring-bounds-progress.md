# Authored finite deformation bounds

Date: 2026-10-26. Historical bounds increment; [production-character skin/deformation/recovery checks are now recorded](shader-authoring-characters-progress.md). Areas 3, 8 and 10 of the [scorecard](scorecard.md).
The [shader-authoring plan](shader-authoring-plan.md) and full platform roadmap
remain in progress. This extends the position/structured-output increments.

## Implemented behavior

Entities and prefabs now expose writable, bindable `bounds_center: vec3` and
`bounds_radius: f32`. A positive radius supplies an enclosure in final deformed
mesh-local coordinates, after skinning and authored vertex deformation. Object
and parent transforms follow it. The author must include all poses/displacements
or update the enclosure with their inputs; it is not a compiler proof of the
shader's geometric limits. Radius zero restores automatic mesh/skin bounds for
ordinary shaders or conservative visibility for authored vertex shaders.

Explicit centers now drive camera culling and transparent depth ordering.
Bounds-only changes invalidate culling without an object-matrix change. World
radius expansion conservatively covers inherited nonuniform scale/shear. Camera
culling still does not remove off-camera directional-shadow casters.

Typed IR, generated initialization/imperative setters, binding dependencies,
static/dynamic prefab paths and manifest validation include the new fields.
Programs without bounds declarations retain their existing generated shader/CPU
goldens. Invalid constants use `E5006`; invalid numeric runtime writes preserve
the previous sphere and report `E8091`. Center writes copy their inputs.

Bounds survive CPU-world retention during device recovery. Program replacement
uses the new program's initialization/bindings, so an enclosure is not carried
across a potentially different deformation shader. Extension API 1 optionally
exposes copied local spheres; the inspector copies/freezes them and displays
their center/radius. A world-space wireframe overlay is not implemented.
[Decision 0199](../../spec/decisions/0199-authored-deformation-bounds.md) defines
the complete contract, including physics/particle and `entity_ref` limitations.

## Correctness evidence

The [bounded source example](../../examples/vertex-deformation/bounds/src/main.mtek)
uses the structured vertex material with moving translation/rotation inputs and
a sphere enclosing its rotated unit box. Its independent verifier runs a 97-by-97
manual-clock target. Each backend passes:

- 12 matched image cases, covering ordinary/instanced entries and shadows;
- 20 bounds transitions, including camera exits/reentries with fixed object
  transforms, clearing the radius to conservative visibility and restoring it;
- four simulated device losses with nondefault translation/rotation inputs;
- 24 replacements between position-only and bounded structured programs.

All 120 cases across hardware and software have zero maximum pixel error against
the applicable reference or pre-loss frame. Warm-up plus two observed replacement
cycles retain stable tracked resource counts per profile. Disposal returns live
GPU buffers/textures/samplers/pipelines/bind groups/shader modules and listeners
to zero. These are short replacement checks, not long-session unloading evidence.

The retained [hardware](shader-authoring/bounds-2026-10-26/attempt-2/hardware.json)
and [software](shader-authoring/bounds-2026-10-26/attempt-2/software.json) records
contain manifests, source/output hashes, counters and expected device warnings.
The first harness attempt failed because a browser-evaluation argument was not
passed; its record remains in `attempt-1`. No runtime fix was needed for that error.

Hardware is one Radeon RX 7900 XTX desktop; SwiftShader uses the same host.
Chromium is 153.0.8010.12. These are not two physical-device tiers, performance
comparisons or production-character skin/deformation evidence.

Compiler validation passes 918 unit tests and 150 integration checks across build,
semantic fixtures, diagnostics, context and registry/schema suites. The build
suite checks all existing generated goldens and the new source fixture. Focused
runtime tests pass 229 checks, including bounds-only culling changes, invalid
writes, public snapshot isolation and transparent ordering. Inspector tests pass
12 checks, including copied/frozen bounds. All 23 LSP completion tests pass,
including entity-body and value completion for bounds. TypeScript, workspace lint and
compiler/CLI Clippy pass.

The context export still leaves at least 1,000 bytes for the project under its
existing limit: the empty context is 28,958 bytes, with no truncation. Registry
help and context guide wording were shortened without dropping fields/rules.
Golden regeneration now replaces files atomically, avoiding Windows errors when
desktop readers retain a mapped previous version.

Compiler jobs/test threads are capped at two; Vitest uses one worker and coverage
compiler probes are serialized. Animation optimization and sustained CPU/GPU
performance testing remain deferred.

All eleven example package budgets pass with unchanged limits. Each folder grows
5,253 bytes against the preceding vertex-increment record. Coverage generation
passes with 404 features, 218 positive fixture programs and 247 diagnostic codes;
release-documentation comparisons pass. The embedded runtime matches its sources
and distribution. A final CLI recompile reproduces all retained GPU output hashes.
[Validation](shader-authoring/bounds-2026-10-26/validation.json),
[package sizes](shader-authoring/bounds-2026-10-26/budgets.json) and
[IR inspection](shader-authoring/bounds-2026-10-26/inspect-ir.json) retain the details.

## Required follow-up

Combined skin/deformation/recovery checks on authored characters, broader physical
devices and world-space diagnostic overlays remain. Arbitrary bounds enclosure
is an author responsibility; translucent sorting remains per object.

**Mtek-authored compute is still unimplemented (`E4901`).** Typed resources,
dispatch/workgroups, synchronization, lifetime, CPU-reference readback,
compute-to-render examples, matched direct-WGSL evidence and related tooling
remain required by the plan. Other remaining scorecard work is unchanged.
