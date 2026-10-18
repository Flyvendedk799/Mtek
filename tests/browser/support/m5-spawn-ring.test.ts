// The M5-02 fixture stays what the browser spec claims: the transcription of the spawn ring (support/m5-scenes.ts)
// occurs in its source, and the arithmetic it relies on (columns, pixels, colours) is what the spec text says.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { M5_FIXTURES_DIR, SPAWN_RING } from "./m5-fixtures.ts";
import { PALETTE, RING_SIZE, RING_SOURCE_LITERALS, blockCentre, blockColourIndex, ringColumn } from "./m5-scenes.ts";

describe("the spawn ring transcription (M5-02)", () => {
  it("occurs in the fixture source", () => {
    const source = readFileSync(join(M5_FIXTURES_DIR, SPAWN_RING, "src", "main.mtek"), "utf8");
    for (const literal of RING_SOURCE_LITERALS) expect(source, literal).toContain(literal);
  });

  it("places the blocks of the eight columns 32 pixels apart, from pixel 48", () => {
    expect(Array.from({ length: RING_SIZE }, (_, column) => blockCentre(column))).toEqual([48, 80, 112, 144, 176, 208, 240, 272].map((x) => ({ x, y: 80 })));
  });

  it("derives which press owns a column and its colour", () => {
    // After 8 presses press n owns column n; after 11 presses columns 0..2 belong to presses 8..10, the others to 3..7.
    expect(Array.from({ length: RING_SIZE }, (_, column) => ringColumn(8, column))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Array.from({ length: RING_SIZE }, (_, column) => ringColumn(11, column))).toEqual([8, 9, 10, 3, 4, 5, 6, 7]);
    // A cleared ring: only the presses since the clear count.
    expect(Array.from({ length: RING_SIZE }, (_, column) => ringColumn(11, column, 8))).toEqual([8, 9, 10, undefined, undefined, undefined, undefined, undefined]);
    // Press n has the colour of n % 3: red, green, blue, red, ...
    expect([0, 1, 2, 3, 4, 5, 200, 201, 202].map((n) => PALETTE[blockColourIndex(n)])).toEqual(["#ff4040", "#40d060", "#4080ff", "#ff4040", "#40d060", "#4080ff", "#4080ff", "#ff4040", "#40d060"]);
    // After 208 presses the live blocks are presses 200..207, in columns 0..7.
    expect(Array.from({ length: RING_SIZE }, (_, column) => ringColumn(208, column))).toEqual([200, 201, 202, 203, 204, 205, 206, 207]);
  });
});
