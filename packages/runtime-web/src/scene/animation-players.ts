/**
 * The playing clips of a world (decisions 0156, 0190, 0225): the part that needs no skeleton.
 *
 * This is the clip control API for rigid-node clips and the base of the skeletal one. The skeletal players of
 * `skeleton.ts` extend it and live in the animation module, which the runtime imports only for a program that has a
 * skinned mesh or `clips_from` (`animation-backend.ts`); a world without the module uses this class as it is, so every
 * skeletal query answers "no skeleton" and nothing here imports skeletal code.
 */
import type { MtekSkin } from "../abi/manifest-types.js";
import { ClipPlayers, type PlayableChannel, type PlayableClip } from "./clips.js";
import type { SkeletonPlayer } from "./skeleton.js";

/** Receives one sampled channel of a rigid clip. */
export type Apply = (slot: number, channel: PlayableChannel, value: ArrayLike<number>) => void;

export class AnimationPlayers {
  protected readonly nodes = new ClipPlayers();
  /** The skeletal player of `slot`: none without the animation module. */
  skin(_slot: number): SkeletonPlayer | undefined { return undefined; }
  share(_source: number, _targets: readonly number[]): boolean { throw new RangeError("Animation sharing needs a skinned source"); }
  detach(_slot: number): SkeletonPlayer { throw new RangeError("Animation detaching needs a skinned entity"); }
  add(clip: PlayableClip): void { this.nodes.add(clip); }
  addSkin(_slot: number, _skin: MtekSkin, _clip?: string): void { throw new Error("A skinned mesh needs the animation module, which is not loaded"); }
  remove(slot: number): void { this.nodes.remove(slot); }
  copyPose(_target: number, _source: number): boolean { return false; }
  transition(_slot: number, _name: string, _seconds: number, _looping: boolean, _speed: number): boolean { return false; }
  play(slot: number, looping: boolean, speed: number): boolean { return this.nodes.play(slot, looping, speed); }
  pause(slot: number): boolean { return this.nodes.pause(slot); }
  resume(slot: number): boolean { return this.nodes.resume(slot); }
  seek(slot: number, time: number): boolean { return this.nodes.seek(slot, time); }
  fade(slot: number, weight: number, duration: number): boolean { return this.nodes.fade(slot, weight, duration); }
  time(slot: number): number { return this.nodes.time(slot); }
  duration(slot: number): number { return this.nodes.duration(slot); }
  weight(slot: number): number { return this.nodes.weight(slot); }
  playing(slot: number): boolean { return this.nodes.playing(slot); }
  finished(slot: number): boolean { return this.nodes.finished(slot); }
  crossed(slot: number, marker: number): boolean { return this.nodes.crossed(slot, marker); }
  advance(dt: number, apply: Apply, _distance?: (slot: number) => number): void { this.nodes.advance(dt, apply); }
  pose(apply: Apply, time?: number): void { this.nodes.pose(apply, time); }
  poseSlot(slot: number, apply: Apply): void { this.nodes.poseSlot(slot, apply); }
}
