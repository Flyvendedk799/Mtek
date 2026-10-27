import type { MtekSkin } from "../abi/manifest-types.js";
import { sampleChannelInto } from "./clips.js";
import { blendQuat } from "./pose-layers.js";
import type { BlendInspection } from "./animation-inspection.js";

export interface BlendSample {
  readonly clip: string;
  readonly x: number;
  readonly y: number;
}
export interface BlendParameter {
  readonly x: number;
  readonly y: number;
}
export interface BlendOptions {
  readonly samples: readonly BlendSample[];
  /** Defaults to the first sample's position. */
  readonly parameter?: BlendParameter;
  /** Initial normalized cycle position in [0,1). */
  readonly phase?: number;
  readonly speed?: number;
  readonly looping?: boolean;
}
type Clip = MtekSkin["clips"][number];
export type BlendSolver = (x: number, y: number, out: Float64Array) => void;
export const MAX_BLEND_SAMPLES = 32;

/**
 * Weights for sample points: a partition of unity that is exact at every sample and continuous.
 * Inside the Delaunay triangulation they are barycentric; outside the convex hull they are the
 * linear weights of the nearest hull point; collinear samples (every 1D case) are interpolated
 * piecewise-linearly along their line. Cocircular ties are broken by a fixed lifting perturbation,
 * so the result depends only on the points and their order.
 */
