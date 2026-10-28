// Test support (not shipped): reads the first skin of a GLB file into the compiler's MtekSkin shape
// (all document nodes in order, the skin's joints and inverse-bind matrices, the first skinned mesh node,
// and the animation clips of the file). Vertex influences are not needed by the humanoid tests and stay empty.
import type { MtekSkin } from "../abi/manifest-types.js";

interface GltfNode { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; skin?: number; mesh?: number }
interface Gltf {
  nodes: GltfNode[];
  skins: { joints: number[]; inverseBindMatrices?: number }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  animations?: { name?: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
}

const WIDTH: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(json: Gltf, bin: DataView, index: number): number[] {
  const a = json.accessors[index]!, view = json.bufferViews[a.bufferView]!, width = WIDTH[a.type]!;
  if (a.componentType !== 5126) throw new Error("test GLB reader supports float accessors only");
  const out: number[] = [];
  for (let i = 0; i < a.count; i++)
    for (let c = 0; c < width; c++)
      out.push(bin.getFloat32((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? width * 4) + c * 4, true));
  return out;
}

/** Decomposes a column-major TRS matrix (positive scale assumed, as in the test assets). */
function decompose(m: readonly number[]): { translation: number[]; rotation: number[]; scale: number[] } {
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!), sy = Math.hypot(m[4]!, m[5]!, m[6]!), sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const a = m[0]! / sx, b = m[4]! / sy, c = m[8]! / sz, d = m[1]! / sx, e = m[5]! / sy, f = m[9]! / sz, g = m[2]! / sx, h = m[6]! / sy, j = m[10]! / sz;
  const trace = a + e + j;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; w = s / 4; x = (h - f) / s; y = (c - g) / s; z = (d - b) / s; }
  else if (a > e && a > j) { const s = Math.sqrt(1 + a - e - j) * 2; w = (h - f) / s; x = s / 4; y = (b + d) / s; z = (c + g) / s; }
  else if (e > j) { const s = Math.sqrt(1 + e - a - j) * 2; w = (c - g) / s; x = (b + d) / s; y = s / 4; z = (f + h) / s; }
  else { const s = Math.sqrt(1 + j - a - e) * 2; w = (d - b) / s; x = (c + g) / s; y = (f + h) / s; z = s / 4; }
  return { translation: [m[12]!, m[13]!, m[14]!], rotation: [x, y, z, w], scale: [sx, sy, sz] };
}

export function skinFromGlb(bytes: Uint8Array): MtekSkin {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
  const binAt = 20 + jsonLength;
  const bin = new DataView(bytes.buffer, bytes.byteOffset + binAt + 8, view.getUint32(binAt, true));
  const parents = json.nodes.map(() => -1);
  json.nodes.forEach((n, i) => (n.children ?? []).forEach(c => { parents[c] = i; }));
  const nodes = json.nodes.map((n, i) => {
    const t = n.matrix === undefined ? undefined : decompose(n.matrix);
    return { name: n.name ?? `node${i}`, parent: parents[i]!, translation: t?.translation ?? n.translation ?? [0, 0, 0], rotation: t?.rotation ?? n.rotation ?? [0, 0, 0, 1], scale: t?.scale ?? n.scale ?? [1, 1, 1] };
  });
  const skin = json.skins[0]!, ibm = accessor(json, bin, skin.inverseBindMatrices!);
  const meshNode = json.nodes.findIndex(n => n.skin === 0 && n.mesh !== undefined);
  const clips = (json.animations ?? []).map((animation, k) => {
    const channels = animation.channels.filter(ch => ch.target.path === "translation" || ch.target.path === "rotation" || ch.target.path === "scale").map(ch => {
      const sampler = animation.samplers[ch.sampler]!;
      return { node: ch.target.node, path: ch.target.path as "translation" | "rotation" | "scale", interpolation: "linear" as const, times: accessor(json, bin, sampler.input), values: accessor(json, bin, sampler.output) };
    });
    const duration = Math.max(0, ...channels.map(ch => ch.times[ch.times.length - 1]!));
    return { name: animation.name ?? `clip${k}`, duration, channels };
  });
  return { meshNode, nodes, joints: skin.joints, inverseBind: skin.joints.map((_, j) => ibm.slice(j * 16, j * 16 + 16)), indices: [], weights: [], clips };
}
