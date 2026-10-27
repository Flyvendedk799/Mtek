# Animation: composition, adaptation and measured behaviour

- Repository path: `spec/animation.md`
- Status: Normative for the composable-animation area (decision 0219). Earlier
  behaviour (clips, skeletal playback, layers, 1D locomotion, IK, retarget frames)
  is specified by decisions 0190, 0191, 0192, 0196 and 0209.

## 1. Blend spaces and layer fades (decision 0220)

Host API of `AnimationPlayer` and `AnimationController` (extension API 1; no new
runtime ABI and no Mtek syntax; the source surface is section 4).

### 1.1 Blend spaces

`player.blend` plays a **blend space**: 1 to 32 samples `{clip, x, y}` and a
parameter `(x, y)`. While it is active it replaces the base clip, exactly where
the 1D locomotion blend of decision 0196 does (before layers, procedural
overrides and IK; base weight and fade still apply). `player.locomotion` is the
same object seen in one dimension: thresholds are `x`, `y` is `0`. Setting either
configures the other, `locomotion.set` keeps its strict ordering rules, and the
earlier behaviour is unchanged.

```ts
player.blend.set({ samples, parameter?, phase?, speed?, looping? } | undefined): void
player.blend.setParameter(x: number, y?: number): void   // y defaults to 0
player.blend.seek(phase: number): void                    // [0, 1]; no crossings, no root motion
player.blend.play(looping?: boolean, speed?: number): boolean
player.blend.pause(): boolean;  player.blend.resume(): boolean
player.blend.crossedPhase(phase: number): boolean
player.blend.crossed(clip: string, seconds: number): boolean
// readable: active, phase, parameter {x, y}, playing, finished, duration, revision
controller.setBlendSpace(options | undefined);  controller.setBlendParameter(x, y);
```

`set` validates everything before changing anything. It throws `RangeError` for
no or more than 32 samples, a missing or zero-length clip, a non-finite point,
parameter, speed or phase, and **two samples at the same point**. The parameter
defaults to the first sample. Unlike `locomotion.set`, one sample is allowed (its
weight is always one). The same clip may appear at several points.

**Weights.** For a parameter `p` the weights `w_i` of the samples are:

1. *Inside the convex hull*: the barycentric coordinates of `p` in the triangle of
   the Delaunay triangulation of the sample points that contains it.
2. *Outside the hull*: the weights of the nearest point of the hull boundary
   (Euclidean distance in the unscaled `(x, y)` plane), linear on the hull edge
   that holds it. Pick axes with commensurable scales; the host may scale an axis.
3. *Collinear samples* (including every 1D case, any direction, and one or two
   samples): piecewise-linear interpolation of the orthogonal projection of `p`
   onto the line, clamped to its end points.

Properties, asserted for fixed layouts (triangle, grids, hexagon with centre,
collinear hull edges, scattered sets up to 32 samples) and 40 random lattice
subsets: the weights are nonnegative and sum to one (to 1e-12); weight one at
every sample, zero elsewhere; deterministic; and continuous in `p`, including
across triangle edges, through vertices, onto the hull and beyond (a tenfold
smaller parameter step gives a tenfold smaller weight change). At most three
samples are nonzero away from the collinear case, so at most three clips are sampled.

The triangulation takes each sample triple with a non-degenerate area (relative
tolerance 1e-12) whose circumcircle holds no other sample strictly (relative
tolerance 1e-11). Exactly cocircular quadruples, as in every grid cell, are
resolved by lifting the points onto a paraboloid with a fixed integer-hash
perturbation (the regular triangulation of that lifted set), so the choice of
diagonal is consistent and depends only on the sample order. The solver is
rebuilt only when the point list changes, so calling `set` every frame with the
same layout is cheap; a change of layout costs at most `C(32,3) * 32` circle tests.
Samples that are nearly but not exactly collinear can form thin triangles with a
steep but finite weight slope; this is a property of the layout, not smoothing.

**Cycles.** All active clips share one normalized phase in [0, 1). Its rate in
cycles per second is `speed * sum(w_i / duration_i)` (the weighted harmonic mean
of the durations, as `duration` reports it), evaluated with the weights at the
start of the advance. Changing the parameter therefore never moves the phase, and
the pose is continuous with the parameter. Clips that should step in unison must
have aligned cycles; the blend does not time-warp them. Clips are blended in
sample order, each by its share of the weight so far (lerp for translation and
scale, shortest-arc SLERP for rotation); channels a clip lacks use the bind
value. Playback loops by default; a non-looping blend holds phase one and
finishes. `crossedPhase` and `crossed` describe the most recent advance with the
weights that advanced it, retain multiple wraps and are unaffected by pose
throttling. With root motion owned by the host, the weighted translation delta
of the root node accumulates over every wrap on each advance; the displayed root
stays at bind. Layers (section 1.2), procedural overrides and IK compose on top
unchanged. A named `transition` or `copyPose` clears the blend, as for locomotion.

