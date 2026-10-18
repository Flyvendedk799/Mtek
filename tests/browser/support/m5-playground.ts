// M5-07: the physics playground (`examples/physics-playground`, decision 0069) for the browser spec
// `specs/m5/playground.spec.ts`: how global setup builds the example, and the independent model the spec compares the
// running program with. Nothing here calls the runtime: the expected numbers come from the program's own constants
// (read from its source) and from the geometry it declares, so a spec that agrees with them has checked the engine, not
// repeated it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";

export const PLAYGROUND_SRC = join(REPO_ROOT, "examples", "physics-playground");
export const PLAYGROUND_OUT = join(BROWSER_ROOT, ".out", "m5-playground");
/** Served from the static server's root (`.out/`). */
export const PLAYGROUND_URL = "/m5-playground/index.html";

/** `mtek build --mode test` of the example into `.out/m5-playground/`; a build that fails fails the whole run. */
export function buildPlayground(cli: string): void {
  rmSync(PLAYGROUND_OUT, { recursive: true, force: true });
  const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", PLAYGROUND_OUT, PLAYGROUND_SRC]);
  if (run.status !== 0 || !existsSync(join(PLAYGROUND_OUT, "index.html"))) {
    throw new Error(`mtek build --mode test of examples/physics-playground failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
  }
}

export function playgroundSource(): string {
  return readFileSync(join(PLAYGROUND_SRC, "src", "main.mtek"), "utf8");
}

/** The value of `const NAME: f32 = <number>;` in the example's source. */
export function exampleConstant(name: string, source: string = playgroundSource()): number {
  const match = new RegExp(`^const ${name}: f32 = (-?[0-9]+(?:\\.[0-9]+)?);$`, "m").exec(source);
  if (match?.[1] === undefined) throw new Error(`examples/physics-playground/src/main.mtek has no \`const ${name}: f32 = <number>;\``);
  return Number(match[1]);
}

/**
 * The lines of the example the model below transcribes (the geometry of the floor, the zone and `First`, the mass of a
 * crate, the spawn expression, the camera and the meter). A unit test checks that each occurs in the source, so
 * the model cannot drift from the program unnoticed.
 */
export const PLAYGROUND_SOURCE_LITERALS = [
  "mesh: Box { size: vec3(14.0, 1.0, 8.0) };",
  "body: Dynamic { mass: 2.0 };",
  "origin: vec3(-4.5, 0.5, 0.0);",
  "position: vec3(4.0, 1.5, 0.0);",
  "collider: BoxCollider { size: vec3(4.0, 2.0, 6.0); sensor: true };",
  "let x = (random() * 2.0 - 1.0) * SPAWN_RANGE_X;",
  "let z = (random() * 2.0 - 1.0) * SPAWN_RANGE_Z;",
  "spawn(Crate { origin: vec3(x, SPAWN_HEIGHT, z) });",
  "position: vec3(0.0, 8.0, 17.0);",
  "target: vec3(0.0, 1.5, 0.0);",
  "projection: Perspective { fov_y: 0.8; near: 0.1; far: 100.0 };",
  "position: bind(vec3(-8.0 + (0.4 + 0.5 * f32(entered)) * 0.5, 6.0, -3.0));",
  "scale: bind(vec3(0.4 + 0.5 * f32(entered), 0.4, 0.4));",
] as const;

// ---- the geometry of the scene, transcribed from the source (see PLAYGROUND_SOURCE_LITERALS) ----------------------

export const GRAVITY = 9.81;
/** `manifest.runtimeConfig.fixedStep`: a manual-clock frame of exactly this length is exactly one fixed tick. */
export const STEP = 0.016666668;
/** The floor is 14 x 1 x 8 with its top face at y = 0, centred on the origin. */
export const FLOOR_HALF = { x: 7, z: 4 } as const;
/** A crate is a unit cube of 2 kg. */
export const CRATE_HALF = 0.5;
export const CRATE_MASS = 2;
/** The sensor zone is a 4 x 2 x 6 box centred at (4, 1.5, 0): x in [2, 6], y in [0.5, 2.5], z in [-3, 3]. */
export const ZONE = { centre: { x: 4, y: 1.5, z: 0 }, half: { x: 2, y: 1, z: 3 } } as const;
/** `First`: a crate of the same prefab, resting at x = -4.5, z = 0. */
export const FIRST = { x: -4.5, z: 0 } as const;
/** The rest height of a crate on the floor: the top face of the floor plus half a crate. */
export const REST_Y = CRATE_HALF;
/** How far from a decision boundary a spawn position must lie for the spec to call its outcome certain. */
export const MARGIN = 0.1;

// ---- seeded positions ---------------------------------------------------------------------------------------------

/** xoshiro128** seeded through splitmix32, written from the reference algorithms (spec/stdlib.md `random`); every operation of the program is binary32. */
export class Xoshiro128StarStar {
  private readonly s = new Uint32Array(4);

  constructor(seed: number) {
    let x = seed >>> 0;
    for (let i = 0; i < 4; i += 1) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
  }

  private get(i: number): number {
    return this.s[i] ?? 0;
  }

  private nextU32(): number {
    const rotl = (value: number, k: number): number => ((value << k) | (value >>> (32 - k))) >>> 0;
    const result = Math.imul(rotl(Math.imul(this.get(1), 5) >>> 0, 7), 9) >>> 0;
    const t = (this.get(1) << 9) >>> 0;
    this.s[2] = this.get(2) ^ this.get(0);
    this.s[3] = this.get(3) ^ this.get(1);
    this.s[1] = this.get(1) ^ this.get(2);
    this.s[0] = this.get(0) ^ this.get(3);
    this.s[2] = this.get(2) ^ t;
    this.s[3] = rotl(this.get(3), 11);
    return result;
  }

  /** `random()`: the top 24 bits of the next output over 2^24, an f32 in [0, 1). */
  nextF32(): number {
    return (this.nextU32() >>> 8) / 16_777_216;
  }
}

export interface Spawn {
  readonly x: number;
  readonly z: number;
}

/**
 * The first `count` positions the C key of the example spawns at, in order: `x = (random() * 2.0 - 1.0) * SPAWN_RANGE_X`,
 * then `z` likewise, every operation rounded to binary32 like the generated code.
 */
export function spawnPositions(seed: number, count: number, source: string = playgroundSource()): Spawn[] {
  const rangeX = exampleConstant("SPAWN_RANGE_X", source);
  const rangeZ = exampleConstant("SPAWN_RANGE_Z", source);
  const random = new Xoshiro128StarStar(seed);
  const f = Math.fround;
  const scatter = (range: number): number => f(f(f(random.nextF32() * 2) - 1) * f(range));
  const out: Spawn[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = scatter(rangeX);
    const z = scatter(rangeZ);
    out.push({ x, z });
  }
  return out;
}

// ---- what becomes of a crate --------------------------------------------------------------------------------------

/** `zone`: rests on the floor inside the sensor zone. `floor`: rests on the floor outside it. `off`: misses the floor and is destroyed. */
export type Fate = "zone" | "floor" | "off";

/**
 * The fate of a crate dropped straight down at `spawn`, which the geometry decides: a crate whose whole footprint is over
 * the floor rests on it; one whose footprint is clear of the floor falls past it; the zone is entered by any crate whose
 * footprint overlaps it. A spawn within `MARGIN` of a decision boundary has no certain fate and is refused, so a seed that
 * makes the spec's expectations ambiguous fails loudly instead of flaking.
 */
export function fate(spawn: Spawn): Fate {
  const { x, z } = spawn;
  if (Math.abs(z) + CRATE_HALF + MARGIN > FLOOR_HALF.z) throw new Error(`a crate at z = ${String(z)} is too close to the long edge of the floor`);
  const over = Math.abs(x) + CRATE_HALF;
  if (over > FLOOR_HALF.x - MARGIN && over < FLOOR_HALF.x + 2 * CRATE_HALF + MARGIN) {
    throw new Error(`a crate at x = ${String(x)} straddles the end of the floor: its fate is not certain`);
  }
  if (over >= FLOOR_HALF.x + 2 * CRATE_HALF + MARGIN) return "off";
  const reach = ZONE.half.x + CRATE_HALF;
  const distance = Math.abs(x - ZONE.centre.x);
  if (Math.abs(distance - reach) < MARGIN) throw new Error(`a crate at x = ${String(x)} grazes the edge of the sensor zone: whether it enters is not certain`);
  return distance < reach ? "zone" : "floor";
}

/** Whether a crate that rests on the floor at `spawn` stays clear of `First` and of every earlier resting crate (so nothing lands on anything). */
export function assertSeparated(spawns: readonly Spawn[]): void {
  const resting: Array<{ label: string; x: number; z: number }> = [{ label: "First", ...FIRST }];
  spawns.forEach((spawn, index) => {
    if (fate(spawn) === "off") return;
    for (const other of resting) {
      const gap = Math.max(Math.abs(spawn.x - other.x), Math.abs(spawn.z - other.z));
      if (gap < 2 * CRATE_HALF + 0.3) throw new Error(`crate ${String(index)} lands within ${gap.toFixed(3)} of ${other.label}: it would rest on it`);
    }
    resting.push({ label: `crate ${String(index)}`, x: spawn.x, z: spawn.z });
  });
}

// ---- time ---------------------------------------------------------------------------------------------------------

/**
 * Fixed ticks until a body released from rest has fallen `distance`, by the engine's substepped model (decision 0063:
 * four substeps of semi-implicit Euler per step, so after n steps it has fallen g dt^2 (n^2 / 2 + n / 8)).
 */
export function fallTicks(distance: number): number {
  let n = 0;
  while (fallDistance(n) < distance) n += 1;
  return n;
}

/** The distance a body released from rest has fallen after `ticks` fixed steps (the model of `fallTicks`). */
export function fallDistance(ticks: number): number {
  return GRAVITY * STEP * STEP * ((ticks * ticks) / 2 + ticks / 8);
}

/** How high an impulse lifts a body of `mass` that starts at rest in free flight: v = J / m, rise = v^2 / (2 g). */
export function liftHeight(impulse: number, mass: number): number {
  const v = impulse / mass;
  return (v * v) / (2 * GRAVITY);
}

/** The apex of that flight, in seconds. */
export function liftTime(impulse: number, mass: number): number {
  return impulse / mass / GRAVITY;
}

// ---- pixels -------------------------------------------------------------------------------------------------------

export interface PixelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The bounding box, in pixels (inclusive), of every pixel within `tolerance` of `rgb` on every channel; null when there is none. */
export function colourExtent(pixels: Uint8Array, width: number, height: number, rgb: readonly [number, number, number], tolerance: number): PixelBox | null {
  let box: PixelBox | null = null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      if (![0, 1, 2].every((c) => Math.abs((pixels[at + c] ?? 0) - (rgb[c] ?? 0)) <= tolerance)) continue;
      box = box === null ? { left: x, right: x, top: y, bottom: y } : { left: Math.min(box.left, x), right: Math.max(box.right, x), top: Math.min(box.top, y), bottom: Math.max(box.bottom, y) };
    }
  }
  return box;
}

