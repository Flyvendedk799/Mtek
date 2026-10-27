# Animation: composition, adaptation and measured behaviour

- Repository path: `spec/animation.md`
- Status: Normative for the composable-animation area (decision 0219). Earlier
  behaviour (clips, skeletal playback, layers, 1D locomotion, IK, retarget frames)
  is specified by decisions 0190, 0191, 0192, 0196 and 0209.

## 1. Blend spaces and layer fades (decision 0220)

<!-- 0220 writes this section. -->

## 2. Automatic humanoid mapping and retargeting (decision 0221)

Decision 0221 implements acceptance items 4 and 5 of decision 0219. Source:
`packages/runtime-web/src/scene/humanoid.ts` (mapping), `humanoid-rig.ts` (bind analysis,
name parsing) and `humanoid-retarget.ts`; the public API is re-exported by the runtime
(`animation.ts`, `runtime.d.ts`).

### 2.1 Contract

```ts
export type HumanoidBone = /* the 22 canonical names of decision 0219 */;
export interface HumanoidMap {
  readonly bones: Readonly<Partial<Record<HumanoidBone, string>>>;   // node names
  readonly evidence: Readonly<Partial<Record<HumanoidBone, "name" | "structure">>>;
  readonly confidence: number;                                       // [0, 1]
  readonly unmapped: readonly HumanoidBone[];                        // optional bones not found
  readonly up: readonly [number, number, number];                    // mesh-local, hips to head
  readonly forward: readonly [number, number, number];               // mesh-local facing
}
export function mapHumanoid(skin: MtekSkin): HumanoidMap | { readonly error: string };

export interface HumanoidRetargetOptions {
  readonly translationScale?: number;   // default: target leg length / source leg length
  readonly restCorrection?: boolean;    // default true; false = the naive bind-relative transfer
  readonly sourceMap?: HumanoidMap;     // default: mapHumanoid(source)
  readonly targetMap?: HumanoidMap;
  readonly maxKeyInterval?: number;     // seconds, default 1/30
}
export function retargetHumanoid(source: MtekSkin, target: MtekSkin, options?: HumanoidRetargetOptions): MtekSkin;
```

All 15 required bones are present in a `HumanoidMap` or the result is `{ error }`; the
error names the reason (too few joints, no common hips, an arm or leg chain that is too
short, no spine between hips and head, not an upright biped, a bone name that is not
unique). `mapHumanoid` is pure and never throws. `retargetHumanoid` throws `RangeError`
for an invalid skin, a non-uniform scale (decision 0209 band), a bad option, or a skeleton
that does not map ("Humanoid mapping failed for the source/target: ..."), which the
language layer reports as `E8110`. Mapped bones are joints of the skin; a bone name must be
unique among the node names.

### 2.2 Mapping by name

A joint name is split at separators and at lower-to-upper case changes, digits are dropped
and everything is lower-cased. Rig-prefix words (`mixamorig`, `def`, `j`, `bip`, `b`, `cc`, `skeleton`,
`joint`, `bone`, ...) are ignored; the words `left`/`l` and `right`/`r` give the side; the
remaining words are joined into a stem and looked up in one compact table
(`NAME_TABLE_SPEC`: 422 bytes, plus 90 bytes of ignored words). A stem is a bone family
(hips, torso, neck, head, leg, arm) and, for limbs, a role (upper, lower, foot, toe,
shoulder, hand). Because the whole stem must match, twist, roll, end and finger bones
(`upperarm_twist_01_l`, `HeadTop_End`, `LeftHandIndex1`) are not humanoid bones. Limb
families need a side; centre families must not have one. Examples: `mixamorig:LeftUpLeg`,
`pelvis`/`thigh_l`/`calf_r`/`clavicle_l`, `J_Bip_R_LowerLeg`, `DEF-thigh.L.001`,
`Bip01_L_Thigh`, `L_Thigh`, `left_leg`, `Skeleton_arm_joint_L__4_`.

Names pick out the anchors: the top-most joint of the left and right leg family and of the
left and right arm family (when unique), and the head (the one `head` joint, or the last joint
of a chain of `neck` joints as in CesiumMan). Names do not number the segments of a limb or
the spine: that is done from the chain (below), with the role words of the names as hints.