**Inspection.** `AnimationInspection.blend` is `{phase, parameter, samples[{clip,
x, y, weight}]}` with the current weights, or `null`. `mode` stays `"locomotion"`
while any blend space is active (the inspector panel and controller already
treat that mode as "phase-synchronized blend"). `AnimationInspection.locomotion`
keeps its 1D shape and is non-null only when every sample has `y = 0`.

### 1.2 Layer fades

```ts
player.layers.fade(id: string, weight: number, seconds: number): boolean
controller.fadeLayer(id, weight, seconds): boolean
```

The layer's weight moves from its current weight to `weight` along a smoothstep
(`3t^2 - 2t^3`, the curve of clip transitions) over `seconds`, advanced by
`advance` independently of the layer clock, so the result depends only on the
total time and not on the frame partition, and a hitch past the end lands exactly
on the target. Fades are continuous and interruptible: a new `fade` starts from
the weight the layer has at that moment and replaces the fade in progress; `set`
cancels a fade and applies its own weight at once (retarget with `fade` for a
smooth change). The layer keeps its clock, speed and phase throughout. Zero
seconds applies the weight immediately. A layer faded to zero stays registered and
keeps playing; only `remove`/`clear` delete it. It returns `false` for an unknown
layer and throws `RangeError` for a weight outside [0, 1] or a negative or
non-finite duration.

`AnimationLayerInspection` gains `targetWeight` (the fade target, or the weight
when none) and `fadeRemaining` (seconds left, `0` when none); `weight` is the
weight applied now.

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

A mapped humanoid gets analytic two-bone limb goals (legs and arms), an anatomical range
for the knee and elbow, a soft reach limit, optional end-joint orientation, and foot
placement that lowers the hips by the least amount that lets both feet reach their ground.
This is acceptance item 6 of decision 0219. It extends the orientation and hinge IK of
decision 0196 (which it does not replace) and obeys the scale rule of decision 0209. It
needs no compiler change: ABI 1 and extension API 1 stay, and the Mtek-source surface is
section 4. The code is `packages/runtime-web/src/scene/limb-ik.ts`.

### 3.1 Input: the humanoid map

The solver takes the `HumanoidMap` of decision 0219 and does not care how it was made
(decision 0221 builds maps; the tests here write them by hand for CesiumMan, the
character-composition Source and LongLegs, and synthetic rigs). It uses `hips`, the three
bones of each limb (`*UpperLeg/*LowerLeg/*Foot`, `*UpperArm/*LowerArm/*Hand`), and the
mesh-local `up` and `forward`. `setHumanoid` rejects a map when a used bone names no skin
node, when a lower bone is not a descendant of its upper bone or an end bone not a
descendant of its lower bone (twist bones between them are allowed and follow rigidly),
or when `up` or `forward` is zero or not finite. `setHumanoid(undefined)` removes the map
and every goal, and a goal or placement set without a map throws `RangeError`.

### 3.2 API

```ts
player.setHumanoid(map: HumanoidMap | undefined): void
player.ik.setLimb(id: string, goal: LimbGoal): void
player.ik.setFootPlacement(placement: FootPlacement | undefined): void
player.ik.remove(id: string): void   // a CCD constraint (0196) or a limb goal
player.ik.clear(): void              // all constraints, limb goals and foot placement; the map stays
// AnimationController: setHumanoid, setLimb, setFootPlacement (the same arguments)

type LimbName = "leftLeg" | "rightLeg" | "leftArm" | "rightArm";
interface LimbGoal {
  limb: LimbName;
  target: [x, y, z];                  // mesh-local position of the end joint (ankle, wrist)
  weight?: number;                    // [0, 1], default 1: blend with the animated pose
  pole?: [x, y, z];                   // mesh-local direction the knee/elbow bends toward
  rotation?: [x, y, z, w];            // mesh-local end orientation (without it the end keeps its local rotation)
  rotationWeight?: number;            // [0, 1], multiplies weight for the orientation
  softness?: number;                  // [0, 0.5], default 0.05
  flexion?: { min: number; max: number }; // radians, 0 <= min < max <= 175 deg; default 0..150 (leg) / 0..145 (arm) deg
}
interface FootGround {                // exactly one of height and point
  height?: number;                    // ground height under the foot along mesh-local up
  point?: [x, y, z];                  // mesh-local contact point
  normal?: [x, y, z];                 // mesh-local ground normal
  weight?: number;                    // contact weight in [0, 1], default 1
}
interface FootPlacement {
  left: FootGround; right: FootGround;
  smoothing?: number;                 // seconds, default 0.1; 0 follows immediately
  soleOffset?: number;                // foot joint to sole; default: the lower bind foot-joint height above groundLevel
  groundLevel?: number;               // height the animation was authored on; default 0
  maxDrop?: number;                   // default: half the shorter bind leg reach
  softness?: number;                  // default 0.05
}
```

