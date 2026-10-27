# Mtek-authored vertex and compute shaders

Added: 2026-10-26, explicitly requested by the user. Status: **in progress**.
This required workstream belongs to areas 3 (rendering) and 10 (language/compiler)
of the active scorecard. It must not disappear behind a generic future-v0.2 label.

## Current boundary

Mtek supports the compatible position-only vertex form and named struct results
with position, optional normal/UV/tangent outputs and typed custom payloads. A matching
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
CesiumMan's mixed-filter sampler. A [spatial inspection increment](inspection-2026-10-27/checkpoint.md)
adds public copied diagnostics and world bounds/skeleton/IK/collider/contact
overlays. The [authored cohort increment](shader-authoring/cohorts-2026-10-27/checkpoint.md)
now validates combined authored shared-pose instancing on the original characters,
including CPU references, bounds/culling, shadows, detach/rejoin and recovery.
The [production composition workflow](character-composition-2026-10-27/checkpoint.md)
now adds locomotion/actions, constraints, procedural adaptation, compatible
different proportions, transitions/root ownership and recovery with authored
deformation and shadows. Wider physical-device evidence is still outstanding.
**Bounded standalone Mtek-authored compute is now
executable through ordinary source builds**; see the current acceptance below.

A [compute-backend increment](shader-authoring-compute-progress.md) now provides
typed compute entries/builtins, explicit storage access and checked storage-array
layouts, validated independently with Naga. A subsequent source-checking increment
implements declarations, resources, signatures and GPU effects under
[decision 0202](../../spec/decisions/0202-bounded-source-compute-checking.md).
Kernel lowering, manifest/runtime resources, dispatch and inspection are now
implemented. A subsequent [position-attachment checkpoint](shader-authoring/compute-render-2026-10-26/checkpoint.md)
connects completed scalar xyz outputs to declared entity geometry, with finite
bounds, disposal, scene lifetime and recovery checks using CPU fakes. That
historical checkpoint retained E4901 pending numerical/render acceptance.
The [focused acceptance harness](../../tests/browser/COMPUTE-ACCEPTANCE.md) now
prepares the real compiler package and independent CPU/direct-WGSL references.
Its CPU preflight is separate from the [passing GPU numerical/geometry runs](shader-authoring/compute-gpu-2026-10-27/checkpoint.md)
on Radeon and SwiftShader. All eight kernels now execute over 13 numerical cases,
including composite values. The [public compute acceptance](shader-authoring/compute-release-2026-10-27/checkpoint.md)
adds independent shadow references and a real [geometry example](../../examples/compute-geometry/README.md).
Nine tests pass on each backend, including all three shadow qualities, off-camera
casters, final bounds, pending output, recovery and detach. Ordinary source
analysis now packages standalone compute without a diagnostic bypass. Context,
LSP, grammar, coverage and release documentation advertise this bounded API 1
contract. Material-local compute remains rejected by E4901.

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

The bounded compute implementation and desktop acceptance portions of criteria
3–5 are delivered: source checking/lowering, packaging, dispatch, inspection,
resource lifetime, numerical CPU/direct-WGSL comparisons, geometry/shadows and a
public example. Unsupported operations and device limits are documented in
[the compute contract](../../spec/compute.md). This does not complete the whole
shader track: integrated/mobile or other physical-device evidence remains.
The explicit compatible-rig production composition is now delivered, with its
operating assumptions and original/generated content documented. SwiftShader on
the same desktop is a second backend, not a second device.

On 2026-10-27 the user explicitly re-enabled animation optimization and CPU/GPU
testing, including while doing other work. Both are active. The fresh pre-change
animation baseline and candidate each pass all 210 frozen checks. The
[measured optimization](animation-optimization-2026-10-27/checkpoint.md) reduces
GPU pass time and buffer use; whole-frame CPU evidence remains mixed. Host-load
limits are unchanged, with noisy attempts retained and retried.