### 2.3 Mapping by structure

When names do not pick out an anchor (or all of them fail, or they lead to a non-biped), the
joint forest and the bind positions in the frame of the mesh node decide:

1. **Hips** are a joint with at least three limb-like children (subtree depth of two or
   more): two chains that mirror each other about a plane (mean distance between the first three joints
   less than 20 % of the chain length) with parallel directions (cosine above 0.8) are the
   legs; a third child whose path rises opposite to the legs (cosine above 0.6 from hips to head)
   and that holds a mirrored pair of limb chains (the arms) is the spine. The candidate highest
   in the hierarchy wins. `up` is the direction from the hips to the head.
2. **Spine path**: from the third child the path follows the child that is on the symmetry plane
   (within 35 % of its offset), deepest first, then highest; at the first joint with a mirrored
   limb pair those are the arms and that joint is where they attach. The head is the last joint
   of the path above it; a leaf among several children of its parent (jaw, eyes, a head-top
   bone) belongs to the head, and a lone trailing leaf more than 1.5 times as long as the
   segment before it is taken as a head-top end bone.
3. **Legs**: along a leg chain the ankle is the first joint (from the third) after which the chain
   turns more than 50 degrees away from the leg axis, else the chain end, or the joint before a
   last segment that is shorter than half the shin (toes). The knee is the joint that balances the
   thigh and shin lengths. The joint after the ankle is the toes.
4. **Arms**: an optional clavicle (first joint), an elbow and a wrist are chosen to balance the
   upper arm and forearm lengths (with 0.1 per joint beyond the wrist as a tie-break, so that a
   finger or carried prop is not taken for the hand); the chain stops where it turns more than
   60 degrees away from the arm axis.
5. **Spine bones**: the path from the hips to the head, split at the arm attachment joint. The
   joints at or below it are the torso: `spine` is the first, `chest` the second, `upperChest` the
   last of three or more. The first joint above it is the `neck` (a joint named neck wins).

Name role words enter limb splitting as hints that lower the cost of a matching assignment (and
raise it for a contradicting one); names only ever decide between candidates the geometry allows.
`evidence[bone]` is `"name"` when the chosen joint's own name is a recognised name of that bone
family and side (and, for limbs, not a contradicting role), `"structure"` otherwise.

### 2.4 Facing, sides, confidence and rejection

