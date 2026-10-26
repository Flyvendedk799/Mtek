# Animation roadmap increment

The full platform roadmap remains incomplete. This increment extends decisions
0193 and 0195 with [decision 0196](../../spec/decisions/0196-animation-blends-and-crowds.md).
No frozen AI benchmark archive content was used or changed.

## Delivered

- Phase-synchronized 1D locomotion blends over different-duration clips, clamped
  control parameters, shortest-arc rotations and bind defaults for absent channels.
  Weight changes preserve phase. Mounted playback/pause/seek/markers/fade and
  non-looping completion work with active blends; root translation extraction
  retains wraps and advances independently of pose sampling.
- Copied camera-distance bands for independent and mounted controllers, immediate
  refresh on approach, and nearest-member scheduling for shared-pose groups.
  Clocks and markers continue at every tick; sockets describe the displayed pose.
- Mesh-local end orientation targets and bind-relative hinge limits in bounded IK.
  Explicit uniform-scale requirements reject ambiguous orientation transforms.
- Explicit world-frame retarget corrections, per-node translation multipliers and
  compatible mapped ancestors with static helper bones. Existing local transfer
  and numeric translation-scale arguments remain supported. Key times and
  LINEAR/STEP interpolation are retained, without resampling.
- Explicit shared-pose cohorts through extension contexts, shared evaluation,
  palettes, deformation and opaque instancing, with independent detachment and
  reference-counted release. Different poses retain distinct mesh sort identities.
- Updated [Three.js host example](../../examples/incremental-animation/README.md)
  with a walk/run slider, oriented feet/hands, knee limits, distance throttling,
  pause, skeleton overlays and two differently proportioned procedural rigs.
- Shared generated manifest-validator functions instead of repeated inline bodies.
  A differential test checks the original strategy's acceptance and ordered public
  failures across the entire shared corpus; Ajv still never ships in the runtime.

## Retained validation

The [final GPU report](animation/verified/test-results.json) records **40 passed, 0 failed, 0 not-run** (20 RX 7900 XTX,
20 SwiftShader on the same Windows computer). It includes playback routing, distance propagation and interval roundoff handling.
An additional retarget lookup fix for node names such as `constructor` followed
the GPU run; the final full runtime suite covers that utility fix. The GPU run covers:

- 1, 10 and 50 animated actors, with 1, 1 and 5 explicit phase cohorts respectively.
  Shared individual and instanced draws have identical pixels to independent
  rendering; independent players remain separate even when instancing is enabled.
- In the 50-actor case, five cohorts reduce draws from 50 to 5 and steady palette
  transfer from 3,200 to 320 bytes per step. These synthetic one-joint quads are
  correctness/transfer probes, not a character-quality or performance benchmark.
- Five detach/rejoin cycles return live buffers to the same plateau. Device
  recovery restores identical pixels using a generation-aware extension hook.
- Mounted distance policies skip far poses while clocks advance, then refresh
  immediately after a host transform moves an actor near the active camera.
- The actual Three.js integration keeps oriented grips on both procedural rigs,
  preserves cycle phase when changing weights, and runs without browser errors.
- Existing shadows, environment lighting, off-camera GPU skinning, post effects,
  mip sampling and recovery remain covered by the same selection.

Final full runtime run: **1,584 passed across 104 files**. The first broad run had one
cold-import timeout in the existing golden-program renderer integration (1,582
passed); the full rerun passed without changing its timeout or assertions.
Additional unit cases cover frame partitioning, root wraps, pause/seek/completion,
marker contribution weights, interruption with additive layers, IK frames/limits,
retarget frames/helper nodes, cohort lifetime and atomic input validation.

Other successful checks:

- Code generation: 1,953 tests across 16 files. CLI integration: 41 tests.
- Strengthened public declaration compatibility: 27 tests. Release documentation:
  127 tests, including the decision-range mutation check after repairing an encoding
  error in the specification README. No test timeout or runtime assertion was relaxed.
- Workspace format, Clippy, TypeScript, lint, naming, task/asset generation and
  prebuilt provenance passed; final focused lint and TypeScript also cover the
  final utility/declaration changes.
- Generated release docs validate 260 registry features and 246 diagnostic codes;
  the coverage audit records 403 combined features, 215 positive fixture programs
  and 246 diagnostic codes, with no missing negative-test coverage or exception.
- All eleven existing folder/zip budgets pass unchanged. The minified runtime is
  673,806 bytes, 20,050 bytes smaller than the previous
  lighting checkpoint. [Measured package sizes](animation/package-sizes.json) and
  [command logs](animation/validation-runs.json) retain the results.

Sanitized GPU probe JSON is alongside the report. The actual example screenshots
are retained byte-for-byte with [SHA-256 hashes](animation/verified/images.json).
These are separate successful runs and focused reruns, not a claim of one clean
full-workspace invocation.

## Remaining acceptance scope

Update 2026-10-26: the [matched character increment](matched-animation-progress.md)
subsequently delivered the Three.js comparison and authored-character clip demo.
Its GPU sums include compute skinning. The paragraph below records this earlier
checkpoint; use the current [scorecard](scorecard.md) for remaining scope.

The animation implementation is substantially broader, but this does not close
all original acceptance criteria. Matched Three.js character rendering benchmarks
at multiple mesh complexities, p95 CPU/GPU/memory evidence, physical hardware tiers,
production character asset demonstrations and a larger transition/root-motion/IK
combination corpus remain. The existing integration uses generated procedural
assets. Current GPU timing excludes separate compute skinning and is not whole-frame
GPU time; it cannot establish a fair comparative speed claim.

Cohorts intentionally share an entire pose. Arbitrary independent-pose instancing,
2D blend spaces, automatic humanoid mapping, rotational root extraction, anatomical
swing cones and collision-aware IK are not implemented. They must not be presented
as acceptance requirements that the original compatible-rig workflow explicitly
asked for. Other platform work remains in the [scorecard](scorecard.md).
