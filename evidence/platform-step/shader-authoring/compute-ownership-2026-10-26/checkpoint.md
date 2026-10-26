# Compute artifact and ownership checkpoint

Date: 2026-10-26. Implements the internal artifact/resource contract in
[decision 0203](../../../../spec/decisions/0203-compute-artifacts-and-internal-resource-ownership.md).
**Public compute remains incomplete and source builds still receive E4901.**

The compiler now returns validated compute artifacts with the exact dispatch,
uniform and storage layout records used by its WGSL. Compute maps have separate
content hashes after span IDs are assigned, so identical WGSL from different
declarations or builds cannot overwrite source provenance. A negative control
corrupts a kernel return and confirms that Naga prevents artifact creation.

Internal runtime owners now support exact-size copied byte uploads, per-instance
uniforms/resources, validated logical dispatch domains/device limits, cleared
output tails, ordered readback and immutable completed-dispatch snapshots.
Readbacks cannot expose a submission before its validation succeeds. Disposal and
loss cancel pending operations; recovery replays the completed snapshot and then
restores later staged uploads. Replacement invalidates old handles and pending
creation. Failed multi-instance recovery rolls back resources already recreated.
Allocation rollback, registry retirement and repeated cleanup release resources
exactly once. Disposed handles leave store bookkeeping.

The shared compiler/runtime fixture covers packed f32 and four-byte-struct
streams, nested arrays/structs, bool32/color, uniform arrays and three inputs.
Rust produces and checks the golden definition/WGSL; TypeScript consumes that
same definition, with no second layout algorithm. The fake backend records GPU
commands and uses an injected CPU callback. It does not execute WGSL or establish
numerical GPU correctness.

Verification:

- 923 compiler unit checks passed, two test threads.
- 49 focused compiler integration checks passed: compute_backend 5,
  compute_frontend 15, compute_lowering 9, naga_oracle 7, shader_lowering 9,
  wgsl_blocks 4. Existing material WGSL goldens remain unchanged.
- Three JavaScript source-map checks passed after updating their exhaustive IR
  visitor for StorageRead. The all-target compiler check caught that omission
  from the preceding checkpoint.
- Compiler Clippy, all targets, `--locked -j 2 -- -D warnings`, passed.
- Rust formatting/whitespace checks passed.
- 39 compute lifecycle/ownership checks and 26 registry checks passed, one worker.
- Runtime TypeScript and focused ESLint passed. Final editor ESLint also passed,
  closing that pending check from the previous checkpoint.
- No browser/GPU workload, sustained benchmark or animation optimization ran.

No manifest/schema, advertised language capability or runtime ABI changed.
The new runtime modules are internal and are not connected to `mountMtek` or
exported as a public API. They require whole packed uniform bytes; source defaults
and structured host values still need writer/API integration. Internal output
buffers carry VERTEX usage and store ownership checks, but there is no generated
mesh attachment or compute-to-render demo yet.

Next work: manifest/schema and inspection, source defaults/writers, public mounted
handles and source-mapped diagnostics, lifecycle wiring for startup/scene changes/
replacement/recovery, generated-position rendering, and numerical Mtek-source
checks against CPU/direct-WGSL references plus the required hardware evidence.
The broader platform scorecard remains open; heavy validation and animation
optimization remain deferred during the occupied-PC period.
