import type { MtekSkin } from "./abi/manifest-types.js";
import type { AnimationLayer } from "./scene/pose-layers.js";
import type { IKConstraint } from "./scene/ik.js";
import { SkeletonPlayer, skinProblem } from "./scene/skeleton.js";
import { PoseSchedule, type AnimationUpdateBand } from "./scene/pose-schedule.js";
import type { LocomotionOptions } from "./scene/locomotion.js";
import type { BlendOptions } from "./scene/blend-space.js";

/** Structural interface implemented by Three.js Bone/Object3D and ordinary host objects. */
export interface AnimationBone {
  readonly position: { set(x: number, y: number, z: number): unknown };
  readonly quaternion: {
    set(x: number, y: number, z: number, w: number): unknown;
  };
  readonly scale: { set(x: number, y: number, z: number): unknown };
}
export interface AnimationControllerOptions {
  readonly clip?: string;
  readonly bones?: Readonly<Record<string, AnimationBone>>;
  /** Pose evaluation interval in seconds; clocks and marker queries still advance on every update. */
  readonly updateInterval?: number;
  readonly updatePolicy?: readonly AnimationUpdateBand[];
}

/** Independent of the Mtek compiler, mounted application and renderer. Extension API v1. */
export class AnimationController {
  readonly apiVersion = 1;
  readonly player: SkeletonPlayer;
  private targets: readonly { node: number; bone: AnimationBone }[];
  private readonly schedule = new PoseSchedule();
  private disposed = false;
  constructor(skin: MtekSkin, options: AnimationControllerOptions = {}) {
    const problem = skinProblem(skin, skin.indices.length);
    if (problem !== undefined) throw new RangeError(problem);
    this.player = new SkeletonPlayer(skin, options.clip);
    this.setUpdateInterval(options.updateInterval ?? 0);
    if (options.updatePolicy !== undefined) this.setUpdatePolicy(options.updatePolicy);
    this.targets = Object.entries(options.bones ?? {}).map(([name, bone]) => {
      const node = skin.nodes.findIndex((n) => n.name === name);
      if (node < 0) throw new RangeError(`Unknown animation bone: ${name}`);
      return { node, bone };
    });
    this.apply();
  }
  private active(): void {
    if (this.disposed) throw new Error("Animation controller is disposed");
  }
  setUpdateInterval(seconds: number): void {
    this.active();
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new RangeError(
        "Animation update interval must be finite and nonnegative",
      );
    this.schedule.set([{distance: 0, interval: seconds}]);
  }
  setUpdatePolicy(bands: readonly AnimationUpdateBand[] | undefined): void {
    this.active(); this.schedule.set(bands);
  }
  setLocomotion(options: LocomotionOptions | undefined): void {
    this.active(); this.player.locomotion.set(options);
  }
  setLocomotionParameter(value: number): void {
    this.active(); this.player.locomotion.setParameter(value);
  }
  /** Configure (or with `undefined` clear) the 2D blend space that drives the base pose. */
  setBlendSpace(options: BlendOptions | undefined): void {
    this.active(); this.player.blend.set(options);
  }
  setBlendParameter(x: number, y: number): void {
    this.active(); this.player.blend.setParameter(x, y);
  }
  setLayer(id: string, layer: AnimationLayer): void {
    this.active();
    this.player.layers.set(id, layer);
  }
  /** Fade a layer's weight over `seconds`; false when the layer does not exist. */
  fadeLayer(id: string, weight: number, seconds: number): boolean {
    this.active();
    return this.player.layers.fade(id, weight, seconds);
  }
  setIK(id: string, constraint: IKConstraint): void {
    this.active();
    this.player.ik.set(id, constraint);
  }
  update(dt: number, force = false, distance = 0): boolean {
    this.active();
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("Animation delta must be finite and nonnegative");
    if (!Number.isFinite(distance) || distance < 0)
      throw new RangeError("Animation distance must be finite and nonnegative");
    this.player.advance(dt, false);
    if (!this.schedule.due(dt,distance,force)) return false;
    this.player.evaluate();
    this.apply();
    return true;
  }
  private apply(): void {
    const p = this.player.pose;
    for (const { node, bone } of this.targets) {
      const at = node * 10;
      bone.position.set(p[at]!, p[at + 1]!, p[at + 2]!);
      bone.quaternion.set(p[at + 3]!, p[at + 4]!, p[at + 5]!, p[at + 6]!);
      bone.scale.set(p[at + 7]!, p[at + 8]!, p[at + 9]!);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.targets = [];
    this.player.layers.clear();
    this.player.blend.set(undefined);
    this.player.ik.clear();
    this.player.setProceduralOverride(undefined);
  }
}

export function createAnimationController(
  skin: MtekSkin,
  options?: AnimationControllerOptions,
): AnimationController {
  return new AnimationController(skin, options);
}
export { retargetSkin } from "./scene/retarget.js";
export type { RetargetOptions } from "./scene/retarget.js";
export { mapHumanoid } from "./scene/humanoid.js";
export type { HumanoidBone, HumanoidMap } from "./scene/humanoid.js";
export { retargetHumanoid } from "./scene/humanoid-retarget.js";
export type { HumanoidRetargetOptions } from "./scene/humanoid-retarget.js";
export {deformSkin} from "./mesh/skinning.js";
export type { AnimationLayer } from "./scene/pose-layers.js";
export type { IKConstraint, IKHingeLimit } from "./scene/ik.js";
export type { LocomotionOptions, LocomotionSample } from "./scene/locomotion.js";
export type { BlendOptions, BlendSample, BlendParameter } from "./scene/blend-space.js";
export type { AnimationUpdateBand } from "./scene/pose-schedule.js";
export type { MtekSkin } from "./abi/manifest-types.js";
