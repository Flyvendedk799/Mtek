// The canonical humanoid vocabulary of decision 0219. Decision 0221 owns `mapHumanoid` (scene/humanoid.ts) and
// the same declarations; this file exists so the limb solver (decision 0222) depends only on the type, never on
// how a map was produced. When scene/humanoid.ts lands, re-export these two names from it and delete this file.

export type HumanoidBone =
  | "hips" | "spine" | "head"
  | "leftUpperLeg" | "leftLowerLeg" | "leftFoot"
  | "rightUpperLeg" | "rightLowerLeg" | "rightFoot"
  | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightUpperArm" | "rightLowerArm" | "rightHand"
  | "chest" | "upperChest" | "neck" | "leftShoulder" | "rightShoulder" | "leftToes" | "rightToes";

export interface HumanoidMap {
  /** Skin node names. */
  readonly bones: Readonly<Partial<Record<HumanoidBone, string>>>;
  readonly evidence: Readonly<Partial<Record<HumanoidBone, "name" | "structure">>>;
  /** In [0, 1]. */
  readonly confidence: number;
  /** Optional bones that were not found. */
  readonly unmapped: readonly HumanoidBone[];
  /** Mesh-local up (hips to head). */
  readonly up: readonly [number, number, number];
  /** Mesh-local facing direction. */
  readonly forward: readonly [number, number, number];
}
