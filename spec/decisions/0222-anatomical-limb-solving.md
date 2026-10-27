# 0222 — Anatomical limb solving

Status: implemented in the runtime with CPU tests and generated measurements; the Mtek-source surface (0223) and the browser demonstration (0224) are pending. Date: 2026-10-27.
Extends 0196, 0209 and 0219 (acceptance item 6).

## Why

Positional CCD IK with optional hinge limits (0196) can already pull a hand or foot
to a target, but it does not know what a leg is. On a real skeleton it needs a
rig-specific seed to bend the knee the right way (the character-composition
controller seeds a knee rotation and caps a pelvis lowering by hand), it
converges in a bounded number of iterations rather than exactly, it can fold
through a straight limb, and it has no notion of lowering the hips so that two
feet at different heights both reach the ground. Decision 0219 makes anatomical
solving part of the animation area: analytic two-bone limb IK with a bend
direction from the bind pose, anatomical hinge ranges, reach clamping without
popping, and foot placement that lowers the hips only as much as needed. This
decision specifies and implements it for a mapped humanoid. Section 3 of
`spec/animation.md` is the normative text with the measured table; this record
keeps the decisions and their reasons.

## Decision

1. **Input is the `HumanoidMap` of 0219, nothing else.** The solver uses `hips`, the
   three bones of each limb, and the mesh-local `up` and `forward`; it validates that
   they name skin nodes and form upper, lower, end descendant chains (twist bones in
   between are allowed and follow rigidly). It does not depend on how the map was
   made. Until 0221's `scene/humanoid.ts` lands on the same branch, the two types
   live in `scene/humanoid-types.ts` with the exact 0219 shape.
2. **API.** `player.setHumanoid(map | undefined)`, `player.ik.setLimb(id, goal)`,
   `player.ik.setFootPlacement(placement | undefined)`, with the existing
   `ik.remove(id)` and `ik.clear()` covering them, and the same three methods on
   `AnimationController`. One goal per limb; IDs share a namespace with CCD
   constraints; foot placement owns both legs. All targets are mesh-local, like CCD.
3. **Analytic solve.** Law of cosines on the measured chord lengths, so any proportions,
   uniform scale, rolled bone frames and Z-up meshes need no case analysis, and a
   reachable target is met to float round-off (measured below 1e-6 of full reach).
4. **Bend from the bind pose.** The hinge `h = q x A` (bend side `q`, limb axis `A`) is
   read from the bind pose, anatomically oriented (knees forward, elbows backward with
   respect to `HumanoidMap.forward`), stored in the upper bone's frame, and carried by
   the animated upper bone, so the animation's own thigh and arm twist is kept. An
   explicit `pole` overrides it.
5. **Soft reach, not snapping.** The distance to the target is eased into the reach
   interval with `w = softness (cmax - cmin)` and the exponential map of 3.3 (strictly
   increasing, C1, asymptotic to the limits). Without it the knee angle has an
   unbounded derivative at full extension; with the default 0.05 the largest joint
   rotation per unit of target travel is 8.8 rad per reach on every sweep, 99.7 with
   the hard clamp.
6. **Anatomical range on the middle joint only**: knee 0..150, elbow 0..145 degrees,
   overridable (`flexion`). The flexion comes from the law of cosines, so it is in
   range by construction and cannot be negative (no hyperextension, no reverse bend).
7. **One singular direction per limb, placed where it is least harmful.** A continuous
   choice of bend plane over all target directions cannot exist. Carrying the hinge by
   the shortest arc from the animated direction puts the singularity opposite it, which
   for an arm that hangs down is straight overhead. The carry therefore goes through
   a reference direction opposite a fixed singular one, in the frame of the upper bone's
   parent: up for legs, medial and backward for arms. The pole of an explicit `pole`
   has the usual singularity along the limb axis (falls back to the carried hinge).
8. **Foot placement** takes per-foot ground targets (`height` for terrain following that
   keeps the animated lift and plane position, `point` plus `normal` for planting), a
   contact `weight`, a sole offset and a ground level. The hips drop is the closed-form
   minimum along up that brings both feet inside their exact-reach limit, never
   negative, capped by `maxDrop`, smoothed with an exponential time constant fed by
   `advance`. Feet keep their animated global orientation, tilted onto the normal.
9. **Evaluation order.** Procedural overrides and root ownership, then limbs (foot
   placement, then left leg, right leg, left arm, right arm), then CCD constraints,
   then matrices. A CCD constraint therefore refines a limb result. `SkeletonPlayer`
   changes: `setHumanoid`, `ik.advance(dt)` in `advance`, `!ik.animating` in the
   evaluation memo (a paused clock still converges), limb inspection in `inspect()`.
10. **Scale (0209).** Uniform numerically (the `16 * 2^-23` band) along every ancestor of a
    limb end, the hips and the mesh node; a larger anisotropy raises `RangeError` during
    evaluation, as orientation IK does.
11. **Inspection and public surface.** `AnimationInspection.limbs` and `.footPlacement` are
    optional, so earlier producers and the inspector's fixtures stay valid; the inspector
    overlay draws limb goals and its panel lists them. `runtime.d.ts` is updated by hand
    and `runtime-dts.test.ts` checks it. ABI 1 and extension API 1 are unchanged. The
    reserved runtime diagnostic `E8112` (0219) belongs to the language surface (0223), which
    maps its own commands to these calls; the runtime API throws `RangeError`.

## Deviations from 0219 and choices it left open

- 0219 names `player.ik`-style goals only as "IK goals (positional chains and anatomical
  limbs)"; the exact names above are this decision's.
- `HumanoidBone` and `HumanoidMap` are declared in `scene/humanoid-types.ts` and in
  `runtime.d.ts` (same shape as 0219) so this work compiles and tests without 0221; the
  merge keeps one declaration.
- Foot placement needs a sole offset the skeleton cannot supply; the default (lower bind
  foot-joint height over ground level 0) assumes the mesh origin is at the soles.

## Evidence

`evidence/animation/limb-solving.json` and the table in `spec/animation.md` section 3.7
are written by `npm run limbs:write` and checked by `npm run limbs:check` and by
`limb-solving.test.ts`, which also asserts every bound; `limb-ik.test.ts` covers the API,
validation, pole, weight, orientation, softness, ranges, scale, degenerate targets,
evaluation order, foot placement, smoothing and the controller; `limb-assets.test.ts`
runs CesiumMan and the composition Source and LongLegs rigs with hand-written maps where
the (uncommitted) GLB files exist. The measurements use synthetic rigs and independent
reference computations (joint angles from positions, a scanned and bisected minimum
drop), 32 000 reachable targets, 77 760 targets beyond reach, 153 600 range-sweep
targets, six or seven continuity paths per limb and 86 foot-placement cases.

## Limitations

The middle joint is the only ranged joint (no shoulder or hip limits, clavicle motion,
twist distribution or toe solving). Targets in the last 3.7 % of reach are met
approximately by design, so a pinned leg straighter than about 30 degrees of knee flexion
is bent slightly. Placement uses supplied ground data (no ray casts, contact detection or
foot planting), moves the hips only along up, and smooths both directions, so a fast ground
change lags. Uniform scale only. The runtime bundle grows by about 18.9 KB minified
(689 466 to 708 326 bytes); `crates/mtek-cli/prebuilt` is stale until refreshed. No browser
or GPU test is added here.
