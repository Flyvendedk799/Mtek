# Spatial inspection and animation diagnosis

Date: 2026-10-27. Continues the platform roadmap after the
[compute shadow/capability acceptance](../shader-authoring/compute-release-2026-10-27/checkpoint.md).
The entire roadmap is not complete.

## Delivered behavior

Optional extension/animation API 1 inspection now returns fresh copied scene,
camera, draw-bound, physics and evaluated animation state. Reads do not propagate
transforms, evaluate animation, consume root motion, step physics or submit GPU
work. Scene/spawn generation IDs prevent old selections from aliasing new actors.
The [contract](../../../spec/inspection.md) defines coordinate spaces, stale bounds,
contact availability and the passive after-frame observation boundary.

The separately packaged inspector adds transparent world bounds, skeleton, IK
target/reach-error, box/sphere collider and contact-normal overlays. Clipping
covers every WebGPU clip plane. Parent transforms, nonuniform scale, actual body
poses, resized content boxes, borders/padding and DPR are retained. Node indices
keep duplicate names distinct. Segment/pixel caps bound the optional canvas cost;
unsupported CSS transforms are reported. No spatial observer means no per-frame
spatial snapshot work. Disposal removes canvas, listeners and observers.

The panel adds active clip/transition state, ordered layers/effective masks,
root-motion ownership, procedural overrides and effective IK settings. Its spatial
section subscribes only while open; text updates remain throttled. The new
[inspection studio](../../../examples/inspection-studio/README.md) compiles an actual
Mtek scene with the original pinned Fox, a transformed parent, masked Run layer,
procedural neck control, hand IK and a falling physics crate. It consumes the
public optional package, as does the lighting studio's world-overlay switch.

Skeleton/IK coordinates precede material-authored vertex deformation. Bounds are
renderer enclosures, not compiler proofs. Collider dimensions are those supplied
to physics and are not multiplied by visual entity scale again. Lines do not
depth-test against scene geometry. Unsupported data remains unavailable.

## Desktop acceptance and retained failures

The [browser record index](browser-records.json) retains raw numeric data,
sanitized reports/environments/build provenance and byte-identical PNGs. The
initial final `hardware/` and `software/` runs pass four tests each, with zero
failures, skipped or NOT-RUN cases. Radeon RX 7900 XTX and SwiftShader are two
backends on the same desktop, not two physical-device tiers.

After documentation/provenance refresh and rounding backing dimensions down to
honor the exact pixel cap, `release/inspection/` passes all eight cases again.
`release/compute/` passes 18 numerical/geometry/shadow/lifetime cases against the
current runtime. `release/rendering-regression/` passes 78 animation, lighting and
mapped-material checks (39 on each backend), with zero failures or NOT-RUN.

- Independent source-scene parent/camera calculations match all 22 tested
  nontrivial skeleton segments. Maximum initial projection error is about
  3.24e-8 NDC; world-matrix error stays below 8e-10. The same checks pass after
  camera/parent changes and viewport resize, with DPR 1.5 and border/padding.
- Actual masked-layer/procedural/IK controls are visible in copied diagnostics.
  The crate settles with real contacts; inspection does not add physics steps.
- Disabling overlays causes zero spatial reads. Completed device recovery
  restores identical geometry. Source reset invalidates the old selection;
  full remount releases all seven tracked registry ownership categories.
- The actual lighting studio exposes optional selected bounds. Screenshots of
  both studios and contacts were visually reviewed.

Rejected/intermediate candidates remain in this directory. The first harness
asserted a float32-rounded collider dimension while the physics contract retains
the exact validated nominal descriptor; it now asserts 0.7 exactly. Early green
coordinate tests missed a global canvas background rule that hid the scene.
Those opaque screenshots are rejected visual evidence. A Shadow DOM with an
explicit transparent canvas fixes the product bug; transparency is now asserted.
A later software run exposed a recovery-test race: the pre-loss `running` state
could satisfy the wait. The test now requires completed-recovery diagnostic
MTEK-W8061 before advancing. No coordinate/contact/resource threshold was relaxed.

## Package cost and validation

The optional inspector is not bundled into compiled scenes automatically. Public
runtime diagnostics do add code. To retain the existing package limits,
token-aware declaration compaction verifies an identical parsed declaration AST,
including template/string literal contents. Generated validator diagnostic string
pooling retains exact ordered errors, schema paths and directive/property syntax.
Ajv remains a build dependency. The prebuilt provenance includes the new pooling
script; all five embedded artifacts match built files byte-for-byte.

The minified runtime is 668,846 bytes and compiled-app declarations are 17,640
bytes. Compared with the preceding compute acceptance (694,425 / 18,747 bytes),
these decrease by 25,579 / 1,107 bytes despite the new APIs. All eleven existing
[package budgets](package-budgets.json) hold without increases; stage-show's ZIP
is 713,224 bytes against its existing 740,000-byte limit. Maintained SDK sources
remain readable and no public types are removed.

The [runtime unit report](runtime-unit.json) passes 1,659 tests. Inspector tests
pass 18; browser harness, coverage and release-doc suites pass 314, 52 and 127.
The final [offline installed consumer](release-consumer/package-consumer.json)
strictly type-checks public exports without source aliases. The
[DOM verification](release-consumer/ui-verification.json) passes with GPU disabled,
zero adapter requests and zero page errors. Earlier consumer/UI records remain
as earlier checkpoints. Compiler coverage and generated release-document checks
agree on the current bounded compute and inspection claims.

Additional final checks and exact source/artifact hashes are recorded in
[validation.json](validation.json). The complete Rust workspace passes 1,750
ordinary tests with one existing ignored test, plus all 45,001 grammar conformance
inputs. Formatting and warning-denying Clippy pass. The current runtime also
passes both production-character regression runs under `release/authored-characters/`:
each retains 32 CPU/GPU reference cases, two native-material cases, 16 bounds
transitions, four recoveries, 12 replacements and 36 sampler cases.
Historical animation measurements remain
associated with their original runtime hashes; this increment does not claim
new whole-frame CPU/GPU timing results. Frozen benchmark definitions/assets and
the AI evidence archive are preserved.

Combined authored shared-pose instancing, broader authored-rig compositions,
resource provenance/history, persistent authored IDs, complete authoring workflows,
matched material/streaming/long-session evidence and wider physical devices remain
roadmap work. These desktop diagnostics do not close those requirements.