Rules: one goal per limb (`setLimb` with another ID for a taken limb throws; the same ID
replaces), and goal IDs share a namespace with CCD constraints (the newest definition
wins). Foot placement owns both legs while it is set: a leg goal then throws, and
`setFootPlacement` throws while a leg goal exists. Arrays are copied. Targets, poles and
normals are mesh-local, the space of `jointPosition`. Invalid numbers throw
`RangeError` before any state changes.

### 3.3 The two-bone solve

All solving happens in skeleton space in double precision, on the pose after layers,
procedural overrides and root ownership. Let `Pu, Pl, Pe` be the animated upper, lower
and end joint positions, `a = |Pl - Pu|`, `b = |Pe - Pl|` (chords: twist bones in
between follow their parents rigidly), `T` the target, `d = |T - Pu|` and `e = (T - Pu)/d`
(the animated end direction if `d = 0`).

1. **Reach.** With flexion limits `[fmin, fmax]` the end joint can be
   `cmax = sqrt(a^2 + b^2 + 2ab cos fmin)` (straight) down to
   `cmin = sqrt(a^2 + b^2 + 2ab cos fmax)` from `Pu`. Non-uniform bone lengths, left/right
   differences and uniform scale need no special case: lengths are measured per pose.
2. **Softness.** `w = softness (cmax - cmin)`. A target at distance `d` is solved for
   `d'`: `d' = d` on `[cmin + w, cmax - w]`; above it
   `d' = (cmax - w) + w (1 - exp(-(d - (cmax - w)) / w))`; below it symmetrically,
   `d' = (cmin + w) - w (1 - exp(-((cmin + w) - d) / w))`. The map is strictly
   increasing, has slope 1 where it joins (C1), approaches `cmax` and `cmin` without
   snapping to them, and `softness = 0` is the hard clamp. A target farther than `cmax`
   therefore leaves the end joint on the ray toward the target, short of full extension
   (asymptotically at it).
3. **Angles.** Flexion `phi = acos((d'^2 - a^2 - b^2) / 2ab)` is in `[fmin, fmax]` by
   construction, so the middle joint can neither hyperextend nor fold past its range; the
   hip angle is `alpha = acos((a^2 + d'^2 - b^2) / (2 a d'))`.
4. **Bend plane from the bind pose.** At `setHumanoid` the solver reads the bind pose:
   the limb axis `A = unit(Pe - Pu)`, the bind knee/elbow offset from that line, and the
   anatomical side (`+forward` for legs, `-forward` for arms, projected across `A`). The
   offset gives the bend plane when it exceeds 0.3 % of the limb length (its sign is
   flipped to the anatomical side unless it is sideways to it); a straight bind uses the
   anatomical side itself; a limb along `forward` uses `up`. The hinge is `h = q x A`, where
   `q` is the bend direction, stored in the upper bone's local frame. A positive rotation
   about `h` bends the limb toward `q`. Knees therefore bend forward and elbows backward
   relative to `HumanoidMap.forward`, whatever the rig's axes, bone rolls or A/T pose.
5. **Following the animation.** At run time the hinge is the stored one carried by the
   animated upper bone, so thigh and upper-arm twists in the animation turn the bend
   plane with them. For a target direction `e` it is carried from the animated chord
   `c` to `r` and then to `e` by shortest arcs, where `-r` is the limb's single
   *singular direction*. Starting from the chord makes a target on the animated end
   joint leave the pose unchanged (measured below). Any continuous choice of bend plane
   over all target directions has one direction where it is undefined (a continuous
   tangent field on a sphere vanishes somewhere); the solver puts it where it matters
   least: straight up for legs (into the torso) and medial and backward for arms (a
   hand behind the back on the far side), in the frame of the upper bone's parent so it
   follows the body. Away from it the hinge turns at the rate of the target; close to it
   the plane turns quickly (sensitivity about 1/angle, measured below). An explicit
   `pole` replaces the carried hinge by `h = unit(pole - (pole.e) e) x e`; a pole
   within about 0.001 of the limb axis falls back to the carried hinge.
6. **Rotations.** The upper bone is swung from its animated direction to its solved
   direction `u = cos(alpha) e + sin(alpha) q` and twisted about `u` until its hinge lies
   across the bend plane; the lower bone is swung onto the end target. Local rotations
   are computed from the parents' global rotations (rotation-only conversion, valid under
   the uniform-scale rule below), so animated lower-bone twist and any intermediate
   twist bones are preserved.
7. **Weight and orientation.** `weight` blends each of the upper, lower and end local
   rotations between the animated pose and the solved one by spherical interpolation;
   `weight = 0` is bit-identical to the animated pose. With `rotation`, the end bone's
   local rotation is blended toward the one that gives that mesh-local orientation, by
   `weight * rotationWeight`; without it the end keeps its local rotation (it turns with
   the shin).
