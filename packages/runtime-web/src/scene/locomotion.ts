import type { MtekSkin } from "../abi/manifest-types.js";
import { sampleChannelInto } from "./clips.js";
import { blendQuat } from "./pose-layers.js";

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
type Clip = MtekSkin["clips"][number];

/** Piecewise-linear 1D blend with one shared normalized cycle for all clips. */
export class LocomotionBlend {
  private samples: readonly { threshold: number; clip: Clip }[] = [];
  private parameterValue = 0;
  private speed = 1;
  private phaseValue = 0;
  private previous = 0;
  private running = false;
  private ended = false;
  private looping = true;
  private wraps = 0;
  private lastPair: readonly [Clip,Clip,number] | undefined;
  private readonly other: Float64Array;
  private readonly value = new Float64Array(4);
  revision = 0;
  constructor(private readonly skin: MtekSkin) {
    this.other = new Float64Array(skin.nodes.length * 10);
  }
  get active(): boolean { return this.samples.length > 0; }
  get phase(): number { return this.phaseValue; }
  get parameter(): number { return this.parameterValue; }
  get playing(): boolean { return this.active && this.running; }
  get finished(): boolean { return this.active && this.ended; }
  inspect(): { phase: number; parameter: number; samples: readonly { clip: string; threshold: number; weight: number }[] } | null {
    if (!this.active) return null;
    let right = this.samples.findIndex(sample => sample.threshold >= this.parameterValue);
    if (right < 0) right = this.samples.length - 1;
    const left = Math.max(0, right - 1), a = this.samples[left]!, b = this.samples[right]!;
    const weight = left === right ? 0 : Math.max(0,Math.min(1,(this.parameterValue-a.threshold)/(b.threshold-a.threshold)));
    return { phase: this.phase, parameter: this.parameter, samples: this.samples.map((sample,index) => ({ clip: sample.clip.name,
      threshold: sample.threshold, weight: left === right ? Number(index === left) : index === left ? 1 - weight : index === right ? weight : 0 })) };
  }
  get duration(): number {
    if (!this.active) return 0;
    const [a,b,weight] = this.pair();
    return 1 / ((1 - weight) / a.duration + weight / b.duration);
  }
  pause(): boolean { if (!this.active) return false; this.running = false; return true; }
  resume(): boolean { if (!this.active || this.ended) return false; this.running = true; return true; }
  play(looping = true, speed = 1): boolean {
    if (!this.active || !Number.isFinite(speed) || speed < 0) return false;
    this.looping = looping; this.speed = speed; this.running = true; this.ended = false; this.seek(0); return true;
  }

