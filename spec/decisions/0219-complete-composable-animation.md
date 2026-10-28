# 0219 — Complete composable and adaptable animation

Status: accepted contract; **met** on 2026-10-28 by 0220–0225 (scorecard area 2 done). Date: 2026-10-27. Extends 0190, 0191, 0192, 0196 and 0209.
Defines what "done" means for platform scorecard area 2 (composable and
adaptable animation) and splits the work into 0220 (blend spaces and layer
fades), 0221 (automatic humanoid mapping and retargeting), 0222 (anatomical
limb solving), 0223 (language and manifest surface) and 0224 (demonstration).

## Why

Layers, masks, additive actions, 1D locomotion, positional IK, hinge limits,
root motion and explicit-mapping retargeting exist, but only host TypeScript can
use them: a `.mtek` program can only play, fade and transition clips. The
scorecard defers 2D blend spaces, automatic humanoid mapping and anatomical
solving as "extensions"; this contract makes them part of the area instead.

## Acceptance (area 2 is done when every item holds and is tested)

1. **Source reach.** A `.mtek` program composes animation without host code:
   masked override/additive layers with fades, 1D and 2D blend spaces driven by
   parameters, IK goals (positional chains and anatomical limbs), root motion
   consumed as a displacement, and clips taken from another humanoid rig.
2. **2D blend spaces.** Any number of clips placed at 2D parameter points; the
   weights are a partition of unity, exact at each sample, continuous in the
   parameter, clamp to the nearest hull point outside the samples, and reduce
   to the existing 1D behaviour for collinear samples. Cycles stay
   phase-synchronized (shared normalized cycle) while weights change.
3. **Layer fades.** A layer's weight can be faded over a duration; fades are
   continuous, interruptible and keep the layer's phase.
4. **Automatic humanoid mapping.** A function maps a skin to the canonical
   humanoid bones below from names (Mixamo, Unreal mannequin, Unity/VRM-style,
   Blender/Rigify `DEF-`, CesiumMan `Skeleton_*` and plain `LeftUpLeg`-style)
   and, when names fail, from topology and bind geometry. It reports
   per-bone source (name or structure), confidence and unmapped bones, and
   rejects non-humanoids (the Fox) instead of guessing.
5. **Humanoid retargeting.** A clip of one humanoid plays on another with
   different names, proportions and rest pose (T-pose vs A-pose) using the
   automatic map, rest-pose correction and automatic hips-translation scale
   from leg length. Measured limb-direction error and foot sliding are published
   and asserted.
6. **Anatomical solving.** For a mapped humanoid: analytic two-bone limb IK
   with a bend direction taken from the bind pose (knees forward, elbows back),
   anatomical hinge ranges for knees and elbows, reach clamping without popping,
   and foot placement on unequal heights that lowers the hips only as much as
   needed. Joint angles stay continuous along continuous target paths and never
   bend backwards.
7. **Evidence.** CPU unit tests for all of the above, published measurements in a
   new `spec/animation.md` (created by 0220; 0221 and 0222 add sections), generated
   by scripts and asserted by tests, and an example written in Mtek source with a
   browser test on both local backends comparing GPU output with CPU references.

Wider physical devices remain area 7. Automatic mapping of non-humanoid rigs
(quadrupeds, creatures) and facial animation are outside the area.

## Canonical humanoid bones (shared by 0221, 0222, 0223)

Required: `hips`, `spine`, `head`, `leftUpperLeg`, `leftLowerLeg`, `leftFoot`,
`rightUpperLeg`, `rightLowerLeg`, `rightFoot`, `leftUpperArm`, `leftLowerArm`,
`leftHand`, `rightUpperArm`, `rightLowerArm`, `rightHand`.
Optional: `chest`, `upperChest`, `neck`, `leftShoulder`, `rightShoulder`,
`leftToes`, `rightToes`. "Left" is the character's left.

```ts
export type HumanoidBone = "hips" | "spine" | ... ; // the 22 names above
export interface HumanoidMap {
  readonly bones: Readonly<Partial<Record<HumanoidBone, string>>>; // node names
  readonly evidence: Readonly<Partial<Record<HumanoidBone, "name" | "structure">>>;
  readonly confidence: number;            // [0, 1]
  readonly unmapped: readonly HumanoidBone[]; // optional bones not found
  readonly up: readonly [number, number, number];      // mesh-local up (hips to head)
  readonly forward: readonly [number, number, number]; // mesh-local facing
}
export function mapHumanoid(skin: MtekSkin): HumanoidMap | { readonly error: string };
```

The type and `mapHumanoid` live in `packages/runtime-web/src/scene/humanoid.ts`
(0221). 0222 takes a `HumanoidMap` as input and must not depend on how it was
made.

## Runtime diagnostics reserved

`E8110` humanoid mapping failed for a `clips_from` source or target (the entity
keeps its own clips), `E8111` an animation command names an unknown clip, joint,
layer or blend space (dropped), `E8112` an IK goal names an unknown chain or a
non-humanoid limb (dropped). 0223 may refine the wording, not the meaning.
