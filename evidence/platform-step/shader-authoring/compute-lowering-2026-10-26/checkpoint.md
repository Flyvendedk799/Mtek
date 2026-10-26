# Compute lowering and editor checkpoint

Date: 2026-10-26. Paused at the user's request after the focused checks finished.

Checked compute declarations now lower into self-contained typed IR: qualified
symbols, uniform defaults/layouts, ordered input resources, output capacity/layout,
workgroup dimensions and a typed kernel. Indexed input reads have a distinct
`StorageRead` expression; the array itself never becomes a copyable value.
CPU emission and prefab substitution reject storage reads.

The shader backend shares material expression/statement lowering and the helper
dependency graph. It emits read-only input arrays and a read/write output, preserves
bool32 and nested-array wrappers, clamps dynamic signed/unsigned input indices,
and retains source maps. The entry supplies all fourteen ComputeInput fields.
It guards all three global coordinates before calculating the x-fastest logical
index, then writes one kernel result per logical slot. Host domain validation
remains required: nonzero axes, checked product fitting u32 and output capacity.

Development binding layout: group 0 dispatch at binding 0, optional params at 1,
inputs in declaration order starting at 2, output immediately after the inputs.
`compute_dispatch_layout()` supplies the authoritative layout of the x/y/z u32
dispatch block. This is an internal backend contract awaiting manifest/runtime
integration, not a released compute API or ABI change.

Public analysis and builds still report E4901. The new tests explicitly assert
that gate before removing only E4901 inside their development harness. The
resource planner independently rejects compute programs while packaging is
unfinished. These tests do not prove dispatch, numerical GPU results, readback,
lifetime/recovery or compute-to-render behavior.

Editor Enter rules now handle wrapped binary expressions, including nested call
arguments and restoration after the final semicolon/comma. The corpus check
evaluates Enter rules as well as structural indentation. Existing source examples
and frozen evidence were not rewritten to make the check pass.

Verification at this checkpoint:

- 46 compiler integration checks pass, with Cargo jobs/test threads capped at two:
  compute_lowering (6), compute_frontend (15), compute_backend (5), naga_oracle (7),
  shader_lowering (9), wgsl_blocks (4). This includes all existing material goldens.
- Source-to-WGSL checks cover 13 scalar/composite element types, helpers, mutable
  structs, bool encoding, clamping, source maps and deterministic output. A small
  interpreter evaluates the actual generated entry guard/index expressions over
  five rounded 1D/2D/3D domains, checking complete unique logical-slot coverage.
  This is CPU IR correctness evidence, not GPU execution evidence.
- Editor unit tests: 81 passed. Real VS Code 1.142.0 integration: 11 passed,
  including actual Enter typing, with GPU acceleration disabled. Editor build
  and ESLint passed before the final integration test was added; final lint and
  broader Rust unit/Clippy checks remain for resumption.
- Rust formatting is applied at the stopping checkpoint. No sustained benchmark,
  animation optimization or GPU workload was run.

Next: finish manifest/resource inspection and runtime ownership, upload, dispatch,
readback, disposal/replacement/recovery, then perform the required numerical and
compute-to-render validation when the user's CPU/GPU scheduling permits it.
