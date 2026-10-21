/**
 * Audio (`spec/audio.md`, decision 0130): what generated code reaches as `ctx.audio`.
 *
 * Sound files are fetched and verified with the other assets (a missing or changed file fails the mount with
 * `E7030`, like an image). Decoding uses an `OfflineAudioContext`, which browsers allow before any user gesture;
 * the `AudioContext` that plays is created (or resumed) on the first key press, click or touch, because browsers
 * keep audio suspended until then (autoplay policy). Until that gesture `play` and `play_at` do nothing, and
 * `play_music` remembers the track and starts it on unlock. A file the browser cannot decode is the warning
 * `W8202` once; playing it does nothing. A volume or pitch outside its range, or not finite, is clamped with
 * `W8201`. Nothing here ever stops the program.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { resolveSpan } from "../host/failures.js";

/** The ranges of `spec/audio.md` section 3; the compiler checks constants against the same numbers (E5501). */
export const VOLUME_RANGE = [0, 4] as const;
export const PITCH_RANGE = [0.0625, 16] as const;

// ---- the parts of Web Audio the runtime uses (injectable for tests) ----
export interface AudioParamLike {
  value: number;
}
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}
export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}
export interface BufferSourceLike extends AudioNodeLike {
  buffer: unknown;
  loop: boolean;
  readonly playbackRate: AudioParamLike;
  start(): void;
  stop(): void;
  onended: (() => void) | null;
}
export interface PannerLike extends AudioNodeLike {
  panningModel: string;
  distanceModel: string;
  refDistance: number;
  setPosition(x: number, y: number, z: number): void;
}
export interface AudioContextLike {
  readonly state: string;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceLike;
  createPanner(): PannerLike;
}
export interface AudioBackend {
  /** A playing context; `undefined` when the browser has no Web Audio. Called on the first user gesture. */
  createContext(): AudioContextLike | undefined;
  /** Decodes a file (works before any gesture); rejects when the browser cannot decode it. */
  decode(bytes: Uint8Array): Promise<unknown>;
}

/** Web Audio of the browser, or `undefined` where there is none (then every call is a no-op). */
export function browserAudioBackend(): AudioBackend | undefined {
  const scope = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
    OfflineAudioContext?: new (channels: number, length: number, rate: number) => { decodeAudioData(buffer: ArrayBuffer): Promise<unknown> };
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  const Offline = scope.OfflineAudioContext;
  if (Ctor === undefined || Offline === undefined) return undefined;
  let decoder: { decodeAudioData(buffer: ArrayBuffer): Promise<unknown> } | undefined;
  return {
    createContext: () => new Ctor(),
    decode: (bytes) => {
      decoder ??= new Offline(1, 1, 44100);
      // decodeAudioData detaches its argument: give it a copy of exactly these bytes.
      return decoder.decodeAudioData(bytes.slice().buffer);
    },
  };
}

/** The pose of the active camera, for positional sound. */
export interface ListenerPose {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
}

/** `ctx.audio`: the calls generated code makes. Every method takes the call's span id first. */
export interface AudioService {
  play(spanId: unknown, sound: unknown, volume?: unknown, pitch?: unknown): void;
  playAt(spanId: unknown, sound: unknown, position: unknown, volume?: unknown): void;
  playMusic(spanId: unknown, sound: unknown, volume?: unknown): void;
  stopMusic(spanId: unknown): void;
  setVolume(spanId: unknown, volume: unknown): void;
  setMuted(spanId: unknown, muted: unknown): void;
  isMuted(spanId?: unknown): boolean;
  /** Releases the playing context (`dispose()` of the application). */
  dispose?(): void;
  /** A hot reload: sounds of the new manifest that are not known yet are decoded from `bytes`. */
  adopt?(manifest: MtekManifest, bytes: (url: string) => Uint8Array | undefined): void;
}

/** A service that plays nothing: for worlds nothing drives and for programs without sounds. */
export const SILENT_AUDIO: AudioService = Object.freeze({
  play: () => undefined,
  playAt: () => undefined,
  playMusic: () => undefined,
  stopMusic: () => undefined,
  setVolume: () => undefined,
  setMuted: () => undefined,
  isMuted: () => false,
});

export interface AudioSystemOptions {
  readonly manifest: MtekManifest;
  /** The verified bytes of an asset by url (the asset loader's files). */
  readonly bytes: (url: string) => Uint8Array | undefined;
  readonly backend: AudioBackend | undefined;
  readonly report: (diagnostic: MtekDiagnostic) => void;
  /** The active camera, read at every `play_at`. */
  readonly listener?: () => ListenerPose | undefined;
}

