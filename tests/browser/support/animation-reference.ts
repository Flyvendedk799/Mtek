// Decision 0224: the CPU references of the composable-animation acceptance. Nothing here reads the running program: the
// rigs and their clips come from the committed GLB files, the blend weights from the geometry of the sample layout, the
// ground from the numbers in the example's source, and the image from CPU skinning and a CPU rasteriser.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AnimationController, retargetHumanoid, type MtekSkin } from "../../../packages/runtime-web/src/animation.js";
import { skinFromGlb } from "../../../packages/runtime-web/src/test-support/glb-skin.js";
import { REPO_ROOT } from "./environment.ts";

export type V3 = readonly [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => norm(sub(a, b));
export const unit = (a: V3): V3 => scale(a, 1 / norm(a));
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const smoothstep01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
export const angleBetween = (a: V3, b: V3): number => Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b)))));
/** Rotation about +Y by `angle` of a vector (the heading of the figure): +Z goes to (sin, 0, cos). */
export const rotateY = (v: V3, angle: number): V3 => [v[0] * Math.cos(angle) + v[2] * Math.sin(angle), v[1], -v[0] * Math.sin(angle) + v[2] * Math.cos(angle)];

/** Rotation of `v` by the unit quaternion `q` (x, y, z, w). */
export function rotateByQuat(q: { x: number; y: number; z: number; w: number }, v: V3): V3 {
  const t: V3 = [2 * (q.y * v[2] - q.z * v[1]), 2 * (q.z * v[0] - q.x * v[2]), 2 * (q.x * v[1] - q.y * v[0])];
  return [v[0] + q.w * t[0] + (q.y * t[2] - q.z * t[1]), v[1] + q.w * t[1] + (q.z * t[0] - q.x * t[2]), v[2] + q.w * t[2] + (q.x * t[1] - q.y * t[0])];
}

export const EXAMPLE_MODELS = join(REPO_ROOT, "examples", "animation-composition", "models");

export interface Rig {
  readonly bytes: Uint8Array;
  readonly skin: MtekSkin;
  readonly mesh: SkinnedMesh;
}
export interface SkinnedMesh {
  /** Bind-pose vertex positions (x, y, z per vertex), the joint (an index into `skin.joints`) of each vertex and the triangle indices. */
  readonly positions: Float32Array;
  readonly joints: Uint8Array;
  readonly indices: Uint16Array;
}

interface Gltf {
  accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices: number }> }>;
}

/** The first primitive of the first mesh: positions (float), joints (unsigned byte, first of four) and indices (unsigned short). */
export function readSkinnedMesh(bytes: Uint8Array): SkinnedMesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
  const binAt = 20 + jsonLength + 8;
  const at = (accessor: number): { start: number; count: number; type: string; componentType: number } => {
    const a = json.accessors[accessor]!;
    const v = json.bufferViews[a.bufferView]!;
    return { start: binAt + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), count: a.count, type: a.type, componentType: a.componentType };
  };
  const primitive = json.meshes[0]!.primitives[0]!;
  const p = at(primitive.attributes["POSITION"]!);
  const j = at(primitive.attributes["JOINTS_0"]!);
  const i = at(primitive.indices);
  if (p.componentType !== 5126 || j.componentType !== 5121 || i.componentType !== 5123) throw new Error("unexpected component types in the example model");
  const positions = new Float32Array(p.count * 3);
  for (let k = 0; k < positions.length; k += 1) positions[k] = view.getFloat32(p.start + k * 4, true);
  const joints = new Uint8Array(j.count);
  for (let k = 0; k < j.count; k += 1) joints[k] = view.getUint8(j.start + k * 4);
  const indices = new Uint16Array(i.count);
  for (let k = 0; k < i.count; k += 1) indices[k] = view.getUint16(i.start + k * 2, true);
  return { positions, joints, indices };
}