export function blendWeights(points: readonly (readonly [number, number])[]): BlendSolver {
  const n = points.length;
  if (n < 1 || n > MAX_BLEND_SAMPLES || points.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
    throw new RangeError(`A blend space needs 1 to ${MAX_BLEND_SAMPLES} samples at finite points`);
  if (points.some((p, i) => points.some((q, j) => j < i && p[0] === q[0] && p[1] === q[1])))
    throw new RangeError("Blend samples must be at distinct points");
  // Work relative to the first sample so the lifted circle test keeps its precision far from the origin.
  const ox = points[0]![0], oy = points[0]![1], X = points.map(p => p[0] - ox), Y = points.map(p => p[1] - oy);
  const L = Math.max(Math.max(...X) - Math.min(...X), Math.max(Math.max(...Y) - Math.min(...Y))) || 1;
  const Z = X.map((x, i) => x * x + Y[i]! * Y[i]!), W = X.map((_, i) => { // integer hash: generic and platform-independent, unlike an additive sequence
    let h = Math.imul(i + 1, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return (h >>> 0) / 2 ** 32;
  });
  // > 0 when point d lies inside the circle through counter-clockwise a, b, c (lift z).
  const inside = (a: number, b: number, c: number, d: number, z: readonly number[]): number => {
    const ax = X[a]! - X[d]!, ay = Y[a]! - Y[d]!, bx = X[b]! - X[d]!, by = Y[b]! - Y[d]!, cx = X[c]! - X[d]!, cy = Y[c]! - Y[d]!;
    const az = z[a]! - z[d]!, bz = z[b]! - z[d]!, cz = z[c]! - z[d]!;
    return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  };
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const area = (X[j]! - X[i]!) * (Y[k]! - Y[i]!) - (X[k]! - X[i]!) * (Y[j]! - Y[i]!);
    if (Math.abs(area) <= 1e-12 * L * L) continue;
    const [b, c] = area > 0 ? [j, k] : [k, j];
    let empty = true;
    for (let d = 0; d < n && empty; d++) {
      if (d === i || d === j || d === k) continue;
      const lifted = inside(i, b, c, d, Z);
      empty = !(lifted > 1e-11 * L ** 4 || (lifted >= -1e-11 * L ** 4 && inside(i, b, c, d, W) > 0));
    }
    if (empty) triangles.push([i, b, c]);
  }
  if (triangles.length === 0) {
    // Collinear: interpolate along the line through the lexicographic extremes.
    const order = X.map((_, i) => i).sort((a, b) => X[a]! - X[b]! || Y[a]! - Y[b]!);
    const first = order[0]!, last = order[n - 1]!;
    const length = Math.hypot(X[last]! - X[first]!, Y[last]! - Y[first]!);
    const dx = n > 1 ? (X[last]! - X[first]!) / length : 0, dy = n > 1 ? (Y[last]! - Y[first]!) / length : 0;
    const along = (x: number, y: number): number => (x - X[first]!) * dx + (y - Y[first]!) * dy;
    const t = order.map(i => along(X[i]!, Y[i]!));
    if (t.some((v, i) => i > 0 && v - t[i - 1]! <= 1e-12 * L))
      throw new RangeError("Blend samples must be at distinct points");
    return (x, y, out) => {
      out.fill(0); x -= ox; y -= oy;
      const s = Math.min(t[n - 1]!, Math.max(t[0]!, along(x, y)));
      let k = 1;
      while (k < n && t[k]! < s) k++;
      if (k === n) out[order[0]!] = 1;
      else { const w = (s - t[k - 1]!) / (t[k]! - t[k - 1]!); out[order[k - 1]!] = 1 - w; out[order[k]!] = w; }
    };
  }
  const counts = new Map<number, number>();
  for (const [a, b, c] of triangles) for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
    const key = Math.min(p, q) * 64 + Math.max(p, q);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const areas = triangles.map(([a, b, c]) => (X[b]! - X[a]!) * (Y[c]! - Y[a]!) - (X[c]! - X[a]!) * (Y[b]! - Y[a]!));
  const hull = [...counts].filter(([, count]) => count === 1).map(([key]) => [Math.floor(key / 64), key % 64] as const);
  return (x, y, out) => {
    out.fill(0); x -= ox; y -= oy;
    const cross = (p: number, q: number): number => (X[p]! - x) * (Y[q]! - y) - (Y[p]! - y) * (X[q]! - x);
    // The most-inside triangle, so a point on a shared edge or a rounding gap still gets valid weights.
    let best = -Infinity, at = 0, u = 0, v = 0, w = 0;
    triangles.forEach(([a, b, c], t) => {
      const p = cross(b, c) / areas[t]!, q = cross(c, a) / areas[t]!, r = cross(a, b) / areas[t]!, least = Math.min(p, q, r);
      if (least > best) { best = least; at = t; u = p; v = q; w = r; }
    });
    if (best >= -1e-9) {
      const [a, b, c] = triangles[at]!;
      u = Math.max(0, u); v = Math.max(0, v); w = Math.max(0, w);
      const total = u + v + w;
      out[a] = u / total; out[b] = v / total; out[c] = w / total;
      return;
    }
    let nearest = Infinity;
    for (const [a, b] of hull) {
      const ex = X[b]! - X[a]!, ey = Y[b]! - Y[a]!;
      const t = Math.min(1, Math.max(0, ((x - X[a]!) * ex + (y - Y[a]!) * ey) / (ex * ex + ey * ey)));
      const distance = Math.hypot(X[a]! + ex * t - x, Y[a]! + ey * t - y);
      if (distance < nearest) { nearest = distance; out.fill(0); out[a] = 1 - t; out[b] = t; }
    }
  };
}

/**
 * Phase-synchronized 2D blend: every contributing clip shares one normalized cycle whose rate is
 * the weighted mean of the clips' inverse durations, so moving the parameter never jumps the phase.
 * The 1D locomotion API is a view of this class with thresholds as x and y = 0.
 */
export class BlendSpace {
  private samples: readonly { x: number; y: number; clip: Clip }[] = [];
  private solver: BlendSolver | undefined;
  private key = "";
  private px = 0;
  private py = 0;
  private speed = 1;
  private phaseValue = 0;
  private previous = 0;
  private running = false;
  private ended = false;
  private looping = true;
  private wraps = 0;
  private readonly current = new Float64Array(MAX_BLEND_SAMPLES);
  private readonly last = new Float64Array(MAX_BLEND_SAMPLES);
  private fresh = false;
  private lastValid = false;
  private readonly other: Float64Array;
  private readonly value = new Float64Array(4);
  revision = 0;
  constructor(private readonly skin: MtekSkin) {
    this.other = new Float64Array(skin.nodes.length * 10);
  }
  get active(): boolean { return this.samples.length > 0; }
  get phase(): number { return this.phaseValue; }
  get parameter(): BlendParameter { return { x: this.px, y: this.py }; }
  get playing(): boolean { return this.active && this.running; }
  get finished(): boolean { return this.active && this.ended; }
  /** Current weights, one per sample in the order given to `set`. Do not retain the array. */
  weights(): Float64Array {
    if (!this.fresh && this.solver !== undefined) { this.solver(this.px, this.py, this.current); this.fresh = true; }
    return this.current;
  }
  private rate(w: Float64Array): number {
    let rate = 0;
    this.samples.forEach((sample, i) => { rate += w[i]! / sample.clip.duration; });
    return rate;
  }
  get duration(): number { return this.active ? 1 / this.rate(this.weights()) : 0; }
  inspect(): BlendInspection | null {
    if (!this.active) return null;
    const w = this.weights();
    return { phase: this.phase, parameter: this.parameter,
      samples: this.samples.map((s, i) => ({ clip: s.clip.name, x: s.x, y: s.y, weight: w[i]! })) };
  }
  pause(): boolean { if (!this.active) return false; this.running = false; return true; }
  resume(): boolean { if (!this.active || this.ended) return false; this.running = true; return true; }
  play(looping = true, speed = 1): boolean {
    if (!this.active || !Number.isFinite(speed) || speed < 0) return false;
    this.looping = looping; this.speed = speed; this.running = true; this.ended = false; this.seek(0); return true;
  }
  set(options: BlendOptions | undefined): void {
    if (options === undefined) {
      this.samples = []; this.solver = undefined; this.key = ""; this.wraps = 0; this.lastValid = false; this.revision++; return;
    }
    const samples = options.samples.map(sample => {
      const clip = this.skin.clips.find(clip => clip.name === sample.clip);
      if (clip === undefined || clip.duration <= 0)
        throw new RangeError("Blend samples need existing nonzero-duration clips");
      return { x: sample.x, y: sample.y, clip };
    });
    const key = samples.map(s => `${s.x},${s.y}`).join(";");
    const solver = key === this.key && this.solver !== undefined ? this.solver : blendWeights(samples.map(s => [s.x, s.y]));
    const px = options.parameter?.x ?? samples[0]!.x, py = options.parameter?.y ?? samples[0]!.y;
    const phase = options.phase ?? 0, speed = options.speed ?? 1;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(speed) || speed < 0
      || !Number.isFinite(phase) || phase < 0 || phase >= 1)
      throw new RangeError("Invalid blend parameter, speed or phase");
    this.samples = samples; this.solver = solver; this.key = key; this.px = px; this.py = py; this.fresh = false; this.speed = speed;
    this.running = true; this.ended = false; this.looping = options.looping ?? true;
    this.phaseValue = phase; this.previous = phase; this.wraps = 0; this.lastValid = false; this.revision++;
  }
  setParameter(x: number, y = 0): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("Blend parameter must be finite");
    if (x !== this.px || y !== this.py) { this.px = x; this.py = y; this.fresh = false; this.revision++; }
  }
  seek(phase: number): void {
    if (!Number.isFinite(phase) || phase < 0 || phase > 1)
      throw new RangeError("Blend phase must be in [0,1]");
    this.phaseValue = phase; this.previous = phase; this.wraps = 0; this.lastValid = false; this.revision++;
    this.ended = false;
  }
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Blend delta must be finite and nonnegative");
    this.previous = this.phaseValue; this.wraps = 0;
    if (!this.active || !this.running || dt === 0) { this.lastValid = false; return; }
    const w = this.weights();
    this.last.set(w); this.lastValid = true;
    const next = this.phaseValue + dt * this.speed * this.rate(w);
    if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER)
      throw new RangeError("Blend update exceeds the supported cycle range");
    if (!this.looping && next >= 1) { this.phaseValue = 1; this.running = false; this.ended = true; }
    else { this.wraps = Math.floor(next); this.phaseValue = next - this.wraps; }
    if (dt > 0 && this.speed > 0) this.revision++;
  }
  /** Marker seconds in a contributing clip; crossings remain available between pose updates. */
  crossed(name: string, seconds: number): boolean {
    if (!this.active || !this.lastValid || !Number.isFinite(seconds) || seconds < 0) return false;
    const at = this.samples.findIndex((sample, i) => sample.clip.name === name && this.last[i]! > 0);
    if (at < 0 || seconds > this.samples[at]!.clip.duration) return false;
    return this.crossedPhase(seconds / this.samples[at]!.clip.duration);
  }
  crossedPhase(marker: number): boolean {
    if (!this.lastValid || !Number.isFinite(marker) || marker < 0 || marker > 1) return false;
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
  /** Weighted pose: clips in sample order, each blended in by its share of the weight so far. */
  apply(out: Float64Array, bind: Float64Array): void {
    const w = this.weights();
    let total = 0;
    this.samples.forEach((sample, i) => {
      if (w[i] === 0) return;
      if (total === 0) { this.sample(sample.clip, out, bind); total = w[i]!; return; }
      this.sample(sample.clip, this.other, bind);
      const t = w[i]! / (total + w[i]!);
      total += w[i]!;
      for (let at = 0; at < out.length; at += 10) {
        for (const c of [0, 1, 2, 7, 8, 9]) out[at + c] = out[at + c]! + (this.other[at + c]! - out[at + c]!) * t;
        blendQuat(out, at + 3, this.other, at + 3, t);
      }
    });
  }
  /** Accumulate displacement across every wrap, independently of pose evaluation cadence. */
  rootDelta(node: number, out: Float64Array): void {
    const w = this.weights();
    this.samples.forEach(({ clip }, i) => {
      const influence = w[i]!;
      const channel = influence === 0 ? undefined : clip.channels.find(channel => channel.node === node && channel.path === "translation");
      if (channel === undefined) return;
      for (const [time, factor] of [[this.previous * clip.duration, -1], [this.phaseValue * clip.duration, 1], [0, -this.wraps], [clip.duration, this.wraps]] as const) {
        sampleChannelInto(channel, time, this.value);
        for (let c = 0; c < 3; c++) out[c] = out[c]! + this.value[c]! * influence * factor;
      }
    });
  }
}
