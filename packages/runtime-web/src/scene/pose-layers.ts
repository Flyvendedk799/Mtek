import type { MtekSkin } from "../abi/manifest-types.js";
import { ClipPlayers, sampleChannelInto } from "./clips.js";
import type { AnimationLayerInspection } from "./animation-inspection.js";

export interface AnimationLayer {
  readonly clip: string;
  readonly weight: number;
  /** Node name to weight; omitted nodes have weight zero. Omit the mask for the whole rig. */
  readonly mask?: Readonly<Record<string, number>>;
  /** A joint whose whole subtree (itself and every descendant) has weight one; added to `mask` (decision 0223). */
  readonly subtree?: string;
  readonly additive?: boolean;
  readonly speed?: number;
  readonly looping?: boolean;
}

/** Hamilton product, using scratch storage owned by the caller. Inputs may alias output. */
export function multiplyQuat(
  out: Float64Array,
  at: number,
  a: ArrayLike<number>,
  ai: number,
  b: ArrayLike<number>,
  bi: number,
): void {
  const x = a[ai]!,
    y = a[ai + 1]!,
    z = a[ai + 2]!,
    w = a[ai + 3]!;
  const u = b[bi]!,
    v = b[bi + 1]!,
    s = b[bi + 2]!,
    t = b[bi + 3]!;
  out[at] = w * u + x * t + y * s - z * v;
  out[at + 1] = w * v - x * s + y * t + z * u;
  out[at + 2] = w * s + x * v - y * u + z * t;
  out[at + 3] = w * t - x * u - y * v - z * s;
}

export function blendQuat(
  out: Float64Array,
  at: number,
  b: ArrayLike<number>,
  bi: number,
  weight: number,
): void {
  let dot = 0;
  for (let i = 0; i < 4; i++) dot += out[at + i]! * b[bi + i]!;
  const angle = Math.acos(Math.min(1, Math.abs(dot))),
    sine = Math.sin(angle);
  const aWeight =
    sine > 1e-6 ? Math.sin((1 - weight) * angle) / sine : 1 - weight;
  const bWeight =
    (sine > 1e-6 ? Math.sin(weight * angle) / sine : weight) *
    (dot < 0 ? -1 : 1);
  for (let i = 0; i < 4; i++)
    out[at + i] = out[at + i]! * aWeight + b[bi + i]! * bWeight;
  const length = Math.hypot(out[at]!, out[at + 1]!, out[at + 2]!, out[at + 3]!);
  for (let i = 0; i < 4; i++) out[at + i] = out[at + i]! / length;
}

interface LayerFade { from: number; to: number; elapsed: number; duration: number }

/** Ordered override/additive layers. Sampling storage and clocks are independent per actor. */
export class PoseLayers {
  private readonly layers = new Map<
    string,
    { options: AnimationLayer; mask: Float64Array; clock: ClipPlayers; weight: number; fade?: LayerFade }
  >();
  private readonly value = new Float64Array(4);
  private readonly rotation = new Float64Array(4);
  private readonly inverse = new Float64Array(4);
  revision = 0;
  constructor(private readonly skin: MtekSkin) {}

  inspect(): readonly AnimationLayerInspection[] {
    return [...this.layers].map(([id, { options, mask, clock, weight, fade }]) => ({ id, clip: options.clip, weight,
      targetWeight: fade?.to ?? weight, fadeRemaining: fade === undefined ? 0 : fade.duration - fade.elapsed,
      additive: options.additive ?? false, time: clock.time(0), duration: clock.duration(0), playing: clock.playing(0), mask: [...mask] }));
  }

