// CPU reference for the M1 pixel assertions (spec/testing.md section 6.3), independent of the runtime:
// its own f64 implementation of the view and projection matrices of spec/runtime-abi.md section 8.3,
// `quat.euler` (spec/language.md section 5.4 table), the entity transform `T · R · S` composed with the
// parent's (spec/scenes.md section 12), the sRGB transfer functions (spec/language.md section 5.4), and
// analytic ray casts against the primitive shapes, used to decide what a pixel must show.
//
// A pixel is only asserted when its expectation is robust: rays through the pixel centre and through
// points `margin` pixels around it must all hit the same front-most entity (or all miss everything), and
// no ray may graze a tessellated sphere between its inscribed and its true radius. Edge pixels, where
// rasterisation rules or tessellation decide, are never asserted.

/** `[x, y, z]`. */
export type Vec3 = readonly [number, number, number];
/** Unit quaternion `[x, y, z, w]`. */
export type Quat = readonly [number, number, number, number];
/** 4x4 matrix, column-major: element (row r, column c) at index `c * 4 + r`. */
export type Mat4 = readonly number[];

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function el(m: Mat4, row: number, col: number): number {
  const value = m[col * 4 + row];
  if (value === undefined) throw new RangeError("matrix index out of range");
  return value;
}

/** `a · b`: applies `b` first. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out: number[] = [];
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += el(a, row, k) * el(b, k, col);
      out.push(sum);
    }
  }
  return out;
}

export function translation(v: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
}

export function scaling(v: Vec3): Mat4 {
  return [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1];
}

export function transpose(m: Mat4): Mat4 {
  const out: number[] = [];
  for (let col = 0; col < 4; col += 1) for (let row = 0; row < 4; row += 1) out.push(el(m, col, row));
  return out;
}

/** The rotation matrix of a unit quaternion. */
export function rotation(q: Quat): Mat4 {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}

/** The inverse of a 4x4 matrix (cofactor expansion); throws for a singular matrix. */
export function invert(m: Mat4): Mat4 {
  const a = (row: number, col: number): number => el(m, row, col);
  const minor = (row: number, col: number): number => {
    const rows = [0, 1, 2, 3].filter((r) => r !== row);
    const cols = [0, 1, 2, 3].filter((c) => c !== col);
    const g = (i: number, j: number): number => a(rows[i] ?? 0, cols[j] ?? 0);
    return (
      g(0, 0) * (g(1, 1) * g(2, 2) - g(1, 2) * g(2, 1)) -
      g(0, 1) * (g(1, 0) * g(2, 2) - g(1, 2) * g(2, 0)) +
      g(0, 2) * (g(1, 0) * g(2, 1) - g(1, 1) * g(2, 0))
    );
  };
  let det = 0;
  for (let col = 0; col < 4; col += 1) det += (col % 2 === 0 ? 1 : -1) * a(0, col) * minor(0, col);
  if (Math.abs(det) < 1e-300) throw new RangeError("singular matrix");
  const out: number[] = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      // inverse(row, col) = cofactor(col, row) / det
      out[col * 4 + row] = (((row + col) % 2 === 0 ? 1 : -1) * minor(col, row)) / det;
    }
  }
  return out;
}

/** `m · (v, w)` without a perspective divide. */
export function transform4(m: Mat4, v: Vec3, w: number): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    out[row] = el(m, row, 0) * v[0] + el(m, row, 1) * v[1] + el(m, row, 2) * v[2] + el(m, row, 3) * w;
  }
  return out;
}

