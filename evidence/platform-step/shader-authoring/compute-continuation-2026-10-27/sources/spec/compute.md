# Bounded standalone compute (API 1)

Standalone `compute` declarations are executable module items. They may be
exported/imported and call GPU-compatible helpers. `compute` remains reserved as
an ordinary identifier; a compute member inside a material is E4901. Compute
programs are invoked from the mounted JavaScript host, not from Mtek CPU code.

```mtek
compute Scale {
    param gain: f32 = 2.0;
    input source: array<f32, 16>;
    output result: array<f32, 16>;
    kernel(input: ComputeInput) -> f32 {
        return source[input.index] * gain;
    }
}
scene Demo { camera Main {} }
```

The kernel returns one output element per logical invocation. Input buffers are
read-only. Direct output reads/writes and whole-buffer values are rejected. The
output element type must match the return type. Boolean storage values use u32;
scalar xyz streams are tightly packed. Composite storage retains the checked
layout's padding/strides; use inspection metadata rather than assuming a layout.

## Limits and invocation

- At most four input storage buffers and exactly one output. Each is a fixed
  outer `array<T,N>` of at most 16 MiB. Nested types must fit the existing layout
  profile; expanded layouts are capped at 16,384 nodes.
- Up to 64 typed uniform parameters / 65,536 bytes. Defaults are constant;
  parameters without defaults must be supplied by the host. Writers are generated
  from the same layouts as WGSL, with finite-value/type/shape validation.
- Optional `workgroup_size: [x,y,z];`, default `[64,1,1]`. Axes are bounded by
  `[256,256,64]`, with at most 256 invocations per group. Actual device limits are
  checked before allocation/dispatch; source limits do not guarantee every device.
- A dispatch has one to three positive integer dimensions. Their product must
  fit output capacity. Workgroups round up; excess invocations return before
  accessing storage. Index flattening is `x + sizeX*(y + sizeY*z)`.
- `ComputeInput` exposes `index`, `global_x/y/z`, `local_x/y/z`, `group_x/y/z`,
  `group_count_x/y/z` and `local_index` as u32. Dynamic input reads clamp to input
  capacity; constant out-of-range reads are source errors.
- One pending dispatch and up to four pending readbacks per handle. Undispatched
  output tails are zeroed on each dispatch. Uploads and parameter changes stage
  copied CPU data; callers retain ownership of their input views.

```js
const compute = await app.createCompute("src/main.mtek::Scale", { gain: 3 });
compute.upload("source", Float32Array.from({ length: 16 }, (_, i) => i));
await compute.dispatch([16]);
const output = new Float32Array(await compute.readback());
compute.dispose();
```

Storage/uniform textures, workgroup shared memory, barriers, atomics, indirect
dispatch and general compute graphs are not part of API 1. A host orchestrates
ordered dispatch/readback explicitly. See decisions 0201–0205 for checking,
artifacts, ownership, packaging and completed-output recovery.

## Rendering and lifetime

`handle.attachPositions(entitySymbol, {center:[x,y,z], radius})` borrows the
completed packed f32 xyz output for one declared static, unskinned mesh. Output
must contain exactly three scalars per source vertex, with a completed full-output
dispatch. Bounds must be finite and enclose every final local vertex. The entity
must not use an authored vertex stage. Indices, normals and UVs remain unchanged;
the host must preserve their validity. Translation in the supplied example does.

The bridge isolates mesh identity from sibling instances, uses the same position
buffer for visible and shadow passes, and suppresses both while output is pending,
failed or unavailable. Off-camera opaque casters still cast shadows. The lease's
`dispose()` restores original geometry. GPU resource ownership remains with the
compute handle; the renderer never destroys a borrowed output.

Device recovery replays the last completed input/parameter/domain snapshot before
exposing output, preserving later staged edits for the next dispatch. Scene reset
or change retires attachments and preserves identical program compute handles.
Committed program replacement invalidates handles and leases; app disposal releases
all tracked owners. API 1 is an additive development ABI 1 manifest extension,
not a stable published package guarantee.

`mtek inspect --bindings` and `--shaders` include compute definitions, capacities,
strides, slots, WGSL and source maps. `mtek context` advertises `compute-programs`
and includes compute parameters, buffers and kernel symbols. The executable
[geometry/shadow example](../examples/compute-geometry/README.md) and
[acceptance probes](../tests/browser/COMPUTE-ACCEPTANCE.md) retain the tested scope.