8. **Scale (decision 0209).** Every node from the root to a limb end, the hips and the
   mesh node must have numerically uniform positive scale (the `16 * 2^-23` float32
   round-off band of 0209); a larger anisotropy raises `RangeError("Limb IK requires
   uniform ancestor scales")` during evaluation, as orientation IK does. Uniform scales of
   any size, rotated mesh nodes and Z-up meshes are fine.

Degenerate targets (at the upper joint, on the limb axis, exactly at full reach, along
the pole, opposite the limb) produce finite poses: zero distance uses the animated end
direction, antipodal swings use the hinge as their axis, and bones of length zero are
left untouched.

### 3.4 Foot placement

`setFootPlacement({left, right, ...})` adds a per-frame stage before the limb goals. Each
foot is a `FootGround`:

- `{height}`: terrain following. The foot keeps its animated plane position and lift and
  follows the ground by `height - groundLevel`, but never goes below
  `height + soleOffset` (divided by the slope term `max(0.5, normal . up)` when a normal
  is given). This works for a whole walk cycle without contact flags.
- `{point, normal?}`: planted. The foot joint goes to `point + normal * soleOffset`
  (`normal` defaults to up).
- The foot's animated global orientation is kept, tilted by the shortest rotation from
  `up` to `normal` when a normal is given, so the sole follows slopes whatever the shin
  does. Toes follow their parent.
- `weight` is the contact signal: it blends the foot toward its target, and scales its
  contribution to the hips drop.

The **hips drop** is the smallest `delta >= 0` along mesh-local up with
`|T_i - (Pu_i - delta up)| <= cmax_i - w_i` for both feet (each foot's exact-reach limit
from 3.3), found in closed form: with `v = T - Pu`, `p = v . up`, `q = |v|^2 - L^2`, the
drop is `0` if `q <= 0`, else `max(0, -p - sqrt(p^2 - q))`, `max(0, -p)` when no drop can
reach, and `0` when the interval lies below zero (a higher ground is never fixed by
raising the hips). The drop is `max_i (weight_i * delta_i)`, capped by `maxDrop`, applied
to the hips node's local translation in its parent's frame, and then both legs are solved
to their targets. Smoothing is `drop <- drop + (wanted - drop)(1 - exp(-dt / smoothing))`
using the time accumulated by `advance` since the last evaluation: the first
evaluation takes the wanted drop without lag, evaluation alone never advances it, state
survives replacing the placement each frame, and a paused clock still converges (the
player keeps evaluating while it is converging). During lag the feet may be short of
their targets; `inspect()` reports the miss.

Because the soft limit starts 3.7 % of the reach short of full extension, a leg that is
straighter than that in the animation is bent a little when a foot is pinned, even on
flat ground (no locked knees). A leg with at least about 30 degrees of knee flexion is
inside the exact shell, and then flat ground in reach leaves the pose unchanged. Pass
`softness: 0` to pin straight legs exactly.

`soleOffset` cannot be derived from a skeleton (the mesh is not in the skin). The default
assumes the bind pose stands on mesh-local height 0 along `up`, so the lower bind foot
joint height is the offset. Pass both `soleOffset` and `groundLevel` when the mesh origin
is not at the soles.

### 3.5 Evaluation order

Base clip or blend, layers, procedural override, root-motion ownership (0196, unchanged),
**then limbs**: foot placement (hips drop, then both legs), then limb goals in the fixed
order left leg, right leg, left arm, right arm, **then CCD constraints** in insertion order
(0196), then matrices and the palette. Limb goals therefore see the animated pose and the
hips adjustment; a CCD constraint on the same chain refines (and overrides) a limb
result, and a CCD constraint on a parent chain still sees the lowered hips. The skeleton
change is four lines: `SkeletonPlayer.setHumanoid`, `ik.advance(dt)` inside `advance`,
`!ik.animating` in the evaluation memo, and the limb inspection spread into `inspect()`.

### 3.6 Inspection

`AnimationInspection` gains optional `limbs` (id, limb, node indices, target, weight,
rotation, pole, softness, flexion range, last solved flexion and miss) and
`footPlacement` (both grounds with last flexion and miss, smoothing, sole offset, ground
level, `requiredDrop`, applied `drop`). The inspector overlay draws limb goals like IK goals and its
panel lists them. Reading them never evaluates a pose.

### 3.7 Measurements

Generated by `npm run limbs:write` from `packages/runtime-web/src/scene/limb-evidence.ts`
(rigs, sweeps and checks) through `SkeletonPlayer`; `npm run limbs:check` and
`limb-solving.test.ts` fail when the table or `evidence/animation/limb-solving.json`
differ from a fresh measurement or a bound is missed. The rigs are synthetic and
deterministic: straight identity-frame, bent-bind A-pose with rolled bone frames, a Z-up
mesh yawed and scaled by 2.5 with unequal bone lengths, and a long-thigh/short-shin rig;
foot placement uses two bent-knee stances. The independent checks recompute joint angles
from positions and the bind pose, and the minimum hips drop by scanning and bisection,
not from the solver's formulas. Error-like figures are rounded up to a power of ten so
that float noise cannot change the published text.

