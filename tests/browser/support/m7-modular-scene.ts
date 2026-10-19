// M7-01: the modular scene (`examples/modular-scene`, decision 0002) for the browser spec `specs/m7/modular-scene.spec.ts` and
// for the derived numbers of its `mtek test` fixtures (`mtek-test/example-fixtures.test.ts`): how global setup builds the
// example, and an independent model of what its scene shows.
//
// Nothing here calls the runtime. The model is written from the program's source (the geometry of the floor, the pillars,
// the beacons and the gauge; the formulas of the beacons' bob and pulse; the row that P places) and is handed to the CPU
// reference of `m1-reference.ts` (analytic ray casts, its own view and projection matrices, the sRGB transfer functions), so
// a spec that agrees with it has checked the compiler's module handling and the runtime, not repeated them.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";
import { linearToSrgb8, srgbToLinear, type SceneSpec, type Vec3 } from "./m1-reference.ts";

export const MODULAR_SRC = join(REPO_ROOT, "examples", "modular-scene");
export const MODULAR_OUT = join(BROWSER_ROOT, ".out", "m7-modular-scene");
/** Served from the static server's root (`.out/`). */
export const MODULAR_URL = "/m7-modular-scene/index.html";

/** `mtek build --mode test` of the example into `.out/m7-modular-scene/`; a build that fails fails the whole run. */
export function buildModularScene(cli: string): void {
  rmSync(MODULAR_OUT, { recursive: true, force: true });
  const run = runCli(cli, ["build", "--mode", "test", "--format", "json", "--out", MODULAR_OUT, MODULAR_SRC]);
  if (run.status !== 0 || !existsSync(join(MODULAR_OUT, "index.html"))) {
    throw new Error(`mtek build --mode test of examples/modular-scene failed (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
  }
}

/** The text of one of the example's modules, `relative` to `examples/modular-scene/`. */
export function modularSource(relative: string): string {
  return readFileSync(join(MODULAR_SRC, relative), "utf8");
}

/** The modules of the example, in the order the compiler loads them (depth first from the entry, imports in source order). */
export const MODULAR_MODULES = ["src/main.mtek", "src/theme.mtek", "src/materials.mtek", "src/props/pillar.mtek", "src/props/beacon.mtek"] as const;

/** The value of `export const NAME: <type> = <number>;` in `src/theme.mtek`. */
export function themeNumber(name: string): number {
  const match = new RegExp(`^export const ${name}: (?:f32|i32) = (-?[0-9]+(?:\\.[0-9]+)?);$`, "m").exec(modularSource("src/theme.mtek"));
  if (match?.[1] === undefined) throw new Error(`examples/modular-scene/src/theme.mtek has no \`export const ${name}: <number type> = <number>;\``);
  return Number(match[1]);
}

/** The value of `export const NAME: color = #rrggbb;` in `src/theme.mtek`. */
export function themeColour(name: string): string {
  const match = new RegExp(`^export const ${name}: color = (#[0-9a-f]{6});$`, "m").exec(modularSource("src/theme.mtek"));
  if (match?.[1] === undefined) throw new Error(`examples/modular-scene/src/theme.mtek has no \`export const ${name}: color = #rrggbb;\``);
  return match[1];
}

/** Lines of the example's sources that the model below transcribes; a unit test checks that each occurs in its file. */
export const MODULAR_SOURCE_LITERALS: ReadonlyArray<{ file: (typeof MODULAR_MODULES)[number]; text: string }> = [
  { file: "src/main.mtek", text: "position: vec3(0.0, 3.5, 14.0);" },
  { file: "src/main.mtek", text: "target: vec3(0.0, 1.2, 0.0);" },
  { file: "src/main.mtek", text: "projection: Perspective { fov_y: 0.9; near: 0.1; far: 100.0 };" },
  { file: "src/main.mtek", text: "position: vec3(0.0, -0.05, -1.0);" },
  { file: "src/main.mtek", text: "mesh: Box { size: vec3(16.0, 0.1, 8.0) };" },
  { file: "src/main.mtek", text: "material: Matte { tint: SLATE };" },
  { file: "src/main.mtek", text: "entity Left: Pillar {" },
  { file: "src/main.mtek", text: "origin: vec3(-3.6, 0.0, 0.0);" },
  { file: "src/main.mtek", text: "origin: vec3(-1.2, 0.0, 0.0);" },
  { file: "src/main.mtek", text: "height: 3.0;" },
  { file: "src/main.mtek", text: "tint: GOLD;" },
  { file: "src/main.mtek", text: "origin: vec3(1.2, 0.0, 0.0);" },
  { file: "src/main.mtek", text: "height: 1.2;" },
  { file: "src/main.mtek", text: "width: 1.2;" },
  { file: "src/main.mtek", text: "tint: TEAL;" },
  { file: "src/main.mtek", text: "origin: vec3(-3.6, 3.4, 0.0);" },
  { file: "src/main.mtek", text: "rate: 1.0;" },
  { file: "src/main.mtek", text: "origin: vec3(3.6, 3.0, 0.0);" },
  { file: "src/main.mtek", text: "tint: ROSE;" },
  { file: "src/main.mtek", text: "position: bind(vec3(5.4, (0.2 + 0.5 * f32(Lantern.flashes + Lamp.flashes)) * 0.5, 1.5));" },
  { file: "src/main.mtek", text: "scale: bind(vec3(0.6, 0.2 + 0.5 * f32(Lantern.flashes + Lamp.flashes), 0.6));" },
  { file: "src/main.mtek", text: "material: Matte { tint: STONE };" },
  { file: "src/main.mtek", text: "if placed < MAX_PLACED {" },
  { file: "src/main.mtek", text: "if placed % 2 == 1 {" },
  { file: "src/main.mtek", text: "origin: vec3(PLACE_X0 + PLACE_STEP * f32(placed), 0.0, PLACE_Z);" },
  { file: "src/main.mtek", text: "height: PLACE_BASE_HEIGHT + PLACE_RISE * f32(placed);" },
  { file: "src/props/pillar.mtek", text: "param height: f32 = 2.0;" },
  { file: "src/props/pillar.mtek", text: "position: origin + vec3(0.0, half(height), 0.0);" },
  { file: "src/props/pillar.mtek", text: "scale: vec3(width, height, width);" },
  { file: "src/props/pillar.mtek", text: "material: Matte { tint: tint };" },
  { file: "src/props/beacon.mtek", text: "param rate: f32 = 2.0;" },
  { file: "src/props/beacon.mtek", text: "position: bind(origin + vec3(0.0, 0.25 * sin(rate * frame.time), 0.0));" },
  { file: "src/props/beacon.mtek", text: "mesh: Sphere { radius: 0.4; segments: 32; rings: 16 };" },
  { file: "src/props/beacon.mtek", text: "material: Matte { tint: tint; dim: bind(0.75 + 0.25 * sin(rate * frame.time)) };" },
  { file: "src/materials.mtek", text: "return color.linear(tint.rgb * dim, tint.a);" },
  { file: "src/theme.mtek", text: "export fn half(h: f32) -> f32 {" },
];

// ---- colours ---------------------------------------------------------------------------------------------------------

const hexBytes = (hex: string): [number, number, number] => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];

