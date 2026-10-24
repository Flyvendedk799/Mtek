/**
 * Sampled glTF node clips (decision 0156): LINEAR and STEP translation, rotation and scale.
 * Rotation uses shortest-arc SLERP. Autoplay loops hold the last key on the exact end.
 * The sampled pose is composed with the entity's own transform by the world (decision 0174).
 */

export interface PlayableChannel {
  readonly path: "translation" | "rotation" | "scale";
  readonly interpolation: "linear" | "step";
  readonly times: readonly number[];
  readonly values: readonly number[];
}

export interface PlayableClip {
  readonly slot: number;
  readonly duration: number;
  readonly channels: readonly PlayableChannel[];
}

/**
 * Writes the value of `channel` at `time` (seconds) into `out`: 3 floats, or 4 for a rotation (`channelWidth`). Allocates
 * nothing: the sampler of every playing clip runs once per frame.
 */
export function sampleChannelInto(channel: PlayableChannel, time: number, out: Float64Array): void {
  const comps = channelWidth(channel);
  const times = channel.times;
  const count = times.length;
  const values = channel.values;
  const identity = (): void => {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    if (comps === 4) out[3] = 1;
  };
  if (count === 0) {
    identity();
    return;
  }
  const first = times[0] ?? 0;
  if (time <= first) {
    for (let i = 0; i < comps; i += 1) out[i] = values[i] ?? 0;
    if (comps === 4) normalizeInto(out);
    return;
  }
  let hi = 1;
  while (hi < count && (times[hi] ?? 0) <= time) hi += 1;
  const lo = hi - 1;
  const from = lo * comps;
  if (channel.interpolation === "step" || hi >= count) {
    for (let i = 0; i < comps; i += 1) out[i] = values[from + i] ?? 0;
    if (comps === 4) normalizeInto(out);
    return;
  }
  const t0 = times[lo] ?? 0;
  const t1 = times[hi] ?? t0;
  const span = t1 - t0;
  const t = span === 0 ? 0 : (time - t0) / span;
  const to = hi * comps;
  if (comps === 4) {
    let dot = 0;
    for (let i = 0; i < 4; i += 1) dot += (values[from + i] ?? 0) * (values[to + i] ?? 0);
    const sign = dot < 0 ? -1 : 1;
    const angle = Math.acos(Math.min(1, Math.abs(dot)));
    const sine = Math.sin(angle);
    const aWeight = sine > 1e-6 ? Math.sin((1 - t) * angle) / sine : 1 - t;
    const bWeight = sine > 1e-6 ? Math.sin(t * angle) / sine : t;
    for (let i = 0; i < 4; i += 1) {
      const a = values[from + i] ?? 0;
      out[i] = a * aWeight + sign * (values[to + i] ?? 0) * bWeight;
    }
    normalizeInto(out);
    return;
  }
  for (let i = 0; i < 3; i += 1) {
    const a = values[from + i] ?? 0;
    out[i] = a + ((values[to + i] ?? a) - a) * t;
  }
}

/** 3 for a translation or a scale, 4 for a rotation. */
export function channelWidth(channel: PlayableChannel): number {
  return channel.path === "rotation" ? 4 : 3;
}

/** The value of `channel` at `time` (seconds) as a new array: 3 floats, or 4 for a rotation. */
export function sampleChannel(channel: PlayableChannel, time: number): readonly number[] {
  const out = new Float64Array(4);
  sampleChannelInto(channel, time, out);
  return Array.from(out.subarray(0, channelWidth(channel)));
}

function normalizeInto(value: Float64Array): void {
  const length = Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0);
  if (!(length > 0)) {
    value[0] = 0;
    value[1] = 0;
    value[2] = 0;
    value[3] = 1;
    return;
  }
  for (let i = 0; i < 4; i += 1) value[i] = (value[i] ?? 0) / length;
}

/** `value` is a scratch array that holds the sample during the call only. */
type Apply = (slot: number, channel: PlayableChannel, value: ArrayLike<number>) => void;

interface Player {
  clip: PlayableClip;
  time: number;
  playing: boolean;
  looping: boolean;
  speed: number;
  finished: boolean;
  weight: number;
  fadeFrom: number;
  fadeTo: number;
  fadeTime: number;
  fadeDuration: number;
  previous: number;
  travel: number;
}

/** The clips currently playing. One per entity slot. */
export class ClipPlayers {
  private readonly players: Player[] = [];
  private readonly scratch = new Float64Array(4);

  add(clip: PlayableClip): void {
    this.remove(clip.slot);
    this.players.push({ clip, time: 0, playing: true, looping: true, speed: 1, finished: false,
      weight: 1, fadeFrom: 1, fadeTo: 1, fadeTime: 0, fadeDuration: 0, previous: 0, travel: 0 });
  }

  private player(slot: number): Player | undefined {
    return this.players.find((player) => player.clip.slot === slot);
  }

