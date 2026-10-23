/**
 * Sampled glTF node clips (decision 0156): LINEAR and STEP translation, rotation and scale.
 * Rotation is nlerp. Time wraps after the duration, holding the last key on the exact end.
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
    for (let i = 0; i < 4; i += 1) {
      const a = values[from + i] ?? 0;
      out[i] = a + (sign * (values[to + i] ?? 0) - a) * t;
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

/** The clips currently playing. One per entity slot. */
export class ClipPlayers {
  private readonly players: { clip: PlayableClip; time: number }[] = [];
  private readonly scratch = new Float64Array(4);

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
      for (const channel of player.clip.channels) this.write(apply, player.clip.slot, channel, at);
    }
  }

  /** Advances by `dt` seconds, wrapping after the duration, then writes the new pose. */
  advance(dt: number, apply: Apply): void {
    for (const player of this.players) {
      let next = player.time + dt;
      const { duration } = player.clip;
      if (duration > 0 && next > duration) next %= duration;
      player.time = next;
      for (const channel of player.clip.channels) this.write(apply, player.clip.slot, channel, next);
    }
  }

  private write(apply: Apply, slot: number, channel: PlayableChannel, time: number): void {
    sampleChannelInto(channel, time, this.scratch);
    apply(slot, channel, this.scratch);
  }
}
