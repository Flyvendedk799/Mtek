import type { MtekSkin } from "./abi/manifest-types.js";
import type { AnimationLayer } from "./scene/pose-layers.js";
import type { IKConstraint } from "./scene/ik.js";
import { SkeletonPlayer, skinProblem } from "./scene/skeleton.js";

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
}

/** Independent of the Mtek compiler, mounted application and renderer. Extension API v1. */
export class AnimationController {
  readonly apiVersion = 1;
  readonly player: SkeletonPlayer;
  private targets: readonly { node: number; bone: AnimationBone }[];
  private elapsed = 0;
  private interval = 0;
  private disposed = false;
  constructor(skin: MtekSkin, options: AnimationControllerOptions = {}) {
    const problem = skinProblem(skin, skin.indices.length);
    if (problem !== undefined) throw new RangeError(problem);
    this.player = new SkeletonPlayer(skin, options.clip);
    this.setUpdateInterval(options.updateInterval ?? 0);
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
    this.interval = seconds;
    this.elapsed = 0;
  }
  setLayer(id: string, layer: AnimationLayer): void {
    this.active();
    this.player.layers.set(id, layer);
  }
  setIK(id: string, constraint: IKConstraint): void {
    this.active();
    this.player.ik.set(id, constraint);
  }
  update(dt: number, force = false): boolean {
    this.active();
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("Animation delta must be finite and nonnegative");
    this.player.advance(dt, false);
    this.elapsed += dt;
    if (!force && this.elapsed < this.interval) return false;
    this.elapsed = this.interval > 0 ? this.elapsed % this.interval : 0;
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
export {deformSkin} from "./mesh/skinning.js";
export type { AnimationLayer } from "./scene/pose-layers.js";
export type { IKConstraint } from "./scene/ik.js";
export type { MtekSkin } from "./abi/manifest-types.js";
