# Compute authoring progress

Updated: 2026-10-27. Status: **bounded standalone source compute accepted on desktop hardware/software backends**.
Required work in scorecard areas 3 and 10 and the
[shader-authoring plan](shader-authoring-plan.md).

The [current acceptance](shader-authoring/compute-release-2026-10-27/checkpoint.md)
supersedes the temporary public E4901 gates recorded below. Ordinary source builds
now package compute without bypassing diagnostics. Independent CPU/direct-WGSL
arithmetic, geometry, low/medium/high shadows, final bounds, pending output,
recovery and resource lifetime pass; all nine tests pass on each backend. The
[geometry example](../../examples/compute-geometry/README.md), context, LSP,
coverage and release docs describe the same [bounded API 1](../../spec/compute.md).
E4901 now rejects only material-local compute. Wider devices and the rest of the
shader-authoring plan remain open. The sections below preserve earlier boundaries.

A [current-code continuation](shader-authoring/compute-continuation-2026-10-27/checkpoint.md)
adds dispatch-completion and changed-output shadow references after recovery.
All 18 hardware/software checks pass, including the twelve shadow cases.
The context test now ties its advertised compute capability to an ordinary
successful package and verifies that material-local compute produces E4901 and
no package. Context/frontend/lowering, LSP and release consistency checks pass.

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

## Mounted packaging increment and required next work

An [artifact/resource-owner increment](shader-authoring/compute-ownership-2026-10-26/checkpoint.md)
now supplies validated compiler artifacts and internal runtime upload/dispatch/
readback/recovery/replacement owners. It has a shared compiler/runtime layout
fixture and CPU fake lifecycle checks. That record describes the preceding
internal-only checkpoint. A subsequent
[packaging/mounted checkpoint](shader-authoring/compute-packaging-2026-10-26/checkpoint.md)
connects these owners to `mountMtek`, manifest/schema packaging, generated default
writers, inspection and public handles. It does not establish numerical GPU execution.

Checked declarations now connect to typed IR and kernel WGSL in the
[compute lowering checkpoint](shader-authoring/compute-lowering-2026-10-26/checkpoint.md).
The editor indentation failure described above is historical and fixed by that
checkpoint. Public analysis/build still emits E4901. The planner packaging guard
has now been removed: checked development IR packages all compute artifacts.

Manifest packaging, mounted dispatch/inspection and the accepted ownership/recovery
contract are now connected, including bounded dispatch/device-limit validation,
upload/readback, ordering, disposal, replacement and device recovery. A subsequent
[position-attachment checkpoint](shader-authoring/compute-render-2026-10-26/checkpoint.md)
adds a bounded renderer bridge and corrects scene resets to preserve identical
program compute handles while retiring scene-local attachments. Its actual
compiler fixture verifies command/lifetime behavior with CPU callbacks only. Run an actual
Mtek-authored numerical buffer transform against CPU and direct-WGSL references,
plus a compute-to-render example. Update editor/coverage/release capabilities only
as those paths become usable. Naga/backend checks alone cannot close this track.

The complete platform roadmap remains open. Earlier compute increments were
performed during a testing deferral. On 2026-10-27 the user explicitly re-enabled
CPU/GPU tests and animation optimization, including while doing other work.
The [new GPU checkpoint](shader-authoring/compute-gpu-2026-10-27/checkpoint.md)
records passing scalar/invocation and composite arithmetic, rendered geometry,
recovery and lifetime checks on Radeon and SwiftShader. All eight packaged
kernels execute over 13 numerical cases. At that historical checkpoint, compute
geometry shadow references and capability/release alignment were still required
and E4901 was retained. The public acceptance linked at the top now delivers both
and removes the standalone gate; material-local compute remains rejected. The
[animation optimization](animation-optimization-2026-10-27/checkpoint.md) now has
complete 210-pass before and after measurements, with reduced GPU time/buffers
and mixed whole-frame CPU evidence. Historical NOT-RUN records remain unchanged.