interface Sound {
  readonly url: string;
  readonly span: number;
  buffer: unknown;
  state: "pending" | "ready" | "failed";
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The audio subsystem of a mounted application. */
export class AudioSystem implements AudioService {
  private readonly sounds = new Map<string, Sound>();
  private context: AudioContextLike | undefined;
  private master: GainNodeLike | undefined;
  private volume = 1;
  private muted = false;
  private music: { readonly source: string; readonly volume: number; node?: BufferSourceLike; gain?: GainNodeLike } | undefined;
  private readonly active = new Set<BufferSourceLike>();
  private disposed = false;
  /** Resolves when every sound is decoded or failed (for tests). */
  readonly decoded: Promise<void>;

  constructor(private readonly options: AudioSystemOptions) {
    const pending: Promise<void>[] = [];
    for (const asset of options.manifest.assets) {
      if (asset.kind !== "audio") continue;
      const sound: Sound = { url: asset.url, span: asset.span, buffer: undefined, state: "pending" };
      this.sounds.set(asset.source, sound);
      pending.push(this.decodeOne(sound));
    }
    this.decoded = Promise.all(pending).then(() => undefined);
  }

  /** Whether the program declares any sound. */
  get hasSounds(): boolean {
    return this.sounds.size > 0;
  }

  /** The state of every sound by source path (for `debug` and tests). */
  states(): Record<string, Sound["state"]> {
    return Object.fromEntries([...this.sounds].map(([source, sound]) => [source, sound.state]));
  }

  /** Whether the first gesture created the playing context. */
  get unlocked(): boolean {
    return this.context !== undefined;
  }

  private async decodeOne(sound: Sound): Promise<void> {
    const backend = this.options.backend;
    if (backend === undefined) {
      sound.state = "failed";
      return;
    }
    const bytes = this.options.bytes(sound.url);
    try {
      if (bytes === undefined) throw new Error("its bytes were not loaded");
      sound.buffer = await backend.decode(bytes);
      sound.state = "ready";
    } catch (error) {
      sound.state = "failed";
      this.options.report(
        makeRuntimeDiagnostic("W8202", {
          phase: "runtime:mount",
          message: `The browser could not decode the sound '${sound.url}': ${error instanceof Error ? error.message : String(error)}. Playing it does nothing.`,
          source: resolveSpan(this.options.manifest, sound.span),
          notes: ["help: convert the sound to 16-bit PCM WAV, which every browser decodes"],
        }),
      );
    }
  }

  /**
   * The first key press, click or touch: creates (or resumes) the playing context, inside the gesture as browsers
   * require. Idempotent; the host calls it from capturing `pointerdown`, `keydown` and `touchend` listeners.
   */
  unlock(): void {
    if (this.disposed) return;
    if (this.context === undefined) {
      const context = this.options.backend?.createContext();
      if (context === undefined) return;
      this.context = context;
      this.master = context.createGain();
      this.master.connect(context.destination);
      this.applyMaster();
      const wanted = this.music;
      if (wanted !== undefined && wanted.node === undefined) this.startMusic(wanted.source, wanted.volume);
    }
    if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
  }