<!-- limb-solving:begin -->
| Measurement | Result | Bound |
|---|---|---|
| Reach error, reachable targets (relative to full reach) | 32000 targets, 4 rigs x 4 limbs: at most 1e-6 | 1e-5 |
| Beyond reach: end-joint distance / full reach | 77760 targets: at most 1 | <= 1.000001 |
| Beyond reach: monotone in target distance | 0 violations | 0 |
| Beyond reach: direction error | at most 1e-6 rad | 1e-5 rad |
| Soft reach profile, upright left leg (end / reach at target 0.95, 1.0, 1.1, 2.0 x reach) | 0.95, 0.9864, 0.9991, 1 | monotone, <= 1 |
| Middle joint outside its range | 0 of 153600 targets; flexion seen 0.264 to 150 deg | 0 (knee 0-150, elbow 0-145 deg) |
| Reverse bends (negative flexion about the bind hinge) | 0 | 0 |
| Knees behind the hip-ankle line (legs, lower hemisphere) | 0 | 0 |
| Non-finite poses (sweeps and degenerate targets) | 0 of 154304 | 0 |
| Continuity: largest joint rotation per unit of target travel / reach (soft 0.05) | 8.77 rad | 12 rad |
| Continuity: same paths with a hard clamp (softness 0) | 99.7 rad | reference only |
| Foot placement: hips drop vs independent minimum | 86 steps/slopes, 2 rigs: at most 1e-6 | 1e-5 |
| Foot placement: foot joint to target | at most 1e-6 | 1e-5 |
| Foot placement: hips raised above the animated pose | 0 cases (largest drop 0.294 units) | 0 |
| Foot placement: foot orientation vs tilted animation | at most 1e-6 rad | 1e-5 rad |
| Foot placement: flat ground in reach leaves the pose unchanged | pose difference at most 1e-15, drop 0 | 1e-9 |
| Foot placement: smoothing follows D (1 - exp(-t / tau)) | 90 frames: deviation at most 1e-16, monotone | 1e-9 |
<!-- limb-solving:end -->

Reading the table: continuity is the largest rotation of the upper or lower local
rotation, or of the flexion, between two consecutive target positions, per unit of target
travel measured in full reaches. A great circle at 0.8 reach gives 1.25 (the joints
turn exactly as fast as the target direction); the radial paths through full extension
reach about 8 because `d(flexion)/d(d')` is large there (the analytic maximum of the
soft zone is `reach * sqrt(reach / (2 a b w))`); and the hard clamp (`softness = 0`)
is more than ten times worse on the same path, which is what the softness buys. Paths
that pass near a limb's singular direction (3.3 item 5) reach 3 to 5.4.

### 3.8 Limits

- Only the middle joint has a range. Hip and shoulder swing, clavicle motion and twist
  distribution are not constrained or solved, and toes are not solved separately.
- Targets inside the last `softness * (cmax - cmin)` of reach (3.7 % of full reach by
  default) are met approximately, by design; the exact-reach figure is for the shell
  inside it.
- One singular direction per limb; a path through it flips the bend plane quickly.
  An explicit `pole` has the opposite singularity (along the limb axis).
- Foot placement uses the ground targets it is given: no ray casts, no contact detection,
  no planting; `weight` is the host's contact signal. The hips move straight along `up`,
  one drop for both legs, not forward or sideways.
- Smoothing is symmetric, so a fast ground change lags with the feet briefly short.
- Uniform scale only (0209). Limb goals and placement are state of one `SkeletonPlayer`
  and are shared by explicit pose cohorts (0196); `detachAnimation` snapshots the pose,
  not the goals.
- The browser, GPU and Mtek-source paths are not exercised here (decisions 0223 and 0224).

## 4. Composition in Mtek programs (decision 0223)

Decision 0223 gives a `.mtek` program everything sections 1 to 3 give a host: masked layers with fades,
1D and 2D blend spaces, positional and anatomical goals, root motion as a displacement, and the clips of
another humanoid. It is acceptance item 1 of decision 0219. The calls are `animation.*` (CPU only, no
GPU or constant use); the ones that change state are handlers-only like `animation.play` (`E5080` in a
function or an initialiser, `E5005` in a `bind`). A new entity field, `clips_from`, takes the clips of
another file's skeleton. The runtime ABI stays 1; the manifest gains optional data (4.9).

### 4.1 The calls

Every call takes the entity first (`target: entity_ref`, a named entity or a reference) and returns
`bool`, *applied*, unless a result type is shown. A call on a dead reference, an entity without a skeletal
mesh, or with a number that is not finite does nothing and returns `false`, without a diagnostic (the
convention of `animation.play`). A weight is clamped to 0..1.