function loadRig(file: string): Rig {
  const bytes = new Uint8Array(readFileSync(join(EXAMPLE_MODELS, file)));
  return { bytes, skin: skinFromGlb(bytes), mesh: readSkinnedMesh(bytes) };
}

let rigs: { hero: Rig; guest: Rig } | undefined;
export function heroRig(): Rig {
  rigs ??= { hero: loadRig("Hero.glb"), guest: loadRig("Guest.glb") };
  return rigs.hero;
}
export function guestRig(): Rig {
  rigs ??= { hero: loadRig("Hero.glb"), guest: loadRig("Guest.glb") };
  return rigs.guest;
}

/** What the runtime does at mount for `clips_from: HERO` on the Guest: the Guest's own skeleton with the Hero's clips, retargeted. */
export function retargetedGuest(): MtekSkin {
  return retargetHumanoid(heroRig().skin, guestRig().skin);
}

/** Joint positions (mesh-local, by node name) of `skin` playing `clip` after `seconds` from time zero, evaluated on the CPU; `rootOwner` names a joint whose travel the host owns (it stays at bind, as in the example). */
export function cpuPose(skin: MtekSkin, clip: string, seconds: number, rootOwner?: string): { nodes: Map<string, V3>; palette: Float32Array } {
  const controller = new AnimationController(skin, { clip });
  if (rootOwner !== undefined) controller.player.setRootMotion(rootOwner);
  const duration = skin.clips.find((c) => c.name === clip)?.duration ?? 1;
  controller.player.advance(seconds % duration, true);
  controller.player.evaluate();
  const nodes = new Map<string, V3>();
  for (const node of controller.player.inspect?.().nodes ?? []) nodes.set(node.name, [node.position.x, node.position.y, node.position.z]);
  const palette = Float32Array.from(controller.player.palette);
  controller.dispose();
  return { nodes, palette };
}

/** The bind pose of `skin`: joint positions and an identity palette. */
export function bindPose(skin: MtekSkin): { nodes: Map<string, V3>; palette: Float32Array } {
  const controller = new AnimationController(skin, {});
  controller.player.evaluate();
  const nodes = new Map<string, V3>();
  for (const node of controller.player.inspect?.().nodes ?? []) nodes.set(node.name, [node.position.x, node.position.y, node.position.z]);
  const palette = Float32Array.from(controller.player.palette);
  controller.dispose();
  return { nodes, palette };
}

/** The translation of the node `joint` over one cycle of `clip`, divided by the duration: the clip's own travel speed (m/s). */
export function clipTravel(skin: MtekSkin, clip: string, joint: string): V3 {
  const node = skin.nodes.findIndex((n) => n.name === joint);
  const c = skin.clips.find((candidate) => candidate.name === clip);
  const channel = c?.channels.find((ch) => ch.node === node && ch.path === "translation");
  if (c === undefined || channel === undefined) throw new Error(`no translation of ${joint} in ${clip}`);
  const n = channel.times.length;
  const last: V3 = [channel.values[(n - 1) * 3]!, channel.values[(n - 1) * 3 + 1]!, channel.values[(n - 1) * 3 + 2]!];
  const first: V3 = [channel.values[0]!, channel.values[1]!, channel.values[2]!];
  return scale(sub(last, first), 1 / (channel.times[n - 1]! - channel.times[0]!));
}

/** The mesh-local frame of the Hero's figure in the world: its soles are `figureBase` below the capsule's centre, turned by the capsule's rotation. */
export function figureToWorld(hero: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }, figureBase: number, local: V3): V3 {
  const origin = add([hero.position.x, hero.position.y, hero.position.z], rotateByQuat(hero.rotation, [0, -figureBase, 0]));
  return add(origin, rotateByQuat(hero.rotation, local));
}

/**
 * Signed distance of the middle joint of a two-bone limb from the line between its ends, along the side `side` (a vector that is not
 * parallel to the limb): positive when the joint bends toward `side` (a knee toward the character's front, an elbow toward its back).
 */
