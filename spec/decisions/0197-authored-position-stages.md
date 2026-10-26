# 0197: Authored local-position vertex stages

Status: accepted, 2026-10-26. [Decision 0199](0199-authored-deformation-bounds.md) adds finite authored bounds. Structured outputs and payloads are added by [decision 0198](0198-typed-vertex-outputs-and-varyings.md). This is the first bounded implementation of the
[vertex/compute workstream](../../evidence/platform-step/shader-authoring-plan.md).
It does not complete that workstream.

## Contract

A material requires one `fragment(input: SurfaceInput) -> color` and may declare
one `vertex(input: VertexInput) -> vec3`, in either order. The vertex result is a
mesh-local position. `VertexInput` contains `position: vec3`, `normal: vec3` and
`uv: vec2`. The compiler tracks vertex reads separately from fragment varyings;
passing the whole input to a helper conservatively requires every field. Missing
required asset attributes remain `E7010`; absent, unread attributes are not required.

Both stages are GPU roots. Their reachable functions obey the existing purity,
capture, constant-loop-bound and GPU type rules. Material values are readonly and
supplied through the existing group-1 block. Texture/sampler operands are bound
resources, not first-class values. `sample` explicitly reads level zero and is
available in the vertex stage. Implicit derivatives (`sample_mip` and mapped
lighting) retain their fragment-prefix requirement (`E4042`), including helper
functions, where they were already forbidden.

The order is skeletal deformation, authored local-position function, then the
object/instance model and camera projection. The fragment's `local_position` and
`world_position` reflect the authored result. Normals and UVs retain their mesh
values (including skeletal deformation of normals). Authors must choose position
operations compatible with those normals, such as translation. This subset has no
authored normal/UV result, clip-space ownership or custom varying declarations.

## Runtime and compatibility

An authored shader emits optional manifest and inspection property
`vertexDeformation: 1`. Older shaders omit it and preserve their shader bytes and
binding layouts. Updated runtimes give authored materials vertex and fragment
visibility for group-1 values/resources; cache keys distinguish those layouts.
Old schema validators reject the new property, so a new compiler's emitted runtime
must accompany the new package. Extension API 1 is unchanged.

The runtime has no compiler-proven finite bounds for arbitrary position functions.
It conservatively retains authored draws during camera-frustum culling. Original
mesh spheres still supply sorting/inspection centers; transparent per-object
ordering is approximate for displaced geometry. An explicit authored-bounds
contract and corresponding overlays remain required follow-up work.

Directional shadow rendering uses the same shader module and authored entry with
the light projection in a full frame block, the live material bindings and the
object block. It does not bind the shadow texture while writing that attachment.
Skinning precedes both passes. Static compatible authored meshes can instance in
the color pass; shadow draws remain individual, as for existing materials.
Shadow buffers and pipelines belong to the scene registry and are released on
disposal, failed initialization and replacement. Recovery recreates them through
the usual scene startup path; hardware recovery needs separate evidence.

## Evidence and remaining scope

Compiler tests cover signatures, stage order, duplicate stages, GPU effects,
derivative rejection, attributes, helper reachability, WGSL validation and source
spans. The source example compares against equivalent ordinary transforms with
vertex texture sampling, moving parameters, instancing, camera culling and shadows.
Hardware and software correctness runs are separate from performance measurements.

Typed vertex outputs, varying types/locations/interpolation, authored bounds,
deformation-aware normal authoring and a broader skin/recovery/device matrix remain.
Compute declarations remain `E4901`. Typed storage/uniform resources, access modes,
dispatch/workgroup limits, synchronization, CPU-reference readback and a
compute-to-render workload need a separate accepted resource/ABI design before
implementation. No raw WGSL escape hatch counts as Mtek-authored compute.
