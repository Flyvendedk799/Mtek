// What the M1 fixtures declare, transcribed for the CPU reference (support/m1-reference.ts). Defaults are
// the registry defaults of spec/stdlib.md section 3 and spec/scenes.md section 3 (camera projection
// `Perspective { fov_y: 0.9, near: 0.1, far: 1000.0 }`, entity rotation identity, scale 1, Sphere
// `radius 0.5, segments 32, rings 16`, Unlit `color #ffffff`, scene `clear_color #000000`). Every value
// that the source states is listed in `sourceLiterals`, and a unit test checks that each occurs in the
// fixture source, so this transcription cannot silently drift from the programs under test.
import { FIXTURE_A, FIXTURE_A_MOVED, FIXTURE_A_RENAMED, FIXTURE_B } from "./m1-fixtures.ts";
import { quatEuler, type Quat, type SceneSpec } from "./m1-reference.ts";

const IDENTITY: Quat = [0, 0, 0, 1];

/** Fixture A: a perspective camera looking at a target, one Box with an Unlit colour. */
export const SCENE_A: SceneSpec = {
  fixture: FIXTURE_A,
  renderTarget: { width: 128, height: 128 },
  clearColor: "#202830",
  camera: {
    position: [0, 2, 6],
    target: [0, 0.5, 0],
    projection: { kind: "perspective", fovY: 0.9, near: 0.1, far: 1000 },
  },
  entities: [
    {
      name: "Crate",
      parent: null,
      position: [0, 0.5, 0],
      rotation: IDENTITY,
      scale: [1, 1, 1],
      shape: { kind: "box", size: [1, 1, 1] },
      color: "#6b5cff",
    },
  ],
  sourceLiterals: [
    "clear_color: #202830;",
    "position: vec3(0.0, 2.0, 6.0);",
    "target: vec3(0.0, 0.5, 0.0);",
    "position: vec3(0.0, 0.5, 0.0);",
    "mesh: Box { size: vec3(1.0, 1.0, 1.0) };",
    "material: Unlit { color: #6b5cff };",
  ],
};

/** A-moved: A with the box at another `position` (right of and above the camera's target). */
export const SCENE_A_MOVED: SceneSpec = {
  ...SCENE_A,
  fixture: FIXTURE_A_MOVED,
  entities: SCENE_A.entities.map((entity) => ({ ...entity, position: [1.5, 1.25, 0] })),
  sourceLiterals: SCENE_A.sourceLiterals.map((literal) =>
    literal === "position: vec3(0.0, 0.5, 0.0);" ? "position: vec3(1.5, 1.25, 0.0);" : literal,
  ),
};

/** A-renamed: A with every declared name changed; it must render exactly as A. */
export const SCENE_A_RENAMED: SceneSpec = {
  ...SCENE_A,
  fixture: FIXTURE_A_RENAMED,
  entities: SCENE_A.entities.map((entity) => ({ ...entity, name: "Parcel" })),
  sourceLiterals: [...SCENE_A.sourceLiterals, "scene Showroom {", "camera Lens {", "entity Parcel {"],
};

const GROUND_SIZE = 20;

/**
 * Fixture B: an orthographic camera oriented by a rotation (looking straight down, screen-up = −Z), a Plane
 * with a nested Sphere of non-uniform scale, module constants, a Sphere with defaults. The target is wider
 * than tall (aspect 1.6), so the 20 × 20 plane leaves clear-colour bands on the left and the right.
 */
export const SCENE_B: SceneSpec = {
  fixture: FIXTURE_B,
  renderTarget: { width: 256, height: 160 },
  clearColor: "#000000",
  camera: {
    position: [0, 15, 0],
    rotation: quatEuler(-1.5707964, 0, 0),
    projection: { kind: "orthographic", height: GROUND_SIZE, near: 0.5, far: 40 },
  },
  entities: [
    {
      name: "Ground",
      parent: null,
      position: [0, 0, 0],
      rotation: IDENTITY,
      scale: [1, 1, 1],
      shape: { kind: "plane", size: [GROUND_SIZE, GROUND_SIZE] },
      color: "#3a5f3a",
    },
    {
      name: "Fountain",
      parent: 0,
      position: [0, 1, 0],
      rotation: IDENTITY,
      scale: [2, 0.5, 2],
      shape: { kind: "sphere", radius: 1, segments: 24, rings: 12 },
      color: "#ffcc00",
    },
    {
      name: "Lamp",
      parent: null,
      position: [4, 0.25, 4],
      rotation: IDENTITY,
      scale: [1, 1, 1],
      shape: { kind: "sphere", radius: 0.5, segments: 32, rings: 16 },
      color: "#ffffff",
    },
  ],
  sourceLiterals: [
    "const GROUND_SIZE: f32 = 20.0;",
    "const ACCENT = #ffcc00;",
    "position: vec3(0.0, 15.0, 0.0);",
    "rotation: quat.euler(-1.5707964, 0.0, 0.0);",
    "projection: Orthographic { height: GROUND_SIZE; near: 0.5; far: 40.0 };",
    "mesh: Plane { size: vec2(GROUND_SIZE, GROUND_SIZE) };",
    "material: Unlit { color: #3a5f3a };",
    "position: vec3(0.0, 1.0, 0.0);",
    "scale: vec3(2.0, 0.5, 2.0);",
    "mesh: Sphere { radius: 1.0; segments: 24; rings: 12 };",
    "material: Unlit { color: ACCENT };",
    "position: vec3(4.0, 0.25, 4.0);",
    "mesh: Sphere {};",
  ],
};
