# Compute position render bridge

Started 2026-10-26; checkpoint completed 2026-10-27. Implements [decision 0205](../../../../spec/decisions/0205-compute-position-attachments.md).
Ordinary source builds still emit E4901. This is development integration using
actual compiler artifacts and CPU fakes, not numerical GPU acceptance.

`handle.attachPositions(qualifiedEntitySymbol, sphere)` borrows a completed packed
f32 xyz output for a declared drawable entity. Capacity must equal three times
its mesh vertex count. Indices, normals and UVs stay with the original mesh;
skinned targets, authored vertex stages and spawned targets are excluded. The
copied finite sphere supplies final mesh-local culling/sorting bounds, including
conservative scaling under shear. Detach and reattach to change that envelope.

The borrowed mesh has independent identity/order, isolating it from other entities
and instanced batches using the same original mesh. It owns no GPU resources.
Pending/failed output is excluded from draw lists, including the list passed to
shadows. Subsequent attached dispatches must cover the whole output. Parameter
edits and uploads stage future work without changing current output. Disposal
restores the original mesh without releasing shared buffers. Handle disposal
detaches first, then releases the owned output.

Recovery drops old bindings, replays completed compute state, and binds a newly
created output in the rebuilt scene before committing. Failed recovery remains
retryable. Scene reset/go_to preserves identical program compute contracts and
retires scene-local attachments; program replacement invalidates both. This fixes
the previous implementation's unconditional store disposal on scene changes.

The shared Mtek source fixture now contains seven kernels, a 72-scalar position
transform, and two entities sharing a box. Its generated package is checked
against the compiler, with stale shader/map files rejected. Mounted CPU checks
verify buffer borrowing, unchanged sibling geometry, copied bounds, pending and
failed dispatch suppression, culling after host transforms, instancing separation
and regrouping, recovery, reset, replacement and release. The callback executes CPU
arithmetic; it never interprets WGSL. Actual GPU arithmetic, shadow/pixel reference
checks and wider physical-device acceptance remain required.

Validation: 1,651 runtime tests pass across 107 files with one worker. The selected
compiler suites pass 65 tests with two jobs/test threads. Workspace TypeScript,
runtime lint, compiler Clippy and formatting checks pass. Current commands, source
hashes and final package sizes are retained alongside this record. No GPU/browser
process, sustained benchmark or animation optimization was started.

The JavaScript minified runtime grows by 5,173 bytes versus the preceding
checkpoint. [Decision 0206](../../../../spec/decisions/0206-compact-shipped-runtime-declarations.md)
omits comments from distributed application declarations while retaining the
annotated npm SDK source. Tests compare complete declaration syntax and compile
the distributed file independently. The new declaration is 18,747 bytes, 2,471
bytes below this feature's annotated source and 1,935 below the preceding shipped
declaration. Combined JavaScript/declaration growth is 3,238 bytes. Package limits
are unchanged: all eleven examples pass both folder and ZIP checks. The smallest
remaining ZIP margin is 1,168 bytes (stage-show). These are distribution costs,
not execution performance evidence.
