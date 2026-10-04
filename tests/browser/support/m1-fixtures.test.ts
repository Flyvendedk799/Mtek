// The M1 fixtures stay what the gate claims they are: A and B are the semantic pass fixtures of M1-11
// byte for byte, A-moved differs from A only in the entity's position, A-renamed only in the declared
// names, and the CPU reference's transcription of each scene (support/m1-scenes.ts) matches its source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_A,
  FIXTURE_A_MOVED,
  FIXTURE_A_RENAMED,
  FIXTURE_B,
  M1_FIXTURES_DIR,
  SEMANTIC_COPIES,
  SEMANTIC_PASS_DIR,
  m1FixtureNames,
} from "./m1-fixtures.ts";
import { SCENE_A, SCENE_A_MOVED, SCENE_A_RENAMED, SCENE_B } from "./m1-scenes.ts";

function fixtureFile(name: string, file: string): string {
  return readFileSync(join(M1_FIXTURES_DIR, name, file), "utf8");
}

/** The lines of `b` that differ from `a`, by position (both must have the same number of lines). */
function changedLines(a: string, b: string): Array<{ line: number; from: string; to: string }> {
  const left = a.split("\n");
  const right = b.split("\n");
  expect(right).toHaveLength(left.length);
  return left.flatMap((from, index) => {
    const to = right[index] ?? "";
    return from === to ? [] : [{ line: index + 1, from, to }];
  });
}

describe("M1 browser fixtures", () => {
  it("are exactly A, B, A-moved and A-renamed", () => {
    expect(m1FixtureNames()).toEqual([FIXTURE_A_MOVED, FIXTURE_A_RENAMED, FIXTURE_A, FIXTURE_B].sort());
  });

  for (const name of SEMANTIC_COPIES) {
    it(`${name} is a byte-identical copy of tests/semantics/pass/${name}`, () => {
      for (const file of ["mtek.toml", join("src", "main.mtek")]) {
        expect(readFileSync(join(M1_FIXTURES_DIR, name, file)), file).toEqual(readFileSync(join(SEMANTIC_PASS_DIR, name, file)));
      }
    });
  }

  it("A-moved differs from A only in the entity's position", () => {
    expect(fixtureFile(FIXTURE_A_MOVED, "mtek.toml")).toBe(fixtureFile(FIXTURE_A, "mtek.toml"));
    const changes = changedLines(fixtureFile(FIXTURE_A, "src/main.mtek"), fixtureFile(FIXTURE_A_MOVED, "src/main.mtek"));
    expect(changes).toEqual([
      { line: 10, from: "        position: vec3(0.0, 0.5, 0.0);", to: "        position: vec3(1.5, 1.25, 0.0);" },
    ]);
  });

  it("A-renamed differs from A only in the scene, camera and entity names", () => {
    expect(fixtureFile(FIXTURE_A_RENAMED, "mtek.toml")).toBe(fixtureFile(FIXTURE_A, "mtek.toml"));
    const changes = changedLines(fixtureFile(FIXTURE_A, "src/main.mtek"), fixtureFile(FIXTURE_A_RENAMED, "src/main.mtek"));
    expect(changes.map(({ from, to }) => [from.trim(), to.trim()])).toEqual([
      ["scene Gallery {", "scene Showroom {"],
      ["camera Main {", "camera Lens {"],
      ["entity Crate {", "entity Parcel {"],
    ]);
  });

  for (const scene of [SCENE_A, SCENE_A_MOVED, SCENE_A_RENAMED, SCENE_B]) {
    it(`the CPU reference's description of ${scene.fixture} matches its source`, () => {
      const source = fixtureFile(scene.fixture, "src/main.mtek");
      for (const literal of scene.sourceLiterals) expect(source, literal).toContain(literal);
      // One entity declaration per described entity, and nothing else that draws.
      expect(source.match(/^\s*entity \w+ \{/gm)?.length).toBe(scene.entities.length);
      expect(source.match(/mesh:/g)?.length).toBe(scene.entities.length);
    });
  }
});