| Call | Meaning |
| --- | --- |
| `set_layer(target, id: string, clip: string, weight: f32, additive: bool, mask: string)` | Layer `id` plays `clip` over the base pose (section 1.2). `mask` is the name of a joint: the layer moves that joint and every descendant (`PoseLayers` option `subtree`); `""` is the whole rig. Setting an existing layer with the same clip keeps its clock; setting cancels a fade and applies `weight` at once. |
| `fade_layer(target, id, weight: f32, seconds: f32)` | Section 1.2 `fade`: smoothstep from the current weight, interruptible, keeps the phase. `false` and `E8111` for a layer that does not exist; a negative `seconds` returns `false`. |
| `remove_layer(target, id)` | Removes the layer; `false` (no diagnostic) when there is none. |
| `blend_sample(target, clip, x: f32, y: f32)` | Adds a sample to the entity's **pending** blend definition (at most 32). |
| `blend_play(target, looping: bool, speed: f32)` | Makes the pending definition the base pose (`player.blend.set`, section 1.1), restarting at phase 0, and **consumes** it, whether it was valid or not. |
| `blend_parameter(target, x, y)` | Moves the parameter of the active blend; before `blend_play` it is the initial parameter of the pending one (the first sample otherwise). `false` when there is neither. |
| `blend_clear(target)` | Drops the active blend (the base clip resumes) and the pending definition. |
| `blend_phase(target) -> f32` | The blend's normalised cycle position, `0` without a blend. |
| `limb_goal(target, limb: string, goal: vec3, weight: f32)` | Section 3.2 `setLimb`; `limb` is `"left_leg"`, `"right_leg"`, `"left_arm"` or `"right_arm"`, `goal` the world position of the ankle or wrist. One goal per limb; a new call replaces it. |
| `clear_limb(target, id)` | Removes the goal of the limb named `id`; `false` when there is none. |
| `foot_placement(target, left: vec3, right: vec3, left_normal: vec3, right_normal: vec3, weight: f32)` | Section 3.4: world ground points and normals; `weight` is the contact weight of both feet. A zero normal means no tilt. |
| `clear_foot_placement(target)` | Releases foot placement. |
| `chain_goal(target, id, end_joint: string, length: i32, goal: vec3, weight: f32)` | CCD constraint (decision 0196) on `end_joint` and its `length - 1` ancestors, from the top of the chain to the end; 12 iterations, tolerance 1 mm. `length` is at least 2. |
| `clear_chain(target, id)` | Removes the constraint; `false` when there is none. |
| `root_motion(target, joint: string)` | Gives the translation of `joint` to the program (`player.setRootMotion`): the displayed joint stays at bind, `take_root_motion` returns what it moved. `""` hands it back. |
| `take_root_motion(target) -> vec3` | The root displacement since the last call, in world space; consumed. Zero without root motion. |

`clear_*` and `remove_layer` are idempotent. Layer and chain ids share the namespace of the host API
(`player.layers`, `player.ik`), so a host can inspect or remove what a program set; limb goals use the
ids `limb:<name>`.

### 4.2 World space

The solvers work in the skeletal mesh local space of `animation.joint_position`. A goal, ground point or
normal a program gives is in **world** space, and the runtime carries it into that space with the entity's world
matrix at the time of the call (pending writes to the entity are propagated first): a position `p` by the
inverse of the matrix, a normal by its transpose (renormalised), so that an entity that is rotated, moved,
scaled uniformly or not at all, keeps the end joint on the world goal. The skeleton itself must still have
uniform bind scales (decision 0209); the *entity's* scale is free. A goal is converted when the call runs and
is not tied to the entity afterwards: a program that wants a goal to follow a moving entity (or a moving
target) calls again every `update`, which is cheap. `take_root_motion` multiplies by the linear part of the
matrix (rotation and scale, no translation).

Root motion is first turned from the space of the root joint's parent into the mesh-local space with the
displayed transform of that parent relative to the mesh node (`SkeletonPlayer.consumeRootMotionLocal`, a
rig whose armature is scaled by 0.01 or rotated to Z-up therefore reports correct displacements), then to
the world. It feeds a character mover directly:

```mtek
scene Walk {
    camera Main {}
    entity Hero {
        body: Kinematic {};
        collider: CapsuleCollider { radius: 0.3; height: 1.8; };
    }
    on key_down(Key.Space) {
        animation.root_motion(Hero, "Hips");
    }
    update(dt: f32) {
        Hero.body.move_character(animation.take_root_motion(Hero), Hero.rotation);
    }
}
```

### 4.3 Humanoid commands

`limb_goal` and `foot_placement` need the canonical bones of section 2. The runtime maps the entity's skin
with `mapHumanoid` the first time one of them is called and gives the result to `setHumanoid` (section 3.2);
a skeleton that does not map (or whose map `setHumanoid` refuses) is `E8112` once for the entity, and every
humanoid call is then dropped without further diagnostics. A leg goal while foot placement is set (or the
reverse) is refused by the solver (section 3.2) and reported as `E8113`.

### 4.4 Names, diagnostics and reporting