export function bendSide(upper: V3, middle: V3, end: V3, side: V3): number {
  const axis = unit(sub(end, upper));
  const q = unit(sub(side, scale(axis, dot(side, axis))));
  const along = dot(sub(middle, upper), axis);
  const offset = sub(sub(middle, upper), scale(axis, along));
  return dot(offset, q);
}

// ---- the blend space (decision 0220) ------------------------------------------------------------------------------------

/** The sample layout of the example: transcribed from its `blend_sample` calls (a unit test finds them in the source). */
export const BLEND_LAYOUT = [
  { clip: "Idle", x: 0, y: 0 },
  { clip: "Walk", x: 0, y: 1 },
  { clip: "Run", x: 0, y: 2 },
  { clip: "StrafeLeft", x: -1, y: 0 },
  { clip: "StrafeRight", x: 1, y: 0 },
] as const;

type P2 = readonly [number, number];
const IDLE: P2 = [0, 0], WALK: P2 = [0, 1], RUN: P2 = [0, 2], LEFT: P2 = [-1, 0], RIGHT: P2 = [1, 0];
/**
 * The Delaunay triangulation of the five points: the hull is the triangle LEFT, RIGHT, RUN (IDLE lies on the edge between
 * the first two, WALK inside). Two triangulations of the quadrilateral LEFT, IDLE ... are possible only when four points
 * are cocircular, and none are: the circumcircle of (LEFT, WALK, RUN) has its centre at (-1.5, 1.5) and radius^2 2.5, and
 * IDLE (distance^2 4.5) and RIGHT lie outside; that of (LEFT, IDLE, WALK) has centre (-0.5, 0.5), radius^2 0.5, and RUN
 * (distance^2 2.5) lies outside. The mirror images hold for RIGHT. So the triangles below are the only Delaunay ones.
 */
const TRIANGLES: ReadonlyArray<readonly [number, number, number]> = [
  [3, 0, 1], // LEFT, IDLE, WALK
  [0, 4, 1], // IDLE, RIGHT, WALK
  [3, 1, 2], // LEFT, WALK, RUN
  [1, 4, 2], // WALK, RIGHT, RUN
];
const POINTS: readonly P2[] = [IDLE, WALK, RUN, LEFT, RIGHT];

function barycentric(p: P2, a: P2, b: P2, c: P2): [number, number, number] {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const l1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d;
  const l2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d;
  return [l1, l2, 1 - l1 - l2];
}

function nearestOnSegment(p: P2, a: P2, b: P2): P2 {
  const ab: P2 = [b[0] - a[0], b[1] - a[1]];
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}

/** Weights (in the order of `BLEND_LAYOUT`) at the parameter `(x, y)`: barycentric inside the hull, those of the nearest hull point outside. */
export function referenceBlendWeights(x: number, y: number): number[] {
  let p: P2 = [x, y];
  const inside = (q: P2): boolean => TRIANGLES.some(([i, j, k]) => barycentric(q, POINTS[i]!, POINTS[j]!, POINTS[k]!).every((l) => l >= -1e-12));
  if (!inside(p)) {
    const hull: ReadonlyArray<readonly [P2, P2]> = [[LEFT, RIGHT], [RIGHT, RUN], [RUN, LEFT]];
    let best = Infinity;
    for (const [a, b] of hull) {
      const q = nearestOnSegment([x, y], a, b);
      const d = Math.hypot(q[0] - x, q[1] - y);
      if (d < best) { best = d; p = q; }
    }
  }
  const weights = [0, 0, 0, 0, 0];
  for (const [i, j, k] of TRIANGLES) {
    const l = barycentric(p, POINTS[i]!, POINTS[j]!, POINTS[k]!);
    if (l.every((v) => v >= -1e-12)) {
      weights[i] = l[0]; weights[j] = l[1]; weights[k] = l[2];
      return weights.map((w) => Math.max(0, w)).map((w, _, all) => w / all.reduce((s, v) => s + v, 0));
    }
  }
  throw new Error("point in no triangle");
}

