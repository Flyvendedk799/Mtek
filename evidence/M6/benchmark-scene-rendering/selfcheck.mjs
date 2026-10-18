// Self-check of the oracle: it must reproduce the hand-derived, hardware-verified fixture of scene-rendering-01
// (derived there from a CPU projection, `benchmarks/baselines/support/test/projection.ts`, and checked on both sides)
// and the analytic invariants of the scenes of this directory. Run: node evidence/M6/benchmark-scene-rendering/selfcheck.mjs
import { readFileSync } from "node:fs";
import { parseToml } from "../../../benchmarks/tools/toml-subset.mjs";
import { colourAt, hexBytes, prepare, project } from "./oracle.mjs";
import { scenes } from "./scenes.mjs";

let failures = 0;
const check = (ok, message) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};

// 1. scene-rendering-01, from its prompt.
const seed = prepare({
  clear: "#202020",
  camera: { position: [0, 0, 6], target: [0, 0, 0], fovY: 0.9 },
  entities: [
    { name: "Cube", mesh: { box: [1, 1, 1] }, material: { unlit: "#22c55e" } },
    { name: "Ball", position: [2, 0, 0], mesh: { sphere: 0.5, segments: 32, rings: 16 }, material: { unlit: "#3b82f6" } },
  ],
});
const fixture = parseToml(readFileSync(new URL("../../../benchmarks/tasks/scene-rendering-01/mtek-tests/scene.test.toml", import.meta.url), "utf8"));
let compared = 0;
for (const step of fixture.steps) {
  if (step.expect_pixel === undefined) continue;
  const { x, y, color, tolerance } = step.expect_pixel;
  const got = colourAt(seed, x, y);
  const want = hexBytes(color);
  const worst = Math.max(...got.rgb.map((c, i) => Math.abs(c - want[i])));
  compared += 1;
  check(worst <= tolerance && got.key !== "ambiguous", `scene-rendering-01 pixel (${x}, ${y}): oracle ${got.rgb.join(",")} (${got.key}) vs fixture ${want.join(",")}`);
}
check(compared === 21, `scene-rendering-01: ${compared} pixels compared`);

// 2. Invariants: the projection of a world point and the ray cast through that pixel agree.
const bar = prepare(scenes["scene-rendering-02"]);
const tip = project(scenes["scene-rendering-02"].camera, [1.2, 1.6, 0.6]);
check(colourAt(bar, Math.floor(tip.x), Math.floor(tip.y)).key === "Tip", "02: the front pole of Tip projects onto Tip");
const hierarchy = prepare(scenes["scene-rendering-03"]);
// Hand: Arm (-2.5, -1.5) + R(0.6435011) (4, 0) = Elbow (0.7, 0.9); Hand = Elbow + 0.75 * R(-0.6435011) (3, 0) = (2.5, -0.45)
const hand = project(scenes["scene-rendering-03"].camera, [2.5, -0.45, 0.45]);
check(colourAt(hierarchy, Math.floor(hand.x), Math.floor(hand.y)).key === "Hand", "03: the front pole of Hand is where the hierarchy puts it, (2.5, -0.45)");

// 3. The calibration of the lit scenes: a white matte surface facing the light squarely renders (close to) white.
const flat = prepare({
  clear: "#000000",
  camera: { position: [0, 0, 5], target: [0, 0, 0], fovY: 0.4 },
  lights: [{ directional: [0, 0, -1], intensity: 1 }],
  entities: [{ name: "Wall", mesh: { box: [4, 4, 0.2] }, material: { pbr: { base: "#ffffff", roughness: 1, metallic: 0 } } }],
});
const lit = colourAt(flat, 64, 64).rgb;
check(lit.every((c) => c >= 250), `a white rough surface facing a 1 lux light squarely renders ${lit.join(",")} (full brightness up to the specular term)`);
const point = prepare({
  clear: "#000000",
  camera: { position: [0, 0, 6], target: [0, 0, 0], fovY: 0.4 },
  lights: [{ point: [0, 0, 3], intensity: 9 }],
  entities: [{ name: "Wall", mesh: { box: [4, 4, 0.2] }, material: { pbr: { base: "#ffffff", roughness: 1, metallic: 0 } } }],
});
const lit3 = colourAt(point, 64, 64).rgb;
check(lit3.every((c) => c >= 250), `a white rough surface 2.9 units from a 9 candela lamp renders ${lit3.join(",")}`);

// The ambient calibration of the prompts: "adds 10 % of the diffuse colour" is ambient_intensity = 0.1 / pi under the
// default exposure (scale pi), i.e. a white surface in the dark reads linear 0.1, which is 89 as an sRGB byte.
const ambient = prepare({
  clear: "#000000",
  camera: { position: [0, 0, 5], target: [0, 0, 0], fovY: 0.4 },
  ambient: { color: "#ffffff", intensity: 0.1 / Math.PI },
  entities: [{ name: "Wall", mesh: { box: [4, 4, 0.2] }, material: { pbr: { base: "#ffffff", roughness: 1, metallic: 0 } } }],
});
const dark = colourAt(ambient, 64, 64).rgb;
check(dark.every((c) => c === 89), `ambient only, k = 0.1: a white surface renders ${dark.join(",")} (89 expected)`);

if (failures > 0) {
  console.log(`${failures} checks failed`);
  process.exit(1);
}
console.log("all checks passed");