  play(slot: number, looping: boolean, speed: number): boolean {
    const p = this.player(slot);
    if (p === undefined || !Number.isFinite(speed) || speed < 0) return false;
    p.time = 0;
    p.travel = 0;
    p.looping = looping;
    p.speed = speed;
    p.finished = !looping && p.clip.duration === 0;
    p.playing = !p.finished;
    return true;
  }

  pause(slot: number): boolean {
    const p = this.player(slot);
    if (p === undefined) return false;
    p.playing = false;
    return true;
  }

  resume(slot: number): boolean {
    const p = this.player(slot);
    if (p === undefined || p.finished) return false;
    p.playing = true;
    return true;
  }

  seek(slot: number, time: number): boolean {
    const p = this.player(slot);
    if (p === undefined || !Number.isFinite(time)) return false;
    p.time = Math.max(0, Math.min(p.clip.duration, time));
    p.travel = 0;
    p.finished = !p.looping && p.time === p.clip.duration;
    if (p.finished) p.playing = false;
    return true;
  }

  fade(slot: number, weight: number, duration: number): boolean {
    const p = this.player(slot);
    if (p === undefined || !Number.isFinite(weight) || !Number.isFinite(duration) || duration < 0) return false;
    p.fadeFrom = p.weight;
    p.fadeTo = Math.max(0, Math.min(1, weight));
    p.fadeDuration = duration;
    p.fadeTime = 0;
    if (duration === 0) p.weight = p.fadeTo;
    return true;
  }

  time(slot: number): number { return this.player(slot)?.time ?? 0; }
  duration(slot: number): number { return this.player(slot)?.clip.duration ?? 0; }
  weight(slot: number): number { return this.player(slot)?.weight ?? 0; }
  playing(slot: number): boolean { return this.player(slot)?.playing ?? false; }
  finished(slot: number): boolean { return this.player(slot)?.finished ?? false; }

  /** A marker in (0, duration] crossed during the latest advance, even across wraps/hitches. */
  crossed(slot: number, marker: number): boolean {
    const p = this.player(slot);
    if (p === undefined || !Number.isFinite(marker) || marker <= 0 || marker > p.clip.duration || p.travel <= 0) return false;
    let distance = marker - p.previous;
    if (distance <= 0 && p.looping) distance += p.clip.duration;
    return distance > 0 && distance <= p.travel;
  }

  remove(slot: number): void {
    const index = this.players.findIndex((player) => player.clip.slot === slot);
    if (index >= 0) this.players.splice(index, 1);
  }

  /** Writes every channel at `time` (the player's own time when omitted) without advancing. */
  pose(apply: Apply, time?: number): void {
    for (const player of this.players) {
      for (const channel of player.clip.channels) this.write(apply, player, channel, time ?? player.time);
    }
  }

  poseSlot(slot: number, apply: Apply): void {
    const p = this.player(slot);
    if (p !== undefined) for (const channel of p.clip.channels) this.write(apply, p, channel, p.time);
  }

  /** Advances by `dt` seconds, wrapping after the duration, then writes the new pose. */
  advance(dt: number, apply: Apply): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    for (const player of this.players) {
      player.previous = player.time;
      player.travel = player.playing ? dt * player.speed : 0;
      let next = player.time + player.travel;
      const { duration } = player.clip;
      if (!player.looping && next >= duration) {
        next = duration;
        player.travel = duration - player.time;
        player.finished = true;
        player.playing = false;
      } else if (duration > 0 && next > duration) next %= duration;
      if (duration === 0) next = 0;
      player.time = next;
      if (player.fadeDuration > 0) {
        player.fadeTime = Math.min(player.fadeDuration, player.fadeTime + dt);
        const t = player.fadeTime / player.fadeDuration;
        const eased = t * t * (3 - 2 * t);
        player.weight = player.fadeFrom + (player.fadeTo - player.fadeFrom) * eased;
      }
      for (const channel of player.clip.channels) this.write(apply, player, channel, next);
    }
  }

  private write(apply: Apply, player: Player, channel: PlayableChannel, time: number): void {
    sampleChannelInto(channel, time, this.scratch);
    const weight = player.weight;
    if (channel.path === "rotation") {
      const w = this.scratch[3] ?? 1;
      const sign = w < 0 ? -1 : 1;
      const angle = Math.acos(Math.min(1, Math.abs(w)));
      const sine = Math.sin(angle);
      const factor = sine > 1e-6 ? Math.sin(weight * angle) / sine : weight;
      for (let i = 0; i < 3; i += 1) this.scratch[i] = (this.scratch[i] ?? 0) * factor * sign;
      this.scratch[3] = Math.cos(weight * angle);
      normalizeInto(this.scratch);
    } else {
      const base = channel.path === "scale" ? 1 : 0;
      for (let i = 0; i < 3; i += 1) this.scratch[i] = base + ((this.scratch[i] ?? base) - base) * weight;
    }
    apply(player.clip.slot, channel, this.scratch);
  }
}
