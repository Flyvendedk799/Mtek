# Structured vertex outputs and typed fragment payloads

Date: 2026-10-26. Historical structured-output increment; [finite authored bounds are now implemented](shader-authoring-bounds-progress.md). Areas 3 and 10 of the [scorecard](scorecard.md).
The [shader-authoring plan](shader-authoring-plan.md) remains in progress.
This extends the [position-only increment](shader-authoring-progress.md);
it does not complete the shader-authoring track or the platform roadmap.

## Implemented behavior

An authored vertex stage can return a named struct containing local `position`,
optional `normal` and `uv`, and scalar/vector/color/quaternion payload fields.
A second fragment parameter of the same nominal struct type receives those
fields. Existing `vec3` results and fragment-only programs remain compatible.
Helpers and imported declarations retain GPU checking and source maps.

Float/vector/color fields interpolate smoothly. Integer, boolean and quaternion
fields use the first vertex's value. Booleans use a stored unsigned integer.
Surface and payload fields share a checked limit of 16 varying variables;
locations fill unused slots and are reported with types/interpolation by shader
inspection. Invalid geometry fields, unsupported payload types and mismatched
fragment signatures produce source diagnostics. `E6003` now has an executable
fixture and is no longer a reserved diagnostic.

Generated normal/UV outputs can satisfy fragment attribute requirements even
when the source asset omits those attributes. Vertex reads still require the
corresponding original attributes. The selected normal undergoes the object
inverse-transpose transform; the surface world normal is normalized. The payload
retains local values. [Decision 0198](../../spec/decisions/0198-typed-vertex-outputs-and-varyings.md)
defines the contract and its limits.

The runtime binding contract remains `vertexDeformation: 1`. Both ordinary and
instanced entries and directional shadows use the authored geometry. The
[structured example](../../examples/vertex-deformation/README.md) compares
rotated positions/normals, remapped UVs, smooth float/color data and flat
integer/boolean/quaternion data against ordinary object transforms.

## Validation

- 916 compiler unit tests and 135 tests across eight integration suites pass.
  These include imported outputs, missing asset attributes, nominal linkage,
  exact varying limits, generated WGSL validation, inspection and existing
  shader goldens. A separate diagnostic audit passes all 10 tests.
- 24 structured and 24 position-only rendering cases pass across hardware and
  SwiftShader. Every authored/reference pixel matches exactly. Structured
  geometry changes at least 156 pixels; shadows change at least 299 pixels.
- Eight simulated device losses recover with identical frames and preserve
  nondefault translation/rotation inputs. Forty-eight replacements between
  position-only and structured programs also match the references exactly.
- Each rendering configuration performs three replacement cycles. The first
  warms both profiles; the next two retain identical live buffer, texture,
  pipeline, bind-group and shader-module counts for each profile. Disposal
  returns all tracked live GPU resources and listeners to zero. This short
  replacement check does not establish long-session asset unloading behavior.
- TypeScript, workspace lint, compiler/CLI Clippy, formatting and diff checks
  pass. Coverage generation reports 404 features, 217 positive fixture programs
  and 246 diagnostic codes; release-documentation comparisons pass. The
  prebuilt runtime matches its sources and built distribution. Runtime code
  did not change in this increment; package budget results remain recorded in
  the preceding increment rather than being presented as a new measurement.

These are small 97-by-97 correctness probes on one Radeon RX 7900 XTX desktop
and SwiftShader on that same host, using Chromium 153.0.8010.12. They do not
establish another physical-device tier or comparative performance. Compiler
jobs/test threads are capped at two; coverage compiler probes are serialized.
Animation optimization and sustained CPU/GPU performance runs remain deferred.

Records under [structured-2026-10-26](shader-authoring/structured-2026-10-26/):

- [Structured hardware](shader-authoring/structured-2026-10-26/verified-lifecycle/hardware.json)
  and [software](shader-authoring/structured-2026-10-26/verified-lifecycle/software.json)
  include per-case gates, recovery/replacement counters, source/output hashes,
  manifests and diagnostics. Expected device-loss/recovery warnings are retained.
- [Position-only hardware](shader-authoring/structured-2026-10-26/final-legacy/hardware.json)
  and [software](shader-authoring/structured-2026-10-26/final-legacy/software.json)
  retain the compatibility replay; the subsequent verifier change only strengthens
  structured recovery inputs.
- [Shader inspection](shader-authoring/structured-2026-10-26/inspect.json) and
  [validation summary](shader-authoring/structured-2026-10-26/validation.json).

Earlier attempts remain available. One harness attempt loaded the wrong module
export. The first lifecycle attempt exposed a reference setup error: replacement
correctly carried unbound transforms, while the reference expected initial values.
Binding reference rotations fixed the comparison. Resource comparisons explicitly
allow the first cycle to warm caches; raw warm-up counts remain in the records.

## Required follow-up

Authored finite bounds, combined skeletal deformation/recovery checks, wider
physical-device evidence and further authoring tooling remain. Deformed objects
still use conservative visibility and their original centers for transparent
sorting/inspection. Source interpolation annotations are not exposed.

**Mtek-authored compute remains unimplemented (`E4901`).** Its typed resources,
dispatch/workgroup contract, synchronization, lifetime, numerical CPU-reference
readback, compute-to-render example and direct-WGSL comparison remain required
acceptance work. Runtime-internal compute does not satisfy that requirement.
