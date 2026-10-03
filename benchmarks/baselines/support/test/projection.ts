// An independent CPU projection (f64) used to derive the pixel coordinates of the fixtures
// (spec/testing.md section 6.3: "project the entity centre with the same view/projection formulas on the
// CPU"). It does not use three.js: the baseline reference must reproduce these numbers on the GPU.
export type Vec3 = readonly [number, number, number];

export interface View {
  readonly position: Vec3;
  readonly target: Vec3;
}

export interface PerspectiveView extends View {
  /** Full vertical field of view in radians. */
  readonly fovY: number;
}

export interface OrthographicView extends View {
  /** Visible world height. */
  readonly height: number;
}

export interface PixelPosition {
  /** Horizontal pixel coordinate, 0 at the left edge of the target (a pixel centre is at +0.5). */
  readonly x: number;
  /** Vertical pixel coordinate, 0 at the top edge. */
  readonly y: number;
  /** Distance of the point in front of the camera along its viewing direction. */
  readonly depth: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: Vec3): Vec3 {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
}

/** Camera basis for a look-at camera with world up +Y (the case `|forward . up| = 1` is not handled). */
function basis(view: View): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = normalize(sub(view.target, view.position));
  const right = normalize(cross(forward, [0, 1, 0]));
  return { forward, right, up: cross(right, forward) };
}

function toPixels(ndcX: number, ndcY: number, depth: number, size: number): PixelPosition {
  return { x: ((ndcX + 1) / 2) * size, y: ((1 - ndcY) / 2) * size, depth };
}

/** Pixel position of a world point seen by a perspective look-at camera on a square target. */
export function projectPerspective(view: PerspectiveView, point: Vec3, size = 128): PixelPosition {
  const { forward, right, up } = basis(view);
  const offset = sub(point, view.position);
  const depth = dot(offset, forward);
  const scale = depth * Math.tan(view.fovY / 2);
  return toPixels(dot(offset, right) / scale, dot(offset, up) / scale, depth, size);
}

/** Pixel position of a world point seen by an orthographic look-at camera on a square target. */
export function projectOrthographic(view: OrthographicView, point: Vec3, size = 128): PixelPosition {
  const { forward, right, up } = basis(view);
  const offset = sub(point, view.position);
  const half = view.height / 2;
  return toPixels(dot(offset, right) / half, dot(offset, up) / half, dot(offset, forward), size);
}