  set(options: LocomotionOptions | undefined): void {
    if (options === undefined) {
      this.samples = []; this.wraps = 0; this.lastPair = undefined; this.revision++; return;
    }
    const samples = options.samples.map(sample => {
      const clip = this.skin.clips.find(clip => clip.name === sample.clip);
      if (clip === undefined || clip.duration <= 0 || !Number.isFinite(sample.threshold))
        throw new RangeError("Locomotion samples need existing nonzero-duration clips and finite thresholds");
      return { threshold: sample.threshold, clip };
    });
    if (samples.length < 2 || samples.some((sample, i) => i > 0 && sample.threshold <= samples[i - 1]!.threshold))
      throw new RangeError("Locomotion needs at least two samples with strictly increasing thresholds");
    const parameter = options.parameter ?? samples[0]!.threshold;
    const phase = options.phase ?? 0, speed = options.speed ?? 1;
    if (!Number.isFinite(parameter) || !Number.isFinite(speed) || speed < 0
      || !Number.isFinite(phase) || phase < 0 || phase >= 1)
      throw new RangeError("Invalid locomotion parameter, speed or phase");
    this.samples = samples; this.parameterValue = parameter; this.speed = speed;
    this.running = true; this.ended = false; this.looping = options.looping ?? true;
    this.phaseValue = phase; this.previous = phase; this.wraps = 0; this.lastPair = undefined; this.revision++;
  }
  setParameter(value: number): void {
    if (!Number.isFinite(value)) throw new RangeError("Locomotion parameter must be finite");
    if (value !== this.parameterValue) { this.parameterValue = value; this.revision++; }
  }
  seek(phase: number): void {
    if (!Number.isFinite(phase) || phase < 0 || phase > 1)
      throw new RangeError("Locomotion phase must be in [0,1]");
    this.phaseValue = phase; this.previous = phase; this.wraps = 0; this.lastPair = undefined; this.revision++;
    this.ended = false;
  }
  private pair(): readonly [Clip, Clip, number] {
    let right = this.samples.findIndex(sample => sample.threshold >= this.parameterValue);
    if (right < 0) right = this.samples.length - 1;
    const b = this.samples[right]!, a = this.samples[Math.max(0, right - 1)]!;
    const weight = a === b ? 0 : Math.max(0, Math.min(1, (this.parameterValue - a.threshold) / (b.threshold - a.threshold)));
    return [a.clip, b.clip, weight];
  }
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Locomotion delta must be finite and nonnegative");
    this.previous = this.phaseValue; this.wraps = 0;
    if (!this.active || !this.running || dt === 0) { this.lastPair = undefined; return; }
    const [a, b, weight] = this.lastPair = this.pair();
    const next = this.phaseValue + dt * this.speed * ((1 - weight) / a.duration + weight / b.duration);
    if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER)
      throw new RangeError("Locomotion update exceeds the supported cycle range");
    if (!this.looping && next >= 1) { this.phaseValue = 1; this.running = false; this.ended = true; }
    else { this.wraps = Math.floor(next); this.phaseValue = next - this.wraps; }
    if (dt > 0 && this.speed > 0) this.revision++;
  }
  /** Marker seconds in a contributing clip; crossings remain available between pose updates. */
  crossed(name: string, seconds: number): boolean {
    if (!this.active || this.lastPair === undefined || !Number.isFinite(seconds) || seconds < 0) return false;
    const [a, b, weight] = this.lastPair;
    const clip = a.name === name && weight < 1 ? a : b.name === name && weight > 0 ? b : undefined;
    if (clip === undefined || seconds > clip.duration) return false;
    return this.crossedPhase(seconds / clip.duration);
  }
  crossedPhase(marker: number): boolean {
    if (this.lastPair === undefined || !Number.isFinite(marker) || marker < 0 || marker > 1) return false;
    return this.wraps > 1 || (this.wraps === 1
      ? marker > this.previous || marker <= this.phaseValue
      : marker > this.previous && marker <= this.phaseValue);
  }
  private sample(clip: Clip, out: Float64Array, bind: Float64Array): void {
    out.set(bind);
    for (const channel of clip.channels) {
      sampleChannelInto(channel, this.phaseValue * clip.duration, this.value);
      const at = channel.node * 10 + (channel.path === "translation" ? 0 : channel.path === "rotation" ? 3 : 7);
      out.set(this.value.subarray(0, channel.path === "rotation" ? 4 : 3), at);
    }
  }
  apply(out: Float64Array, bind: Float64Array): void {
    const [a, b, weight] = this.pair();
    this.sample(a, out, bind);
    if (weight === 0) return;
    this.sample(b, this.other, bind);
    for (let at = 0; at < out.length; at += 10) {
      for (const c of [0, 1, 2, 7, 8, 9]) out[at + c] = out[at + c]! + (this.other[at + c]! - out[at + c]!) * weight;
      blendQuat(out, at + 3, this.other, at + 3, weight);
    }
  }
  /** Accumulate displacement across every wrap, independently of pose evaluation cadence. */
  rootDelta(node: number, out: Float64Array): void {
    const [a, b, weight] = this.pair();
    for (const [clip, influence] of [[a, 1 - weight], [b, weight]] as const) {
      if (influence === 0) continue;
      const channel = clip.channels.find(channel => channel.node === node && channel.path === "translation");
      if (channel === undefined) continue;
      for (const [time, factor] of [[this.previous * clip.duration, -1], [this.phaseValue * clip.duration, 1], [0, -this.wraps], [clip.duration, this.wraps]] as const) {
        sampleChannelInto(channel, time, this.value);
        for (let c = 0; c < 3; c++) out[c] = out[c]! + this.value[c]! * influence * factor;
      }
    }
  }
}
