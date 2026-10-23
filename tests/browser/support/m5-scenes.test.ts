// The M5-01 fixture stays what the browser spec claims: the CPU reference's transcription of the scene
// (support/m5-scenes.ts) matches its source, the hand-derived clock value is the one the runtime reaches, and
// the fixture list is exactly the one fixture.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { M5_FIXTURES_DIR, PHYSICS_CALLBACKS, PHYSICS_COMBOS, PHYSICS_DROP, PHYSICS_SENSOR, PHYSICS_TUNNEL, PHYSICS_WAVES, PREFAB_INSTANCES, SPAWN_RING, m5FixtureNames } from "./m5-fixtures.ts";
import { CLIMBER_AT, CLIMBER_FRAMES, CLIMBER_STEP, CLIMBER_TIME, SHOWROOM } from "./m5-scenes.ts";

describe("M5 browser fixtures", () => {
  it("are exactly the physics fixtures, the prefab instances fixture and the spawn ring", () => {
    expect(m5FixtureNames()).toEqual([PHYSICS_CALLBACKS, PHYSICS_COMBOS, PHYSICS_DROP, PHYSICS_SENSOR, PHYSICS_TUNNEL, PHYSICS_WAVES, PREFAB_INSTANCES, SPAWN_RING]);
  });

  it("the numbers the M5-06 physics specs derive by hand occur in their fixtures' sources", () => {
    const source = (fixture: string): string => readFileSync(join(M5_FIXTURES_DIR, fixture, "src", "main.mtek"), "utf8");
    const expectLiterals = (fixture: string, literals: readonly string[]): void => {
      for (const literal of literals) expect(source(fixture), `${fixture}: ${literal}`).toContain(literal);
    };
    // physics-sensor.spec.ts: a zone from y = 3 to 5, balls of radius 0.25 dropped from 9 or thrown at 12 and 8.5 m/s, a ledge top at y = 4.
    expectLiterals(PHYSICS_SENSOR, [
      "position: vec3(0.0, 4.0, 0.0);",
      "collider: BoxCollider { size: vec3(12.0, 2.0, 2.0); sensor: true; };",
      "position: vec3(4.0, 3.5, 0.0);",
      "collider: BoxCollider { size: vec3(1.0, 1.0, 1.0); };",
      "position: vec3(-4.0, 9.0, 0.0);",
      "position: vec3(-1.5, 0.25, 0.0);",
      "position: vec3(1.5, 0.25, 0.0);",
      "position: vec3(4.0, 9.0, 0.0);",
      "B.body.set_linear_velocity(vec3(0.0, 12.0, 0.0));",
      "C.body.set_linear_velocity(vec3(0.0, 8.5, 0.0));",
    ]);
    expect([...source(PHYSICS_SENSOR).matchAll(/collider: SphereCollider \{ radius: 0\.25; \};/g)]).toHaveLength(4);
    // physics-tunnelling.spec.ts: a 0.1 m wall at x = 5, balls of radius 0.05, no gravity, 17 lanes in each of the two groups.
    expectLiterals(PHYSICS_TUNNEL, [
      "gravity: vec3(0.0, 0.0, 0.0);",
      "position: vec3(5.0, 0.0, 24.0);",
      "collider: BoxCollider { size: vec3(0.1, 2.0, 60.0); };",
      "collider: SphereCollider { radius: 0.05; };",
      "collider: BoxCollider { size: vec3(0.1, 2.0, 2.0); };",
      "body: Dynamic { mass: 10000.0; };",
    ]);
    const lanes = (group: string): string[] => [...source(PHYSICS_TUNNEL).matchAll(new RegExp(`entity ${group}\\d\\d: Shot \\{ lane: [\\d.]+; x0: ([\\d.]+); speed: ([\\d.]+); \\}`, "g"))].map((match) => `${String(match[1])}@${String(match[2])}`);
    expect(lanes("S")).toHaveLength(17);
    expect(lanes("D"), "the dynamic group repeats the lane table of the static group").toEqual(lanes("S"));
    // physics-callbacks.spec.ts and physics-combinations.spec.ts: balls start at x = 2 with 5 m/s towards a wall whose face is at 4.9.
    for (const fixture of [PHYSICS_CALLBACKS, PHYSICS_COMBOS]) {
      expectLiterals(fixture, ["gravity: vec3(0.0, 0.0, 0.0);", "position: vec3(2.0, 0.0, lane);", "self.body.set_linear_velocity(vec3(5.0, 0.0, 0.0));", "mesh: Box { size: vec3(0.2, 2.0, 8.0); };"]);
    }
    expectLiterals(PHYSICS_CALLBACKS, ["speed: 4.0; });", "speed: -4.0; });", "x0: 8.0;", "state mark_kind: i32 = kind;"]);
    expectLiterals(PHYSICS_COMBOS, ["Ball.body.set_linear_velocity(vec3(3.0, 0.0, 0.0));", "Ball.body.set_linear_velocity(vec3(0.0, 0.0, 3.0));", "self.body.set_linear_velocity(vec3(6.0, 0.0, 0.0));", "position: vec3(0.0, 0.0, -20.0);"]);
    // physics-resources.spec.ts: waves of 50 (Space) and 100 (D) crates that live 90 ticks, three tints, a floor of 24 x 1 x 8.
    expectLiterals(PHYSICS_WAVES, ["for i in 0..50 {", "for i in 0..100 {", "life: 90;", "collider: BoxCollider { size: vec3(24.0, 1.0, 8.0); };"]);
  });

  it("the numbers the physics spec derives by hand occur in the physics drop's source", () => {
    // Rest height 0.5 (floor top y = 0, unit cube), impulse 8 N*s on 2 kg, a drop from 3 m: see specs/m5/physics.spec.ts.
    const source = readFileSync(join(M5_FIXTURES_DIR, PHYSICS_DROP, "src", "main.mtek"), "utf8");
    for (const literal of [
      "position: vec3(0.0, -0.5, 0.0);",
      "mesh: Box { size: vec3(20.0, 1.0, 20.0); };",
      "position: vec3(0.0, 3.0, 0.0);",
      "mesh: Box { size: vec3(1.0, 1.0, 1.0); };",
      "body: Dynamic { mass: 2.0; };",
      "body: Static {};",
      "self.body.apply_impulse(vec3(0.0, 8.0, 0.0));",
    ]) {
      expect(source, literal).toContain(literal);
    }
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
