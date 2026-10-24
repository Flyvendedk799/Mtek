import { describe, expect, it } from "vitest";
import { ClipPlayers, sampleChannel } from "./clips.js";

describe("clip sampling", () => {
  const spin = {
    path: "rotation" as const,
    interpolation: "linear" as const,
    times: [0, 1],
    values: [0, 0, 0, 1, 0, 1, 0, 0],
  };

  it("slerps a half turn with constant angular speed, including away from the midpoint", () => {
    expect(sampleChannel(spin, 0.25)[1]).toBeCloseTo(Math.sin(Math.PI / 8), 8);
    expect(sampleChannel({ ...spin, values: [0, 0, 0, -1, 0, -1, 0, 0] }, 0.25)[1]).toBeCloseTo(-Math.sin(Math.PI / 8), 8);
    const value = sampleChannel(spin, 0.5);
    expect(value[0]).toBeCloseTo(0, 5);
    expect(value[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(value[2]).toBeCloseTo(0, 5);
    expect(value[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("holds the previous key for step and wraps after the duration", () => {
    expect(sampleChannel({ ...spin, interpolation: "step" }, 0.9)[3]).toBeCloseTo(1, 5);
    const seen: number[] = [];
    const players = new ClipPlayers();
    players.add({ slot: 0, duration: 1, channels: [spin] });
    players.advance(1.25, (_slot, _channel, value) => {
      seen.push(value[1] ?? 0);
    });
    expect(seen[0]).toBeCloseTo(sampleChannel(spin, 0.25)[1] ?? 0, 5);
  });
});

describe("controlled clip playback", () => {
  const slide = { path: "translation" as const, interpolation: "linear" as const, times: [0, 1], values: [0, 0, 0, 2, 0, 0] };
  const noop = (): void => undefined;
  const setup = (): ClipPlayers => {
    const players = new ClipPlayers();
    players.add({ slot: 0, duration: 1, channels: [slide] });
    return players;
  };

  it("finishes once, holds the last pose, and restarts explicitly", () => {
    const p = setup();
    expect(p.play(0, false, 2)).toBe(true);
    p.advance(0.3, noop);
    expect(p.time(0)).toBeCloseTo(0.6);
    expect(p.crossed(0, 0.5)).toBe(true);
    p.advance(1, noop);
    expect(p.time(0)).toBe(1);
    expect(p.finished(0)).toBe(true);
    expect(p.playing(0)).toBe(false);
    expect(p.crossed(0, 1)).toBe(true);
    expect(p.resume(0)).toBe(false);
    p.advance(1, noop);
    expect(p.crossed(0, 1)).toBe(false);
    expect(p.play(0, false, 1)).toBe(true);
    expect(p.finished(0)).toBe(false);
    expect(p.time(0)).toBe(0);
  });

  it("handles pause, seek and looping markers without duplicates at exact boundaries", () => {
    const p = setup();
    p.advance(1, noop);
    expect(p.crossed(0, 1)).toBe(true);
    p.advance(0.1, noop);
    expect(p.crossed(0, 1)).toBe(false);
    expect(p.crossed(0, 0.05)).toBe(true);
    p.pause(0);
    p.advance(1, noop);
    expect(p.time(0)).toBeCloseTo(0.1);
    expect(p.crossed(0, 0.05)).toBe(false);
    p.seek(0, 0.75);
    expect(p.crossed(0, 0.5)).toBe(false);
    p.resume(0);
    p.advance(2.4, noop);
    expect(p.crossed(0, 0.5)).toBe(true);
    expect(p.crossed(0, 1)).toBe(true);
    expect(p.crossed(0, 0)).toBe(false);
    expect(p.crossed(0, 1.1)).toBe(false);
  });

  it("fades a paused pose to the base transform and can interrupt the fade continuously", () => {
    const p = setup();
    p.seek(0, 1);
    p.pause(0);
    p.fade(0, 0, 1);
    let x = 0;
    p.advance(0.5, (_slot, _channel, value) => { x = value[0] ?? 0; });
    expect(x).toBe(1);
    expect(p.weight(0)).toBe(0.5);
    p.fade(0, 1, 0.5);
    p.advance(0.25, noop);
    expect(p.weight(0)).toBe(0.75);
    p.advance(0.25, noop);
    expect(p.weight(0)).toBe(1);
    p.fade(0, 0, 0);
    p.poseSlot(0, (_slot, _channel, value) => { x = value[0] ?? 0; });
    expect(x).toBe(0);
  });

  it("blends rotation on the shortest arc and scale toward one", () => {
    const p = new ClipPlayers();
    p.add({ slot: 0, duration: 1, channels: [
      { path: "rotation", interpolation: "step", times: [0], values: [0, -1, 0, 0] },
      { path: "scale", interpolation: "step", times: [0], values: [3, 3, 3] },
    ] });
    p.fade(0, 0.5, 0);
    p.pose((_, channel, value) => {
      if (channel.path === "scale") expect(value[0]).toBe(2);
      else {
        expect(value[1]).toBeCloseTo(-Math.SQRT1_2);
        expect(value[3]).toBeCloseTo(Math.SQRT1_2);
      }
    });
  });

  it("rejects invalid numbers and removed clips, and handles zero-duration clips", () => {
    const p = setup();
    expect(p.play(0, true, -1)).toBe(false);
    expect(p.play(0, true, Infinity)).toBe(false);
    expect(p.seek(0, NaN)).toBe(false);
    expect(p.fade(0, NaN, 1)).toBe(false);
    expect(p.fade(0, 1, -1)).toBe(false);
    p.remove(0);
    expect(p.play(0, false, 1)).toBe(false);
    expect(p.time(0)).toBe(0);
    expect(p.crossed(0, 0.5)).toBe(false);
    p.add({ slot: 0, duration: 0, channels: [slide] });
    p.play(0, false, 1);
    p.advance(10, noop);
    expect(p.finished(0)).toBe(true);
    expect(p.time(0)).toBe(0);
  });
});
