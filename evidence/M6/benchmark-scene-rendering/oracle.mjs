// An independent CPU ray caster for the scene/rendering benchmark tasks (decision 0078).
//
// It derives the expected pixels of a task from the SCENE THE PROMPT DESCRIBES, never from a reference
// solution: the scene is transcribed from the prompt into scenes.mjs, this file casts one ray per pixel
// centre through it (f64, no three.js, no Mtek runtime) and, for lit surfaces, shades with the CPU oracle of
// spec/materials.md section 8 (`tests/browser/support/reference-shading.ts`, which shares no code with the
// runtime). Matrix, quaternion and sRGB helpers come from `tests/browser/support/m1-reference.ts`, the
// M1 pixel oracle (also independent of the runtime).
//
// Conventions (spec/scenes.md sections 3, 12; spec/runtime-abi.md section 8.3; spec/stdlib.md section 4):
//   - right-handed, +Y up, the camera looks along its local -Z, a look-at camera has up +Y;
//   - entity transform T(position) * R(rotation) * S(scale), composed with the parent's;
//   - Box: full extents; Sphere: radius; Plane: the +Y face at y = 0, single sided (back-face culling);
//   - opaque, depth test, back faces culled: a ray sees the ENTRY point of a convex solid, and a solid whose entry
//     point is clipped by the near or far plane (depth along the view axis outside [near, far]) shows nothing;
//   - the render target is square, pixel (x, y) has its centre at (x + 0.5, y + 0.5), y grows downwards.
//
// A pixel is only offered for a fixture when its expectation is robust: the rays through points up to a margin
// around its centre must all hit the same surface (the same entity and face), or all miss everything. A sphere
// is tessellated in the runtime and in three.js, so it is cast with its true radius and a pixel is rejected
// when a ray passes within the sagitta band between the inscribed and the true radius.
import {
  invert,
  multiply,
  quatAxisAngle,
  rotation,
  scaling,
  srgbToLinear,
  transform4,
  translation,
} from "../../../tests/browser/support/m1-reference.ts";
import { linearRgbToSrgb8, shadePbr } from "../../../tests/browser/support/reference-shading.ts";

export const SIZE = 128;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => mul(a, 1 / Math.hypot(...a));

/** `#rrggbb` to a linear RGB triple (the sRGB EOTF). */
export function hexLinear(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255));
}

/** `#rrggbb` to the bytes an sRGB target holds for it. */
export function hexBytes(hex) {
  return linearRgbToSrgb8(hexLinear(hex));
}

const rotationOf = (entity) => (entity.rotation === undefined ? rotation([0, 0, 0, 1]) : rotation(entity.rotation));

/** World matrices of the entities, in list order (a parent is named by its name and must come first). */
export function worldMatrices(entities) {
  const byName = new Map();
  return entities.map((entity) => {
    const local = multiply(
      multiply(translation(entity.position ?? [0, 0, 0]), rotationOf(entity)),
      scaling(entity.scale ?? [1, 1, 1]),
    );
    let world = local;
    if (entity.parent !== undefined) {
      const parent = byName.get(entity.parent);
      if (parent === undefined) throw new Error(`${entity.name}: parent '${entity.parent}' must be listed first`);
      world = multiply(parent, local);
    }
    byName.set(entity.name, world);
    return world;
  });
}

export const axisAngle = (axis, angle) => quatAxisAngle(axis, angle);

/** The view basis of a look-at camera (up +Y). */
function basis(camera) {
  const forward = normalize(sub(camera.target, camera.position));
  const right = normalize(cross(forward, [0, 1, 0]));
  return { forward, right, up: cross(right, forward) };
}

/** Ray of pixel position (px, py) in pixel units: origin, direction with dot(direction, forward) = 1. */
function pixelRay(camera, px, py) {
  const { forward, right, up } = basis(camera);
  const ndcX = (px / SIZE) * 2 - 1;
  const ndcY = 1 - (py / SIZE) * 2;
  if (camera.orthoHeight !== undefined) {
    const half = camera.orthoHeight / 2;
    return { origin: add(camera.position, add(mul(right, ndcX * half), mul(up, ndcY * half))), direction: forward, forward };
  }
  const k = Math.tan(camera.fovY / 2);
  return { origin: camera.position, direction: add(forward, add(mul(right, ndcX * k), mul(up, ndcY * k))), forward };
}

