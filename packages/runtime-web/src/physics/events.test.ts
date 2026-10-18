import { describe, expect, it } from "vitest";
import { collisionPair, sortCollisions } from "./events.js";

const order = (pairs: ReturnType<typeof collisionPair>[]): string[] =>
  sortCollisions(pairs).map((p) => `${p.started ? "enter" : "exit"}(${String(p.low)},${String(p.high)})`);

describe("collision event order (spec/physics.md section 6)", () => {
  it("puts the lower slot first in a pair, whichever order the engine reported them", () => {
    expect(collisionPair(9, 3, true)).toEqual({ low: 3, high: 9, started: true });
    expect(collisionPair(3, 9, false)).toEqual({ low: 3, high: 9, started: false });
  });

  it("sorts enter events before exit events, each by (lower slot, higher slot)", () => {
    expect(
      order([
        collisionPair(5, 2, false),
        collisionPair(7, 1, true),
        collisionPair(2, 5, true),
        collisionPair(1, 3, false),
        collisionPair(1, 2, true),
        collisionPair(6, 2, true),
      ]),
    ).toEqual(["enter(1,2)", "enter(1,7)", "enter(2,5)", "enter(2,6)", "exit(1,3)", "exit(2,5)"]);
  });

  it("is independent of the order the engine reports in", () => {
    const base = [collisionPair(4, 8, true), collisionPair(1, 2, true), collisionPair(3, 9, false), collisionPair(2, 7, false), collisionPair(0, 6, true)];
    const expected = order([...base]);
    const rotated = [...base.slice(2), ...base.slice(0, 2)];
    expect(order(rotated)).toEqual(expected);
    expect(order([...base].reverse())).toEqual(expected);
  });

  it("keeps the engine's order for the same pair reported twice (a stable sort)", () => {
    const a = { ...collisionPair(1, 2, true) };
    const b = { ...collisionPair(2, 1, true) };
    const sorted = sortCollisions([a, b]);
    expect(sorted[0]).toBe(a);
    expect(sorted[1]).toBe(b);
  });
});
