# Mtek runtime SDK and extension compatibility

The local `@mtek/runtime-web` package exposes its supported declarations and ESM
bundle at the package root. Compiled Mtek applications continue to carry their
own relative runtime bundle; npm installation is not required for those apps.
That bundle is the core runtime (`dist/core*.js`): it has no skeletal animation code. A compiled
application with a skinned mesh or `clips_from` also carries the animation module `animation/<hash>.js`,
which its runtime imports at mount (decision 0225). The package root exports the whole API, including
`createAnimationController`, `mapHumanoid`, `retargetHumanoid`, `retargetSkin` and `deformSkin`,
synchronously: host code bundles what it imports.
The package remains private and has not been published to a registry. Local
tarballs can be built with `npm run build -w @mtek/runtime-web` and
`npm pack -w @mtek/runtime-web`. The public declarations are validated with TypeScript 6 browser DOM definitions
and require no repository source aliases. Older TypeScript hosts must supply
compatible WebGPU declarations themselves. The SDK does not force a second set
of global WebGPU declarations into a host that already provides them.
The package's types entry names the maintained, self-contained public declaration
file, so workspace type checking works without `dist/`. Tarballs include that
declaration and built ESM, while implementation sources stay outside the package.
The annotated declaration remains the SDK types entry. Compiled applications
receive the same declarations with comments and redundant whitespace omitted.
Token-aware compaction verifies identical parsed declarations, preserving literal
contents and the complete public type surface (decisions 0206 and 0208).

## API 1 contract

Extensions implement the public `MtekExtension` interface. A host validates a
nonempty unique ID and `apiVersion: 1` before setup. Unsupported versions fail
mount rather than silently degrading. Setup runs in declaration order; cleanup
runs in reverse order during application disposal or setup rollback.
An extension must release anything acquired before its own setup throws. Cleanup
must be idempotent. A failing frame hook disables that extension, reports a runtime
diagnostic and runs its cleanup once while the application continues.

Contexts are valid only during their application's lifetime. Scene replacement or
recovery can reconstruct entities while retaining the extension; query fresh IDs
and animation players after reconstruction. Transform reads are
copies; IDs are opaque and scoped to scene/spawn generations. Query again after
scene changes. Transform batches validate completely before applying writes.
Writes are local transforms before bindings; bindings/physics retain ownership.
Extensions receive host services only when the application explicitly supplies
them. They do not gain renderer internals, network capabilities or GPU access.

The optional [`@mtek/inspector`](../inspector/README.md) package demonstrates this
boundary with entity selection, transform history, animation controls, world
overlays and optional host-supplied metrics. Its JavaScript includes no runtime
implementation.

Optional `context.inspectScene?.()` and `player.inspect?.()` return fresh copied
world/camera/physics and animation diagnostics. Read them after frames: inspection
does not propagate transforms, evaluate poses, step physics or submit GPU work.
World matrices include parents; nodes remain in mesh-local space before authored
material deformation. Body poses and collider dimensions come from the physics
backend contract. Missing/stale bounds and unsupported contacts remain unavailable.
See the [inspection contract](../../spec/inspection.md) and the public-package
[inspection studio](../../examples/inspection-studio/README.md).

## Compatibility and release policy

- The current packages are `0.1.0-dev` development snapshots, not a stable public
  release. Keep packages from the same tested checkout together. The inspector's
  peer dependency pins that development version; it also checks extension API 1.
- API 1 changes must preserve its documented meanings. New optional fields and
  optional capabilities may be additive; removing/changing existing behavior
  requires a new extension API version with explicit validation and migration
  documentation. A version number must not be accepted by coercion.
- A future stable package release must pin tested runtime/extension versions,
  include distribution declarations and lifecycle/error contract tests, describe
  supported environments and breaking changes, and retain a migration path. This
  policy does not claim that such a public release already exists.
- Import public package exports. Repository `src/`, compiled object layouts,
  shaders and renderer internals are not supported extension interfaces.

Validation uses an installed local-tarball consumer with strict TypeScript and no
repository aliases, plus mounted lifecycle tests using a fake GPU. This establishes
the package/API boundary; browser/device rendering support has its separate
contract and still requires WebGPU and real-device evidence.

## Bounded source compute (API 1)

The current snapshot exposes `app.createCompute(qualifiedId, params?)` and
`MtekComputeHandle` for packaged compute declarations. Ordinary Mtek source builds
now package standalone compute declarations. Numerical, geometry/shadow and
lifecycle acceptance passes on Radeon and SwiftShader. Compiler tests use ordinary
analysis without stripping diagnostics. This development snapshot is not a stable
release; see `spec/compute.md` for the bounded API 1 contract.

Creation applies source defaults and requires every parameter without a default.
`setParam(name, value)` validates/copies values through generated uniform writers.
Vectors accept component objects or exact arrays, colors use linear rgba values,
matrices use 16 column-major values, and arrays/structs require their exact shape.
`upload(name, view)` copies exactly one full input buffer, using the byte length
and storage layout returned by `inspect()`. Dispatch accepts one to three positive
logical dimensions whose product fits the output capacity. Await `dispatch`
before consuming its completion; `readback()` returns a separate packed buffer
and zeroed unused output slots. There is one pending dispatch and at most four
pending readbacks per handle.

Handles work while running or paused, survive scene changes and device recovery,
and become disposed when the program is replaced or the app is disposed. Recovery
replays the last completed dispatch and preserves subsequent staged edits for the
next dispatch. Dispose unused handles explicitly. GPU buffers are not public API.
See [decision 0204](../../spec/decisions/0204-compute-packaging-and-mounted-handles.md)
for lifecycle, diagnostics and evidence boundaries.

`handle.attachPositions("src/main.mtek::Demo.Shape", { center: [0, 0, 0], radius: 2 })`
borrows a completed packed scalar f32 xyz output for one declared entity. Its
capacity must equal three times that mesh's vertex count. Indices, normals and UVs
are retained; skinned targets and authored vertex-stage composition are currently
rejected. The explicit final local sphere must cover every position rendered
while the attachment lives. Dispose the attachment to restore the original mesh.
The entity is hidden while a subsequent complete-output dispatch is pending, and
after dispatch failure. Recovery reacquires its recreated output. Scene changes
dispose attachments while preserving identical program compute handles; program
replacement disposes both. See [decision 0205](../../spec/decisions/0205-compute-position-attachments.md).