// ---- the ground (the example's `ground` function, transcribed) --------------------------------------------------------------

const smoothstep = (a: number, b: number, x: number): number => smoothstep01((x - a) / (b - a));
/** Height of the ground at (x, z): the example's `fn ground`. */
export function groundHeight(x: number, z: number): number {
  const strip = 1 - smoothstep(2.8, 3.2, Math.abs(x));
  const stairs = 0.15 * smoothstep(3.35, 3.65, z) + 0.15 * smoothstep(4.35, 4.65, z);
  const ramp = 0.3 * Math.min(1, Math.max(0, (z - 7.5) / 1.5));
  const curb = 0.2 * smoothstep(-0.05, 0.05, x) * smoothstep(-0.1, 0.1, z) * (1 - smoothstep(1.9, 2.1, z));
  return strip * (stairs - ramp + curb);
}

// ---- the leg reach and the minimum hips drop (decision 0222, spec/animation.md 3.3 and 3.4) ------------------------------------

export interface LegReach {
  /** Chord lengths of the thigh and the shin, measured on the animated pose. */
  a: number;
  b: number;
  /** Greatest and least reach from the hip joint with the knee range 0 to 150 degrees, and the soft margin. */
  cmax: number;
  cmin: number;
  w: number;
}
export function legReach(hip: V3, knee: V3, ankle: V3, softness = 0.05, flexionMax = (150 * Math.PI) / 180): LegReach {
  const a = dist(hip, knee), b = dist(knee, ankle);
  const cmax = a + b;
  const cmin = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(flexionMax));
  return { a, b, cmax, cmin, w: softness * (cmax - cmin) };
}

/**
 * The smallest drop of the hips along +Y that brings an ankle target within the exact reach `cmax - w` of the hip joint:
 * `delta` with `|T - (P - delta up)| = L`, the smaller root of `delta^2 + 2 p delta + q = 0`; zero when already within.
 */
export function minimumDrop(hip: V3, target: V3, reach: LegReach): number {
  const v = sub(target, hip);
  const limit = reach.cmax - reach.w;
  const p = v[1];
  const q = dot(v, v) - limit * limit;
  if (q <= 0) return 0;
  const disc = p * p - q;
  return disc < 0 ? Math.max(0, -p) : Math.max(0, -p - Math.sqrt(disc));
}

// ---- the image: CPU skinning, a camera and a rasteriser --------------------------------------------------------------------

/** Column-major palette skinning of the bind positions of `mesh`: mesh-local positions of every vertex. */
export function skinVertices(mesh: SkinnedMesh, palette: Float32Array): Float64Array {
  const out = new Float64Array(mesh.positions.length);
  for (let v = 0; v < mesh.joints.length; v += 1) {
    const m = mesh.joints[v]! * 16;
    const x = mesh.positions[v * 3]!, y = mesh.positions[v * 3 + 1]!, z = mesh.positions[v * 3 + 2]!;
    for (let r = 0; r < 3; r += 1) out[v * 3 + r] = palette[m + r]! * x + palette[m + 4 + r]! * y + palette[m + 8 + r]! * z + palette[m + 12 + r]!;
  }
  return out;
}

export interface Camera {
  eye: V3;
  target: V3;
  fovY: number;
  width: number;
  height: number;
}
/** The pixel (x right, y down, centres at +0.5) of a world point, and the depth in front of the camera. */
export function project(camera: Camera, p: V3): { x: number; y: number; depth: number } {
  const f = unit(sub(camera.target, camera.eye));
  // right = f x up with up = (0, 1, 0); up' = right x f.
  const r = unit([-f[2], 0, f[0]]);
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d = sub(p, camera.eye);
  const cx = dot(d, r), cy = dot(d, u), depth = dot(d, f);
  const t = Math.tan(camera.fovY / 2);
  const ndcX = cx / depth / (t * (camera.width / camera.height));
  const ndcY = cy / depth / t;
  return { x: ((ndcX + 1) / 2) * camera.width, y: ((1 - ndcY) / 2) * camera.height, depth };
}