const transformVec = (m, v, w) => transform4(m, v, w).slice(0, 3);

/** Entry of a ray into a shape in local space: { t, normal, face } or null. `t` is shared with the world ray. */
function castLocal(entity, o, d) {
  const mesh = entity.mesh;
  if (mesh.box !== undefined) {
    let tMin = -Infinity;
    let tMax = Infinity;
    let axisIn = -1;
    let signIn = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const half = mesh.box[axis] / 2;
      if (Math.abs(d[axis]) < 1e-15) {
        if (o[axis] < -half || o[axis] > half) return null;
        continue;
      }
      const t1 = (-half - o[axis]) / d[axis];
      const t2 = (half - o[axis]) / d[axis];
      const lo = Math.min(t1, t2);
      if (lo > tMin) {
        tMin = lo;
        axisIn = axis;
        signIn = d[axis] > 0 ? -1 : 1; // entering through the face the ray comes from
      }
      tMax = Math.min(tMax, Math.max(t1, t2));
    }
    if (tMin > tMax || tMin <= 0) return null; // misses, or the ray starts inside (back faces are culled)
    const normal = [0, 0, 0];
    normal[axisIn] = signIn;
    return { t: tMin, normal, face: `${signIn > 0 ? "+" : "-"}${"XYZ"[axisIn]}`, band: false };
  }
  if (mesh.sphere !== undefined) {
    const r = mesh.sphere;
    const a = dot(d, d);
    const b = 2 * dot(o, d);
    const c = dot(o, o) - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t <= 0) return null;
    const point = add(o, mul(d, t));
    // Within the tessellation band (inscribed radius .. true radius) the tessellated surface may or may not be hit.
    const inner = r * Math.cos(Math.PI / mesh.segments) * Math.cos(Math.PI / mesh.rings);
    const discInner = b * b - 4 * a * (dot(o, o) - inner * inner);
    return { t, normal: normalize(point), face: "", band: discInner < 0 };
  }
  // Plane: the +Y face at y = 0, extent size[0] along X and size[1] along Z, seen from above only.
  const [sx, sz] = mesh.plane;
  if (d[1] >= 0 || o[1] <= 0) return null;
  const t = -o[1] / d[1];
  const x = o[0] + t * d[0];
  const z = o[2] + t * d[2];
  if (Math.abs(x) > sx / 2 || Math.abs(z) > sz / 2) return null;
  return { t, normal: [0, 1, 0], face: "", band: false };
}

/** The visible surface along a ray: { key, entity, point, normal } or { key: "clear" } or { key: "ambiguous" }. */
function castRay(scene, worlds, inverses, ray) {
  const near = scene.camera.near ?? 0.1;
  const far = scene.camera.far ?? 1000;
  let best = null;
  for (const [index, entity] of scene.entities.entries()) {
    if (entity.mesh === undefined || entity.visible === false) continue;
    const inverse = inverses[index];
    const o = transformVec(inverse, ray.origin, 1);
    const d = transformVec(inverse, ray.direction, 0);
    const hit = castLocal(entity, o, d);
    if (hit === null) continue;
    if (hit.band) return { key: "ambiguous" };
    // depth along the view axis equals t because dot(direction, forward) = 1
    if (hit.t < near || hit.t > far) continue;
    // The normal matrix is the inverse transpose of the world matrix (spec/scenes.md section 12).
    const m = inverse;
    const n = hit.normal;
    const worldNormal = normalize([
      m[0] * n[0] + m[1] * n[1] + m[2] * n[2],
      m[4] * n[0] + m[5] * n[1] + m[6] * n[2],
      m[8] * n[0] + m[9] * n[1] + m[10] * n[2],
    ]);
    const candidate = { t: hit.t, key: `${entity.name}${hit.face === "" ? "" : ` ${hit.face}`}`, entity, normal: worldNormal };
    if (best === null || candidate.t < best.t) best = { ...candidate, second: best === null ? Infinity : best.t };
    else best.second = Math.min(best.second, candidate.t);
  }
  if (best === null) return { key: "clear" };
  if (best.second - best.t < 1e-4 * Math.max(1, best.t)) return { key: "ambiguous" };
  best.point = add(ray.origin, mul(ray.direction, best.t));
  return best;
}