The calls that can name something the entity lacks carry the span of the call to the runtime
(`ctx.animationSetLayer(.., spanId)`), so a diagnostic points at the Mtek source. A call is dropped and returns
`false` in each case. Each diagnostic is reported **once per entity and name** (a pose cohort counts as one
entity).

| Code | Reported for |
| --- | --- |
| `E8110` | `clips_from`: the source or the target skeleton does not map as a humanoid, or the retarget fails (4.9); once per declaration. The entity keeps its own clips. |
| `E8111` | An unknown clip (`set_layer`, `blend_sample`), joint (`set_layer` mask, `chain_goal` end joint, `root_motion`), layer (`fade_layer`) or limb (`limb_goal`, `clear_limb`) name, or a `blend_play` with no sample pending. |
| `E8112` | `limb_goal` or `foot_placement` on a skeleton that is not a humanoid (4.3). |
| `E8113` | A call the animation system refuses for another reason, with its message: an invalid blend space (two samples at one point, a zero-duration clip, more than 32 samples), a chain that is shorter than 2 or longer than the skeleton, a leg goal next to foot placement, an empty layer id. `E8113` is an addition of decision 0223 to the three codes 0219 reserved. |

Removal and clearing calls report nothing for a name that was never set.

### 4.5 Layers and blend spaces

A layer is the layer of section 1.2; a program that sets a layer every frame with the same clip, weight and
mask costs a mask rebuild (at most 256 floats) and no phase change. `blend_sample` accumulates;
`blend_play` builds the blend space with `looping` and `speed`, the pending parameter and phase 0. A program
therefore defines a blend once (in `init` or on an event), then moves the parameter every frame. A
later `animation.transition` clears the blend, as in section 1.1; `animation.pause`, `resume`, `seek`,
`time`, `duration`, `playing`, `finished` and `crossed` act on the blend while it is active (decision 0220).
All of them evaluate at the next advance of phase 3; the calls of this section do not evaluate the pose
themselves, so several calls in one handler cost one evaluation.

### 4.6 Hot reload

A hot reload builds a new world: the players, and with them layers, the blend space, pending samples,
limb, foot and chain goals, root-motion ownership and the once-only diagnostics are not migrated (a
playing clip is not migrated either, decision 0190). The new program's `init` and handlers set them up again
in its first frames. State the program keeps in its `state` carries over as always.

### 4.7 Example

```mtek
const RIG = asset.glb("../models/Hero.glb");
const MIXAMO = asset.glb("../models/Dance.glb");

scene Demo {
    state steps: f32 = 0.0;
    camera Main {}
    entity Hero {
        mesh: RIG.mesh("Body");
        clips_from: MIXAMO;
        clip: "Walk";
        body: Kinematic {};
        collider: CapsuleCollider { radius: 0.3; height: 1.8; };
    }
    on key_down(Key.Space) {
        animation.set_layer(Hero, "wave", "Wave", 1.0, false, "Spine1");
        animation.fade_layer(Hero, "wave", 0.0, 0.5);
        animation.root_motion(Hero, "Hips");
    }
    update(dt: f32) {
        animation.foot_placement(Hero, vec3(0.2, 0.0, 0.0), vec3(-0.2, 0.1, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), 1.0);
        animation.limb_goal(Hero, "right_arm", vec3(1.0, 1.4, 0.5), 0.8);
        Hero.body.move_character(animation.take_root_motion(Hero), Hero.rotation);
    }
}
```

### 4.8 Chains

`chain_goal` builds the chain from the skeleton hierarchy, so the program names only the end joint and the
length. The constraint is the one of `player.ik.set`: bounded CCD, no hinge limits, positional only.
For arms and legs of a humanoid prefer `limb_goal` (an analytic solve with a bend direction and a knee or elbow
range); use chains for tails, spines, tentacles and rigs `mapHumanoid` rejects.

### 4.9 `clips_from` and the manifest

`clips_from: asset.glb("..")` is a field of entities and prefabs (construction-only, a GLB constant). The
entity plays the clips of **that file's skeleton**, retargeted onto its own skeletal mesh when the scene
mounts:

* **Compile time.** The entity must have a skeletal mesh (`mesh` from a file with a skin for it) and the named
  file must contain a skin with at least one clip, else `E7028`. A `clip: "name"` next to it names a clip of
  the source skeleton (`E5016` if the source has none of that name); the first skin of the file that has clips
  is the source. Whether both skeletons are humanoids is only known to the run-time mapper (`E8110`).
* **Manifest.** The top-level optional array `clipSources` holds each source skeleton once, sorted by file:
  a `skin` (nodes, joints, inverse bind matrices, clips) with **empty** `indices` and `weights` (vertex
  influences stay with the mesh). Entities and prefabs carry `clipsFrom`, the index into `clipSources`. The
  `clip` of such an entity has no channels (the runtime retargets the keyframes). Manifest schema 1 and runtime
  ABI 1 are unchanged: both fields are optional and absent when no entity uses `clips_from`.
