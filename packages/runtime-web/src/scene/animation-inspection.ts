import type { Vec3, Quat } from "../math/types.js";
import type { IKHingeLimit } from "./ik.js";

export interface AnimationLayerInspection {
  readonly id: string;
  readonly clip: string;
  /** Weight applied now; differs from `targetWeight` while a fade runs. */
  readonly weight: number;
  readonly targetWeight: number;
  /** Seconds until a running fade reaches `targetWeight`; zero when none. */
  readonly fadeRemaining: number;
  readonly additive: boolean;
  readonly time: number;
  readonly duration: number;
  readonly playing: boolean;
  /** Effective node-indexed mask, copied from evaluation storage. */
  readonly mask: readonly number[];
}
export interface IKInspection {
  readonly id: string;
  readonly chain: readonly number[];
  readonly target: Vec3;
  readonly weight: number;
  readonly iterations: number;
  readonly tolerance: number;
  readonly rotation?: Quat;
  readonly rotationWeight: number;
  readonly limits: readonly { readonly node: number; readonly limit: IKHingeLimit }[];
}
export interface BlendInspection {
  readonly phase: number;
  readonly parameter: { readonly x: number; readonly y: number };
  readonly samples: readonly { readonly clip: string; readonly x: number; readonly y: number; readonly weight: number }[];
}
export interface AnimationInspection {
  readonly mode: "bind" | "held" | "clip" | "locomotion";
  readonly clip: string | null;
  readonly transition: { readonly elapsed: number; readonly duration: number; readonly progress: number; readonly outgoingClip: string | null; readonly fromSnapshot: boolean };
  readonly rootMotionNode: number | null;
  readonly proceduralOverride: boolean;
  readonly nodes: readonly { readonly index: number; readonly name: string; readonly parent: number; readonly joint: boolean; readonly position: Vec3 }[];
  readonly layers: readonly AnimationLayerInspection[];
  readonly ik: readonly IKInspection[];
  /** The active blend space (any dimension); `locomotion` repeats it in 1D form when every sample has y = 0. */
  readonly blend: BlendInspection | null;
  readonly locomotion: { readonly phase: number; readonly parameter: number; readonly samples: readonly { readonly clip: string; readonly threshold: number; readonly weight: number }[] } | null;
}