  set(id: string, options: AnimationLayer): void {
    const clip = this.skin.clips.find((c) => c.name === options.clip);
    if (id === "" || clip === undefined)
      throw new RangeError("A layer needs an ID and an existing clip");
    if (
      !Number.isFinite(options.weight) ||
      options.weight < 0 ||
      options.weight > 1 ||
      !Number.isFinite(options.speed ?? 1) ||
      (options.speed ?? 1) < 0
    )
      throw new RangeError("Invalid animation layer weight or speed");
    const mask = new Float64Array(this.skin.nodes.length).fill(
      options.mask === undefined && options.subtree === undefined ? 1 : 0,
    );
    if (options.subtree !== undefined) {
      const root = this.skin.nodes.findIndex((n) => n.name === options.subtree);
      if (root < 0) throw new RangeError(`Invalid bone mask: ${options.subtree}`);
      this.skin.nodes.forEach((_, i) => {
        for (let node = i; node >= 0; node = this.skin.nodes[node]!.parent)
          if (node === root) { mask[i] = 1; break; }
      });
    }
    for (const [name, weight] of Object.entries(options.mask ?? {})) {
      const i = this.skin.nodes.findIndex((n) => n.name === name);
      if (i < 0 || !Number.isFinite(weight) || weight < 0 || weight > 1)
        throw new RangeError(`Invalid bone mask: ${name}`);
      mask[i] = weight;
    }
    const previous = this.layers.get(id);
    const clock =
      previous?.options.clip === options.clip
        ? previous.clock
        : new ClipPlayers();
    if (clock !== previous?.clock) {
      clock.add({ slot: 0, duration: clip.duration, channels: [] });
      clock.play(0, options.looping ?? true, options.speed ?? 1);
    }
    // Retain phase when editing weights; a speed/loop change takes effect at that phase.
    else if (
      previous.options.speed !== options.speed ||
      previous.options.looping !== options.looping
    ) {
      const time = clock.time(0);
      clock.play(0, options.looping ?? true, options.speed ?? 1);
      clock.seek(0, time);
    }
    this.layers.set(id, { options: { ...options }, mask, clock, weight: options.weight });
    this.revision++;
  }
  /**
   * Move a layer's weight to `weight` over `seconds` along a smoothstep, from the weight it has now,
   * replacing any fade in progress. The layer keeps its phase; zero seconds is immediate.
   */
  fade(id: string, weight: number, seconds: number): boolean {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1 || !Number.isFinite(seconds) || seconds < 0)
      throw new RangeError("Invalid animation layer fade weight or duration");
    const layer = this.layers.get(id);
    if (layer === undefined) return false;
    if (seconds === 0 || weight === layer.weight) { delete layer.fade; layer.weight = weight; }
    else layer.fade = { from: layer.weight, to: weight, elapsed: 0, duration: seconds };
    this.revision++;
    return true;
  }
  remove(id: string): void {
    if (this.layers.delete(id)) this.revision++;
  }
  clear(): void {
    if (this.layers.size > 0) {
      this.layers.clear();
      this.revision++;
    }
  }
  seek(id: string, seconds: number): boolean {
    const layer = this.layers.get(id);
    if (layer === undefined || !layer.clock.seek(0, seconds)) return false;
    this.revision++;
    return true;
  }
  crossed(id: string, marker: number): boolean {
    return this.layers.get(id)?.clock.crossed(0, marker) ?? false;
  }
  advance(dt: number): void {
    for (const layer of this.layers.values()) {
      const before = layer.clock.time(0);
      layer.clock.advance(dt, () => undefined);
      if (before !== layer.clock.time(0)) this.revision++;
      const fade = layer.fade;
      if (fade === undefined || dt === 0) continue;
      fade.elapsed = Math.min(fade.duration, fade.elapsed + dt);
      const t = fade.elapsed / fade.duration;
      layer.weight = fade.elapsed === fade.duration ? fade.to : fade.from + (fade.to - fade.from) * t * t * (3 - 2 * t);
      if (fade.elapsed === fade.duration) delete layer.fade;
      this.revision++;
    }
  }
  apply(pose: Float64Array, bind: Float64Array): void {
    for (const { options, mask, clock, weight } of this.layers.values()) {
      const clip = this.skin.clips.find((c) => c.name === options.clip)!;
      for (const channel of clip.channels) {
        const w = weight * mask[channel.node]!;
        if (w === 0) continue;
        sampleChannelInto(channel, clock.time(0), this.value);
        const at =
          channel.node * 10 +
          (channel.path === "translation"
            ? 0
            : channel.path === "rotation"
              ? 3
              : 7);
        if (channel.path === "rotation") {
          if (options.additive === true) {
            for (let i = 0; i < 4; i++)
              this.inverse[i] = bind[at + i]! * (i < 3 ? -1 : 1);
            multiplyQuat(this.rotation, 0, this.inverse, 0, this.value, 0);
            this.value.set([0, 0, 0, 1]);
            blendQuat(this.value, 0, this.rotation, 0, w);
            multiplyQuat(pose, at, pose, at, this.value, 0);
          } else blendQuat(pose, at, this.value, 0, w);
        } else
          for (let c = 0; c < 3; c++) {
            if (options.additive !== true)
              pose[at + c] =
                pose[at + c]! + (this.value[c]! - pose[at + c]!) * w;
            else if (channel.path === "scale")
              pose[at + c] =
                pose[at + c]! * (1 + (this.value[c]! / bind[at + c]! - 1) * w);
            else
              pose[at + c] =
                pose[at + c]! + (this.value[c]! - bind[at + c]!) * w;
          }
      }
    }
  }
}