// ---- the camera and the meter -------------------------------------------------------------------------------------

/** `camera Main` of the example: position, target and the vertical field of view (a pinhole looking along `target - position`, y up). */
export const CAMERA = { position: [0, 8, 17], target: [0, 1.5, 0], fovY: 0.8 } as const;

type Vector = readonly [number, number, number];
const sub = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalise = (a: Vector): Vector => {
  const length = Math.sqrt(dot(a, a));
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** The pixel column of a world point seen by `CAMERA` in a `width` x `height` target (column 0 is the left edge of the image). */
export function projectColumn(point: Vector, width: number, height: number): number {
  const forward = normalise(sub(CAMERA.target, CAMERA.position));
  const right = normalise(cross(forward, [0, 1, 0]));
  const v = sub(point, CAMERA.position);
  const depth = dot(v, forward);
  const ndcX = dot(v, right) / (depth * Math.tan(CAMERA.fovY / 2) * (width / height));
  return (ndcX * 0.5 + 0.5) * width;
}

/** The meter's `bind` expressions (see PLAYGROUND_SOURCE_LITERALS): a box 0.4 + 0.5 n long, 0.4 high and deep, its left end at x = -8, centred at y = 6, z = -3. */
export function meterBox(entered: number): { min: Vector; max: Vector } {
  const length = 0.4 + 0.5 * entered;
  const centre = -8 + length * 0.5;
  return { min: [centre - length / 2, 5.8, -3.2], max: [centre + length / 2, 6.2, -2.8] };
}

/** The columns the meter's silhouette spans after `entered` entries: the extremes of its eight projected corners. */
export function meterColumns(entered: number, width: number, height: number): { left: number; right: number } {
  const { min, max } = meterBox(entered);
  const columns: number[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) columns.push(projectColumn([x, y, z], width, height));
    }
  }
  return { left: Math.min(...columns), right: Math.max(...columns) };
}

/** A PNG (8-bit RGB, the alpha channel dropped) of an RGBA readback, for the evidence directory. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = row + 1 + x * 3;
      rows[to] = rgba[from] ?? 0;
      rows[to + 1] = rgba[from + 1] ?? 0;
      rows[to + 2] = rgba[from + 2] ?? 0;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** Writes a file into the results directory of the run (`MTEK_RESULTS_DIR`), where the evidence is collected from. */
export function writeResult(name: string, content: string | Uint8Array): void {
  const dir = process.env["MTEK_RESULTS_DIR"];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}