/** Coverage of triangles (world positions, indices) at pixel centres, depth-agnostic: 1 where any triangle covers the centre. */
export function rasterMask(camera: Camera, world: ArrayLike<number>, indices: ArrayLike<number>): Uint8Array {
  const { width, height } = camera;
  const mask = new Uint8Array(width * height);
  const pts: Array<{ x: number; y: number; depth: number }> = [];
  for (let v = 0; v < world.length / 3; v += 1) pts.push(project(camera, [world[v * 3]!, world[v * 3 + 1]!, world[v * 3 + 2]!]));
  for (let t = 0; t < indices.length; t += 3) {
    const a = pts[indices[t]!]!, b = pts[indices[t + 1]!]!, c = pts[indices[t + 2]!]!;
    if (a.depth <= 0.05 || b.depth <= 0.05 || c.depth <= 0.05) continue;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

/** Number of set pixels with an unset 4-neighbour (or on the border): the length of the boundary in pixels. */
export function boundaryPixels(mask: Uint8Array, width: number, height: number): number {
  let n = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) continue;
      const open = x === 0 || y === 0 || x === width - 1 || y === height - 1 || mask[y * width + x - 1] === 0 || mask[y * width + x + 1] === 0 || mask[(y - 1) * width + x] === 0 || mask[(y + 1) * width + x] === 0;
      if (open) n += 1;
    }
  }
  return n;
}

/** Pixels (RGBA, row by row from the top) for which `test(r, g, b)` holds, as a mask. */
export function classify(data: ArrayLike<number>, width: number, height: number, test: (r: number, g: number, b: number) => boolean): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) mask[i] = test(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!) ? 1 : 0;
  return mask;
}
/** The Hero's orange (#e8863a under the example's light): green and blue are fixed fractions of red, whatever the shading. */
export const isHeroOrange = (r: number, g: number, b: number): boolean => r > 30 && g / r > 0.4 && g / r < 0.75 && b / r < 0.42;
/** The Guest's blue (#4f86d9): blue is more than twice red; the floor's grey-blue (#3a4150) is 1.4 times and the clear colour 1.8 times. */
export const isGuestBlue = (r: number, g: number, b: number): boolean => b > 60 && b / Math.max(r, 1) > 2.1;

export interface MaskComparison {
  /** Pixels set in exactly one of the masks. */
  difference: number;
  referencePixels: number;
  imagePixels: number;
  /** Boundary pixels of the reference mask: the symmetric difference of two rasterisations of one outline lies along it. */
  boundary: number;
  centroidShift: number;
  iou: number;
}
export function compareMasks(reference: Uint8Array, image: Uint8Array, width: number, height: number): MaskComparison {
  let difference = 0, a = 0, b = 0, both = 0;
  const ca = [0, 0], cb = [0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const r = reference[y * width + x]!, i = image[y * width + x]!;
      if (r !== i) difference += 1;
      if (r === 1) { a += 1; ca[0]! += x + 0.5; ca[1]! += y + 0.5; }
      if (i === 1) { b += 1; cb[0]! += x + 0.5; cb[1]! += y + 0.5; }
      if (r === 1 && i === 1) both += 1;
    }
  }
  const shift = a === 0 || b === 0 ? Infinity : Math.hypot(ca[0]! / a - cb[0]! / b, ca[1]! / a - cb[1]! / b);
  return { difference, referencePixels: a, imagePixels: b, boundary: boundaryPixels(reference, width, height), centroidShift: shift, iou: both / Math.max(1, a + b - both) };
}
