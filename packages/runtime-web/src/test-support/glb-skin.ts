import { existsSync, readFileSync } from "node:fs";
import type { MtekSkin } from "../abi/manifest-types.js";

interface GltfNode { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; mesh?: number; skin?: number }
interface Gltf {
  nodes: GltfNode[]; skins?: { joints: number[]; inverseBindMatrices?: number }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  animations?: { name?: string; samplers: { input: number; output: number; interpolation?: string }[]; channels: { sampler: number; target: { node: number; path: string } }[] }[];
}

function decompose(m: readonly number[]): { translation: number[]; rotation: number[]; scale: number[] } {
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!), sy = Math.hypot(m[4]!, m[5]!, m[6]!), sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const r = [m[0]! / sx, m[1]! / sx, m[2]! / sx, m[4]! / sy, m[5]! / sy, m[6]! / sy, m[8]! / sz, m[9]! / sz, m[10]! / sz];
  const trace = r[0]! + r[4]! + r[8]!;
  let q: number[];
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; q = [(r[5]! - r[7]!) / s, (r[6]! - r[2]!) / s, (r[1]! - r[3]!) / s, s / 4]; }
  else if (r[0]! > r[4]! && r[0]! > r[8]!) { const s = Math.sqrt(1 + r[0]! - r[4]! - r[8]!) * 2; q = [s / 4, (r[3]! + r[1]!) / s, (r[6]! + r[2]!) / s, (r[5]! - r[7]!) / s]; }
  else if (r[4]! > r[8]!) { const s = Math.sqrt(1 + r[4]! - r[0]! - r[8]!) * 2; q = [(r[3]! + r[1]!) / s, s / 4, (r[7]! + r[5]!) / s, (r[6]! - r[2]!) / s]; }
  else { const s = Math.sqrt(1 + r[8]! - r[0]! - r[4]!) * 2; q = [(r[6]! + r[2]!) / s, (r[7]! + r[5]!) / s, s / 4, (r[1]! - r[3]!) / s]; }
  return { translation: [m[12]!, m[13]!, m[14]!], rotation: q, scale: [sx, sy, sz] };
}

/**
 * Reads the node hierarchy, skin joints and animations of a local GLB into the skin shape the animation runtime
 * consumes (no vertex influences). Test-only: the production importer is the Rust compiler. Returns undefined
 * when the file does not exist, because the example models are not committed.
 */
export function glbSkin(file: string): MtekSkin | undefined {
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  const bin = bytes.subarray(28 + jsonLength);
  const read = (index: number): number[] => {
    const accessor = json.accessors[index]!, view = json.bufferViews[accessor.bufferView]!;
    const width = ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[accessor.type]!;
    const out: number[] = [], base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    for (let i = 0; i < accessor.count * width; i++) out.push(bin.readFloatLE(base + i * 4));
    return out;
  };
  const parents = json.nodes.map(() => -1);
  json.nodes.forEach((node, i) => (node.children ?? []).forEach(c => { parents[c] = i; }));
  const nodes = json.nodes.map((node, i) => {
    const t = node.matrix !== undefined ? decompose(node.matrix) : { translation: node.translation ?? [0, 0, 0], rotation: node.rotation ?? [0, 0, 0, 1], scale: node.scale ?? [1, 1, 1] };
    return { name: node.name ?? `node${i}`, parent: parents[i]!, ...t };
  });
  const meshNode = json.nodes.findIndex(n => n.skin !== undefined);
  const skin = json.skins![0]!;
  const inverseBind = skin.inverseBindMatrices === undefined ? skin.joints.map(() => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) : (() => {
    const all = read(skin.inverseBindMatrices);
    return skin.joints.map((_, i) => all.slice(i * 16, i * 16 + 16));
  })();
  const clips = (json.animations ?? []).map((animation, i) => {
    const channels = animation.channels.map(channel => {
      const sampler = animation.samplers[channel.sampler]!;
      return { node: channel.target.node, path: channel.target.path as "translation" | "rotation" | "scale",
        interpolation: sampler.interpolation === "STEP" ? "step" as const : "linear" as const, times: read(sampler.input), values: read(sampler.output) };
    });
    const duration = Math.max(0, ...channels.map(c => c.times.at(-1) ?? 0));
    return { name: animation.name ?? `clip${i}`, duration, channels };
  });
  return { meshNode, nodes, joints: skin.joints, inverseBind, indices: [], weights: [], clips };
}
