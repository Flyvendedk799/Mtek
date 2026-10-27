import type { BlendSpace } from "./blend-space.js";

export interface LocomotionSample {
  readonly clip: string;
  /** Strictly increasing control value, for example movement speed in metres/second. */
  readonly threshold: number;
}
export interface LocomotionOptions {
  readonly samples: readonly LocomotionSample[];
  readonly parameter?: number;
  /** Initial normalized cycle position in [0,1). */
  readonly phase?: number;
  readonly speed?: number;
  readonly looping?: boolean;
}

/** The 1D view of a player's blend space: thresholds are x coordinates with y = 0 (decision 0196). */
export class LocomotionBlend {
  constructor(private readonly space: BlendSpace) {}
  get active(): boolean { return this.space.active; }
  get phase(): number { return this.space.phase; }
  get parameter(): number { return this.space.parameter.x; }
  get playing(): boolean { return this.space.playing; }
  get finished(): boolean { return this.space.finished; }
  get duration(): number { return this.space.duration; }
  get revision(): number { return this.space.revision; }
  inspect(): { phase: number; parameter: number; samples: readonly { clip: string; threshold: number; weight: number }[] } | null {
    const blend = this.space.inspect();
    return blend === null || blend.samples.some(sample => sample.y !== 0) ? null : { phase: blend.phase, parameter: blend.parameter.x,
      samples: blend.samples.map(sample => ({ clip: sample.clip, threshold: sample.x, weight: sample.weight })) };
  }
  pause(): boolean { return this.space.pause(); }
  resume(): boolean { return this.space.resume(); }
  play(looping = true, speed = 1): boolean { return this.space.play(looping, speed); }
  set(options: LocomotionOptions | undefined): void {
    if (options === undefined) { this.space.set(undefined); return; }
    const { samples } = options;
    if (samples.length < 2 || samples.some((sample, i) => i > 0 && sample.threshold <= samples[i - 1]!.threshold))
      throw new RangeError("Locomotion needs at least two samples with strictly increasing thresholds");
    this.space.set({ ...options, samples: samples.map(sample => ({ clip: sample.clip, x: sample.threshold, y: 0 })),
      parameter: { x: options.parameter ?? samples[0]!.threshold, y: 0 } });
  }
  setParameter(value: number): void { this.space.setParameter(value, this.space.parameter.y); }
  seek(phase: number): void { this.space.seek(phase); }
  crossed(name: string, seconds: number): boolean { return this.space.crossed(name, seconds); }
  crossedPhase(marker: number): boolean { return this.space.crossedPhase(marker); }
}
