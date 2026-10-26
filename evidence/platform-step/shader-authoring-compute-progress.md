# Compute authoring progress

Date: 2026-10-26. Status: **backend and source checking implemented; runnable compute incomplete**.
Required work in scorecard areas 3 and 10 and the
[shader-authoring plan](shader-authoring-plan.md).

## Backend increment

[Decision 0201](../../spec/decisions/0201-compute-backend-and-storage-layout.md)
records typed compute entries with static three-dimensional workgroup sizes,
five compute builtin inputs and explicit read/read-write storage globals in the
existing shader IR/printer. Generated code keeps source spans and uses the
existing Naga validation path. No WGSL logic templates or dependencies were added.

The layout engine now computes fixed-capacity outer storage arrays. Scalar
streams are packed at four bytes per element, suitable for eventual scalar
position streams. Vector/matrix strides follow their emitted WGSL types.
Composite values retain existing nested wrappers/member padding, and bools remain
bool32. Root capacity is separate from the ordinary value-array cap; empty,
overflowing or malformed layouts fail. Resource allocation budgets and GPU
device-limit validation remain integration work.

In that first increment the source grammar, capability advertisement, public runtime API, material binding
plans, manifest schema and ABI version are unchanged. **Mtek source still cannot
declare or dispatch compute shaders (`E4901`).** This increment does not satisfy
the required source-authored buffer transform or compute-to-render example.

## Backend verification

- 923 compiler unit tests pass, including four new storage-layout tests.
- Five compute-backend tests verify Naga-accepted emission, all five builtin
  bindings, storage access modes and resource bindings, deterministic output,
  source locations and all three workgroup dimensions. Negative controls reject
  a read-only store, a compute derivative and each zero workgroup dimension.
- Seven Naga-oracle tests pass. The new storage oracle compares recursive member
  offsets/struct spans/array strides for 27 element types: all 14 existing layout
  fixtures plus 13 primitive, small-struct and nested-array cases.
- Nine shader-lowering and four WGSL-block tests pass, including byte-for-byte
  existing shader goldens and deterministic lowering of all passing fixtures.

Commands and source hashes are retained in
[`compute-backend-2026-10-26/validation.json`](shader-authoring/compute-backend-2026-10-26/validation.json).
These are CPU compiler checks, with Cargo jobs and test threads capped at two.
No GPU process, sustained performance run or animation optimization was started.

## Source-checking increment

[Decision 0202](../../spec/decisions/0202-bounded-source-compute-checking.md)
adds standalone compute declarations, contextual input/output resources, uniform
parameters, a kernel and optional static workgroup sizes. Parsing, AST dump/walk,
formatting/comments, declaration/import resolution and typed metadata are implemented.
Kernels join the program's GPU effect roots, including helper calls. The editor
knows the new input record and LSP hover identifies compute declarations/buffers.

The checker enforces up to four input buffers and one output, 16 MiB per resource,
64 uniform params/64 KiB, and workgroup axes at most [256, 256, 64] with a total of
256 invocations. Root storage capacity is separate from ordinary value-array
capacity. Expanded element/parameter layouts are capped at 16,384 nodes so compact
exponentially repeated structs cannot cause unbounded layout construction.

Inputs permit indexed reads and reject writes/whole-buffer copies. The output is
written through a typed kernel return, with direct reads/writes rejected. All
fourteen `ComputeInput` fields are u32. Invalid signatures, defaults, resource
budgets, workgroups and GPU effects have source diagnostics. Compute colour values
have no opaque-material alpha warning. Four new diagnostic fixture projects retain
E4050–E4053 evidence.

**Every compute declaration still receives E4901 at the build boundary.** There
is no runnable compute package yet. The lowerer also refuses a compute declaration
if it bypasses that gate, rather than silently omitting it. `ComputeInput`'s passing
helper fixture proves record parameter/field typing only; it has no invocation
producer and does not prove execution. No compute dispatch capability or runtime
API is advertised.

The source increment's selected compiler run passes 923 unit tests and 145
integration tests, including 15 compute-source tests. Existing shader goldens
remain unchanged. The complete empty context is 28,987 bytes; the unchanged
30,000-byte budget still leaves the required 1,000-byte project reserve. Concise
syntax/diagnostic wording makes room for the input record without dropping entries.
The editor's corpus auto-indent check exposes a remaining limitation for wrapped
binary expressions in vertex examples and the new helper fixture. `mtek fmt`
formats them correctly; the editor's simple structural indentation rules do not
predict those continuations. This remains open and is not counted as passing.
Further tooling checks and current source hashes belong in
[`source-checking-2026-10-26/validation.json`](shader-authoring/source-checking-2026-10-26/validation.json).

## Required next work

Connect checked declarations to kernel lowering, manifest packaging, runtime
dispatch and inspection. Implement the accepted host ownership/recovery contract,
bounded dispatch/device-limit validation, upload/readback,
ordering/synchronization, disposal, replacement and device recovery. Run an actual
Mtek-authored numerical buffer transform against CPU and direct-WGSL references,
plus a compute-to-render example. Update editor/coverage/release capabilities only
as those paths become usable. Naga/backend checks alone cannot close this track.

The complete platform roadmap remains open. The user's overnight goal included
CPU/GPU testing; carrying the older deferral into that window was an agent
scheduling mistake. After returning on 2026-10-26 the user explicitly said not to
run those tests now. Animation optimization and sustained CPU/GPU benchmarking
are therefore deferred for the current occupied-PC period, and remain required
for final acceptance. No GPU or sustained performance run was started by either
compute increment.
