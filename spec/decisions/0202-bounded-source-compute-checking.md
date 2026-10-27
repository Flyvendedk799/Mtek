# 0202: Bounded source compute checking

Status: accepted, 2026-10-26; temporary packaging gate superseded by [0207](0207-source-compute-acceptance-and-capabilities.md). Extends decision 0201. Source checking is implemented;
packaging, runtime dispatch and hardware acceptance remain required work.

## Source contract

```mtek
compute Scale {
    param gain: f32 = 2.0;
    input source: array<vec4, 128>;
    output result: array<vec4, 128>;
    workgroup_size: [64, 1, 1];
    kernel(input: ComputeInput) -> vec4 {
        return source[input.index] * gain;
    }
}
```

Compute programs are standalone module declarations, exportable/importable by
name. They are separate from materials; a `compute(...)` material member retains
its existing parser rejection. `compute` remains reserved as an ordinary name.
`input`, `output` and `workgroup_size` are contextual member forms, so existing
functions/locals using those words keep their meaning. A project still supplies
its required scene/camera. Compute declarations do not become ordinary values.

There are zero to four read-only input buffers and exactly one output buffer.
Each resource is a fixed-capacity `array<T, N>` of GPU-storable scalars, vectors,
matrices, quaternions, colours, user structs or nested ordinary arrays. Capacity
is an integer literal or integer constant. The outer resource uses decision
0201's layout, with a 16,777,216-byte per-resource budget (hence no more than
4,194,304 elements). Nested ordinary arrays retain their existing length/layout
rules. Each expanded element/parameter layout has at most 16,384 nodes, bounding
compiler work even for compact source describing exponentially repeated structs.
Resources and stage input records are not storage elements or uniform values.

Inputs support indexed reads only. They cannot be copied, aliased, iterated,
returned or passed as whole buffers, or assigned through any field/index path.
A value read from an element is an ordinary value and can be copied or passed to
pure helpers. The output name identifies a host resource; source cannot read or
directly assign it. Each kernel invocation returns one element of exactly its
declared type, writing its own logical index. This avoids cross-invocation write
races. Constant invalid indices retain `E3030`; dynamic reads must use the
existing Mtek clamping semantics when lowered.

Uniform params are read-only in the kernel, at most 64 declarations and 65,536
bytes using existing uniform layout. Defaults, when supplied, are constants of
the declared type. One `kernel(input: ComputeInput) -> T` is required. Its body
must return on every path. Kernels are GPU effect roots: ordinary compatible
`fn` helpers, bounded loops and GPU values are allowed; CPU functions/captures,
unbounded GPU loops and fragment derivative operations are rejected at source.
Compute colour results have no opaque-material alpha warning.

`ComputeInput` contains fourteen u32 fields: `index`; `global_x/y/z`;
`local_x/y/z`; `group_x/y/z`; `group_count_x/y/z`; and `local_index`.
The workgroup size defaults to `[64, 1, 1]`. An explicit size is three constant
positive u32 values, at most `[256, 256, 64]` per axis and 256 invocations total.
These are this bounded profile's limits; runtime checks against the selected
device remain necessary. They are not a claim that Naga validates device limits.

`E4050` covers declaration shape/duplicates, `E4051` resource/value-layout budgets,
`E4052` invalid buffer access, and `E4053` workgroup size. Existing name, type,
return, immutable-param and GPU effect diagnostics retain their meanings.

## Required dispatch and lifetime contract

The following rules are decided for the next compiler/runtime integration, but
are not implemented by this source-checking increment.

Host dispatch supplies a nonzero logical 1D/2D/3D domain. The checked product
must fit the output capacity and u32; each rounded-up workgroup count must fit
the actual device limit. `index` is x-fastest logical linear order. Generated
entry code guards each global coordinate before calculating/writing that index,
so rounded workgroup tails do not alias a final output element. Group/count/local
fields retain WebGPU builtin meaning rather than the logical domain's dimensions.

The runtime owns input/output/uniform buffers for each compute instance. Inputs
are uploaded by value, with exact layout/length validation and retained CPU data;
input and output buffers cannot alias in this initial model. Each dispatch clears
its output, then writes its logical prefix; the tail is zero. Uploads, clearing,
dispatch, readback copies and later rendering are ordered on the same GPU queue.
There are no in-kernel dependencies requiring a barrier. General shared memory,
atomics, arbitrary cross-invocation writes and synchronization operations remain
unavailable until a separate contract and evidence support them.

Device recovery must reconstruct the last completed dispatch from its captured
input bytes, uniform values and logical domain. Later uploads/parameter edits
must not change that snapshot before a new dispatch. Pending readbacks must settle
or reject; no operation may wait forever on a lost device. Program replacement
invalidates old compute instances and releases their resources, rather than
carrying a kernel's imperative state into a different program. Disposal releases
GPU buffers, CPU snapshots and listeners. A packed f32 output must be usable for
the required generated-position rendering example; its render/lifetime API,
manifest schema and inspection integration still need implementation.

## Current boundary and required evidence

Every source compute declaration still receives an explicit `E4901` build gate
after checking. It cannot silently disappear from a built program or be packaged
without a runtime implementation. The existing IR lowerer also refuses a compute
declaration if it somehow reaches that boundary. No implemented compute capability,
public dispatch API, manifest entry or ABI update is advertised by this increment.
The new input record is available to the type checker and registry inspection.

The parser, formatter, AST dump/walk and name resolution preserve declarations,
comments, ownership and node/span invariants. Source tests check resource layouts,
invocation fields, workgroups, signatures, immutable access and GPU helper roots;
negative semantic fixtures retain diagnostic evidence. Existing context budget
limits stay unchanged; concise wording makes room for the new record.

The shader-authoring track remains open until real Mtek-source programs lower,
package, dispatch and render, numerical readback matches CPU and direct-WGSL
references, and lifecycle/replacement/recovery and required device tests pass.
Syntax or source-checking tests cannot substitute for that evidence.
