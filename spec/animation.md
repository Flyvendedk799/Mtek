# Animation: composition, adaptation and measured behaviour

- Repository path: `spec/animation.md`
- Status: Normative for the composable-animation area (decision 0219). Earlier
  behaviour (clips, skeletal playback, layers, 1D locomotion, IK, retarget frames)
  is specified by decisions 0190, 0191, 0192, 0196 and 0209.

## 1. Blend spaces and layer fades (decision 0220)

<!-- 0220 writes this section. -->

## 2. Automatic humanoid mapping and retargeting (decision 0221)

<!-- 0221 writes this section, including its generated measurement table. -->

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

<!-- 0223 writes this section. -->
