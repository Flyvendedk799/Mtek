import { expect, it } from "vitest";
import type { CameraRecord } from "../scene/world.js";
import { screenToWorld, worldToScreen } from "./screen.js";

for (const aspect of [16 / 9, 4 / 3, 9 / 16]) {
  for (const kind of ["perspective", "orthographic"] as const) {
    it(`round-trips the speaker hit area at aspect ${aspect} with ${kind}`, () => {
      const camera: CameraRecord = {
        position: { x: 1, y: 2, z: 10 }, target: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        projection: kind === "perspective"
          ? { kind, fov_y: 0.8, near: 0.1, far: 100 }
          : { kind, height: 8, near: 0.1, far: 100 },
      };
      for (const point of [{ x: -5.2, y: 2.7, z: 0 }, { x: -4.81, y: 3.04, z: 0 }, { x: -4.7, y: 3.2, z: 0 }]) {
        const screen = worldToScreen(camera, aspect, point);
        const hit = screenToWorld(camera, aspect, screen, point.z);
        expect(hit.x).toBeCloseTo(point.x, 4);
        expect(hit.y).toBeCloseTo(point.y, 4);
        expect(Math.abs(hit.x + 5.2) <= 0.4 && Math.abs(hit.y - 2.7) <= 0.35)
          .toBe(Math.abs(point.x + 5.2) <= 0.4 && Math.abs(point.y - 2.7) <= 0.35);
      }
    });
  }
}

it("uses quaternion cameras and reports a parallel ray without an invented intersection", () => {
  const camera: CameraRecord = {
    position: { x: 0, y: 0, z: 8 }, target: null,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    projection: { kind: "perspective", fov_y: Math.PI / 2, near: 0.1, far: 100 },
  };
  expect(screenToWorld(camera, 2, { x: 0.5, y: 0.5 }, 0)).toEqual({ x: 8, y: 4, z: 0 });
  camera.rotation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  expect(screenToWorld(camera, 1, { x: 0, y: 0 }, 0).x).toBeNaN();
});
