# 0203: Compute artifacts and internal resource ownership

Status: accepted, 2026-10-26. Extends decisions 0201 and 0202. Implemented as
development compiler/runtime infrastructure; public compute packaging remains gated.

## Artifact boundary

`emit_compute` lowers a checked compute item, prints it and runs the existing
mapped Naga validator before returning an artifact. It carries WGSL, its SHA-256,
source maps and a serialized resource definition: symbol, entry point, workgroup
size, dispatch layout, optional uniform layout, ordered inputs and output. All
storage offsets/strides and uniform offsets come from the existing layout engine.

WGSL files use their WGSL content hash. Compute span-map files use a separate
hash of their actual compact JSON bytes, after span IDs have been interned. Two
identical kernels can share WGSL but have different declaration symbols, source
spans or manifest span IDs. Giving their maps the WGSL filename would overwrite
provenance or serve a stale cached map. This change applies to the new compute
artifact path; existing material artifact behavior is unchanged.

Group 0 has dispatch at binding 0, optional uniforms at 1, inputs in declaration
order starting at 2, and output at `2 + inputs.length`. The dispatch record holds
x/y/z u32 values at its recorded offsets. The runtime must not reconstruct their
offsets from an independently maintained layout.

## Internal runtime owner

`compute/definition.ts`, `compute/instance.ts` and `compute/store.ts` implement
internal owners. They are not exports of `runtime-web`, are not called by
`mountMtek` yet, and do not change the manifest schema, runtime ABI or advertised
language capabilities. This is not a claim that public Mtek programs can dispatch.

An instance owns distinct input/output/uniform/dispatch buffers, its compute
pipeline, bind group and temporary readback buffers. The host supplies a previously
validated shader module. Shader loading and source-mapped GPU diagnostics remain
the mounted integration's responsibility. The owner creates no shader module and
does not release the caller's shared module.

Definitions are copied after checking structural layout bounds, four inputs,
16 MiB per storage resource, 64 KiB uniforms, layout depth 256/16,384 nodes, source
workgroup bounds and the actual device's storage/uniform/binding/workgroup limits.
Validation traverses layout descriptions, not every element of a large resource.
Packed uploads copy exactly the whole declared resource or uniform block, including
only the supplied view's byte range. This internal API requires full uniform bytes;
source defaults and structured host values still require compiler writer/host API
integration. Fresh inputs and output are zero initialized.

Each dispatch checks one to three nonzero logical axes, the safe product against
output capacity/u32 and rounded group counts against the device limit. It captures
input bytes, uniforms and domain by value before submitting. Only one dispatch may
be pending per instance. Later uploads/edits may stage new data without changing
that snapshot. A command buffer clears output before dispatch, so unused tail slots
remain zero. The last completed snapshot changes only after queue completion and
validation succeed. A failed dispatch invalidates that instance's output/resources.

Readback copies on the same queue into a private MAP_READ/COPY_DST buffer. There
are at most four pending readbacks per instance. A copy made during a dispatch
also awaits that dispatch's validation, so mapping cannot expose output from a
failed submission. Returned ArrayBuffers are independent copies. Device loss,
disposal and replacement explicitly reject pending work even if a browser promise
does not settle. GPU promise ordering is used only as specified by
[WebGPU section 3.2.2](https://www.w3.org/TR/webgpu/#promise-ordering).

Recovery recreates resources and replays the immutable last completed dispatch,
then restores any later staged input/uniform bytes without rerunning them. With no
completed dispatch it restores current inputs and an empty output. A failed replay
releases newly created resources and remains eligible for retry. Old completion
callbacks cannot overwrite recovered state. The owner accounts for registry
generation changes and releases partial or pending allocations exactly once.

The store validates a candidate before replacing live definitions. Committed
replacement disposes all previous instances and cancels pending creation; it does
not migrate kernel state. Handles remain usable through recovery. A failed batch
recovery rolls back all instances that already recovered. Disposing one handle
during its replay removes that instance without blocking recovery of the others.
Device-loss and disposal entry points must be connected to the mounted app before
retiring its registry. Weak device-loss callbacks avoid retaining disposed instances.

An internal render-buffer lookup enforces current store/handle ownership and gives
the output VERTEX usage. The renderer must reacquire after recovery. There is no
implemented generated-mesh attachment, bound update, render lifetime API or
compute-to-render demonstration yet.

## Evidence and remaining integration

The shared `tests/codegen/compute-contract/` fixture contains scalar storage, a
four-byte struct stream, nested struct/array/bool/color values, uniform arrays and
multiple inputs. Rust checks its definition and WGSL against the actual compiler;
TypeScript consumes the same definition to allocate/bind resources without another
layout algorithm. Its source intentionally still receives E4901.

The CPU fake records clear/dispatch/copy ordering and runs an injected CPU callback.
It does not interpret WGSL and is not numerical GPU acceptance evidence. Focused
tests exercise copies, cancellation, validation errors, replacement, recovery
snapshots/retries and resource release. Naga tests validate compiler artifacts and
reject a deliberately corrupted return type. Separate map hashes are checked with
identical WGSL and different source symbols/span indexing.

Required next work is manifest/schema and inspection integration, source parameter
defaults/writers, mounted public handles and diagnostics, startup/scene-change/
replacement/device-recovery wiring, a generated-position render bridge, then actual
Mtek-source numerical readback against CPU/direct-WGSL references and the required
physical-device evidence. E4901 and the planner's packaging guard remain until that
path exists. No heavy CPU/GPU benchmark or animation optimization is part of this
increment.
