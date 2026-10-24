import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, expect, it } from "vitest";
import { overlapBoxes, overlapSpheres } from "./overlap.js";

beforeAll(async () => { await RAPIER.init(); });
const origin = { x: 0, y: 0, z: 0 };
const identity = { x: 0, y: 0, z: 0, w: 1 };

it("agrees with Rapier on separated, touching and penetrating spheres", () => {
  for (const x of [0, 0.5, 1.999, 2, 2.001, 4]) {
    const b = { x, y: 0, z: 0 };
    expect(overlapSpheres(origin, 1, b, 1)).toBe(new RAPIER.Ball(1).intersectsShape(origin, identity, new RAPIER.Ball(1), b, identity));
  }
});

it("agrees with Rapier for rotated boxes, including thin boxes and cross-axis separation", () => {
  const aSize = { x: 3, y: 0.5, z: 1 }, bSize = { x: 0.5, y: 2, z: 0.25 };
  const a = new RAPIER.Cuboid(aSize.x / 2, aSize.y / 2, aSize.z / 2);
  const b = new RAPIER.Cuboid(bSize.x / 2, bSize.y / 2, bSize.z / 2);
  for (let i = 0; i < 200; i++) {
    const t = i * 0.37;
    const q = { x: 0, y: Math.sin(t / 2), z: 0, w: Math.cos(t / 2) };
    const r = { x: Math.sin(t / 3), y: 0, z: 0, w: Math.cos(t / 3) };
    const at = { x: Math.sin(i * 1.7) * 3, y: Math.cos(i * 0.9), z: Math.sin(i * 0.2) };
    expect(overlapBoxes(origin, aSize, q, at, bSize, r), `case ${i}`).toBe(a.intersectsShape(origin, q, b, at, r));
  }
});

it("treats axis-aligned box touching as intersection and rejects invalid sizes", () => {
  const size = { x: 2, y: 2, z: 2 };
  expect(overlapBoxes(origin, size, identity, { x: 2, y: 0, z: 0 }, size, identity)).toBe(true);
  expect(overlapBoxes(origin, { x: -1, y: 2, z: 2 }, identity, origin, size, identity)).toBe(false);
  expect(overlapSpheres(origin, -1, origin, 1)).toBe(false);
});