* **Run time.** At mount (and for every spawn) the runtime calls `retargetHumanoid(source, ownSkin)`
  (section 2.5) and gives the entity's player the result: the entity's own nodes, joints and inverse bind
  matrices with the source's clips, so every `animation.*` call sees the **source's** clip names; the entity's
  own clips are not available while `clips_from` works. The result is cached per source and target, so a crowd
  of one prefab retargets once. Any `RangeError` of the mapper or the retargeter (not a humanoid, a
  non-uniform bind scale, a missing bone) is `E8110` at the declaration of the entity, once, and the
  entity keeps its own skin and clips.

### 4.10 Limits

- A program drives *one* skeleton per call; there is no stacking of retargeted sources on one entity.
- Goals are not tied to entities (4.2) and limb solving has no ground detection: the program supplies ground
  points, for example from `body` queries of the host.
- `clips_from` takes the first skin of a file that has clips; a file with several skeletons needs a
  dedicated file.
- Automatic mapping of non-humanoid rigs, facial animation and animation events beyond `crossed` are outside
  the area (decision 0219).

## 5. Where the code lives: the animation module (decision 0225)

The skeletal player, pose layers, blend spaces, IK, limb solving, humanoid mapping and retargeting and the
`animation.*` commands of section 4 are not part of the core runtime (`runtime.<h16>.js`). They are the
**animation module**, `animation/<h16>.js`, which `mtek build` writes and the runtime imports at mount with a
dynamic `import()`, like the physics module (`spec/runtime-abi.md` section 5.2).

- **When.** `subsystems.animation` is true exactly when the scene's manifest has a skinned mesh (a mesh entry with
  a `skin`) or a non-empty `clipSources` (`clips_from`, 4.9). Rigid node clips (decision 0190), static glTF meshes
  and the CPU/GPU skinning of the renderer do not need the module; a program without skinned meshes never requests
  it and ships a runtime without a byte of the code above.
- **What the core keeps.** Rigid node clips and the clip control API they share with skeletal players (`play`,
  `pause`, `seek`, `fade`, `time`, `crossed`, ...; `scene/animation-players.ts`), the validation of a skin at mount
  (`E8006`), and the renderer's skinning, which reads a player's palette through a type-only interface. Without
  the module every `animation.*` command is dropped and returns `false`, as it is for an entity without a skeleton.
- **Failure.** `E8114` (`spec/diagnostics.md`): the file is missing or does not parse, has no default export that
  is a function, or its backend lacks `name`, `createPlayers`, `createCommands` or `retargetHumanoid`; a manifest
  with a skinned mesh or `clips_from` that does not declare the module is `E8114` too. The mount fails with the
  kind `animation-failed`; a hot reload that needs a module that does not load is refused.
- **Host code.** The host API of this document (`createAnimationController`, `mapHumanoid`, `retargetHumanoid`,
  `retargetSkin`, `deformSkin`, the types) is exported synchronously by the npm entry `@mtek/runtime-web`
  (`dist/runtime.js`), which is the core plus this code, bundled by the host with what it imports. The
  `runtime.<h16>.js` of a built game is the core only and does not export them.

## 6. Demonstration (decision 0224)

`examples/animation-composition` composes everything in sections 1 to 4 in Mtek source, with no host animation code: a 2D blend space of
idle, walk, run and the two strafes driven by the keys, root motion fed to `move_character`, an upper-body layer faded in and out, a hand reaching a
world-space point with `limb_goal`, a chain goal on a tail, foot placement on a curb, risers and a ramp, and a second rig with other names, proportions
and rest pose playing the first rig's clips through `clips_from`. Its two models are generated by `tests/assets/tools/animation-demo-assets.mjs`.
`tests/browser/specs/animation-composition/` runs it on the hardware and the software WebGPU configurations with the manual clock and compares
it with CPU references: the blend weights with a hand-derived Delaunay layout (worst difference 1.1e-16), layer fades with the smoothstep
(3e-14), the Guest with `retargetHumanoid` on the CPU (2.4e-7 m), the hand with its target (2.6e-7 m), the planted feet with the ground (4.7 mm at worst,
inside the soft reach margin of 13.0 mm), the hips drop with the closed form of 3.4 derived from the unplaced pose (0.19838 m against 0.19841 reported), the root
motion with the clips' own travel (under 0.7 mm/s) and the GPU image with a CPU-skinned silhouette (41 to 59 pixels of 467 to 521 allowed). The measurements
and their derivations are in decision 0224.

Two limits it found. The animated pose cannot be read once goals are set (`animation.joint_position` is the final pose), so a program that puts feet on
ground from the animated feet keeps an unplaced twin entity that plays the same blend. And the animation clock is the frame time, not the tick: a result that
depends on the blend weights differs between display rates by the sample-and-hold of the weights (section 1.1), while the parameter a program computes with the
frame time, the layer fades and the layer clocks do not.
