// Execution test of the character movement shapes in the generated program module (spec/physics.md
// sections 2 and 3, spec/runtime-abi.md sections 4.2 and 5.2, decisions 0214 and 0217): the
// `movement` fixture's manifest data (capsule, character settings only when written, per-body
// continuous collision) and its handlers run against a fake context, with no browser. Every
// `ctx.body(target, spanId).moveCharacter(..)` and `.grounded` / `.groundNormal` names the call
// of the Mtek source it came from, which the tests resolve through the manifest.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFakeContext } from "./support/fake-ctx.js";
import { loadProgram, record } from "./support/programs.js";

type Fn = (...args: unknown[]) => unknown;

interface ManifestEntity {
  readonly symbol: string;
  readonly body: Readonly<Record<string, unknown>> | null;
  readonly collider: Readonly<Record<string, unknown>> | null;
}

interface MovementManifest {
  readonly spans: readonly { readonly start: number; readonly end: number }[];
  readonly scene: { readonly entities: readonly ManifestEntity[] };
  readonly prefabs: readonly { readonly name: string; readonly body: unknown; readonly collider: unknown }[];
}

const SOURCE = readFileSync(new URL("./movement/src/main.mtek", import.meta.url));

function sourceText(manifest: MovementManifest, span: number): string {
  const range = manifest.spans[span];
  if (range === undefined) throw new Error(`the manifest has no span ${String(span)}`);
  return SOURCE.subarray(range.start, range.end).toString("utf8");
}

async function movement(): Promise<{
  scene: Readonly<Record<string, unknown>>;
  prefab: Readonly<Record<string, unknown>>;
  manifest: MovementManifest;
}> {
  const program = await loadProgram("movement");
  const scenes = record(program.module["scenes"], "scenes");
  const prefabs = record(program.module["prefabs"], "prefabs");
  return {
    scene: record(scenes["Playground"], "scene"),
    prefab: record(prefabs["src/main.mtek::Walker"], "Walker"),
    manifest: program.manifest as unknown as MovementManifest,
  };
}

const HERO = 1;
const BARE = 2;
const PUCK = 4;

describe("the manifest of the movement program", () => {
  it("writes the character object only for the bodies whose program wrote a character field", async () => {
    const { manifest } = await movement();
    const bodies = manifest.scene.entities.map((e) => [e.symbol.split("::")[1], e.body]);
    expect(bodies).toEqual([
      ["Playground.Floor", { kind: "static" }],
      [
        "Playground.Hero",
        {
          kind: "kinematic",
          character: { maxSlope: 0.6, stepHeight: 0.3, stepMinWidth: 0.12, snapToGround: 0.25, skin: 0.02, carry: false },
        },
      ],
      // Nothing written: no object, the runtime applies the defaults.
      ["Playground.Bare", { kind: "kinematic" }],
      // One field written: all six are present, the other five with their defaults.
      [
        "Playground.Platform",
        {
          kind: "kinematic",
          character: { maxSlope: 0.7853982, stepHeight: 0.25, stepMinWidth: 0.1, snapToGround: 0.2, skin: 0.01, carry: true },
        },
      ],
      // `continuous` is listed only when true.
      ["Playground.Puck", { kind: "dynamic", mass: 0.1, linearDamping: 0, angularDamping: 0.05, continuous: true }],
    ]);
  });

  it("carries the capsule collider with the full height", async () => {
    const { manifest } = await movement();
    expect(manifest.scene.entities[HERO]?.collider).toEqual({ kind: "capsule", radius: 0.4, height: 1.8, sensor: false, friction: 0.1, restitution: 0 });
  });

  it("carries the body and collider of a prefab with a character", async () => {
    const { manifest } = await movement();
    expect(manifest.prefabs.map((p) => [p.name, p.body, p.collider])).toEqual([
      [
        "Walker",
        { kind: "kinematic", character: { maxSlope: 0.7853982, stepHeight: 0.25, stepMinWidth: 0.1, snapToGround: 0.2, skin: 0.05, carry: true } },
        { kind: "capsule", radius: 0.25, height: 1, sensor: true, friction: 0.5, restitution: 0 },
      ],
    ]);
  });
});

describe("the handlers of the movement program", () => {
  it("moves the character with the displacement and rotation it computed, and names the call in the source", async () => {
    const { scene, manifest } = await movement();
    const made = createFakeContext(5);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    const fixed = scene["entityFixedUpdate"] as (Fn | null)[];
    expect(fixed.map((fn) => fn !== null)).toEqual([false, true, false, false, false]);
    fixed[HERO]?.(ctx, ctx.e[HERO], 0.5);
    expect(made.bodyCalls.map((c) => ({ target: c.target, method: c.method, args: c.args }))).toEqual([
      { target: HERO, method: "moveCharacter", args: [{ x: 1, y: -0.5, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }] },
    ]);
    expect(made.bodyCalls.map((call) => sourceText(manifest, call.span))).toEqual([
      expect.stringMatching(/^self\.body\.move_character\(/),
    ]);
  });

  it("reads grounded and ground_normal from the body handle", async () => {
    const { scene } = await movement();
    const fixed = scene["entityFixedUpdate"] as (Fn | null)[];
    const made = createFakeContext(5);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    ctx.s["landed"] = false;
    ctx.s["steepness"] = 0;
    fixed[HERO]?.(ctx, ctx.e[HERO], 1 / 60);
    // Not grounded: the branch is not taken.
    expect([ctx.s["landed"], ctx.s["steepness"]]).toEqual([false, 0]);
    made.grounds.set(HERO, { grounded: true, normal: { x: 0, y: 0.75, z: 0.5 } });
    fixed[HERO]?.(ctx, ctx.e[HERO], 1 / 60);
    expect([ctx.s["landed"], ctx.s["steepness"]]).toEqual([true, 0.75]);
  });

  it("moves a named entity from a scene handler and an entity_ref from a collision handler", async () => {
    const { scene } = await movement();
    const made = createFakeContext(5);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    const events = record(scene["events"], "events") as Record<string, { key?: string; owner: unknown; fn: Fn }[]>;
    const space = events["key_down"]?.find((h) => h.key === "Space");
    space?.fn(ctx, ctx.e[BARE]);
    const other = Object.freeze({ slot: 9, gen: 1 });
    events["collision_enter"]?.find((h) => h.owner === PUCK)?.fn(ctx, ctx.e[PUCK], other);
    expect(made.bodyCalls.map((c) => [c.target, c.method, c.args])).toEqual([
      [BARE, "moveCharacter", [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0, w: 1 }]],
      [other, "moveCharacter", [{ x: 0, y: 0, z: Math.fround(0.1) }, { x: 0, y: 0, z: 0, w: 1 }]],
    ]);
  });

  it("a prefab moves itself with its own rotation", async () => {
    const { prefab } = await movement();
    const made = createFakeContext(2);
    const ctx = { ...made.ctx, frame: { time: 0 } };
    (prefab["fixedUpdate"] as Fn)(ctx, ctx.e[1], 0.5);
    expect(made.bodyCalls.map((c) => [c.target, c.method])).toEqual([[1, "moveCharacter"]]);
    expect(made.bodyCalls[0]?.args[0]).toEqual({ x: 0, y: -1, z: 0 });
  });
});