  private applyMaster(): void {
    if (this.master !== undefined) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private clamp(spanId: unknown, value: unknown, fallback: number, range: readonly [number, number], what: string): number {
    if (value === undefined) return fallback;
    const number = finite(value);
    const [lo, hi] = range;
    if (number !== undefined && number >= lo && number <= hi) return number;
    const used = number === undefined ? fallback : Math.min(hi, Math.max(lo, number));
    this.options.report(
      makeRuntimeDiagnostic("W8201", {
        phase: "runtime:update",
        message: `The ${what} ${describe(value)} is outside ${String(lo)} to ${String(hi)}; ${String(used)} is used.`,
        source: typeof spanId === "number" ? resolveSpan(this.options.manifest, spanId) : null,
        expected: `${String(lo)} to ${String(hi)}`,
        actual: describe(value),
      }),
    );
    return used;
  }

  private ready(sound: unknown): Sound | undefined {
    if (typeof sound !== "string") return undefined;
    const found = this.sounds.get(sound);
    return found?.state === "ready" ? found : undefined;
  }

  private source(sound: Sound, volume: number, pitch: number, loop: boolean, last?: AudioNodeLike): { node: BufferSourceLike; gain: GainNodeLike } | undefined {
    const context = this.context;
    if (context === undefined || this.master === undefined) return undefined;
    const node = context.createBufferSource();
    node.buffer = sound.buffer;
    node.loop = loop;
    node.playbackRate.value = pitch;
    const gain = context.createGain();
    gain.gain.value = volume;
    node.connect(gain);
    if (last === undefined) gain.connect(this.master);
    else {
      gain.connect(last);
      last.connect(this.master);
    }
    if (!loop) {
      this.active.add(node);
      node.onended = () => {
        this.active.delete(node);
        node.disconnect();
        gain.disconnect();
        last?.disconnect();
      };
    }
    node.start();
    return { node, gain };
  }

  play(spanId: unknown, sound: unknown, volume?: unknown, pitch?: unknown): void {
    const v = this.clamp(spanId, volume, 1, VOLUME_RANGE, "volume");
    const p = this.clamp(spanId, pitch, 1, PITCH_RANGE, "pitch");
    const found = this.ready(sound);
    if (found !== undefined) this.source(found, v, p, false);
  }

  playAt(spanId: unknown, sound: unknown, position: unknown, volume?: unknown): void {
    const v = this.clamp(spanId, volume, 1, VOLUME_RANGE, "volume");
    const found = this.ready(sound);
    const context = this.context;
    if (found === undefined || context === undefined) return;
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    const [x, y, z] = relativeToListener(position, this.options.listener?.());
    panner.setPosition(x, y, z);
    this.source(found, v, 1, false, panner);
  }

  playMusic(spanId: unknown, sound: unknown, volume?: unknown): void {
    const v = this.clamp(spanId, volume, 1, VOLUME_RANGE, "volume");
    if (typeof sound !== "string") return;
    this.stopMusic();
    this.music = { source: sound, volume: v };
    if (this.context !== undefined) this.startMusic(sound, v);
  }

  private startMusic(source: string, volume: number): void {
    const found = this.ready(source);
    if (found === undefined || this.music === undefined) return;
    const started = this.source(found, volume, 1, true);
    if (started !== undefined) {
      this.music.node = started.node;
      this.music.gain = started.gain;
    }
  }

  stopMusic(): void {
    const music = this.music;
    this.music = undefined;
    if (music?.node !== undefined) {
      music.node.stop();
      music.node.disconnect();
      music.gain?.disconnect();
    }
  }

  setVolume(spanId: unknown, volume: unknown): void {
    this.volume = this.clamp(spanId, volume, this.volume, VOLUME_RANGE, "volume");
    this.applyMaster();
  }

  setMuted(_spanId: unknown, muted: unknown): void {
    this.muted = muted === true;
    this.applyMaster();
  }

  isMuted(): boolean {
    return this.muted;
  }

  adopt(manifest: MtekManifest, bytes: (url: string) => Uint8Array | undefined): void {
    for (const asset of manifest.assets) {
      if (asset.kind !== "audio") continue;
      const known = this.sounds.get(asset.source);
      if (known !== undefined && known.url === asset.url) continue;
      const sound: Sound = { url: asset.url, span: asset.span, buffer: undefined, state: "pending" };
      this.sounds.set(asset.source, sound);
      const backend = this.options.backend;
      if (backend === undefined) {
        sound.state = "failed";
        continue;
      }
      const data = bytes(asset.url);
      if (data === undefined) {
        sound.state = "failed";
        continue;
      }
      backend.decode(data).then(
        (buffer) => {
          sound.buffer = buffer;
          sound.state = "ready";
        },
        () => {
          sound.state = "failed";
        },
      );
    }
  }

  /** Stops every sound and closes the context (`dispose()`). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMusic();
    for (const node of this.active) {
      try {
        node.stop();
      } catch {
        // already ended
      }
    }
    this.active.clear();
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
  }
}

/**
 * `position` in the listener's frame (x right, y up, -z forward), so a panner can be used without the listener
 * API (whose AudioParam form some browsers lack). Without a camera the position is used as is.
 */
export function relativeToListener(position: unknown, pose: ListenerPose | undefined): [number, number, number] {
  const p = position as { x?: unknown; y?: unknown; z?: unknown } | null;
  const px = finite(p?.x) ?? 0;
  const py = finite(p?.y) ?? 0;
  const pz = finite(p?.z) ?? 0;
  if (pose === undefined) return [px, py, pz];
  const d = [px - pose.position.x, py - pose.position.y, pz - pose.position.z] as const;
  const { x, y, z, w } = pose.rotation;
  // The camera's basis from its rotation: right = R·(1,0,0), up = R·(0,1,0), forward = R·(0,0,-1).
  let right: [number, number, number] = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
  let up: [number, number, number] = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  let forward: [number, number, number] = [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
  if (pose.target !== null) {
    const f = normalize([pose.target.x - pose.position.x, pose.target.y - pose.position.y, pose.target.z - pose.position.z]);
    if (f !== undefined) {
      forward = f;
      right = normalize(cross(f, [0, 1, 0])) ?? [1, 0, 0];
      up = cross(right, f);
    }
  }
  const dot = (a: readonly number[], b: readonly number[]): number => (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
  return [dot(d, right), dot(d, up), -dot(d, forward)];
}

function cross(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: readonly [number, number, number]): [number, number, number] | undefined {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-12 ? [v[0] / length, v[1] / length, v[2] / length] : undefined;
}

/** A run-time argument as text for a diagnostic. */
function describe(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value;
}
