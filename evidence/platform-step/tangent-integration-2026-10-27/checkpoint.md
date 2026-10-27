# Authored tangent integration and current compute checks

2026-10-27. **Tangent integration is implemented. The full platform roadmap and
the complete material performance/comparison protocol remain open.**

## Delivered behavior

- Import optional FLOAT/VEC4 tangents with finite, normalized direction and
  handedness ±1; require normals, preserve original packed bytes, and diagnose
  the first invalid frame with E7027. Old packages without tangents remain valid.
- Expose `VertexInput.tangent`, `SurfaceInput.world_tangent` and structured vertex
  tangent output. Use location 11 after the reserved instance matrix locations;
  typed payloads continue to use free varying locations within the existing bound.
- Transform tangents linearly, normalize each vertex direction before
  interpolation, and reconstruct the mapped frame against the final normal.
  Imported static/skinned frames, mirrored UV handedness, authored replacements
  and nonuniform instance transforms are supported. An authored vertex stage
  without a replacement frame selects the derivative fallback.
- Share immutable source/fallback streams and pose cohorts. Deform tangents only
  for consumers that need them; retain CPU fallback, eight-binding GPU skinning,
  device recovery and explicit resource ownership. Missing frames allocate a
  shared zero-initialized 16-byte-per-vertex buffer without per-frame upload.
- Align schemas, context, completion, diagnostics, release docs and the asset
  audit. Runtime region checks reject truncated, misaligned, missing and
  overlapping tangent/index streams. The coverage generator replaces its output
  atomically to handle mapped documents on Windows.

See [decision 0212](../../../spec/decisions/0212-authored-tangent-integration.md)
and the [preceding numerical foundation](../tangent-deformation-2026-10-27/checkpoint.md).

## Acceptance and controls

Thirty-two focused checks pass: sixteen on Radeon and sixteen on SwiftShader.
Independent frame/BRDF references cover nine tangent cases and the existing
derivative controls; every tangent probe distinguishes a stated incorrect frame
by at least eight channel values, with an acceptance tolerance of three. The
varying-direction case exposed and fixed the earlier raw-length interpolation
error under nonuniform scale. GPU-skinned shadow comparisons at all three
qualities match independently translated static geometry, with exact
culled/unculled and recovery comparisons and zero tracked resources after disposal.

The broader animation/material/lighting/alpha/sprite run passes 114 checks, and
the current standalone compute suite passes all 18. Compute shadows cover every
quality, final bounds, off-camera casters, pending completion, recovery and
changed output. Its context capability still matches successful ordinary builds;
material-local compute remains E4901. These results extend the preceding
[compute continuation](../shader-authoring/compute-continuation-2026-10-27/checkpoint.md).

The runtime suite passes all 1,672 tests; current asset/aggregate/manifest tests,
workspace Clippy, TypeScript, lint, coverage/release checks and all eleven package
budgets pass. The pinned asset audit now checks 21 inputs and 38 expected import
or usage outcomes, including explicit rejections. The cold context retains its
existing 30,000-byte budget and 1,000-byte project reserve. Final compiler
packaging after an equivalent Clippy iterator rewrite produces byte-identical
complete packages for all eleven tangent fixtures used in the GPU captures.
The validation inventory records logs and source snapshots, including rejected
intermediate attempts. The full workspace run completed with one stale registry
assertion listing the previous surface fields; that expectation is corrected and
all 25 tests of its target pass on revalidation. Across completed targets there
are 1,753 passing Rust tests and one ignored stress test. The original failed
workspace log and the targeted correction are both retained; a single green
full-workspace invocation is not claimed. Exhaustive grammar conformance passes
all 45,034 inputs, and constrained generation smoke passes too.

## Original product and remaining comparison boundary

The unchanged Khronos WaterBottle is retained in
[`benchmarks/material-lighting/assets/WaterBottle`](../../../benchmarks/material-lighting/assets/WaterBottle/README.md)
with upstream provenance and license metadata. Its SHA-256 is
`b337e526fd6a162013c2984aeec163f5fbb4f717252724dfc3f3458bd51df94b`.
All 2,549 vertices, 13,530 indices, original tangents, textures/material and original
node rotation are preserved. Preparation compares packed geometry/index streams
byte for byte; the native reference hashes the actual received original GLB.

The complete hardware matrix passes all ten workload/profile pairs. The product
normal-map controls change 33/28 pixels at low quality and 153/121 at standard
quality in Mtek/Three respectively, above the predeclared 20/80 gates. Projected
product errors remain within the unchanged visual thresholds.

The software matrix is **failed**, with eight other pairs passing. Mtek's product
normal controls pass (31 and 149 changed pixels); Three's fail (zero and three).
Diagnostic readbacks show identical original mip-zero texture bytes and identical
generated shader sources between backends, but different native generated mip
bytes. This identifies a preprocessing difference; it does not prove the only
cause of the visibility failure. Diagnostics add COPY_SRC to the texture usage
and are explicitly ineligible for performance claims. The reference renderer,
original asset and acceptance threshold were not changed to force a pass.

The failed controls, earlier insufficiently discriminating calibration attempts,
output-directory mistake and corrective runs are retained. Shared-directory
screenshots that were overwritten are not accepted evidence. The runner now
rejects the mistaken option and gives screenshots backend-specific names.

Qualified CPU/GPU/count/presentation measurements, material regression budgets,
the unresolved native-reference software gate, further asset/workload/device
coverage and the remaining [scorecard](../scorecard.md) requirements remain open.
No general performance superiority or additional physical-device tier is claimed.
Frozen AI and runtime/animation benchmark definitions were not modified.

Raw evidence and source hashes: [validation.json](validation.json),
[summary.json](summary.json). Large JSON/WGSL records use gzip; numerical values
and image pixels are preserved, while machine-specific paths are sanitized.
