// Decision 0218: the character movement example (`examples/character-movement`) for the browser spec
// `specs/movement/character.spec.ts`: how global setup builds it, and the model the spec compares the running
// program with. Nothing here calls the runtime. The geometry and the constants are read from the program's own
// source (and a unit test checks that the transcribed literals occur in it), so a spec that agrees with them has
// checked the engine, not repeated it.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const MOVEMENT_SRC = join(REPO_ROOT, "examples", "character-movement");
export const MOVEMENT_OUT = join(BROWSER_ROOT, ".out", "movement-example");
/** Served from the static server's root (`.out/`). */
export const MOVEMENT_URL = "/movement-example/index.html";

/** `mtek build --mode test` of the example into `.out/movement-example/`; a build that fails fails the whole run. */
export function buildMovementExample(cli: string): void {
  rmSync(MOVEMENT_OUT, { recursive: true, force: true });
  const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", MOVEMENT_OUT, MOVEMENT_SRC]);
  if (run.status !== 0 || !existsSync(join(MOVEMENT_OUT, "index.html"))) {
    throw new Error(`mtek build --mode test of examples/character-movement failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
  }
}

export function movementSource(): string {
  return readFileSync(join(MOVEMENT_SRC, "src", "main.mtek"), "utf8");
}

/** The value of `const NAME: f32 = <number>;` in the example's source. */
export function movementConstant(name: string, source: string = movementSource()): number {
  const match = new RegExp(`^const ${name}: f32 = (-?[0-9]+(?:\\.[0-9]+)?);$`, "m").exec(source);
  if (match?.[1] === undefined) throw new Error(`examples/character-movement/src/main.mtek has no \`const ${name}: f32 = <number>;\``);
  return Number(match[1]);
}

/**
 * The lines of the example the model below transcribes: the capsule, the stair blocks, the ledge, the walls, the
 * platform meshes and the key map. A unit test checks that each occurs in the source.
 */
export const MOVEMENT_SOURCE_LITERALS = [
  "collider: CapsuleCollider { radius: 0.3; height: 1.8; friction: 0.0 };",
  "body: Kinematic { max_slope: 0.7853982; step_height: 0.3; };",
  "position: vec3(4.2, 0.1, -9.0);",
  "mesh: Box { size: vec3(2.4, 1.2, 3.0) };",
  "position: vec3(4.0, 0.3, -3.0);",
  "mesh: Box { size: vec3(2.0, 0.6, 3.0) };",
  "position: vec3(26.25, 1.5, 0.0);",
  "mesh: Box { size: vec3(0.5, 3.0, 33.0) };",
  "position: vec3(-6.0, 0.95, 0.0);",
  "mesh: Box { size: vec3(3.0, 0.4, 3.0) };",
  "mesh: Box { size: vec3(5.0, 0.4, 2.0) };",
  "Player.body.teleport(vec3(0.0, 0.95, -9.0), quat.identity(), false);",
  "Player.body.teleport(Slider.position + vec3(0.0, 1.15, 0.0), quat.identity(), false);",
] as const;

// ---- the geometry, transcribed from the source (see MOVEMENT_SOURCE_LITERALS) -------------------------------------

/** `manifest.runtimeConfig.fixedStep`: a manual-clock frame of exactly this length is exactly one fixed tick. */
export const STEP = 0.016666668;
export const RADIUS = 0.3;
export const HEIGHT = 1.8;
/** The centre of the capsule rests this high above the surface it stands on: half the height plus the skin (0.01). */
export const REST_ABOVE_SURFACE = HEIGHT / 2 + 0.01;
export const SKIN = 0.01;
export const SPAWN = { x: -6, y: 0.95, z: 0 } as const;

export const STAIRS = { startX: 2, riser: 0.2, treads: 0.4, steps: 6, z: -9, landingFromX: 4, landingToX: 6.4 } as const;
export const LEDGE = { frontX: 3, height: 0.6, z: -3 } as const;
export const GENTLE = { angle: 0.5235988, startX: 2, length: 6, z: 3 } as const;
export const STEEP = { angle: 1.0471976, startX: 2, length: 4, z: 9 } as const;
export const WALL_EAST_INNER_X = 26;
export const WALL_SOUTH_INNER_Z = 16;
export const SLIDER = { x: 16, z: -9, range: 2.4, period: 10 } as const;
export const LIFT = { x: 16, z: 1.5, travel: 3, period: 12 } as const;
export const TURNTABLE = { x: 16, z: 9, speed: 0.5, radius: 1.5 } as const;
