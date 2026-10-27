# 0221 — Humanoid mapping and retargeting

Status: accepted. Date: 2026-10-27. Extends [0196](0196-animation-blends-and-crowds.md),
[0209](0209-skeletal-scale-round-off.md) and [0219](0219-complete-composable-animation.md).
Implements acceptance items 4 (automatic humanoid mapping) and 5 (humanoid retargeting) of
0219. The rules, the generated measurement tables and the limitations are in
[`spec/animation.md`](../animation.md) section 2.

## Why

`retargetSkin` (0196) needs an explicit name mapping, compatible bone axes and the same rest pose:
it cannot play a Mixamo clip on a VRM model or a T-pose clip on an A-pose rig, and the
language layer (0223) has no mapping to give it. A person who writes `clips_from` in an Mtek
program should not have to write one.

## Decision

**Mapping.** `mapHumanoid(skin)` returns the `HumanoidMap` fixed by 0219 or `{ error }`. Joint
names are parsed (separator, case and rig-prefix insensitive; stems in a 512-byte table that
covers Mixamo, the Unreal mannequin, Unity and VRM names, Blender Rigify `DEF-` names, CesiumMan's
`Skeleton_*`, `Bip01_L_Thigh`, `LeftUpLeg`, `left_leg`, `L_Thigh`) to find the legs, arms and head. A
structural pass finds the same anchors from the joint topology and the bind positions (hips = two
mirrored, parallel leg chains plus a third chain opposed to them that carries a mirrored arm pair and
the head). The segments of a limb and the spine bones are then numbered from the chain, with name role
words as hints. Names never override the geometry: a skeleton whose spine is not opposed to its legs
is not a biped. The Fox, whose joints are named like a humanoid's, is rejected for that reason.
Left and right come from sided names, or else from the facing found in the toes, the bend of the knees
or the glTF convention that an asset faces +Z; `up` is hips to head and `forward` is `left x up`. The
map reports per-bone evidence (`name` or `structure`), a confidence in [0, 1] and the optional
bones that were not found.

**Retargeting.** `retargetHumanoid(source, target, options?)` uses both maps and returns the target
skin with the source clips rewritten as rotations of the target's own bones. Each shared bone's bind
orientation is rest-corrected by the shortest arc to the canonical direction of its limb (T-pose:
arms to the side, legs down, feet forward), and the animation is carried as the world rotation relative to
that corrected rest, expressed in the target's (left, up, forward) frame. A T-pose source therefore drives an
A-pose target, the reverse works the same, and hierarchies with extra clavicles, upper chests or twist
bones still reproduce every limb direction. Hips translation is scaled by the leg-length ratio (overridable
with `translationScale`), with the pelvis keeping the target's own height above its hip joints; a motion
root above the hips is folded into the hips translation. Unmapped and extra bones, scale tracks and the
translation of other bones are not carried: the target keeps its bind pose there.

**Why not `retargetSkin` with a generated mapping.** Its world-space mode carries each node's local change
in the parents' bind frames and needs an exact one-to-one parent structure; it has no rest-pose
correction (the bind-relative transfer that `restCorrection: false` reproduces leaves a T-pose arm
motion 45 degrees off an A-pose arm, measured below) and it animates only nodes that are mapped
one-to-one. The humanoid path shares its validation rules (0209
uniformity, valid skin) and quaternion convention but evaluates the whole pose per key time, which is
what makes differing hierarchies exact.

## Public surface

Exported from the runtime with matching entries in `runtime.d.ts` (mutual-assignability tests):
`mapHumanoid`, `retargetHumanoid`, `HumanoidBone`, `HumanoidMap`, `HumanoidRetargetOptions`
(`translationScale`, `restCorrection`, `sourceMap`, `targetMap`, `maxKeyInterval`). The runtime
bundle `runtime.min.js` grows by 17,982 bytes (689,466 to 707,448). There is no ABI change, no
new diagnostic code (0219 reserved `E8110` for 0223 to raise from the `RangeError`), and the
compiler, examples and browser tests are untouched.

## Evidence

`npm run humanoid:write` regenerates `evidence/animation/humanoid-retarget.json` and the tables
in `spec/animation.md` section 2.6; `npm run humanoid:check` verifies them; the unit tests assert the
bounds and that the committed JSON equals a fresh measurement. Measured: all 15 required bones
correct, and every bone of the fixture and nothing else, on 180 of 180 synthetic skeletons (ten naming
conventions, three rest poses, three mesh frames, two bone-axis conventions, with props, twist bones, a
tail, fingers and face bones) and 80 of 80 proportion and unit variants, on CesiumMan and its
proportion variant (chest, neck and toes found; upper chest and shoulders absent), and a rejection
of the Fox. Limb direction error after rest correction is at most 0.007 degrees over 13 scenario rows
(T to A, A to T, proportion changes, units, Z-up and facing-back frames, bone axes, real skins), against 25
to 45 degrees for the uncorrected transfer; the hip-joint height follows the leg-length ratio exactly;
stance foot height error is at most 0.003 leg lengths; foot slide is 0 for uniformly scaled copies and
for the pairs of equal proportions, and 0.006 to 0.037 leg lengths per second where the pelvis
width or the thigh:shin ratio does not follow the leg ratio.

## Exclusions and open limits

Measured causes are in `spec/animation.md` section 2.7: structure-only mapping of rigs with on-chain
twist bones (Rigify without names), of a head whose last segment looks like a head-top bone, and of a
toeless straight-legged rig that faces away from +Z (left and right exchanged); roll about the bone axis
follows each rig's bind roll; foot sliding from proportion mismatches is left to foot placement (0222).
Quadrupeds, creatures and facial animation remain outside the area (0219).
