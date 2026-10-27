// Decision 0224: the composable-animation example (`examples/animation-composition`) for the browser spec
// `specs/animation-composition/*.spec.ts`: how global setup builds it, and the numbers the spec shares with the program.
// The constants are read from the program's own source (a unit test finds the transcribed literals in it), so a spec that
// agrees with them has checked the engine, not repeated it.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const ANIMATION_SRC = join(REPO_ROOT, "examples", "animation-composition");
export const ANIMATION_OUT = join(BROWSER_ROOT, ".out", "animation-example");
/** Served from the static server's root (`.out/`). */
export const ANIMATION_URL = "/animation-example/index.html";

/** `mtek build --mode test` of the example into `.out/animation-example/`; a build that fails fails the whole run. */
export function buildAnimationExample(cli: string): void {
  rmSync(ANIMATION_OUT, { recursive: true, force: true });
  const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", ANIMATION_OUT, ANIMATION_SRC]);
  if (run.status !== 0 || !existsSync(join(ANIMATION_OUT, "index.html"))) {
    throw new Error(`mtek build --mode test of examples/animation-composition failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
  }
}

export function animationSource(): string {
  return readFileSync(join(ANIMATION_SRC, "src", "main.mtek"), "utf8");
}

/** The value of `const NAME: f32 = <number>;` in the example's source. */
export function animationConstant(name: string, source: string = animationSource()): number {
  const match = new RegExp(`^const ${name}: f32 = (-?[0-9]+(?:\\.[0-9]+)?);$`, "m").exec(source);
  if (match?.[1] === undefined) throw new Error(`examples/animation-composition/src/main.mtek has no \`const ${name}: f32 = <number>;\``);
  return Number(match[1]);
}

/** The lines of the example the spec's model transcribes: the sample layout of the blend space and the station teleports. */
export const ANIMATION_SOURCE_LITERALS = [
  'animation.blend_sample(Model, "Idle", 0.0, 0.0);',
  'animation.blend_sample(Model, "Walk", 0.0, 1.0);',
  'animation.blend_sample(Model, "Run", 0.0, 2.0);',
  'animation.blend_sample(Model, "StrafeLeft", -1.0, 0.0);',
  'animation.blend_sample(Model, "StrafeRight", 1.0, 0.0);',
  'animation.set_layer(Model, "wave", "Wave", 0.0, false, "Spine1");',
  'animation.root_motion(Model, "Root");',
  'animation.chain_goal(Model, "tail", "Tail4", 4, tip, 1.0);',
  'animation.limb_goal(Model, "left_arm", goal, reach);',
  "Hero.body.teleport(vec3(0.03, 0.2 + FIGURE_BASE, 1.0), quat.identity(), false);",
  "Hero.body.teleport(vec3(0.0, 0.3 + FIGURE_BASE, 6.0), quat.identity(), false);",
  "position: vec3(0.36, 1.25, -7.7);",
  "position: vec3(2.6, 0.0, 1.5);",
  "rotation: quat.axis_angle(vec3(0.0, 1.0, 0.0), -1.2);",
  "projection: Perspective { fov_y: 0.8; near: 0.1; far: 120.0 };",
  "Main.position = Hero.position + facing * vec3(0.0, 1.6, -4.0);",
  "Main.target = Hero.position + vec3(0.0, 0.3, 0.0);",
  "let tip = origin + rot * vec3(0.3 * sin(frame.time * 2.5), 0.75, -0.5);",
] as const;
