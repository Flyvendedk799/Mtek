/**
 * The audio subsystem against a fake Web Audio (decision 0130): unlock on the first gesture, music remembered until
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
  suspend?: () => Promise<void>;
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

/** A backend whose decodes finish when the test says so. */
function deferredSystem(): {
  system: AudioSystem;
  context: FakeContext;
  reports: MtekDiagnostic[];
  settle: (index: number, ok: boolean) => void;
  firstSounds: number[];
} {
  const context = new FakeContext();
  const settlers: ((ok: boolean) => void)[] = [];
  const backend: AudioBackend = {
    createContext: () => context,
    decode: () =>
      new Promise((resolve, reject) => {
        settlers.push((ok) => (ok ? resolve({ length: 4 }) : reject(new Error("bad data"))));
      }),
  };
  const manifest = {
    assets: [{ url: "assets/0000000000000002.wav", sha256: "0".repeat(64), bytes: 4, kind: "audio", format: "wav", mime: "audio/wav", source: "sounds/music.wav", span: 0 }],
    spans: [],
  } as unknown as MtekManifest;
  const reports: MtekDiagnostic[] = [];
  const firstSounds: number[] = [];
  const system = new AudioSystem({
    manifest,
    bytes: () => new Uint8Array(4),
    backend,
    report: (d) => reports.push(d),
    onFirstSound: () => firstSounds.push(1),
  });
  return { system, context, reports, firstSounds, settle: (index, ok) => settlers[index]?.(ok) };
}

describe("music and decoding (decision 0176)", () => {
  it("starts a track asked for while its sound still decodes, when the decode resolves", async () => {
    const { system, context, settle } = deferredSystem();
    system.unlock();
    system.playMusic(0, "sounds/music.wav", 0.5);
    expect(context.sources).toHaveLength(0);
    settle(0, true);
    await system.decoded;
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.loop).toBe(true);
    expect(context.sources[0]?.started).toBe(true);
  });

  it("starts that track at the unlock when the decode finished first, and not twice", async () => {
    const { system, context, settle } = deferredSystem();
    system.playMusic(0, "sounds/music.wav");
    settle(0, true);
    await system.decoded;
    expect(context.sources).toHaveLength(0);
    system.unlock();
    system.unlock();
    expect(context.sources).toHaveLength(1);
  });

  it("does not start a track that was stopped or replaced before the decode finished", async () => {
    const { system, context, settle } = deferredSystem();
    system.unlock();
    system.playMusic(0, "sounds/music.wav");
    system.stopMusic();
    settle(0, true);
    await system.decoded;
    expect(context.sources).toHaveLength(0);
  });

  it("reports W8202 for a sound a hot reload adds and the browser cannot decode", async () => {
    const { system, reports, settle, firstSounds } = deferredSystem();
    settle(0, true);
    await system.decoded;
    const added = {
      assets: [{ url: "assets/0000000000000009.wav", sha256: "0".repeat(64), bytes: 4, kind: "audio", format: "wav", mime: "audio/wav", source: "sounds/new.wav", span: 0 }],
      spans: [],
    } as unknown as MtekManifest;
    system.adopt(added, () => new Uint8Array(4));
    settle(1, false);
    await Promise.resolve();
    await Promise.resolve();
    expect(reports.map((r) => r.code)).toEqual(["MTEK-W8202"]);
    expect(reports[0]?.phase).toBe("runtime:reload");
    expect(reports[0]?.message).toContain("assets/0000000000000009.wav");
    // The program already had a sound: no first-sound signal.
    expect(firstSounds).toEqual([]);
  });

  it("tells the host when a program without sounds gets its first one", () => {
    const context = new FakeContext();
    const firstSounds: number[] = [];
    const system = new AudioSystem({
      manifest: { assets: [], spans: [] } as unknown as MtekManifest,
      bytes: () => new Uint8Array(4),
      backend: { createContext: () => context, decode: () => Promise.resolve({}) },
      report: () => undefined,
      onFirstSound: () => firstSounds.push(1),
    });
    expect(system.hasSounds).toBe(false);
    const added = {
      assets: [{ url: "assets/0000000000000009.wav", sha256: "0".repeat(64), bytes: 4, kind: "audio", format: "wav", mime: "audio/wav", source: "sounds/new.wav", span: 0 }],
      spans: [],
    } as unknown as MtekManifest;
    system.adopt(added, () => new Uint8Array(4));
    expect(system.hasSounds).toBe(true);
    expect(firstSounds).toEqual([1]);
    // A second reload that adds another sound is not "the first".
    system.adopt({ assets: [{ ...added.assets[0], url: "assets/000000000000000a.wav", source: "sounds/other.wav" }], spans: [] } as unknown as MtekManifest, () => new Uint8Array(4));
    expect(firstSounds).toEqual([1]);
  });

  it("holds the context while the host is paused and resumes it with the host", async () => {
    const { system, context } = setup();
    await system.decoded;
    const suspended: string[] = [];
    context.suspend = () => {
      context.state = "suspended";
      suspended.push("suspend");
      return Promise.resolve();
    };
    system.unlock();
    expect(context.state).toBe("running");
    system.setSuspended(true);
    expect(suspended).toEqual(["suspend"]);
    expect(context.state).toBe("suspended");
    // A gesture while the host is paused does not wake the sound.
    system.unlock();
    expect(context.state).toBe("suspended");
    system.setSuspended(false);
    expect(context.state).toBe("running");
  });

  it("resolves the span of a W8201 against the manifest of the scene that runs", () => {
    const context = new FakeContext();
    const sourced = (path: string): MtekManifest =>
      ({
        assets: [],
        sources: [{ id: "s", path }],
        spans: [{ file: "s", start: 0, end: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }],
      }) as unknown as MtekManifest;
    let current = sourced("src/first.mtek");
    const reports: MtekDiagnostic[] = [];
    const system = new AudioSystem({
      manifest: current,
      manifestNow: () => current,
      bytes: () => new Uint8Array(4),
      backend: { createContext: () => context, decode: () => Promise.resolve({}) },
      report: (d) => reports.push(d),
    });
    system.setVolume(0, 99);
    current = sourced("src/second.mtek");
    system.setVolume(0, 99);
    expect(reports.map((r) => r.source?.file)).toEqual(["src/first.mtek", "src/second.mtek"]);
  });
});

describe("relativeToListener", () => {
  it("is the identity without a camera", () => {
    expect(relativeToListener({ x: 1, y: 2, z: 3 }, undefined)).toEqual([1, 2, 3]);
  });
});