/** Compiles a scene for casting. */
export function prepare(scene) {
  const worlds = worldMatrices(scene.entities);
  return { scene, worlds, inverses: worlds.map((w) => invert(w)) };
}

/** Linear colour of a hit. */
function shade(scene, hit) {
  const { material } = hit.entity;
  if (material.unlit !== undefined) return hexLinear(material.unlit);
  const camera = scene.camera.position;
  const ambient = scene.ambient ?? { color: "#ffffff", intensity: 0 };
  const lights = (scene.lights ?? []).map((light) =>
    light.directional !== undefined
      ? { kind: "directional", direction: light.directional, color: hexLinear(light.color ?? "#ffffff"), intensity: light.intensity }
      : { kind: "point", position: light.point, color: hexLinear(light.color ?? "#ffffff"), intensity: light.intensity },
  );
  return shadePbr({
    N: hit.normal,
    V: sub(camera, hit.point),
    position: hit.point,
    lights,
    baseColor: hexLinear(material.pbr.base),
    metallic: material.pbr.metallic ?? 0,
    roughness: material.pbr.roughness ?? 0.5,
    ambientColor: hexLinear(ambient.color),
    ambientIntensity: ambient.intensity,
    // The default camera exposure -log2(1.2 * pi) has the scale 1 / (1.2 * 2^EV100) = pi (decision 0081).
    exposure: Math.PI,
  });
}

/** The 8-bit sRGB colour at pixel (x, y), cast through the pixel centre. */
export function colourAt(prepared, x, y) {
  const { scene, worlds, inverses } = prepared;
  const hit = castRay(scene, worlds, inverses, pixelRay(scene.camera, x + 0.5, y + 0.5));
  if (hit.key === "clear") return { key: "clear", rgb: hexBytes(scene.clear) };
  if (hit.key === "ambiguous") return { key: "ambiguous", rgb: [0, 0, 0] };
  return { key: hit.key, rgb: linearRgbToSrgb8(shade(scene, hit)) };
}

/** Largest radius (in steps of 0.75 pixels, up to 3.75) within which every ray hits the surface of the centre ray. */
export function margin(prepared, x, y) {
  const { scene, worlds, inverses } = prepared;
  const centre = castRay(scene, worlds, inverses, pixelRay(scene.camera, x + 0.5, y + 0.5));
  if (centre.key === "ambiguous") return { key: "ambiguous", margin: 0 };
  let best = 0;
  for (let radius = 0.75; radius <= 3.75; radius += 0.75) {
    for (let k = 0; k < 16; k += 1) {
      const angle = (k / 16) * 2 * Math.PI;
      const hit = castRay(scene, worlds, inverses, pixelRay(scene.camera, x + 0.5 + radius * Math.cos(angle), y + 0.5 + radius * Math.sin(angle)));
      if (hit.key !== centre.key) return { key: centre.key, margin: best };
    }
    best = radius;
  }
  return { key: centre.key, margin: best };
}

/** Margin and colour of every pixel. */
export function survey(prepared) {
  const cells = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const m = margin(prepared, x, y);
      cells.push({ x, y, key: m.key, margin: m.margin, rgb: m.key === "ambiguous" ? null : colourAt(prepared, x, y).rgb });
    }
  }
  return cells;
}

/** The projected pixel position of a world point (analytic cross-check for the survey). */
export function project(camera, point) {
  const { forward, right, up } = basis(camera);
  const offset = sub(point, camera.position);
  const depth = dot(offset, forward);
  if (camera.orthoHeight !== undefined) {
    const half = camera.orthoHeight / 2;
    return { x: ((dot(offset, right) / half + 1) / 2) * SIZE, y: ((1 - dot(offset, up) / half) / 2) * SIZE, depth };
  }
  const k = depth * Math.tan(camera.fovY / 2);
  return { x: ((dot(offset, right) / k + 1) / 2) * SIZE, y: ((1 - dot(offset, up) / k) / 2) * SIZE, depth };
}
