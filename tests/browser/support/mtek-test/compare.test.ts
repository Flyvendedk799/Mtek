import { describe, expect, it } from "vitest";
import {
  compareCounters,
  comparePixel,
  compareState,
  describeValue,
  hexToLinear,
  withinTolerance,
  type SceneView,
} from "./compare.ts";
import type { StateEntry } from "./plan.ts";

const entry = (name: string, expected: StateEntry["expected"], tolerance: number | null = 1e-5): StateEntry => ({
  name,
  expected,
  tolerance,
});

describe("withinTolerance", () => {
  it("accepts the binary32 neighbour of a decimal literal even with tolerance 0", () => {
    expect(withinTolerance(Math.fround(0.7), 0.7, 0)).toBe(true);
    expect(withinTolerance(Math.fround(1000.3), 1000.3, 0)).toBe(true);
  });

  it("rejects what is further away than the tolerance plus one rounding step", () => {
    expect(withinTolerance(0.7001, 0.7, 1e-5)).toBe(false);
    expect(withinTolerance(0.700005, 0.7, 1e-5)).toBe(true);
    expect(withinTolerance(-0.7, 0.7, 1e-5)).toBe(false);
  });
});

const sceneOf = (state: Record<string, unknown>): SceneView => ({
  state,
  entities: [
    {
      name: "Cube",
      position: { x: 0, y: 0.5, z: 0 },
      // A turn of 1.0996 rad about +Y.
      rotation: { x: 0, y: Math.fround(Math.sin(0.5498)), z: 0, w: Math.fround(Math.cos(0.5498)) },
      mat: { p: { phase: 1.5, tint: { r: 1, g: 0, b: 0, a: 1 } } },
    },
    { name: "Bare", position: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  ],
});

describe("compareState addressing entities", () => {
  const scene = sceneOf({});
  const sin = Math.sin(0.5498);
  const cos = Math.cos(0.5498);

  it("reads the pose and the material parameters of a named entity", () => {
    expect(
      compareState(scene, [
        entry("Cube.position", [0, 0.5, 0]),
        entry("Cube.rotation", [0, sin, 0, cos]),
        entry("Cube.material.phase", 1.5),
        entry("Cube.material.tint", "#ff0000", null),
      ]),
    ).toEqual([]);
  });

  it("treats a rotation and its negation as the same rotation, and a position as not", () => {
    expect(compareState(scene, [entry("Cube.rotation", [0, -sin, 0, -cos])])).toEqual([]);
    expect(compareState(scene, [entry("Cube.rotation", [0, sin, 0, -cos])])).toHaveLength(1);
    expect(compareState(scene, [entry("Cube.position", [0, -0.5, 0])])).toHaveLength(1);
  });

  it("says what differs and what exists", () => {
    const [rotation] = compareState(scene, [entry("Cube.rotation", [0, 0.9, 0, 0.1])]);
    expect(rotation).toContain("'Cube.rotation' is (0, 0.522");
    expect(rotation).toContain("component y differs");
    expect(compareState(scene, [entry("Cub.position", [0, 0, 0])])[0]).toBe(
      "there is no named entity 'Cub' (entities: Bare, Cube)",
    );
    expect(compareState(scene, [entry("Cube.material.phse", 1)])[0]).toBe(
      "entity 'Cube' has no material parameter 'phse' (parameters: phase, tint)",
    );
    expect(compareState(scene, [entry("Bare.material.phase", 1)])[0]).toContain("(parameters: none)");
    expect(compareState(scene, [entry("Cube.scale", [1, 1, 1])])[0]).toContain("addresses nothing");
    expect(compareState(scene, [entry("Cube.material.phase.x", 1)])[0]).toContain("addresses nothing");
  });
});

describe("compareState", () => {
  const state = {
    speed: Math.fround(0.7),
    done: false,
    name: "cube",
    offset: { x: 1, y: 2, z: 3 },
    turn: { x: 0, y: 0, z: 0, w: 1 },
    tint: { r: hexToLinear("#6b5cff")?.[0], g: hexToLinear("#6b5cff")?.[1], b: hexToLinear("#6b5cff")?.[2], a: 1 },
  };

  it("passes numbers, booleans, strings, vectors, quaternions and colours that match", () => {
    expect(
      compareState(sceneOf(state),[
        entry("speed", 0.7),
        entry("done", false, null),
        entry("name", "cube", null),
        entry("offset", [1, 2, 3]),
        entry("turn", [0, 0, 0, 1]),
        entry("tint", "#6b5cff", null),
        entry("tint", "#6b5cffff", null),
      ]),
    ).toEqual([]);
  });

  it("says what differs", () => {
    const lines = compareState(sceneOf(state),[
      entry("speed", -0.7),
      entry("done", true, null),
      entry("name", "sphere", null),
      entry("offset", [1, 2.5, 3]),
      entry("tint", "#ff0000", null),
    ]);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("state 'speed' is 0.699999988, expected -0.7 (tolerance 0.00001)");
    expect(lines[1]).toBe("state 'done' is false, expected true");
    expect(lines[2]).toBe('state \'name\' is "cube", expected "sphere"');
    expect(lines[3]).toContain("component y differs");
    expect(lines[4]).toContain("expected the colour #ff0000");
  });

  it("honours a per-entry tolerance", () => {
    expect(compareState(sceneOf(state),[entry("speed", 0.75, 0.1)])).toEqual([]);
    expect(compareState(sceneOf(state),[entry("speed", 0.75, 0.01)])).toHaveLength(1);
  });

  it("names the known state when one is missing", () => {
    const [line] = compareState(sceneOf(state),[entry("speeed", 1)]);
    expect(line).toContain("there is no scene state 'speeed'");
    expect(line).toContain("done, name, offset, speed, tint, turn");
  });

  it("treats a value of another kind as a mismatch, never as a match", () => {
    expect(compareState(sceneOf(state),[entry("name", 1)])[0]).toContain("expected the number 1");
    expect(compareState(sceneOf(state),[entry("speed", [1, 2])])[0]).toContain("expected the vector");
    expect(compareState(sceneOf(state),[entry("offset", [1, 2])])[0]).toContain("vector of 2 components");
    expect(compareState(sceneOf(state),[entry("speed", true, null)])[0]).toContain("expected true");
    expect(compareState(sceneOf(state),[entry("speed", "0.7", null)])[0]).toContain('expected "0.7"');
  });
});

describe("compareCounters", () => {
  const counters = { drawCalls: 3, culledObjects: 0 };

  it("compares exactly or against bounds", () => {
    expect(
      compareCounters(counters, [
        { name: "drawCalls", equals: 3, min: null, max: null },
        { name: "drawCalls", equals: null, min: 1, max: 3 },
        { name: "culledObjects", equals: null, min: null, max: 5 },
      ]),
    ).toEqual([]);
  });

  it("says what differs", () => {
    const lines = compareCounters(counters, [
      { name: "drawCalls", equals: 4, min: null, max: null },
      { name: "drawCalls", equals: null, min: 5, max: null },
      { name: "drawCalls", equals: null, min: null, max: 2 },
      { name: "drawCalls", equals: null, min: 4, max: 6 },
    ]);
    expect(lines).toEqual([
      "counter 'drawCalls' is 3, expected 4",
      "counter 'drawCalls' is 3, expected at least 5",
      "counter 'drawCalls' is 3, expected at most 2",
      "counter 'drawCalls' is 3, expected at least 4 and at most 6",
    ]);
  });

  it("names the known counters when one is missing", () => {
    const [line] = compareCounters(counters, [{ name: "nope", equals: 1, min: null, max: null }]);
    expect(line).toBe("there is no counter 'nope' (counters: culledObjects, drawCalls)");
  });
});

describe("comparePixel", () => {
  it("allows a difference up to the tolerance in every channel and ignores alpha", () => {
    expect(comparePixel(1, 2, [107, 92, 255, 0], [107, 92, 255], 0)).toBeNull();
    expect(comparePixel(1, 2, [109, 90, 253, 7], [107, 92, 255], 2)).toBeNull();
  });

  it("reports colour, coordinates and the largest difference", () => {
    expect(comparePixel(64, 10, [32, 32, 32, 255], [107, 92, 255], 2)).toBe(
      "pixel (64, 10) is #202020, expected #6b5cff within 2 per channel; it differs by 223",
    );
    expect(comparePixel(0, 0, [10, 10, 13, 255], [10, 10, 10], 2)).not.toBeNull();
  });
});

describe("describeValue and hexToLinear", () => {
  it("shows vectors, colours and long values compactly", () => {
    expect(describeValue({ x: 1, y: 2 })).toBe("(1, 2)");
    expect(describeValue({ r: 1, g: 0, b: 0, a: 1 })).toBe("(1, 0, 0, 1)");
    expect(describeValue(Math.fround(0.7))).toBe("0.699999988");
    expect(describeValue({ slot: 3, gen: 1 })).toBe('{"slot":3,"gen":1}');
    expect(describeValue("x".repeat(200).split("").map(() => 1)).length).toBeLessThanOrEqual(80);
  });

  it("converts sRGB bytes as colour literals are", () => {
    expect(hexToLinear("#ffffff")).toEqual([1, 1, 1, 1]);
    expect(hexToLinear("#000000")).toEqual([0, 0, 0, 1]);
    expect(hexToLinear("#80808000")?.[3]).toBe(0);
    expect(hexToLinear("#808080")?.[0]).toBeCloseTo(0.2158605, 6);
    expect(hexToLinear("808080")).toBeNull();
    expect(hexToLinear("#12345")).toBeNull();
  });
});
