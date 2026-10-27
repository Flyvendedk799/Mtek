# 0201: Compute backend and storage-array layout

Status: accepted, 2026-10-26; temporary source/runtime boundary superseded by [0207](0207-source-compute-acceptance-and-capabilities.md). Implements compiler infrastructure for the required
[shader-authoring track](../../evidence/platform-step/shader-authoring-plan.md).
It does not introduce source syntax or a runtime dispatch API.

## Shader representation

The existing typed shader IR represents compute entries as a stage with a static
three-component workgroup size. The printer emits `@compute @workgroup_size(x, y,
z)` from that node. Compute entry parameters or IO struct members can carry
`global_invocation_id`, `local_invocation_id`, `workgroup_id`, `num_workgroups`
and `local_invocation_index`. Vector builtins use the existing `vec3<u32>` IR
type; this does not add integer vector types to the Mtek language.

Storage globals carry an explicit group, binding, type and access mode: `read`
or `read_write`. WGSL has no write-only storage-buffer access mode. A future
source-level output-only contract must therefore be enforced by Mtek typing,
with a `read_write` physical buffer. Uniform blocks keep their existing layout.
No WGSL logic templates, untyped shader strings or new dependencies are added.

Every declaration, builtin parameter, stage annotation and storage expression
keeps its source span through the existing printer/span map. Naga validates
emitted compute modules using the same full validation flags as materials.
Its failure remains `E6100`, a compiler defect, rather than a substitute for
source-level typing/effect diagnostics. Naga's acceptance does not prove that a
module meets a particular device's workgroup or resource limits.

These choices follow the WGSL definitions of
[compute entries](https://www.w3.org/TR/WGSL/#compute-shader-entry-point),
[builtins](https://www.w3.org/TR/WGSL/#builtin-inputs-outputs), and
[address-space layout constraints](https://www.w3.org/TR/WGSL/#address-space-layout-constraints).

## Storage resource layout

A storage resource is a fixed-capacity outer array of an ordinary GPU-storable
Mtek value. Elements preserve the existing value representation: bools use
bool32, matrices remain column-major, and nested arrays/structs retain their
uniform-compatible wrappers and member padding. This lets helpers and locals
use the same composite types as values read from storage.

The resource's **outer array** is a transport container, not an ordinary Mtek
array value. It uses the natural alignment of the emitted element type and
`roundUp(AlignOf(E), SizeOf(E))` stride. Thus f32/i32/u32/bool32 streams have
stride 4, vec2 streams stride 8, vec3/vec4/color/quat streams stride 16, and mat4
streams stride 64. A one-f32 struct has stride 4. Nested value arrays keep their
16-byte element wrappers; only the outer resource is packed. A packed f32 stream
can consequently represent positions with three adjacent components without
claiming that a storage vec3 has a 12-byte stride.

`layout::storage_array` returns one authoritative `LayoutNode::Array` for offsets,
size, alignment, capacity, stride, nested representation and bool encoding.
`type_decls_from_layout_node` collects its dependency declarations without
inventing a wrapper block. Consumers derive WGSL types and future transport
metadata from that record, rather than recomputing offsets.

The layout engine rejects empty resources and checked-byte-arithmetic overflow.
Outer capacity is independent of the existing ordinary value-array length cap;
nested value arrays keep their current validation. Layout calculation allocates
metadata only. It grants no permission to allocate a huge GPU buffer: source
resource byte budgets and actual device-limit checks are still required in the
compiler/runtime integration.

## Compatibility and remaining implementation

Existing vertex/fragment IR nodes and their printed bytes are unchanged. This
addition changes no material binding plan, public runtime declarations, manifest
schema, ABI number, source grammar or capability advertisement. In particular,
`E4901` remains correct for the currently unsupported source compute form.

Still required: accepted source/resource/host ownership and recovery contracts;
parsing, resolution, typing and GPU effects; kernel lowering and guarded dispatch;
manifest/inspection/editor integration; upload/readback and deterministic disposal;
render/compute ordering and explicit synchronization rules; resource replacement
and device recovery; numerical CPU and direct-WGSL reference checks; and a real
Mtek-authored compute-to-render example. Shared memory, arbitrary cross-invocation
writes, atomics or barriers must not be exposed before their synchronization
semantics are specified and validated. The full shader-authoring track stays open.

## Evidence

`tests/compute_backend.rs` constructs typed shader IR and checks emitted storage
access modes/bindings, all five builtin inputs, three-dimensional static workgroup
sizes, deterministic text and source locations. Negative controls exercise
read-only stores, derivatives in compute and each zero workgroup dimension.

`tests/naga_oracle.rs` independently compares Naga's recursive struct member
offsets/spans and array strides with storage layout records for every existing
layout fixture plus scalar/vector/matrix/bool, small-struct and nested-array
cases. These are compiler/backend correctness checks. They do not establish
Mtek-source compute support, hardware execution, numerical readback or timing.
