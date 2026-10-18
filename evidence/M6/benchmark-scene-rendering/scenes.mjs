// The scenes of the benchmark tasks scene-rendering-02 .. -10, transcribed from the PROMPTS in the
// task.toml files (not from any reference solution), in the vocabulary of oracle.mjs.
//
//   entity: { name, parent?, position?, rotation? (quaternion [x, y, z, w]), scale?, mesh?, material?, visible? }
//   mesh:   { box: [sx, sy, sz] } | { sphere: radius, segments: 32, rings: 16 } | { plane: [sx, sz] }
//   material: { unlit: "#rrggbb" } | { pbr: { base, metallic, roughness } }
//   light:  { directional: [travel direction], intensity, color? } | { point: [x, y, z], intensity, color? }
//
// `rotZ(a)` is a counter-clockwise rotation by `a` radians about +Z (right-handed).
import { axisAngle } from "./oracle.mjs";

const rotZ = (angle) => axisAngle([0, 0, 1], angle);
const sphere = (radius) => ({ sphere: radius, segments: 32, rings: 16 });
const unlit = (hex) => ({ unlit: hex });
const pbr = (base, roughness, metallic = 0) => ({ pbr: { base, roughness, metallic } });

export const scenes = {
  "scene-rendering-02": {
    clear: "#101820",
    camera: { position: [0, 0, 8], target: [0, 0, 0], fovY: 0.8 },
    entities: [
      // cos(0.9272952) = 0.6, sin(0.9272952) = 0.8: the bar's local +x end face centre is at (1.2, 1.6, 0).
      { name: "Bar", mesh: { box: [4, 1, 0.5] }, rotation: rotZ(0.9272952), material: unlit("#f59e0b") },
      { name: "Tip", position: [1.2, 1.6, 0], mesh: sphere(0.6), material: unlit("#ef4444") },
    ],
  },

  "scene-rendering-03": {
    clear: "#14161c",
    camera: { position: [0, 0, 9], target: [0, 0, 0], fovY: 0.8 },
    entities: [
      { name: "Base", position: [-2.5, -1.5, 0], mesh: { box: [1.2, 1.2, 1.2] }, material: unlit("#64748b") },
      { name: "Arm", position: [-2.5, -1.5, 0], rotation: rotZ(0.6435011) },
      { name: "Upper", parent: "Arm", position: [2, 0, 0], mesh: { box: [4, 0.8, 0.6] }, material: unlit("#3b82f6") },
      { name: "Elbow", parent: "Arm", position: [4, 0, 0], rotation: rotZ(-1.287002), scale: [0.75, 0.75, 0.75] },
      { name: "Fore", parent: "Elbow", position: [1.5, 0, 0], mesh: { box: [3, 0.7, 0.5] }, material: unlit("#22c55e") },
      { name: "Hand", parent: "Elbow", position: [3, 0, 0], mesh: sphere(0.6), material: unlit("#f43f5e") },
    ],
  },

  "scene-rendering-04": {
    clear: "#9db4cc",
    camera: { position: [5, 4, 9], target: [0, 1, 0], fovY: 0.7 },
    entities: [
      { name: "Floor", mesh: { plane: [12, 12] }, material: unlit("#4b5563") },
      { name: "Block", position: [1.5, 0.5, 1.8], mesh: { box: [2, 1, 2] }, material: unlit("#dc2626") },
      { name: "Tower", position: [0, 1.5, 0], mesh: { box: [1.5, 3, 1.5] }, material: unlit("#2563eb") },
      { name: "Ball", position: [-1.6, 0.8, 1.2], mesh: sphere(0.8), material: unlit("#eab308") },
    ],
  },

  "scene-rendering-05": {
    clear: "#1a1d23",
    camera: { position: [0, 6, 6], target: [0, 0, 0], orthoHeight: 8, near: 0.1, far: 100 },
    entities: [
      { name: "Floor", mesh: { plane: [7, 7] }, material: unlit("#3f4a5a") },
      { name: "Crate", position: [2, 0.75, -1], mesh: { box: [1.5, 1.5, 1.5] }, material: unlit("#f97316") },
      { name: "Dome", position: [-1.5, 0, 1], mesh: sphere(1.2), material: unlit("#38bdf8") },
    ],
  },

  "scene-rendering-06": {
    clear: "#0b0d12",
    camera: { position: [2.5, 2.5, 5], target: [0, 0, 0], fovY: 0.9 },
    ambient: { color: "#ffffff", intensity: 0.1 / Math.PI },
    lights: [{ directional: [0, -0.6, -0.8], intensity: 1 }],
    entities: [
      { name: "Floor", position: [0, -1, 0], mesh: { plane: [10, 10] }, material: pbr("#8a929c", 0.9) },
      { name: "Cube", mesh: { box: [2, 2, 2] }, material: pbr("#c8a27a", 0.8) },
    ],
  },

  "scene-rendering-07": {
    clear: "#10131a",
    camera: { position: [0, 3, 8], target: [0, 0.5, 0], fovY: 0.8 },
    ambient: { color: "#ffffff", intensity: 0.05 / Math.PI },
    lights: [{ point: [1.5, 3, 2.5], intensity: 9 }],
    entities: [
      { name: "Floor", mesh: { plane: [14, 14] }, material: pbr("#9aa5b1", 0.9) },
      { name: "Ball", position: [0, 1, 0], mesh: sphere(1), material: pbr("#e11d48", 0.7) },
    ],
  },

  "scene-rendering-08": {
    clear: "#0f172a",
    camera: { position: [0, 2.5, 14], target: [0, 1.5, 0], fovY: 0.8 },
    entities: [
      { name: "Column1", position: [-4, 0.5, 0], mesh: { box: [1.2, 1, 1.2] }, material: unlit("#ef4444") },
      { name: "Column2", position: [-2, 1, 0], mesh: { box: [1.2, 2, 1.2] }, material: unlit("#f59e0b") },
      { name: "Column3", position: [0, 1.5, 0], mesh: { box: [1.2, 3, 1.2] }, material: unlit("#22c55e") },
      { name: "Column4", position: [2, 1, 0], mesh: { box: [1.2, 2, 1.2] }, material: unlit("#3b82f6") },
      { name: "Column5", position: [4, 0.5, 0], mesh: { box: [1.2, 1, 1.2] }, material: unlit("#a855f7") },
    ],
  },

  "scene-rendering-09": {
    clear: "#1e293b",
    camera: { position: [0, 0, 10], target: [0, 0, 0], fovY: 0.9, near: 4, far: 12 },
    entities: [
      { name: "Mid", mesh: { box: [2, 2, 2] }, material: unlit("#ef4444") },
      { name: "Slab", position: [-2.5, 0, 5.5], mesh: { box: [2, 2, 2] }, material: unlit("#22c55e") },
      { name: "Far", position: [3.2, 0, -4], mesh: { box: [3, 3, 3] }, material: unlit("#3b82f6") },
      { name: "Behind", position: [0, 0, 14], mesh: { box: [2, 2, 2] }, material: unlit("#ec4899") },
      { name: "Ghost", position: [3, 0, 2], visible: false, mesh: { box: [2, 2, 2] }, material: unlit("#facc15") },
      { name: "Rim", position: [3.2, -2.2, 0], mesh: { box: [2, 2, 5] }, material: unlit("#a855f7") },
    ],
  },

  "scene-rendering-10": {
    clear: "#0a0a0f",
    camera: { position: [0, 3, 9], target: [0, 0.5, 0], fovY: 0.8 },
    ambient: { color: "#6070a0", intensity: 0.1 / Math.PI },
    lights: [
      { point: [-3, 2.5, 2], color: "#ff3030", intensity: 9 },
      { point: [3, 2.5, 2], color: "#3050ff", intensity: 9 },
    ],
    entities: [
      { name: "Floor", mesh: { plane: [12, 12] }, material: pbr("#e5e7eb", 0.9) },
      { name: "Ball", position: [0, 1, 0], mesh: sphere(1), material: pbr("#f3f4f6", 0.7) },
    ],
  },
};

