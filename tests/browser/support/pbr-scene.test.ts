import { describe, expect, it } from "vitest";
import { quatEuler, rotation, transformPoint } from "./m1-reference.ts";
import { CAMERA_DISTANCE, FOV_Y, SPHERE_RADIUS, TARGET_SIZE, surfaceAt, sunDirection } from "./pbr-scene.ts";

describe("the sphere seen by the fixture's camera", () => {
  it("shows the pole facing the camera at the middle of the target, with N = V = +Z up to the half pixel", () => {
    const point = surfaceAt(TARGET_SIZE / 2 - 1, TARGET_SIZE / 2 - 1);
    expect(point).toBeDefined();
    expect(point!.position[2]).toBeCloseTo(SPHERE_RADIUS, 4);
    expect(point!.N[2]).toBeCloseTo(1, 4);
    expect(point!.V[2]).toBeCloseTo(1, 3);
    expect(point!.N[0]).toBeLessThan(0);
    expect(point!.N[1]).toBeGreaterThan(0);
  });

  it("returns unit vectors and a point on the sphere, with the normal radial", () => {
    for (const [x, y] of [
      [160, 88],
      [83, 148],
      [183, 163],
    ] as const) {
      const point = surfaceAt(x, y)!;
      expect(Math.hypot(...point.position)).toBeCloseTo(SPHERE_RADIUS, 12);
      expect(Math.hypot(...point.N)).toBeCloseTo(1, 12);
      expect(Math.hypot(...point.V)).toBeCloseTo(1, 12);
      point.N.forEach((component, i) => expect(component).toBeCloseTo(point.position[i]! / SPHERE_RADIUS, 12));
    }
  });

  it("hits the sphere at the silhouette radius the pinhole geometry gives and misses outside it", () => {
    // The silhouette subtends asin(r / d) at the camera; its distance from the middle of the target in pixels is
    // tan(asin(r / d)) / tan(fov / 2) times half the target.
    const alpha = Math.asin(SPHERE_RADIUS / CAMERA_DISTANCE);
    const radiusPixels = (Math.tan(alpha) / Math.tan(FOV_Y / 2)) * (TARGET_SIZE / 2);
    expect(radiusPixels).toBeGreaterThan(78);
    expect(radiusPixels).toBeLessThan(82);
    const middle = TARGET_SIZE / 2 - 0.5;
    expect(surfaceAt(Math.round(middle + radiusPixels - 3), Math.round(middle))).toBeDefined();
    expect(surfaceAt(Math.round(middle + radiusPixels + 3), Math.round(middle))).toBeUndefined();
    expect(surfaceAt(0, 0)).toBeUndefined();
  });

  it("looks up and to the right of the middle for a pixel up and to the right", () => {
    const point = surfaceAt(188, 80)!;
    expect(point.N[0]).toBeGreaterThan(0.4);
    expect(point.N[1]).toBeGreaterThan(0.4);
  });
});

describe("the direction of the fixture's directional light", () => {
  it("is world -Z for no rotation and is turned by pitch about X and then yaw about Y", () => {
    expect(sunDirection(0, 0)).toEqual([0, 0, -1]);
    const down = sunDirection(Math.PI / 2, 0);
    expect(down[1]).toBeCloseTo(1, 12);
    expect(down[2]).toBeCloseTo(0, 12);
    const turned = sunDirection(0, Math.PI / 2);
    expect(turned[0]).toBeCloseTo(-1, 12);
    expect(turned[2]).toBeCloseTo(0, 12);
  });

  it("agrees with rotating -Z by the quaternion of quat.euler(pitch, yaw, 0)", () => {
    for (const [pitch, yaw] of [
      [-0.5, 0.6],
      [0.3, -1.1],
      [-1.2, 2.5],
    ] as const) {
      const rotated = transformPoint(rotation(quatEuler(pitch, yaw, 0)), [0, 0, -1]);
      const direction = sunDirection(pitch, yaw);
      direction.forEach((component, i) => expect(component).toBeCloseTo(rotated[i]!, 12));
    }
  });
});
