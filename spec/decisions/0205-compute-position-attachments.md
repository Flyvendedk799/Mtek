# 0205: Bounded compute position attachments

Status: accepted, 2026-10-26; temporary public gate superseded by [0207](0207-source-compute-acceptance-and-capabilities.md). Extends 0203/0204 as development integration.
Ordinary source builds retain E4901 pending numerical GPU/render acceptance.

## Representation and target

`handle.attachPositions(entitySymbol, bounds)` borrows an owned compute output for
one declared drawable entity in the current scene. It returns a disposable
`MtekComputePositionAttachment` with copied inspection metadata. The symbol is the
fully qualified declaration, such as `src/main.mtek::Demo.Shape`; spawned entity
slots and names alone are not accepted. Other entities sharing the original mesh
retain their original positions and buffers.

The output must be a packed scalar f32 xyz stream: stride 4, length exactly three
times the target mesh's vertex count, with a successful complete-output dispatch.
Storage vec3 arrays have a different stride and are rejected. Target topology,
indices, normals and UVs remain the source mesh's; the host owns the meaning of
those retained attributes. Skinned meshes and authored vertex-stage composition
are rejected in this first bridge. No public GPU buffers, ownership transfer,
cross-app handles, general interleaved attributes or generated topology are added.

The required sphere is finite, positive and mesh-local. It must conservatively
enclose all output positions used while the attachment lives. It supplies the
final local bounds, taking precedence over the source entity's authored sphere.
Centers and radius are copied, not rounded inward; transformed bounds use the
existing conservative scale for shear. Culling/sorting are invalidated on attach,
detach and output availability changes. Detach before changing the envelope, then
attach with the new sphere after dispatch. The host is responsible for matching
the sphere to its kernel; there is no CPU readback of vertices on the draw path.

## Ordering and lifetime

Rendering borrows the output only after dispatch completion and validation.
The current single-output-buffer owner cannot preserve old output while a new
dispatch overwrites it. Therefore an attached entity is excluded from camera,
instanced and shadow draws while dispatch validation is pending, or after failure.
It resumes on success. Attached handles reject dispatches whose logical domain
does not cover the complete output. Parameter edits/uploads only stage future
dispatches, so they do not invalidate the current output.

The mesh store polls a private ready-output accessor before reusing draw lists.
Its borrowed wrapper has independent identity/order, shares original indices and
non-position attributes, and owns no buffers. Disposal restores the original mesh
and is idempotent. Disposing a compute handle first detaches all its leases, then
releases owned resources. Mesh retirement never releases the borrowed output.

Device loss drops scene bindings before registry retirement but retains attachment
intent. Recovery replays completed compute state, binds the new output into the
rebuilt scene, and then commits the mounted recovery. Failed recovery releases
candidate bindings and remains retryable. Neither old mesh wrappers nor output
buffers may be reused after loss.

Program replacement invalidates handles and attachments. Scene reset/go_to with
identical compute contracts preserves program-owned handles, while disposing all
scene-local attachments. The next scene needs a new explicit attachment. Equality
checks API, definitions, shader hashes, defaults and parameter shapes; source-map
URLs/span indexes may differ between scene packages. A scene with changed compute
definitions gets a fresh store. Rejected candidates leave the live store untouched.
This also corrects the previous mounted implementation, which disposed compute
handles on every scene swap despite the program-lifetime contract in 0204.

## Evidence boundary

The shared source fixture now includes a 72-scalar position kernel and two entities
sharing a box mesh. The development compiler harness packages its actual source,
shaders, maps, defaults and JavaScript; tests mount that package and verify borrowed
draw buffers, bounds, pending/failure suppression, replacement, reset and recovery.
The fake executes an injected CPU callback, never WGSL. These are ownership and
render-command checks, not numerical GPU or pixel acceptance. The numerical
CPU/direct-WGSL comparison and rendered reference example remain required before
removing E4901 or advertising source compute as usable.
