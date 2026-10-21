/**
 * The audio subsystem against a fake Web Audio (decision 0160): unlock on the first gesture, music remembered until
 * then, clamping with W8201, a file the browser cannot decode with W8202, mute and global volume on the master gain,
 * and positional sound relative to the camera.
 */
import { describe, expect, it } from "vitest";
import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { AudioSystem, relativeToListener, type AudioBackend, type AudioContextLike, type BufferSourceLike, type GainNodeLike, type PannerLike } from "./audio.js";

class FakeContext implements AudioContextLike {
  state = "suspended";
  readonly destination = { connect: () => undefined, disconnect: () => undefined };
  readonly gains: GainNodeLike[] = [];
  readonly sources: (BufferSourceLike & { started: boolean; stopped: boolean })[] = [];
  readonly panners: (PannerLike & { at: number[] })[] = [];
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
  createGain(): GainNodeLike {
    const gain = { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
    this.gains.push(gain);
    return gain;
  }
  createBufferSource(): BufferSourceLike {
    const source = {
      buffer: undefined as unknown,
      loop: false,
      playbackRate: { value: 1 },
      started: false,
      stopped: false,
      onended: null as (() => void) | null,
      connect: () => undefined,
      disconnect: () => undefined,
      start() {
        this.started = true;
      },
      stop() {
        this.stopped = true;
      },
    };
    this.sources.push(source);
    return source;
  }
  createPanner(): PannerLike {
    const panner = {
      panningModel: "",
      distanceModel: "",
      refDistance: 0,
      at: [] as number[],
      connect: () => undefined,
      disconnect: () => undefined,
      setPosition(x: number, y: number, z: number) {
        this.at = [x, y, z];
      },
    };
    this.panners.push(panner);
    return panner;
  }
}

function setup(decodeFails = false): { system: AudioSystem; context: FakeContext; reports: MtekDiagnostic[] } {
  const context = new FakeContext();
  const backend: AudioBackend = {
    createContext: () => context,
    decode: (bytes) => (decodeFails ? Promise.reject(new Error("bad data")) : Promise.resolve({ length: bytes.length })),
  };
  const manifest = {
    assets: [
      { url: "assets/0000000000000001.wav", sha256: "0".repeat(64), bytes: 4, kind: "audio", format: "wav", mime: "audio/wav", source: "sounds/hit.wav", span: 0 },
      { url: "assets/0000000000000002.wav", sha256: "0".repeat(64), bytes: 4, kind: "audio", format: "wav", mime: "audio/wav", source: "sounds/music.wav", span: 0 },
    ],
    spans: [],
  } as unknown as MtekManifest;
  const reports: MtekDiagnostic[] = [];
  const system = new AudioSystem({
    manifest,
    bytes: () => new Uint8Array(4),
    backend,
    report: (d) => reports.push(d),
    listener: () => ({ position: { x: 0, y: 0, z: 5 }, target: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }),
  });
  return { system, context, reports };
}

describe("AudioSystem", () => {
  it("is silent before the first gesture and remembers the music until then", async () => {
    const { system, context } = setup();
    await system.decoded;
    system.play(0, "sounds/hit.wav");
    system.playMusic(0, "sounds/music.wav", 0.5);
    expect(context.sources).toHaveLength(0);
    system.unlock();
    expect(system.unlocked).toBe(true);
    expect(context.state).toBe("running");
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.loop).toBe(true);
    system.play(0, "sounds/hit.wav", 0.5, 2);
    expect(context.sources[1]?.playbackRate.value).toBe(2);
    system.stopMusic();
    expect(context.sources[0]?.stopped).toBe(true);
  });

  it("clamps an out-of-range volume or pitch with W8201", async () => {
    const { system, context, reports } = setup();
    await system.decoded;
    system.unlock();
    system.play(3, "sounds/hit.wav", 9, Number.NaN);
    expect(reports.map((r) => r.code)).toEqual(["MTEK-W8201", "MTEK-W8201"]);
    expect(context.sources[0]?.playbackRate.value).toBe(1);
    expect(context.gains.at(-1)?.gain.value).toBe(4);
  });

  it("reports a sound the browser cannot decode once, with W8202, and keeps going", async () => {
    const { system, context, reports } = setup(true);
    await system.decoded;
    expect(reports.map((r) => r.code)).toEqual(["MTEK-W8202", "MTEK-W8202"]);
    system.unlock();
    system.play(0, "sounds/hit.wav");
    expect(context.sources).toHaveLength(0);
  });

  it("mutes and sets the global volume on the master gain", async () => {
    const { system, context } = setup();
    await system.decoded;
    system.unlock();
    const master = context.gains[0];
    system.setVolume(0, 0.25);
    expect(master?.gain.value).toBe(0.25);
    system.setMuted(0, true);
    expect(system.isMuted()).toBe(true);
    expect(master?.gain.value).toBe(0);
    system.setMuted(0, false);
    expect(master?.gain.value).toBe(0.25);
  });

  it("places positional sound relative to the camera", async () => {
    const { system, context } = setup();
    await system.decoded;
    system.unlock();
    system.playAt(0, "sounds/hit.wav", { x: 2, y: 0, z: 0 });
    const at = context.panners[0]?.at ?? [];
    expect(at[0]).toBeCloseTo(2);
    expect(at[2]).toBeCloseTo(-5);
  });
});

describe("relativeToListener", () => {
  it("is the identity without a camera", () => {
    expect(relativeToListener({ x: 1, y: 2, z: 3 }, undefined)).toEqual([1, 2, 3]);
  });
});
