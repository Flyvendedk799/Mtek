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