`left` is the character's left. Sided names give the left axis (left leg joint minus right leg
joint, orthogonalised against `up`); structure alone only finds an unsided pair and decides the
facing, in this order: the horizontal direction from ankle to toes (if it exceeds 10 % of the leg
length), the bend of the knees from the hip-ankle line (above 2 % of the leg length), and the glTF
convention that an asset faces +Z of the scene (the scene's +Z expressed in mesh-local axes, using
the mesh node's bind rotation). `forward = left x up` (so `left = up x forward`); `up` and `forward`
are unit vectors in the mesh frame, `forward` perpendicular to `up`.

Confidence is the mean over the 15 required bones of 1.0 (the joint's name is that bone's name, role
included), 0.9 (a name of the bone's family and side whose segment came from the chain, for
instance `leg_joint_L_2`) or 0.75 (structure), times a facing factor (1 sided names, or structure
decided by toes; 0.95 knees; 0.85 convention; 0.5 when legs and arms disagree about the left side,
and again 0.5 when sided names contradict the toes) times a tilt factor (1 when the spine is within
18 degrees of opposite the legs, falling linearly to 0.6 at 41 degrees).

A skin is rejected when: it has fewer than 15 joints; the legs and the head have no common
ancestor below them; a limb chain is too short; the arms do not attach between hips and head; the
spine and the legs are not opposed (cosine below 0.75, about 41 degrees); a foot is not below the
hips or the head not above the arms. Names alone never override these geometric checks, which is
why the Fox (names for head, arms and legs, but a horizontal spine) is rejected: its hips-to-head
direction makes 61 degrees with the opposite of its legs' axis (cosine 0.49, 0.75 is needed).

### 2.5 Retargeting

`retargetHumanoid(source, target)` maps both skins and works in the mesh-local frame of each, which
the two (left, up, forward) frames of the maps relate (a rotation `B`). Bones present in both maps
form the shared set; the others (extra bones, props, twist bones, tails, optional bones only one rig
has) keep their bind pose in the target.

**Rest-pose correction.** For every shared bone the world (mesh-local) bind orientation is turned
by the shortest arc until the bone, which points at the next shared bone of its chain, lies along
the canonical direction of its limb: spine, neck and head up; arms and shoulders to the character's
side; legs down; foot forward. Bones that end a chain (hand, head, toes, a foot without toes) follow
the correction of the bone before. This is the rig's *rest-corrected orientation*, `R`.

**Transfer.** At each sample time the source pose gives each shared bone's world orientation `W`.
Its rotation relative to its rest-corrected orientation, `D = W R_source^-1`, is expressed in the target's
frame, `B D B^-1`, and gives the target bone's world orientation `B D B^-1 R_target`. Target bones
that are not shared follow their parents' bind-relative orientation, and each shared bone's local rotation
is its world orientation relative to its target parent's actual one. Because every shared bone is set
by its own world orientation, hierarchies that differ (a clavicle or an upper chest only one rig has,
twist bones on the chain) still reproduce every limb direction, and T-pose to A-pose, A-pose to T-pose
and rest poses with slightly bent knees are handled by the same rule. Scale animation and the
translation of bones other than the hips are not carried; the bind scale is kept.

**Hips.** The source hips position, measured in (left, up, forward) coordinates, becomes the target hips
position: horizontal offsets from the bind position scale by the ratio `r` of the leg lengths
(`|upper leg| + |lower leg|`, mean of both legs, in mesh-local units; or `translationScale`); the height of
the hip joints above the ankle plane scales by `r` and the pelvis keeps its own height above the hip
joints. Translation of nodes above the hips (a motion-root trajectory) is part of the hips position and is
folded into the hips translation. The translation channel is written only when the source hips move.

**Sampling.** Output keys are the union of the key times of every source channel, refined so that no gap
exceeds `maxKeyInterval`; all shared bones get a rotation channel on the same keys (a clip with no
channels yields one key at time zero). Where the target tree is not one-to-one with the source tree the
composite is interpolated linearly between keys, which is the only source of error between keys.

### 2.6 Measurements

The tables are written by `npm run humanoid:write` from the code and the fixtures
(`packages/runtime-web/src/test-support/humanoid-*.ts`), `npm run humanoid:check` fails when they or
`evidence/animation/humanoid-retarget.json` are stale, and `scene/humanoid.test.ts` and
`scene/humanoid-retarget.test.ts` assert the bounds below the tables. The fixtures are one canonical
skeleton under ten naming conventions (Mixamo, Unreal mannequin, Unity, VRM, Rigify `DEF-` with
on-chain twist bones, plain `LeftUpLeg`, `Bip01_L_Thigh`, `left_leg`, `L_Thigh`, and scrambled
`bone_NNN`), three rest poses (T; A with the arms 45 degrees down; A with bent knees), three mesh frames
(Y-up facing +Z; Z-up under a rotated parent; facing -Z), bone-aligned or world-aligned local axes,
proportion variants (legs, arms and spine from 0.6 to 1.6, centimetres, 1/100 scale), props, twist bones,
a tail, fingers and face bones, with a walk (planted stance feet, hips travelling) and a wave authored as
world-space limb directions. Real skins: CesiumMan, CesiumMan with the character-composition proportions
(legs x1.2, arms x0.9, pelvis +0.108; the prepared `Source.glb`/`LongLegs.glb` are mapped too when they
exist), and the Fox as the negative case.

<!-- humanoid-retarget:begin -->
Mapping (generated; `npm run humanoid:check` verifies it). Required bones correct (of 15), optional bones found, evidence counts and confidence:

| Skeleton | Required | Optional found | Not found | Name / structure | Confidence |
| --- | --- | --- | --- | --- | --- |
| mixamo (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 0.973 |
| unreal (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| unity (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| vrm (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| rigify (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 20 / 2 | 0.977 |
| plain (synthetic) | 15/15 | chest, neck | upperChest, leftShoulder, rightShoulder, leftToes, rightToes | 17 / 0 | 0.973 |
| bip (synthetic) | 15/15 | chest, neck, leftShoulder, rightShoulder, leftToes, rightToes | upperChest | 21 / 0 | 1.000 |
| snake (synthetic) | 15/15 | chest, neck, leftShoulder, rightShoulder, leftToes, rightToes | upperChest | 21 / 0 | 0.973 |
| short (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| scrambled (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 0 / 22 | 0.750 |
| CesiumMan | 15/15 | chest, neck, leftToes, rightToes | upperChest, leftShoulder, rightShoulder | 19 / 0 | 0.907 |
| CesiumMan, legs x1.2 arms x0.9 | 15/15 | chest, neck, leftToes, rightToes | upperChest, leftShoulder, rightShoulder | 19 / 0 | 0.907 |
| Fox | rejected: the spine is not opposed to the legs (not an upright biped) | | | | |

Variant matrix: 180 of 180 synthetic skeletons (10 naming conventions x 3 rest poses x 3 mesh frames x 2 bone-axis conventions, with props, twist bones, a tail, fingers and face bones) map all 15 required bones correctly, 180 of 180 map every bone of the fixture and nothing else. Proportion and unit variants: 80 of 80.

Retargeting (generated). Limb error: the largest angle between corresponding limb segments (both upper and lower arm and leg), over all frames, in degrees; uncorrected: the same with `restCorrection: false`. Hips ratio: mean height of the hip joints above the lower ankle, target over source, against the leg-length ratio. Foot height error: in stance, the target ankle height above its bind ankle plane against the source's scaled by the leg ratio, in leg lengths. Slide: target foot speed beyond the source's scaled by the leg ratio while the source foot is planted, in leg lengths per second.

| Scenario | Clip | Limb error | Uncorrected | Hips ratio / leg ratio | Stance frames | Foot height error | Max slide | Mean slide |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mixamo T-pose to Unreal A-pose | walk | 0 | 45 | 1 / 1 | 69 | 0 | 0 | 0 |
| Mixamo T-pose to Unreal A-pose | wave | 0 | 45 | 1 / 1 | 238 | 0 | 0 | 0 |
| Unreal A-pose to Mixamo T-pose | walk | 0 | 45 | 1 / 1 | 69 | 0 | 0 | 0 |
| Unreal A-pose to Mixamo T-pose | wave | 0 | 45 | 1 / 1 | 238 | 0 | 0 | 0 |
| VRM T-pose legs x1.2 to Rigify bent-knee A-pose arms x0.8 | walk | 0 | 45 | 0.833 / 0.833 | 69 | 0 | 0.011 | 0.007 |
| VRM T-pose legs x1.2 to Rigify bent-knee A-pose arms x0.8 | wave | 0 | 45 | 0.833 / 0.833 | 238 | 0 | 0 | 0 |
| Unity T-pose Z-up to plain A-pose, spine x1.2, centimetres, bone axes | walk | 0.006 | 45 | 100 / 100 | 69 | 0 | 0 | 0 |
| Unity T-pose Z-up to plain A-pose, spine x1.2, centimetres, bone axes | wave | 0 | 45 | 100 / 100 | 238 | 0 | 0 | 0 |
| Scrambled names A-pose facing back to VRM T-pose legs x0.85 | walk | 0 | 45 | 0.85 / 0.85 | 69 | 0 | 0.011 | 0.008 |
| Scrambled names A-pose facing back to VRM T-pose legs x0.85 | wave | 0 | 45 | 0.85 / 0.85 | 238 | 0 | 0 | 0 |
| CesiumMan to CesiumMan with legs x1.2, arms x0.9 | clip0 | 0 | 0 | 1.2 / 1.2 | 11 | 0.001 | 0.006 | 0.002 |
| CesiumMan to Mixamo T-pose (Z-up) | clip0 | 0 | 40.4 | 1.605 / 1.605 | 11 | 0.001 | 0.021 | 0.013 |
| Mixamo A-pose walk to CesiumMan | walk | 0.007 | 29.5 | 0.623 / 0.623 | 69 | 0.003 | 0.037 | 0.026 |

Asserted bounds: limb error at most 0.02 degrees; uncorrected at least 25 degrees where rest poses differ; hip-joint height ratio within 2 % of the leg ratio; stance foot height error at most 0.01 leg lengths; slide at most 0.02 (synthetic) or 0.05 (real rigs) leg lengths per second.
<!-- humanoid-retarget:end -->

### 2.7 Limitations and exclusions

- **Structure alone is not a substitute for names on every rig.** Without names, Rigify-style twist bones
  on the limb chain cannot be told from elbows and knees (all 18 scrambled Rigify variants fail on the arms
  or the head; with the `DEF-` names they map correctly), and a head whose last segment is long enough to
  look like a head-top end bone may be given as the neck (measured: the Rigify skeleton without face bones).
  Without toes, straight knees and a mesh that does not face +Z, nothing in the geometry tells left from
  right: the pairs are found with left and right exchanged (4 of the 162 structure-only variants of the
  other nine conventions: plain, T and A poses, facing -Z). Names, toes, bent knees or the +Z convention resolve it.
- **Hands and heads.** Where the hand is a single chain without fingers branching and without a name, the wrist
  is chosen by length balance; props attached to a hand are excluded by their turn away from the arm axis.
- **Roll about the bone axis follows each rig's bind roll** after the shortest-arc correction; a hand or foot
  whose bind roll differs by a quarter turn between the rigs will show that quarter turn. Limb *direction*
  error is what is measured and bounded.
- **Foot sliding is bounded, not zero.** A target that is a uniform scale of the source plants the feet exactly
  (measured 0 to 1e-6 leg lengths per second for scales 0.5 to 100). Sliding appears when the pelvis width
  or the thigh:shin proportion does not follow the leg ratio: 0.013 for legs x0.83 on an unchanged pelvis, 0.032
  for legs x2 and 0.065 for legs x0.5, in leg lengths per second, and 0.037 from a Mixamo-proportioned walk to
  CesiumMan. Removing it needs foot placement (decision 0222), which can take the retargeted pose as input.
- **Between keys**, rigs whose parent chains differ interpolate the composite linearly: the worst measured
  limb direction deviation from the source is 0.007 degrees (Unity Z-up with bone axes to plain; Mixamo
  A-pose walk to CesiumMan).
- **Step channels**: the source is sampled with its own interpolation, but the result is written linear on
  at most `maxKeyInterval` spacing, so a jump of a step channel becomes a ramp of up to that interval.
- **Not carried**: scale tracks, translation of bones other than the hips, animation of non-humanoid
  (non-mapped) bones, morph targets, and any root rotation above the hips. Non-uniform scales are rejected.
  Skeletons other than bipeds (quadrupeds, creatures) are rejected by design.

<!-- humanoid-retarget:begin -->
Mapping (generated; `npm run humanoid:check` verifies it). Required bones correct (of 15), optional bones found, evidence counts and confidence:

| Skeleton | Required | Optional found | Not found | Name / structure | Confidence |
| --- | --- | --- | --- | --- | --- |
| mixamo (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 0.973 |
| unreal (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| unity (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| vrm (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| rigify (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 20 / 2 | 0.977 |
| plain (synthetic) | 15/15 | chest, neck | upperChest, leftShoulder, rightShoulder, leftToes, rightToes | 17 / 0 | 0.973 |
| bip (synthetic) | 15/15 | chest, neck, leftShoulder, rightShoulder, leftToes, rightToes | upperChest | 21 / 0 | 1.000 |
| snake (synthetic) | 15/15 | chest, neck, leftShoulder, rightShoulder, leftToes, rightToes | upperChest | 21 / 0 | 0.973 |
| short (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| scrambled (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 0 / 22 | 0.750 |
| CesiumMan | 15/15 | chest, neck, leftToes, rightToes | upperChest, leftShoulder, rightShoulder | 19 / 0 | 0.907 |
| CesiumMan, legs x1.2 arms x0.9 | 15/15 | chest, neck, leftToes, rightToes | upperChest, leftShoulder, rightShoulder | 19 / 0 | 0.907 |
| Fox | rejected: the spine is not opposed to the legs (not an upright biped) | | | | |

Variant matrix: 180 of 180 synthetic skeletons (10 naming conventions x 3 rest poses x 3 mesh frames x 2 bone-axis conventions, with props, twist bones, a tail, fingers and face bones) map all 15 required bones correctly, 180 of 180 map every bone of the fixture and nothing else. Proportion and unit variants: 80 of 80.

Retargeting (generated). Limb error: the largest angle between corresponding limb segments (both upper and lower arm and leg), over all frames, in degrees; uncorrected: the same with `restCorrection: false`. Hips ratio: mean height of the hip joints above the lower ankle, target over source, against the leg-length ratio. Foot height error: in stance, the target ankle height above its bind ankle plane against the source's scaled by the leg ratio, in leg lengths. Slide: target foot speed beyond the source's scaled by the leg ratio while the source foot is planted, in leg lengths per second.

| Scenario | Clip | Limb error | Uncorrected | Hips ratio / leg ratio | Stance frames | Foot height error | Max slide | Mean slide |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mixamo T-pose to Unreal A-pose | walk | 0 | 45 | 1 / 1 | 69 | 0 | 0 | 0 |
| Mixamo T-pose to Unreal A-pose | wave | 0 | 45 | 1 / 1 | 238 | 0 | 0 | 0 |
| Unreal A-pose to Mixamo T-pose | walk | 0 | 45 | 1 / 1 | 69 | 0 | 0 | 0 |
| Unreal A-pose to Mixamo T-pose | wave | 0 | 45 | 1 / 1 | 238 | 0 | 0 | 0 |
| VRM T-pose legs x1.2 to Rigify bent-knee A-pose arms x0.8 | walk | 0 | 45 | 0.833 / 0.833 | 69 | 0 | 0.011 | 0.007 |
| VRM T-pose legs x1.2 to Rigify bent-knee A-pose arms x0.8 | wave | 0 | 45 | 0.833 / 0.833 | 238 | 0 | 0 | 0 |
| Unity T-pose Z-up to plain A-pose, spine x1.2, centimetres, bone axes | walk | 0.006 | 45 | 100 / 100 | 69 | 0 | 0 | 0 |
| Unity T-pose Z-up to plain A-pose, spine x1.2, centimetres, bone axes | wave | 0 | 45 | 100 / 100 | 238 | 0 | 0 | 0 |
| Scrambled names A-pose facing back to VRM T-pose legs x0.85 | walk | 0 | 45 | 0.85 / 0.85 | 69 | 0 | 0.011 | 0.008 |
| Scrambled names A-pose facing back to VRM T-pose legs x0.85 | wave | 0 | 45 | 0.85 / 0.85 | 238 | 0 | 0 | 0 |
| CesiumMan to CesiumMan with legs x1.2, arms x0.9 | clip0 | 0 | 0 | 1.2 / 1.2 | 11 | 0.001 | 0.006 | 0.002 |
| CesiumMan to Mixamo T-pose (Z-up) | clip0 | 0 | 40.4 | 1.605 / 1.605 | 11 | 0.001 | 0.021 | 0.013 |
| Mixamo A-pose walk to CesiumMan | walk | 0.007 | 29.5 | 0.623 / 0.623 | 69 | 0.003 | 0.037 | 0.026 |

Asserted bounds: limb error at most 0.02 degrees; uncorrected at least 25 degrees where rest poses differ; hip-joint height ratio within 2 % of the leg ratio; stance foot height error at most 0.01 leg lengths; slide at most 0.02 (synthetic) or 0.05 (real rigs) leg lengths per second.
<!-- humanoid-retarget:end -->

## 3. Anatomical limb solving (decision 0222)

<!-- 0222 writes this section, including its generated measurement table. -->

## 4. Composition in Mtek programs (decision 0223)

<!-- 0223 writes this section. -->
