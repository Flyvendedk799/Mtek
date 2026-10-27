# Source compute acceptance probes

Status: numerical, geometry/shadow, pending-output and recovery probes **pass on
Radeon hardware and SwiftShader**. The
[public compute checkpoint](../../evidence/platform-step/shader-authoring/compute-release-2026-10-27/checkpoint.md)
supersedes the historical development-only gate. Ordinary source builds package
standalone compute. E4901 rejects compute declared as a material member.

The focused configuration prepares only the environment probe and compute package.
It does not run the broad browser suite, build unrelated examples, optimize
animation or collect sustained performance measurements. It uses one worker and
zero retries. Hardware and software results remain separate.

Build the current runtime and select
one project explicitly from the repository root:

```powershell
npm run build -w @mtek/runtime-web
npm run test -w @mtek/browser-tests -- --config=compute.config.ts --project=hardware
npm run test -w @mtek/browser-tests -- --config=compute.config.ts --project=software
```

The user explicitly re-enabled CPU/GPU testing and animation optimization on
2026-10-27, including while doing other work. A missing
adapter is NOT-RUN through the existing GPU fixture, never a passing test. The
hardware project rejects a fallback adapter. Results include the existing
browser/OS/adapter environment record. These are bounded correctness checks, not
benchmarks or evidence for additional physical-device tiers.

## Compiler and fixture provenance

`support/compute-fixtures.ts` invokes the focused Rust compute integration tests
with explicit output directories and two Cargo jobs/test threads. They assert
ordinary public analysis succeeds; no diagnostics are stripped. They package the shared
`tests/codegen/compute-contract/kernel.mtek`, actual generated JavaScript/writers,
Naga-validated shaders, source maps, defaults and the current development runtime.
The built runtime is preferred; a fresh checkout can use its tracked prebuilt copy.
The shadow package compiles the actual `examples/compute-geometry/scene` source
and host configuration, with separate source/configuration hashes. The public
example page is served with this same compiler-produced package.

Runtime filenames hash the bytes actually served. `acceptance-build.json` records
source/runtime/file hashes, and preparation verifies them. It does not inject a
different runtime under a stub runtime's content hash. The shared fixture contains
eight kernels; no handwritten WGSL stands in for compiler output.

## Checks to execute

- Position arithmetic, typed parameter packing and nonzero-offset upload views:
  logical domains 1, 71, 72 and 3×4×6 over a 72-f32 stream, with zero tail checks.
- All fourteen invocation fields: domain 5×3×3, workgroups 4×2×2, capacity 257.
  The independent reference uses the fixed storage layout of fourteen u32 fields
  (56 bytes), not offsets copied from the compiler's output.
- Numerical comparison against independent CPU math and independently written
  WGSL. Records retain all three raw little-endian buffers as Base64, with mismatch
  counts. The arithmetic cases require exact words.
- Scalar/vector/matrix copies, padded nested arrays, a nested record transform
  with four inputs, nondefault vector/array/scalar parameters, boolean updates
  and a required parameter. All eight packaged kernels execute over 13 cases.
  Shrinking 3D domains check that prior output tails are cleared. Active ABI
  padding is not a value and is excluded from comparison; every undispatched
  tail word must be zero. Records list the independent fixed stride/field mask.
  The direct reference deliberately uses a different parameter layout and
  word-addressed storage. Matrix storage copy is covered; the Transform fixture's
  unused matrix/settings parameters do not establish matrix-uniform arithmetic.
- Borrowed geometry versus CPU-transformed and direct-WGSL-transformed vertices
  rendered through an independent flat pipeline. A custom quad replaces one box
  face; other faces collapse to degenerate triangles. The sibling entity is moved
  away. Projection and sRGB conversion are independently assembled for the fixed
  source camera/material. Pixel tolerance is fixed at two channel values and at
  most four differing pixels; the geometry must visibly differ from the original.
- Recovery must restore the completed output rather than a later staged edit.
  Detach restores the original image; reset preserves program compute state and
  retires the scene lease; committed replacement invalidates handles/leases.
  Tracked live resources must be zero after disposal. Raw reference/main/recovery
  pixels and a preview screenshot are retained.

The lab at `/compute/index.html` exposes the same probes as explicit buttons. Page
load does not acquire a GPU. The browser tests call those actions; CPU preparation
only bundles them. The measured cases have exact numerical equality, zero
CPU/direct-reference pixel differences and identical recovery/detach pixels on
both backends. Composite arithmetic also passes on both backends.

Six shadow cases per backend compare compute-translated vertices to an ordinary
box moved by the equivalent CPU entity transform. Both retain an unchanged
shared twin. All low/medium/high quality levels cover an off-camera caster and a
source-outside/final-inside culling case, with tight final local bounds. Culling
enabled/disabled references agree; numerical and CPU-reference pixel differences
are zero in the recorded runs. An unshadowed control must differ visibly.
Pending output must match a hidden caster including its absent shadow. Recovery
must replay the last completed offset rather than a staged edit; detach must
restore original geometry/shadows. All tracked registry resources are released.
Completion of the pending dispatch must restore the original computed image
without replacing its lease. A second translation through the recovered handle
must match a fresh CPU entity-transform reference and differ visibly from both
the first output and an unshadowed control. Its replacement lease supplies the
new final local sphere. Raw pixels retain every intermediate image.

Nine tests per backend also exercise the public example's controls, detach,
resource release and recreation. Wider physical-device tiers and the remaining
platform roadmap are separate work; this is bounded correctness evidence.
