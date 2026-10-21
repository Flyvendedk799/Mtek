import { describe, expect, it } from "vitest";
import { ClipPlayers, sampleChannel } from "./clips.js";

describe("clip sampling", () => {
  const spin = {
    path: "rotation" as const,
    interpolation: "linear" as const,
    times: [0, 1],
    values: [0, 0, 0, 1, 0, 1, 0, 0],
  };

  it("nlerps a half turn about Y to about 0.7071", () => {
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