/** `Matte` returns `tint.rgb * dim` as a linear colour: the `#rrggbb` that an sRGB target holds for it. */
export function shade(tint: string, dim: number): string {
  const bytes = hexBytes(tint).map((channel) => linearToSrgb8(srgbToLinear(channel / 255) * dim));
  return `#${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// ---- the scene ---------------------------------------------------------------------------------------------------------

const IDENTITY = [0, 0, 0, 1] as const;
const BOX = { kind: "box", size: [1, 1, 1] } as const;

/** What the program has been through: the clock, the presses of Space and the pillars placed by P. */
export interface ShowroomState {
  /** `frame.time` of the last frame, seconds. */
  readonly time: number;
  /** Presses of Space: each makes both beacons count one flash. */
  readonly presses: number;
  /** Pillars placed by P (0 to MAX_PLACED). */
  readonly placed: number;
}

export const REST: ShowroomState = { time: 0, presses: 0, placed: 0 };

/** A beacon: a sphere bobbing by `0.25 sin(rate t)` around `origin`, coloured `tint * (0.75 + 0.25 sin(rate t))`. */
export function beacon(origin: Vec3, rate: number, time: number): { position: Vec3; dim: number } {
  const wave = Math.sin(Math.fround(rate * Math.fround(time)));
  return { position: [origin[0], origin[1] + 0.25 * wave, origin[2]], dim: 0.75 + 0.25 * wave };
}

/** The gauge's length: 0.2 plus half a metre for each of the flashes counted by the two beacons (two per press). */
export function gaugeLength(presses: number): number {
  return 0.2 + 0.5 * (2 * presses);
}

/** The scale and the centre of the pillar that the program makes of `origin`, `height`, `width`: half its height above `origin`. */
export function pillar(origin: Vec3, height: number, width: number): { position: Vec3; scale: Vec3 } {
  return { position: [origin[0], origin[1] + height * 0.5, origin[2]], scale: [width, height, width] };
}

/** The pillar that press number `n` of P places: `{ origin: vec3(PLACE_X0 + PLACE_STEP n, 0, PLACE_Z), height: 1 + 0.5 n, tint: n odd ? ROSE : TEAL }`. */
export function placedPillar(n: number): { origin: Vec3; height: number; tint: string } {
  return {
    origin: [themeNumber("PLACE_X0") + themeNumber("PLACE_STEP") * n, 0, themeNumber("PLACE_Z")],
    height: themeNumber("PLACE_BASE_HEIGHT") + themeNumber("PLACE_RISE") * n,
    tint: n % 2 === 1 ? themeColour("ROSE") : themeColour("TEAL"),
  };
}

/** The showroom as the CPU reference sees it, for a target of the given size. */
export function showroom(state: ShowroomState, renderTarget: { width: number; height: number }): SceneSpec {
  const stone = themeColour("STONE");
  const gold = themeColour("GOLD");
  const teal = themeColour("TEAL");
  const rose = themeColour("ROSE");
  const width = themeNumber("PILLAR_WIDTH");
  const solid = (name: string, p: { position: Vec3; scale: Vec3 }, color: string): SceneSpec["entities"][number] => ({
    name,
    parent: null,
    position: p.position,
    rotation: IDENTITY,
    scale: p.scale,
    shape: BOX,
    color,
  });
  const lantern = beacon([-3.6, 3.4, 0], 1, state.time);
  const lamp = beacon([3.6, 3.0, 0], 2, state.time);
  const length = gaugeLength(state.presses);
  const sphere = { kind: "sphere", radius: 0.4, segments: 32, rings: 16 } as const;
  const entities: SceneSpec["entities"][number][] = [
    {
      name: "Floor",
      parent: null,
      position: [0, -0.05, -1],
      rotation: IDENTITY,
      scale: [1, 1, 1],
      shape: { kind: "box", size: [16, 0.1, 8] },
      color: themeColour("SLATE"),
    },
    // entity Left: Pillar { origin: vec3(-3.6, 0.0, 0.0); }: every default (height 2, PILLAR_WIDTH, STONE)
    solid("Left", pillar([-3.6, 0, 0], 2, width), stone),
    // entity Middle: Pillar { origin: vec3(-1.2, 0.0, 0.0); height: 3.0; tint: GOLD; }
    solid("Middle", pillar([-1.2, 0, 0], 3, width), gold),
    // entity Right: Pillar { origin: vec3(1.2, 0.0, 0.0); height: 1.2; width: 1.2; tint: TEAL; }
    solid("Right", pillar([1.2, 0, 0], 1.2, 1.2), teal),
    { name: "Lantern", parent: null, position: lantern.position, rotation: IDENTITY, scale: [1, 1, 1], shape: sphere, color: shade(gold, lantern.dim) },
    { name: "Lamp", parent: null, position: lamp.position, rotation: IDENTITY, scale: [1, 1, 1], shape: sphere, color: shade(rose, lamp.dim) },
    solid("Gauge", { position: [5.4, length / 2, 1.5], scale: [0.6, length, 0.6] }, stone),
  ];
  for (let n = 0; n < state.placed; n += 1) {
    const placed = placedPillar(n);
    entities.push(solid(`Placed${String(n)}`, pillar(placed.origin, placed.height, width), placed.tint));
  }
  return {
    fixture: "modular-scene",
    renderTarget,
    clearColor: themeColour("CLEAR"),
    camera: { position: [0, 3.5, 14], target: [0, 1.2, 0], projection: { kind: "perspective", fovY: 0.9, near: 0.1, far: 100 } },
    entities,
    sourceLiterals: MODULAR_SOURCE_LITERALS.map((literal) => literal.text),
  };
}
