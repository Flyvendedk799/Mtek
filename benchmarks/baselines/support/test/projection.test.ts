import { describe, expect, it } from "vitest";
import { projectOrthographic, projectPerspective } from "./projection.ts";

const view = { position: [0, 0, 6], target: [0, 0, 0], fovY: 0.9 } as const;

describe("projectPerspective", () => {
  it("puts the look-at target at the centre of the target", () => {
    expect(projectPerspective(view, [0, 0, 0])).toEqual({ x: 64, y: 64, depth: 6 });
  });

  it("moves +X to the right and +Y up, scaled by depth and the field of view", () => {
    const point = projectPerspective(view, [2, 1, 0]);
    const scale = 6 * Math.tan(0.45);
    expect(point.x).toBeCloseTo(64 + (64 * 2) / scale, 10);
    expect(point.y).toBeCloseTo(64 - (64 * 1) / scale, 10);
  });

  it("shrinks with distance: a nearer point is further from the centre", () => {
    const near = projectPerspective(view, [1, 0, 3]);
    const far = projectPerspective(view, [1, 0, -3]);
    expect(near.x - 64).toBeGreaterThan(far.x - 64);
  });

  it("follows a camera that is not on the Z axis", () => {
    const side = { position: [6, 0, 0], target: [0, 0, 0], fovY: 0.9 } as const;
    // Looking along -X with +Y up, the right-hand side is -Z (right = forward x up).
    expect(projectPerspective(side, [0, 0, -1]).x).toBeGreaterThan(64);
    expect(projectPerspective(side, [0, 0, 1]).x).toBeLessThan(64);
  });
});

describe("projectOrthographic", () => {
  it("maps world units to a fixed number of pixels", () => {
    const ortho = { position: [0, 0, 10], target: [0, 0, 0], height: 6 } as const;
    const point = projectOrthographic(ortho, [3, 3, 0]);
    expect(point.x).toBeCloseTo(128, 10);
    expect(point.y).toBeCloseTo(0, 10);
    expect(projectOrthographic(ortho, [-2, 0, 5]).x).toBeCloseTo(64 - (64 * 2) / 3, 10);
  });
});
