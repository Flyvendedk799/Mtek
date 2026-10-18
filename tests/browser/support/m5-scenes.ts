// What the M5-01 fixture declares, transcribed for the CPU reference (support/m1-reference.ts): each
// instance of a prefab with the entity its params make of it. The expectations are hand-derived from the
// prefab's params (`Cube`: `position: origin`, `scale: vec3(edge, edge, edge)`, `Unlit { color: tint }`;
// `Riser`: `position: bind(base + vec3(0.0, frame.time, 0.0))`), not read back from the compiler. Every
// value the source states is listed in `sourceLiterals`, and a unit test checks that each occurs in the
// fixture source, so this transcription cannot silently drift from the program under test.
import { type SceneSpec, type Vec3 } from "./m1-reference.ts";
import { PREFAB_INSTANCES } from "./m5-fixtures.ts";

const IDENTITY = [0, 0, 0, 1] as const;

/** The clock when the frame is read back: ten frames of 0.1 s. */
export const CLIMBER_FRAMES = 10;
export const CLIMBER_STEP = 0.1;
/** `frame.time` after those frames, in binary32. */
export const CLIMBER_TIME = Math.fround(CLIMBER_FRAMES * CLIMBER_STEP);

const BOX = { kind: "box", size: [1, 1, 1] } as const;

/** The Climber's world position when the frame is read back: `base + vec3(0.0, frame.time, 0.0)`. */
export const CLIMBER_BASE: Vec3 = [0, 0.5, -3];
export const CLIMBER_AT: Vec3 = [CLIMBER_BASE[0], Math.fround(CLIMBER_BASE[1] + CLIMBER_TIME), CLIMBER_BASE[2]];

/** The showroom after `CLIMBER_FRAMES` frames of `CLIMBER_STEP`. */
export const SHOWROOM: SceneSpec = {
  fixture: PREFAB_INSTANCES,
  renderTarget: { width: 384, height: 256 },
  clearColor: "#202830",
  camera: {
    position: [0, 3, 9],
    target: [0, 1, 0],
    projection: { kind: "perspective", fovY: 0.9, near: 0.1, far: 1000 },
  },
  entities: [
    // entity Left: Cube { origin: vec3(-3.0, 0.5, 0.0); tint: #ff4040; }
    { name: "Left", parent: null, position: [-3, 0.5, 0], rotation: IDENTITY, scale: [1, 1, 1], shape: BOX, color: "#ff4040" },
    // entity Middle: Cube {}: the defaults of the params
    { name: "Middle", parent: null, position: [0, 0.5, 0], rotation: IDENTITY, scale: [1, 1, 1], shape: BOX, color: "#6b5cff" },
    // entity Right: Cube { origin: vec3(3.0, 1.0, 0.0); tint: #40d060; edge: 2.0; }
    { name: "Right", parent: null, position: [3, 1, 0], rotation: IDENTITY, scale: [2, 2, 2], shape: BOX, color: "#40d060" },
    // entity Climber: Riser { base: vec3(0.0, 0.5, -3.0); }, after the clock has run
    {
      name: "Climber",
      parent: null,
      position: CLIMBER_AT,
      rotation: IDENTITY,
      scale: [1, 1, 1],
      shape: { kind: "sphere", radius: 0.5, segments: 32, rings: 16 },
      color: "#ffcc00",
    },
  ],
  sourceLiterals: [
    "param origin: vec3 = vec3(0.0, 0.5, 0.0);",
    "param tint: color = #6b5cff;",
    "param edge: f32 = 1.0;",
    "scale: vec3(edge, edge, edge);",
    "material: Unlit { color: tint; };",
    "param base: vec3 = vec3(0.0, 0.5, 0.0);",
    "param tint: color = #ffcc00;",
    "position: bind(base + vec3(0.0, frame.time, 0.0));",
    "mesh: Sphere { radius: 0.5; segments: 32; rings: 16; };",
    "clear_color: #202830;",
    "position: vec3(0.0, 3.0, 9.0);",
    "target: vec3(0.0, 1.0, 0.0);",
    "entity Left: Cube { origin: vec3(-3.0, 0.5, 0.0); tint: #ff4040; }",
    "entity Middle: Cube {}",
    "entity Right: Cube { origin: vec3(3.0, 1.0, 0.0); tint: #40d060; edge: 2.0; }",
    "entity Climber: Riser { base: vec3(0.0, 0.5, -3.0); }",
  ],
};

// ---- the spawn_ring fixture (M5-02, decision 0064) ----
//
// Orthographic camera at (0, 0, 10) looking at the origin, view height 10, on a 320 x 160 target: 16 pixels per unit,
// the world origin at pixel (160, 80), y up. A `Block` with `column` c sits at x = 2 * c - 7 (a unit box facing the
// camera covers 16 x 16 pixels around ((x + 10) * 16, 80)); press n of Space spawns the block of column n % 8 with the
// colour PALETTE[n % 3] (the `if presses % 3` chain of the program), after destroying the block of the same column.

export const RING_TARGET = { width: 320, height: 160 } as const;
export const RING_SIZE = 8;
export const RING_CLEAR = "#202830";
/** The colours the program gives press n: `#ff4040`, then `#40d060` when n % 3 == 1, `#4080ff` when n % 3 == 2. */
export const PALETTE = ["#ff4040", "#40d060", "#4080ff"] as const;
/** The named `Marker` at (-9, 4): pixel (16, 16). */
export const RING_MARKER = { x: 16, y: 16 } as const;

/** The pixel at the centre of the block of `column`. */
export function blockCentre(column: number): { x: number; y: number } {
  return { x: (2 * column - 7 + 10) * 16, y: 80 };
}

/** The index into PALETTE of press `n`. */
export function blockColourIndex(n: number): number {
  return n % 3;
}

/** The last press `n` (`since <= n < presses`) that went into `column` (`n % 8 == column`), or `undefined`. */
export function ringColumn(presses: number, column: number, since = 0): number | undefined {
  for (let n = presses - 1; n >= since; n -= 1) {
    if (n % RING_SIZE === column) return n;
  }
  return undefined;
}

/** Everything the program states that the transcription above relies on; each must occur in the fixture source. */
export const RING_SOURCE_LITERALS: readonly string[] = [
  "clear_color: #202830;",
  "position: vec3(f32(column) * 2.0 - 7.0, 0.0, 0.0);",
  "mesh: Box { size: vec3(1.0, 1.0, 1.0); };",
  "position: vec3(0.0, 0.0, 10.0);",
  "target: vec3(0.0, 0.0, 0.0);",
  "projection: Orthographic { height: 10.0; near: 0.1; far: 100.0; };",
  "position: vec3(-9.0, 4.0, 0.0);",
  "material: Unlit { color: #ffffff; };",
  "let slot = presses % 8;",
  "var tint: color = #ff4040;",
  "if presses % 3 == 1 {",
  "tint = #40d060;",
  "tint = #4080ff;",
  "ring[slot] = spawn(Block { column: slot; tint: tint; });",
];
