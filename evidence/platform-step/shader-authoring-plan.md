# Mtek-authored vertex and compute shaders

Added: 2026-10-26, explicitly requested by the user. Status: **in progress**.
This required workstream belongs to areas 3 (rendering) and 10 (language/compiler)
of the active scorecard. It must not disappear behind a generic future-v0.2 label.

## Current boundary

Mtek supports the compatible position-only vertex form and named struct results
with position, optional normal/UV outputs and typed custom payloads. A matching
second fragment parameter receives those payloads. Locations, interpolation modes,
attribute requirements and the 16-variable limit are checked and inspectable.
Both ordinary/instanced entries and directional shadows use the authored outputs.
See [decision 0198](../../spec/decisions/0198-typed-vertex-outputs-and-varyings.md)
and the [structured-output progress](shader-authoring-structured-progress.md).
The [first increment](shader-authoring-progress.md) remains a historical record.

Device recovery preserving nondefault uniforms and repeated cross-profile
replacements are verified on the desktop hardware/software backends.
[Authored finite bounds](shader-authoring-bounds-progress.md) now provide bindable
final local spheres for culling/sorting and copied inspection. A
[production-character increment](shader-authoring-characters-progress.md) now
checks combined skin/deformation/bounds/shadows and recovery on the original Fox
and CesiumMan assets against GPU and CPU-skinned references. It also preserves
CesiumMan's mixed-filter sampler. World-space overlays, combined authored
shared-pose instancing, broader animation compositions and wider physical-device
evidence are still outstanding. **Runnable Mtek-authored compute remains unimplemented (`E4901`).** Internal
runtime compute and host-authored WGSL do not satisfy it.

A [compute-backend increment](shader-authoring-compute-progress.md) now provides
typed compute entries/builtins, explicit storage access and checked storage-array
layouts, validated independently with Naga. A subsequent source-checking increment
implements declarations, resources, signatures and GPU effects under
[decision 0202](../../spec/decisions/0202-bounded-source-compute-checking.md).
E4901 explicitly blocks runnable packaging until kernel lowering, manifest/runtime
resources, dispatch, inspection and end-to-end examples are implemented.

## Work and acceptance criteria

1. **Define the language and GPU resource contract.** Write an accepted design/ADR
   for stage declarations, entry inputs/outputs, resource ownership, binding layouts,
   host invocation, shader inspection and manifest/ABI versioning. Preserve existing
   fragment-only programs. Define which ordinary Mtek functions/intrinsics are
   legal in each stage and report illegal cross-stage operations at source spans.
2. **User-authored vertex stages.** Implement parsing, typing, lowering, WGSL
   emission and source mapping for typed vertex inputs/outputs and varying linkage
   into fragments. Specify position/normal transform ownership and the order with
   skeletal deformation, instancing, culling and shadow passes. Validate varying
   types/locations/interpolation and required mesh attributes. Ship an actual Mtek
   vertex-deformation example with correct bounds and shadow behavior; verify
   generated shaders, diagnostics and rendered output on the selected device tiers.
3. **User-authored compute stages.** Implement typed compute entry points,
   invocation/workgroup builtins, workgroup sizes and dispatch. Start with an
   explicit bounded resource model: storage/uniform buffers, read/write access,
   host upload/readback and deterministic lifetime. Specify synchronization,
   barriers and render/compute ordering before exposing operations that require
   them. Device limits, invalid bindings, out-of-range dispatch/indexing behavior
   and unsupported operations need actionable diagnostics and tests.
4. **Examples and integration evidence.** Compile and run a Mtek-authored buffer
   transform with numerical readback checked against a CPU reference, plus a
   compute-to-render example such as generated geometry or particles. Compare an
   equivalent direct-WGSL reference at matched behavior. Exercise disposal,
   resource replacement and device recovery. Report workgroup/count/resource
   limits explicitly; do not claim unrestricted compute support.
5. **Tooling and release alignment.** Extend `mtek inspect`, source maps, public
   declarations, editor support and the coverage/diagnostic registries. Update
   existing unsupported-feature documentation only when the new stages work.
   Keep syntax/type/codegen checks separate from hardware correctness and timing
   evidence; obtain required checks before marking the track complete.

## Scheduling and acceptance

The position-only and structured-output vertex increments have bounded compiler/runtime
and hardware/software correctness evidence. This does **not** complete criteria
1, 2, 4 or 5 above: the compute resource contract, bounds overlays, broader composition/instancing/device
evidence and remaining tooling requirements still apply. Criterion 3 (compute)
has started with backend/layout infrastructure and source checking; lowering/runtime integration and
its acceptance evidence remain outstanding.

Animation performance optimization and sustained CPU/GPU benchmarking remain
retained, deferred work while the user is doing heavy work. The small correctness
probes for this increment are separate from those measurements. The full active
goal includes the remaining CPU/GPU validation once it can be run.
