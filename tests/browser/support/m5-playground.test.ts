// The model behind the physics playground spec (support/m5-playground.ts) is checked against the program it models and
// against numbers worked out by hand, so the browser spec's expectations do not rest on code nobody tested.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CAMERA,
  PLAYGROUND_SOURCE_LITERALS,
  assertSeparated,
  colourExtent,
  encodePng,
  exampleConstant,
  fallTicks,
  fate,
  liftHeight,
  liftTime,
  meterBox,
  meterColumns,
  playgroundSource,
  projectColumn,
  spawnPositions,
} from "./m5-playground.ts";

/** The seed of the spec and its six positions, from the runtime's own generator (`packages/runtime-web/src/random/xoshiro.ts`) at the time the example was written. */
const SEED = 166;
const POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [5.964, 0.396],
  [-7.96, 0.915],
  [7.873, 1.852],
  [-0.232, -2.027],
  [2.55, 2.03],
  [-3.084, 2.479],
];

describe("the playground model (M5-07)", () => {
  it("transcribes lines that occur in the example's source", () => {
    const source = playgroundSource();
    for (const literal of PLAYGROUND_SOURCE_LITERALS) expect(source, literal).toContain(literal);
  });

  it("reads the example's constants", () => {
    expect([exampleConstant("KILL_HEIGHT"), exampleConstant("SPAWN_HEIGHT"), exampleConstant("SPAWN_RANGE_X"), exampleConstant("SPAWN_RANGE_Z"), exampleConstant("JUMP_IMPULSE")]).toEqual([-10, 6, 9, 2.5, 10]);
    expect(() => exampleConstant("NO_SUCH_CONSTANT")).toThrow(/no `const NO_SUCH_CONSTANT/);
  });

  it("reproduces the sequence of the runtime's random() for the spec's seed, independently", () => {
    const positions = spawnPositions(SEED, POSITIONS.length);
    positions.forEach((position, index) => {
      expect(position.x, `x of crate ${String(index)}`).toBeCloseTo(POSITIONS[index]?.[0] ?? Number.NaN, 3);
      expect(position.z, `z of crate ${String(index)}`).toBeCloseTo(POSITIONS[index]?.[1] ?? Number.NaN, 3);
    });
    // Equal seeds give equal sequences, different seeds different ones, and every position is in the documented ranges.
    expect(spawnPositions(SEED, 20)).toEqual(spawnPositions(SEED, 20));
    expect(spawnPositions(SEED + 1, 6)).not.toEqual(spawnPositions(SEED, 6));
    for (const { x, z } of spawnPositions(7, 500)) {
      expect(Math.abs(x)).toBeLessThan(9);
      expect(Math.abs(z)).toBeLessThan(2.5);
    }
  });

  it("decides the fate of the spec's six crates and keeps them apart", () => {
    const positions = spawnPositions(SEED, POSITIONS.length);
    // Crate 0 at x = 5.96 overlaps the zone [2, 6]; 1 and 2 are further than 7.5 from the middle; 3 at x = -0.23 is left of the zone;
    // 4 at x = 2.55 is inside; 5 at x = -3.08 is on the floor, clear of First (x = -4.5) by 1.42.
    expect(positions.map(fate)).toEqual(["zone", "off", "off", "floor", "zone", "floor"]);
    expect(() => {
      assertSeparated(positions);
    }).not.toThrow();
  });

  it("refuses a position whose outcome is not certain", () => {
    expect(() => fate({ x: 7, z: 0 })).toThrow(/straddles the end of the floor/);
    expect(() => fate({ x: 1.45, z: 0 })).toThrow(/grazes the edge of the sensor zone/);
    expect(() => fate({ x: 0, z: 3.7 })).toThrow(/long edge/);
    expect(() => {
      assertSeparated([{ x: -4.0, z: 0.5 }]);
    }).toThrow(/rest on it/);
    expect(() => {
      assertSeparated([{ x: 3, z: 0 }, { x: 3.6, z: 1 }]);
    }).toThrow(/crate 0/);
    // A crate that misses the floor does not count against anything.
    expect(() => {
      assertSeparated([{ x: -8, z: 0 }, { x: -8, z: 0.2 }]);
    }).not.toThrow();
  });

  it("derives the times and heights by hand", () => {
    // g dt^2 = 9.81 / 3600 = 0.002725 m; 3 m needs n^2 / 2 + n / 8 >= 1100.9, which first holds at n = 47 (1104.5 + 5.9 against 1058 + 5.75 at 46).
    expect(fallTicks(3)).toBe(47);
    // 16 m (from y = 6 to the kill height) needs 5871.6: n = 109.
    expect(fallTicks(16)).toBe(109);
    // 10 N*s on 2 kg is 5 m/s: 5^2 / (2 * 9.81) = 1.2742 m, reached after 5 / 9.81 = 0.5097 s.
    expect(liftHeight(10, 2)).toBeCloseTo(1.2742, 4);
    expect(liftTime(10, 2)).toBeCloseTo(0.5097, 4);
  });

  it("finds the bounding box of a colour", () => {
    const width = 8;
    const height = 4;
    const pixels = new Uint8Array(width * height * 4);
    for (const [x, y] of [[1, 0], [6, 1], [3, 2]] as const) pixels.set([255, 208, 64, 255], (y * width + x) * 4);
    expect(colourExtent(pixels, width, height, [255, 208, 64], 3)).toEqual({ left: 1, right: 6, top: 0, bottom: 2 });
    expect(colourExtent(pixels, width, height, [253, 210, 66], 3)).toEqual({ left: 1, right: 6, top: 0, bottom: 2 });
    expect(colourExtent(pixels, width, height, [0, 0, 255], 3)).toBeNull();
  });

  it("projects points through the camera by hand-derived rules", () => {
    // The target is on the view axis: the middle column of any target.
    expect(projectColumn(CAMERA.target, 960, 480)).toBeCloseTo(480, 6);
    // The axis lies in the plane x = 0 and the point (1, 1.5, 0) is one unit to its right at the target's depth,
    // sqrt(6.5^2 + 17^2) = 18.2 along the axis: ndc = 1 / (18.2 * tan(0.4) * aspect 2).
    const depth = Math.hypot(6.5, 17);
    expect(projectColumn([1, 1.5, 0], 960, 480)).toBeCloseTo(480 + 480 / (depth * Math.tan(0.4) * 2), 6);
    expect(projectColumn([-1, 1.5, 0], 960, 480)).toBeCloseTo(480 - 480 / (depth * Math.tan(0.4) * 2), 6);
  });

  it("derives the meter's silhouette: left end fixed, half a unit more per entry", () => {
    expect(meterBox(0)).toEqual({ min: [-8, 5.8, -3.2], max: [-7.6, 6.2, -2.8] });
    expect(meterBox(2).max[0]).toBeCloseTo(-6.6, 12);
    const none = meterColumns(0, 960, 480);
    const two = meterColumns(2, 960, 480);
    expect(two.left).toBeCloseTo(none.left, 6);
    // One unit longer, at about 29 px per unit at the meter's depth of 19.4.
    expect(two.right - none.right).toBeGreaterThan(27);
    expect(two.right - none.right).toBeLessThan(31);
  });

  it("encodes a PNG that inflates back to the pixels", () => {
    const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    const png = Buffer.from(encodePng(2, 2, rgba));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    const idat = png.indexOf("IDAT");
    const length = png.readUInt32BE(idat - 4);
    const rows = inflateSync(png.subarray(idat + 4, idat + 4 + length));
    expect([...rows]).toEqual([0, 10, 20, 30, 40, 50, 60, 0, 70, 80, 90, 100, 110, 120]);
    expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");
  });
});
