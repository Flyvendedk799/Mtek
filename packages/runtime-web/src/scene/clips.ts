/**
 * Sampled glTF node clips (decision 0156): LINEAR and STEP translation, rotation and scale.
 * Rotation is nlerp. Time wraps after the duration, holding the last key on the exact end.
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

const IDENTITY = [0, 0, 0, 1] as const;

/** The value of `channel` at `time` (seconds): 3 floats, or 4 for a rotation. */
export function sampleChannel(channel: PlayableChannel, time: number): readonly number[] {
  const comps = channel.path === "rotation" ? 4 : 3;
  const times = channel.times;
  const count = times.length;
  const at = (index: number): number[] => {
    const start = index * comps;
    const out: number[] = [];
    for (let i = 0; i < comps; i += 1) out.push(channel.values[start + i] ?? 0);
    return out;
  };
  if (count === 0) return channel.path === "rotation" ? IDENTITY : [0, 0, 0];
  const first = times[0] ?? 0;
  if (time <= first) return at(0);
  let hi = 1;
  while (hi < count && (times[hi] ?? 0) <= time) hi += 1;
  const lo = hi - 1;
  if (channel.interpolation === "step" || hi >= count) {
    return channel.path === "rotation" ? normalize(at(lo)) : at(lo);
  }
  const t0 = times[lo] ?? 0;
  const t1 = times[hi] ?? t0;
  const span = t1 - t0;
  const t = span === 0 ? 0 : (time - t0) / span;
  const a = at(lo);
  const b = at(hi);
  if (channel.path === "rotation") return nlerp(a, b, t);
  return a.map((value, index) => value + ((b[index] ?? value) - value) * t);
}

function nlerp(a: readonly number[], b: readonly number[], t: number): readonly number[] {
  let dot = 0;
  for (let i = 0; i < 4; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  const sign = dot < 0 ? -1 : 1;
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) out[i] = (a[i] ?? 0) + (sign * (b[i] ?? 0) - (a[i] ?? 0)) * t;
  return normalize(out);
}

function normalize(value: readonly number[]): readonly number[] {
  const length = Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0);
  if (!(length > 0)) return IDENTITY;
  return value.map((component) => component / length);
}

type Apply = (slot: number, channel: PlayableChannel, value: readonly number[]) => void;

/** The clips currently playing. One per entity slot. */
export class ClipPlayers {
  private readonly players: { clip: PlayableClip; time: number }[] = [];

  add(clip: PlayableClip): void {
    this.remove(clip.slot);
    this.players.push({ clip, time: 0 });
  }

  remove(slot: number): void {
    const index = this.players.findIndex((player) => player.clip.slot === slot);
    if (index >= 0) this.players.splice(index, 1);
  }

  /** Writes every channel at `time` (the player's own time when omitted) without advancing. */
  pose(apply: Apply, time?: number): void {
    for (const player of this.players) {
      const at = time ?? player.time;
      for (const channel of player.clip.channels) apply(player.clip.slot, channel, sampleChannel(channel, at));
    }
  }

  /** Advances by `dt` seconds, wrapping after the duration, then writes the new pose. */
  advance(dt: number, apply: Apply): void {
    for (const player of this.players) {
      let next = player.time + dt;
      const { duration } = player.clip;
      if (duration > 0 && next > duration) next %= duration;
      player.time = next;
      for (const channel of player.clip.channels) apply(player.clip.slot, channel, sampleChannel(channel, next));
    }
  }
}
