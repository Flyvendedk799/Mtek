import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { record } from "./support/programs.js";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(import.meta.dirname, ".out/animation-controls");
interface Scene {
  init(ctx: object): void;
  update(ctx: object, dt: number): void;
  events: { key_down: { fn(ctx: object, self: unknown): void }[] };
}
let scene: Scene;
beforeAll(async () => {
  execFileSync("cargo", ["run", "--quiet", "--locked", "-p", "mtek-cli", "--", "build", "--out", out, "tests/semantics/pass/animation_controls"], { cwd: root, stdio: "pipe" });
  const module = record(await import(/* @vite-ignore */ pathToFileURL(resolve(out, "app.js")).href), "program");
  scene = record(module["scenes"], "scenes")["Demo"] as Scene;
}, 120_000);

it("emits native animation calls with entity references and preserves query results", () => {
  const ref = { slot: 0, gen: 0 };
  const calls: unknown[][] = [];
  const s: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    e: [{ ref }], s,
    setCamera: () => undefined, setTransform: () => undefined, setVisible: () => undefined,
  };
  for (const name of ["Play", "Pause", "Seek", "Fade", "Resume", "Transition", "CopyPose"]) {
    ctx["animation" + name] = (...args: unknown[]) => { calls.push([name, ...args]); return true; };
  }
  for (const [name, result] of Object.entries({ Time: 0.3, Duration: 1, Weight: 0.5, Playing: true, Finished: false, Crossed: true, JointPosition: { x: 1, y: 2, z: 3 }, JointRotation: { x: 0, y: 0, z: 0, w: 1 } })) {
    ctx["animation" + name] = (target: unknown, marker?: number) => {
      expect(target).toBe(ref);
      if (name === "Crossed") expect(marker).toBeCloseTo(0.2);
      return result;
    };
  }
  scene.init(ctx);
  scene.events.key_down[0]?.fn(ctx, undefined);
  expect(calls).toEqual([
    ["Play", ref, false, 2], ["Pause", ref], ["Seek", ref, 0.25],
    ["Fade", ref, 0.5, Math.fround(0.1)], ["Resume", ref], ["CopyPose", ref, ref], ["Transition", ref, "idle", Math.fround(.2), true, 1],
  ]);
  scene.update(ctx, 1 / 60);
  expect(s).toEqual({ elapsed: 0.3, duration: 1, weight: 0.5, playing: true, finished: false, impact: true, socket: { x: 1, y: 2, z: 3 }, turn: { x: 0, y: 0, z: 0, w: 1 } });
});