const LIT_NOTE = [
  "Lit scene: the shading is the oracle of spec/materials.md section 8 (tests/browser/support/reference-shading.ts) with the",
  "default camera exposure (scale pi, decision 0081). The prompt calibrates every light in observable terms (a matte white",
  "surface facing the light squarely at the stated distance renders white), which in the units of that model is: directional",
  "light 1 lux, point light I candela at d metres 1 lux when I = d^2 (9 candela at 3 m). An ambient term that adds the fraction",
  "k of the diffuse colour is ambient_intensity = k / pi in these units, because the exposure scale multiplies the ambient term by",
  "pi too (rule 9). The tolerance covers the differences between this model and three.js's MeshStandardMaterial (decision 0078",
  "item 6); it still separates the cases the task is about by far more.",
];

/** Name and explanatory comment lines of the fixture of each task, and the tolerance where it is not the default. */
export const meta = {
  "scene-rendering-02": {
    name: "a bar tilted by 0.9272952 rad about Z with a red ball at its end, on a dark blue-grey background",
    notes: ["Scene: a box 4 x 1 x 0.5 turned about Z by atan2(0.8, 0.6) and a sphere of radius 0.6 on its +x end face, seen from (0, 0, 8)."],
  },
  "scene-rendering-03": {
    name: "a two-segment arm: children follow the rotation and scale of their parents",
    notes: ["Scene: Arm (rot 0.6435011) > Upper, Elbow (rot -1.287002, scale 0.75) > Fore, Hand; Base is a separate box."],
  },
  "scene-rendering-04": {
    name: "three solids on a floor seen from an off-axis camera; nearer solids hide farther ones",
    notes: ["Scene: Floor 12 x 12, Tower, Block and Ball, camera at (5, 4, 9) looking at (0, 1, 0)."],
  },
  "scene-rendering-05": {
    name: "orthographic camera at (0, 6, 6): floor, moved crate and a dome half sunk into the floor",
    notes: ["Scene: orthographic height 8, floor 7 x 7, Crate at (2, 0.75, -1), Dome r 1.2 at (-1.5, 0, 1)."],
  },
  "scene-rendering-06": {
    name: "a cube and a floor lit by a directional light and ambient light",
    notes: ["Scene: light travelling along (0, -0.6, -0.8): front faces get cos 0.8, top faces 0.6, the +X face only ambient.", ...LIT_NOTE],
    tolerance: 6,
  },
  "scene-rendering-07": {
    name: "a red ball on a floor lit by one point light and ambient light",
    notes: ["Scene: point light at (1.5, 3, 2.5), 9 candela, inverse-square, no range; ambient 0.05.", ...LIT_NOTE],
    tolerance: 6,
  },
  "scene-rendering-08": {
    name: "five columns of different heights and colours standing on y = 0",
    notes: ["Scene: columns 1.2 x h x 1.2 at x = -4, -2, 0, 2, 4 with h = 1, 2, 3, 2, 1."],
  },
  "scene-rendering-09": {
    name: "near and far planes cut boxes, a box behind the camera and a hidden box are not drawn",
    notes: [
      "Scene: near 4, far 12, camera at (0, 0, 10). Slab crosses the near plane (its front face is cut off, a sliver of its +X face",
      "remains); Far lies beyond the far plane; Behind is behind the camera; Ghost is hidden; Rim runs through the far plane (its",
      "-X face is cut at depth 12). The ray caster discards an entry point outside [near, far] and culls back faces.",
    ],
  },
  "scene-rendering-10": {
    name: "a white ball and floor lit by a red and a blue point light and a tinted ambient light",
    notes: ["Scene: two 9 candela point lights (#ff3030 at (-3, 2.5, 2), #3050ff at (3, 2.5, 2)), ambient #6070a0 x 0.1.", ...LIT_NOTE],
    tolerance: 6,
  },
};
