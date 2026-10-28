// Execution test of the animation composition calls in generated code (decision 0223): the pass fixture
// `animation_composition` is built, and its handlers run against a fake context. Every command that can
// report (`E8110` to `E8113`) gets the span of its call as the last argument, which the manifest resolves to the
// source text; the others do not; the entity is passed as its reference, vectors as `{x, y, z}` records.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { record } from "./support/programs.js";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(import.meta.dirname, ".out/animation-composition");
const SOURCE = readFileSync(resolve(root, "tests/semantics/pass/animation_composition/src/main.mtek"));

interface Scene {
  init(ctx: object): void;
  update(ctx: object, dt: number): void;
  events: { key_down: { fn(ctx: object, self: unknown): void }[] };
}
let scene: Scene;
let spans: readonly { start: number; end: number }[];

beforeAll(async () => {
  execFileSync("cargo", ["run", "--quiet", "--locked", "-p", "mtek-cli", "--", "build", "--out", out, "tests/semantics/pass/animation_composition"], { cwd: root, stdio: "pipe" });
  const module = record(await import(/* @vite-ignore */ pathToFileURL(resolve(out, "app.js")).href), "program");
  scene = record(module["scenes"], "scenes")["Demo"] as Scene;
  spans = (JSON.parse(readFileSync(resolve(out, "program.manifest.json"), "utf8")) as { spans: { start: number; end: number }[] }).spans;
}, 120_000);

const text = (span: number): string => SOURCE.subarray(spans[span]!.start, spans[span]!.end).toString("utf8");
const V = (x: number, y: number, z: number) => ({ x, y, z });
const f = Math.fround;

it("passes the entity, the arguments and, where a command can report, the span of the call", () => {
  const rig = { slot: 0, gen: 0 }, hero = { slot: 1, gen: 0 };
  const calls: unknown[][] = [];
  const s: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    e: [{ ref: rig, rotation: { x: 0, y: 0, z: 0, w: 1 } }, { ref: hero, rotation: { x: 0, y: 1, z: 0, w: 0 } }],
    s,
    setCamera: () => undefined, setTransform: () => undefined, setVisible: () => undefined,
  };
  for (const name of ["SetLayer", "FadeLayer", "RemoveLayer", "BlendSample", "BlendPlay", "BlendParameter", "BlendClear", "LimbGoal", "ClearLimb",
    "FootPlacement", "ClearFootPlacement", "ChainGoal", "ClearChain", "RootMotion"]) {
    ctx["animation" + name] = (...args: unknown[]) => { calls.push([name, ...args]); return true; };
  }
  const reads: unknown[][] = [];
  ctx["animationAnimatedJointPosition"] = (target: unknown, name: string) => { reads.push([target, name]); return V(0, f(0.9), 0); };
  ctx["animationBlendPhase"] = (target: unknown) => { expect(target).toBe(rig); return 0.25; };
  ctx["animationTakeRootMotion"] = (target: unknown) => (target === rig ? V(1, 2, 3) : V(0, 0, f(0.5)));
  const moves: unknown[][] = [];
  ctx["body"] = (target: unknown, span: number) => ({ moveCharacter: (...args: unknown[]) => { moves.push([target, span, ...args]); } });
  scene.init(ctx);
  scene.events.key_down[0]?.fn(ctx, undefined);

  // The read of the animated pose takes the entity and the joint, no span, and its value reaches the state.
  expect(reads).toEqual([[rig, "Hips"]]);
  expect(s["travel"]).toEqual(V(0, f(0.9), 0));

  // Reporting commands end with a span id; the others do not.
  const shaped = calls.map((call) => {
    const reporting = !["RemoveLayer", "BlendParameter", "BlendClear", "ClearFootPlacement", "ClearChain"].includes(call[0] as string);
    const span = reporting ? (call.at(-1) as number) : undefined;
    return { name: call[0], args: call.slice(1, reporting ? -1 : undefined), text: span === undefined ? undefined : text(span) };
  });
  expect(shaped.map((c) => c.name)).toEqual(["SetLayer", "SetLayer", "FadeLayer", "RemoveLayer", "BlendSample", "BlendSample", "BlendSample", "BlendPlay", "BlendParameter",
    "BlendClear", "LimbGoal", "ClearLimb", "FootPlacement", "ClearFootPlacement", "ChainGoal", "ClearChain", "RootMotion"]);
  expect(shaped.map((c) => c.args)).toEqual([
    [rig, "wave", "Wave", 1, false, "Spine"], [rig, "breath", "Breathe", f(0.4), true, ""], [rig, "wave", 0, f(0.3)], [rig, "breath"],
    [rig, "Idle", 0, 0], [rig, "Walk", 1, 0], [rig, "Strafe", 0, 1], [rig, true, 1], [rig, 0.5, 0.25], [rig],
    [rig, "left_leg", V(0, f(0.1), 0.5), 1], [rig, "left_leg"],
    [rig, V(f(0.1), 0, 0), V(f(-0.1), f(0.2), 0), V(0, 1, 0), V(0, 1, 0), 1, 0], [rig],
    [rig, "reach", "Hand", 3, V(1, 1, 0), f(0.8)], [rig, "reach"], [rig, "Hips"],
  ]);
  // The span of a reporting command is its own call in the source.
  for (const call of shaped) if (call.text !== undefined) expect(call.text, String(call.name)).toMatch(new RegExp(`^animation\\.${String(call.name).replace(/[A-Z]/g, (c, i) => (i === 0 ? c.toLowerCase() : "_" + c.toLowerCase()))}\\(`));

  // Reads and root motion feeding a character mover.
  scene.update(ctx, 1 / 60);
  expect(s["phase"]).toBe(0.25);
  expect(s["applied"]).toBe(true);
  expect(s["travel"]).toEqual(V(1, 2, 3));
  expect(moves).toHaveLength(1);
  expect((moves[0]![0] as { ref: unknown }).ref).toBe(hero);
  expect(text(moves[0]![1] as number)).toMatch(/^Hero\.body\.move_character\(animation\.take_root_motion\(Hero\), Hero\.rotation\)$/);
  expect(moves[0]!.slice(2)).toEqual([V(0, 0, 0.5), { x: 0, y: 1, z: 0, w: 0 }]);
  // The fade in update names its own call too.
  const fades = calls.filter((c) => c[0] === "FadeLayer");
  expect(fades).toHaveLength(2);
  expect(text(fades[1]!.at(-1) as number)).toMatch(/^animation\.fade_layer\(Rig, "wave", 1\.0, dt\)$/);
});
