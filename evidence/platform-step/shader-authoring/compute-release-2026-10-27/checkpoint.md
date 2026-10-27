# Executable source compute: shadows and capability alignment

Date: 2026-10-27. Continues the roadmap without the earlier CPU/GPU testing
deferral. The full platform roadmap remains open.

## Public behavior

Ordinary Mtek source analysis/build now accepts bounded standalone `compute`
programs. The compiler test fixture no longer removes diagnostics, and its
provenance explicitly records ordinary public analysis. E4901 remains for a
compute member inside a material, with a message directing authors to a
standalone declaration. The accepted [contract](../../../../spec/compute.md) and
[decision 0207](../../../../spec/decisions/0207-source-compute-acceptance-and-capabilities.md)
state the API 1 limits; this is not unrestricted compute or a stable release.

The [public example](../../../../examples/compute-geometry/README.md) compiles with
ordinary `mtek check` / `mtek build`. It uploads a packed box stream, dispatches a
source-authored vec3 translation and borrows completed positions. The shadow
follows, the shared twin stays unchanged, and controls detach/release/recreate
the resources. The runtime implementation/bundle bytes are unchanged by this
increment; all eleven existing package limits remain unchanged and hold.

## Independent shadow acceptance

Both `hardware/` and `software/` pass nine browser tests, with zero failures or
NOT-RUN. The physical adapter is the Radeon RX 7900 XTX; SwiftShader is a software
backend on the same PC, not another physical-device tier. The suite retains the
preceding 13 numerical cases / eight shared kernels, independent direct-WGSL
geometry references, reset/replacement checks and a separate source-authored
shadow kernel. Source/config/runtime/package/reference hashes are retained.

For each low/medium/high directional shadow quality:

- Compare compute geometry against the original primitive moved by the equivalent
  CPU entity transform. The reference never reads transformed output vertices or
  a compiler layout. Both render paths keep the shared sibling.
- Verify an off-camera caster produces a visible shadow and a source-outside /
  final-inside case uses its authored final sphere. Compare culling enabled and
  disabled references. All twelve case/backend combinations have zero numerical,
  CPU-reference and culling-reference pixel differences.
- Require visible changes against both original geometry and an unshadowed
  control. Pending output matches a hidden caster, including no stale shadow.
- Stage a different offset, lose the device and require exact completed-snapshot
  recovery. Detach restores original pixels. All seven registry ownership
  counters are zero after every mounted application is disposed.

The actual example and off-camera preview screenshots were visually inspected.
Selected metrics are in [summary.json](summary.json); raw pixels (Base64), reports,
environment records and PNGs remain in the per-backend directories. Copied JSON
is sanitized without changing measurements/statuses.

The original `rejected-harness/` run is retained: the helper omitted host-input
declarations, causing E8040 and invalid CPU reference transforms, and its cube
face order did not match retained normals. The helper now reads/hashes the real
example project configuration and uses the primitive's normative face order.
No pixel/numerical/resource threshold was relaxed. Passing pre-gate checks are
also retained; final runs use public analysis with no bypass.

## Capability and tooling alignment

- The resolver has an implemented Compute construct; `mtek context` advertises
  `compute-programs` and exposes params, input/output buffers and kernel symbols.
  Host compute entry points are default context roots. A checked compute example
  joins the embedded library. Context remains format 2; the cold empty export is
  28,996 bytes against 30,000, preserving the required 1,000-byte project reserve.
  Wording was compacted; full schema/record/function preservation checks pass.
- LSP hover states host API 1 and shows typed compute parameters/resources.
  Completion covers module declarations, compute members and invocation fields,
  including a cursor at the start of a module. All 124 LSP unit tests pass.
- Coverage distinguishes compute uniform/storage reads from material parameters.
  It also repairs the earlier missing final-bounds binding variant. The matrix
  audits 409 features, 220 positive fixture projects and 251 diagnostic codes,
  with zero missing negative tests.
- Grammar has 86/86 productions, 127/127 alternatives and 19/19 semantic rules
  covered. The temporary standalone-compute build-gate annotation is removed;
  syntax is unchanged. Generated release documentation now describes executable
  source compute and the narrower E4901 trigger.

The broader audit also found earlier noncanonical vertex example formatting and
release-doc tests still treating E6003 as reserved. Formatting is corrected, and
the negative mutation tests now use permanently retired E5100. Original failed
audit logs are retained. The generated standard-library schema was also refreshed
from the registry to remove its obsolete dispatch-unavailable description.
The full grammar adapter corpus exposed two compute underscore-entry mutations
where parsing disagreed with StageFn's identifier syntax, and an older mixed
placement fixture missing from the conformance table after vertex support.
Compute now parses the same stage-name syntax and rejects invalid entry names
with E4050. A focused regression covers `_`, fragment, vertex and another name;
the placement fixture is classified as ungrammatical, not exempted from checks.
Final results are recorded in [validation.json](validation.json):

- 1,728 ordinary workspace tests pass, with one existing ignored test. The
  adapter failure from that invocation is retained; after repair, all 45,000
  conformance inputs pass with no mismatches or additional known differences.
- The final compiler library and CLI binary reruns pass 923 + 224 tests; compute frontend,
  syntax/semantic fixtures and compute lowering pass 16 + 23 + 12 tests.
- Browser harness, editor, coverage and release-doc unit suites pass
  314 + 81 + 52 + 127 tests. Browser TypeScript and all four focused lint checks
  pass. Workspace formatting and warning-denying Clippy pass.
- Ordinary example check, bindings/shader inspection and release build pass
  with zero source errors/warnings. Both inspection views expose its compute
  program. Final compiler coverage/release audits pass, and rebuilt runtime and
  compute packages remain byte-identical to the GPU-tested artifacts.

These results combine the recorded workspace run and focused post-repair reruns;
they do not relabel the earlier failing invocation as an all-green run.
An initial Windows executable-lock failure is retained separately from product
correctness. Later overlapping read-only audits use an isolated CLI copy;
final compiler audits use the rebuilt ordinary CLI after other CLI users finish.

Bounds/IK/collision overlays, combined authored shared-pose instancing, broader
animation compositions, wider devices, material/streaming/long-session workload
evidence and the remaining platform work are not closed by this increment.