/** `m · (v, 1)` with the perspective divide. */
export function transformPoint(m: Mat4, v: Vec3): Vec3 {
  const [x, y, z, w] = transform4(m, v, 1);
  return [x / w, y / w, z / w];
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
  const length = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatAxisAngle(axis: Vec3, angle: number): Quat {
  const [x, y, z] = normalize(axis);
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

/** `quat.euler(x, y, z) = axis_angle(+Y, y) * axis_angle(+X, x) * axis_angle(+Z, z)`. */
export function quatEuler(x: number, y: number, z: number): Quat {
  return quatMultiply(quatMultiply(quatAxisAngle([0, 1, 0], y), quatAxisAngle([1, 0, 0], x)), quatAxisAngle([0, 0, 1], z));
}

export type CameraSpec =
  | { readonly position: Vec3; readonly target: Vec3; readonly projection: ProjectionSpec }
  | { readonly position: Vec3; readonly rotation: Quat; readonly projection: ProjectionSpec };

export type ProjectionSpec =
  | { readonly kind: "perspective"; readonly fovY: number; readonly near: number; readonly far: number }
  | { readonly kind: "orthographic"; readonly height: number; readonly near: number; readonly far: number };

/** The view matrix of spec/runtime-abi.md section 8.3: `V = transpose(R) · T(−p)`. */
export function viewMatrix(camera: CameraSpec): Mat4 {
  let r: Mat4;
  if ("target" in camera) {
    const f = normalize(sub(camera.target, camera.position));
    const up: Vec3 = Math.abs(dot(f, [0, 1, 0])) > 1 - 1e-6 ? [0, 0, -1] : [0, 1, 0];
    const right = normalize(cross(f, up));
    const u = cross(right, f);
    r = [right[0], right[1], right[2], 0, u[0], u[1], u[2], 0, -f[0], -f[1], -f[2], 0, 0, 0, 0, 1];
  } else {
    r = rotation(camera.rotation);
  }
  const p = camera.position;
  return multiply(transpose(r), translation([-p[0], -p[1], -p[2]]));
}

/** The projection matrix of spec/runtime-abi.md section 8.3 for a target of aspect `width / height`. */
export function projectionMatrix(projection: ProjectionSpec, aspect: number): Mat4 {
  const { near, far } = projection;
  const m = new Array<number>(16).fill(0);
  if (projection.kind === "perspective") {
    const f = 1 / Math.tan(projection.fovY / 2);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1;
    m[14] = (near * far) / (near - far);
  } else {
    const h = projection.height;
    const w = h * aspect;
    m[0] = 2 / w;
    m[5] = 2 / h;
    m[10] = 1 / (near - far);
    m[14] = near / (near - far);
    m[15] = 1;
  }
  return m;
}

/** sRGB EOTF of spec/language.md section 5.4 (an sRGB channel in 0..1 to linear). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear 0..1 to an 8-bit sRGB value, as the hardware encodes for an `-srgb` render target. */
export function linearToSrgb8(linear: number): number {
  const c = Math.min(Math.max(linear, 0), 1);
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}

/** An opaque `#RRGGBB` colour literal, as the 8-bit RGB an `rgba8unorm-srgb` target holds for it. */
export function expectedRgb8(hex: string): [number, number, number] {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (match === null) throw new Error(`not an opaque #RRGGBB colour: ${hex}`);
  const channel = (index: number): number => linearToSrgb8(srgbToLinear(Number.parseInt(match[index] ?? "", 16) / 255));
  return [channel(1), channel(2), channel(3)];
}

export type ShapeSpec =
  | { readonly kind: "box"; readonly size: Vec3 }
  | { readonly kind: "sphere"; readonly radius: number; readonly segments: number; readonly rings: number }
  | { readonly kind: "plane"; readonly size: readonly [number, number] };

export interface EntitySpec {
  readonly name: string;
  /** Index of the parent in the scene's entity list, or null. */
  readonly parent: number | null;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
  readonly shape: ShapeSpec;
  /** The Unlit colour literal. */
  readonly color: string;
}

export interface SceneSpec {
  /** Directory name under `tests/browser/fixtures/m1/`. */
  readonly fixture: string;
  readonly renderTarget: { readonly width: number; readonly height: number };
  /** `clear_color` literal (the registry default `#000000` when the source has none). */
  readonly clearColor: string;
  readonly camera: CameraSpec;
  readonly entities: readonly EntitySpec[];
  /** Text that must occur in the fixture's `src/main.mtek`, so this description cannot drift from it. */
  readonly sourceLiterals: readonly string[];
}

/** World matrices of every entity: `parent · T(p) · R(q) · S(s)`, in entity order (parents first). */
export function worldMatrices(scene: SceneSpec): Mat4[] {
  const out: Mat4[] = [];
  scene.entities.forEach((entity, index) => {
    const local = multiply(multiply(translation(entity.position), rotation(entity.rotation)), scaling(entity.scale));
    if (entity.parent === null) {
      out.push(local);
      return;
    }
    const parent = out[entity.parent];
    if (parent === undefined || entity.parent >= index) throw new Error(`${entity.name}: parent must come first`);
    out.push(multiply(parent, local));
  });
  return out;
}

export function viewProjection(scene: SceneSpec): Mat4 {
  const { width, height } = scene.renderTarget;
  return multiply(projectionMatrix(scene.camera.projection, width / height), viewMatrix(scene.camera));
}

/** Screen position (pixels, origin top-left, y down) of a world point. */
export function projectToPixels(scene: SceneSpec, world: Vec3): { x: number; y: number } {
  const [nx, ny] = transformPoint(viewProjection(scene), world);
  const { width, height } = scene.renderTarget;
  return { x: ((nx + 1) / 2) * width, y: ((1 - ny) / 2) * height };
}

/** Projected entity centre (the origin of its world matrix). */
export function projectedCentre(scene: SceneSpec, entityIndex: number): { x: number; y: number } {
  const world = worldMatrices(scene)[entityIndex];
  if (world === undefined) throw new Error(`no entity ${String(entityIndex)}`);
  return projectToPixels(scene, [el(world, 0, 3), el(world, 1, 3), el(world, 2, 3)]);
}

type ShapeHit = { kind: "miss" } | { kind: "hit"; t: number } | { kind: "edge" };

/** Ray `o + t·d` (local space) against a shape; `t` in [0, 1] spans the near to the far plane. */
function castShape(shape: ShapeSpec, o: Vec3, d: Vec3): ShapeHit {
  switch (shape.kind) {
    case "box": {
      let tMin = -Infinity;
      let tMax = Infinity;
      for (let axis = 0; axis < 3; axis += 1) {
        const half = (shape.size[axis] ?? 0) / 2;
        const oa = o[axis] ?? 0;
        const da = d[axis] ?? 0;
        if (Math.abs(da) < 1e-15) {
          if (oa < -half || oa > half) return { kind: "miss" };
          continue;
        }
        const t1 = (-half - oa) / da;
        const t2 = (half - oa) / da;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
      if (tMin > tMax || tMax < 0 || tMin > 1) return { kind: "miss" };
      return { kind: "hit", t: Math.max(tMin, 0) };
    }
    case "plane": {
      // Single-sided: the +Y face, back-face culled from below.
      if (d[1] >= 0) return { kind: "miss" };
      const t = -o[1] / d[1];
      if (t < 0 || t > 1) return { kind: "miss" };
      const x = o[0] + t * d[0];
      const z = o[2] + t * d[2];
      return Math.abs(x) <= shape.size[0] / 2 && Math.abs(z) <= shape.size[1] / 2 ? { kind: "hit", t } : { kind: "miss" };
    }
    case "sphere": {
      // The UV sphere's faces lie between its inscribed radius and the true radius.
      const inner = shape.radius * Math.cos(Math.PI / shape.segments) * Math.cos(Math.PI / shape.rings);
      const a = dot(d, d);
      const b = 2 * dot(o, d);
      const c0 = dot(o, o);
      const solve = (radius: number): number | null => {
        const disc = b * b - 4 * a * (c0 - radius * radius);
        if (disc < 0) return null;
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        return t >= 0 && t <= 1 ? t : null;
      };
      const outerT = solve(shape.radius);
      if (outerT === null) return { kind: "miss" };
      const innerT = solve(inner);
      return innerT === null ? { kind: "edge" } : { kind: "hit", t: innerT };
    }
  }
}

/** What a pixel must show: an entity (by index), the clear colour, or nothing robust. */
export type Expectation = { kind: "entity"; index: number } | { kind: "clear" } | { kind: "ambiguous" };

/** The front-most entity along the ray through screen point (x, y) (pixels, y down). */
function castScreenRay(scene: SceneSpec, inverseViewProj: Mat4, worlds: readonly Mat4[], x: number, y: number): Expectation {
  const { width, height } = scene.renderTarget;
  const nx = (x / width) * 2 - 1;
  const ny = 1 - (y / height) * 2;
  const nearPoint = transformPoint(inverseViewProj, [nx, ny, 0]);
  const farPoint = transformPoint(inverseViewProj, [nx, ny, 1]);
  const direction = sub(farPoint, nearPoint);
  let best: { index: number; t: number } | null = null;
  let second = Infinity;
  for (const [index, entity] of scene.entities.entries()) {
    const inverse = invert(worlds[index] ?? identity());
    const [ox, oy, oz] = transform4(inverse, nearPoint, 1);
    const [dx, dy, dz] = transform4(inverse, direction, 0);
    const hit = castShape(entity.shape, [ox, oy, oz], [dx, dy, dz]);
    if (hit.kind === "edge") return { kind: "ambiguous" };
    if (hit.kind === "miss") continue;
    if (best === null || hit.t < best.t) {
      second = best?.t ?? second;
      best = { index, t: hit.t };
    } else {
      second = Math.min(second, hit.t);
    }
  }
  if (best === null) return { kind: "clear" };
  // Two surfaces at nearly the same depth: the depth test, not geometry, would decide.
  if (second - best.t < 1e-4) return { kind: "ambiguous" };
  return { kind: "entity", index: best.index };
}

function same(a: Expectation, b: Expectation): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "entity" || (b.kind === "entity" && a.index === b.index);
}

/**
 * What pixel (px, py) must show: the common result of rays through its centre and through the eight
 * points `margin` pixels around it, or `ambiguous` when they disagree or graze a tessellated edge.
 */
export function expectPixel(scene: SceneSpec, px: number, py: number, margin = 1.5): Expectation {
  const inverseViewProj = invert(viewProjection(scene));
  const worlds = worldMatrices(scene);
  const cx = px + 0.5;
  const cy = py + 0.5;
  const centre = castScreenRay(scene, inverseViewProj, worlds, cx, cy);
  if (centre.kind === "ambiguous") return centre;
  for (const dx of [-margin, 0, margin]) {
    for (const dy of [-margin, 0, margin]) {
      if (dx === 0 && dy === 0) continue;
      if (!same(centre, castScreenRay(scene, inverseViewProj, worlds, cx + dx, cy + dy))) return { kind: "ambiguous" };
    }
  }
  return centre;
}

/** The 8-bit RGB a robust expectation stands for. */
export function expectedColour(scene: SceneSpec, expectation: Expectation): [number, number, number] {
  if (expectation.kind === "clear") return expectedRgb8(scene.clearColor);
  if (expectation.kind === "entity") {
    const entity = scene.entities[expectation.index];
    if (entity === undefined) throw new Error(`no entity ${String(expectation.index)}`);
    return expectedRgb8(entity.color);
  }
  throw new Error("an ambiguous pixel has no expected colour");
}
