// The M5-01 fixture stays what the browser spec claims: the CPU reference's transcription of the scene
// (support/m5-scenes.ts) matches its source, the hand-derived clock value is the one the runtime reaches, and
// the fixture list is exactly the one fixture.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { M5_FIXTURES_DIR, PREFAB_INSTANCES, SPAWN_RING, m5FixtureNames } from "./m5-fixtures.ts";
import { CLIMBER_AT, CLIMBER_FRAMES, CLIMBER_STEP, CLIMBER_TIME, SHOWROOM } from "./m5-scenes.ts";

describe("M5 browser fixtures", () => {
  it("are exactly the prefab instances fixture and the spawn ring", () => {
    expect(m5FixtureNames()).toEqual([PREFAB_INSTANCES, SPAWN_RING]);
  });

  it("the transcription of the showroom occurs in its source", () => {
    const source = readFileSync(join(M5_FIXTURES_DIR, PREFAB_INSTANCES, "src", "main.mtek"), "utf8");
    for (const literal of SHOWROOM.sourceLiterals) expect(source, literal).toContain(literal);
  });

  it("names the instances in the order of the scene", () => {
    const source = readFileSync(join(M5_FIXTURES_DIR, PREFAB_INSTANCES, "src", "main.mtek"), "utf8");
    const declared = [...source.matchAll(/^\s*entity (\w+): \w+/gm)].map((match) => match[1]);
    expect(SHOWROOM.entities.map((entity) => entity.name)).toEqual(declared);
  });

  it("derives the climber's position from the clock the runtime reaches", () => {
    // Ten frames of 0.1 s accumulate to 0.9999999999999999 in binary64 and read as 1.0 in binary32.
    let clock = 0;
    for (let frame = 0; frame < CLIMBER_FRAMES; frame += 1) clock += CLIMBER_STEP;
    expect(clock).toBe(0.9999999999999999);
    expect(Math.fround(clock)).toBe(1);
    expect(CLIMBER_TIME).toBe(1);
    expect(CLIMBER_AT).toEqual([0, 1.5, -3]);
  });
});
