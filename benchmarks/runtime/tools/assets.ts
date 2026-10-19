// The generated assets of the asset-heavy startup workload: one GLB with four named sphere-like meshes of 21,600 triangles
// each, and eight 512 x 512 RGBA PNG textures. Everything is computed from integers and fixed formulas, so the bytes of
// the GLB and the pixels of the textures are the same on every machine (`asset-heavy-startup/assets.sha256.json` records
// their hashes; PNG compression is left to zlib, so the hash covers the decoded pixels, not the compressed file).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssetHeavyDefinition } from "../common/layout.ts";
import { encodePng } from "./png.ts";

export interface MeshData {
  readonly name: string;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint16Array;
}

/** A UV sphere of `segments` x `rings` quads (two triangles each) whose radius is modulated by a mesh-specific wave. */
export function sphereMesh(def: AssetHeavyDefinition, meshIndex: number): MeshData {
  const { sphereSegments: segments, sphereRings: rings, radius } = def;
  const vertexCount = (segments + 1) * (rings + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  for (let j = 0; j <= rings; j += 1) {
    const v = j / rings;
    const theta = v * Math.PI; // 0 at the top pole
    for (let i = 0; i <= segments; i += 1) {
      const u = i / segments;
      const phi = u * 2 * Math.PI;
      const wave = 1 + 0.1 * Math.sin((3 + meshIndex) * phi + meshIndex) * Math.sin(2 * theta + 0.5 * meshIndex);
      const r = radius * wave;
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.cos(theta);
      const nz = Math.sin(theta) * Math.sin(phi);
      const index = j * (segments + 1) + i;
      positions.set([r * nx, r * ny, r * nz], index * 3);
      normals.set([nx, ny, nz], index * 3);
      uvs.set([u, v], index * 2);
    }
  }
  const indices = new Uint16Array(segments * rings * 6);
  let cursor = 0;
  for (let j = 0; j < rings; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = j * (segments + 1) + i;
      const b = a + segments + 1;
      // Counter-clockwise seen from outside (the glTF front face).
      indices.set([a, a + 1, b, a + 1, b + 1, b], cursor);
      cursor += 6;
    }
  }
  return { name: `Rock${String(meshIndex)}`, positions, normals, uvs, indices };
}

function pad4(length: number): number {
  return (4 - (length % 4)) % 4;
}

/** The GLB with all the meshes: one node per mesh, no materials, no textures (the textures are separate files). */
export function buildGlb(def: AssetHeavyDefinition): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const nodes: object[] = [];
  const addView = (bytes: Buffer, target: number): number => {
    const padded = Buffer.concat([bytes, Buffer.alloc(pad4(bytes.length))]);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(padded);
    offset += padded.length;
    return bufferViews.length - 1;
  };
  for (let m = 0; m < def.meshes; m += 1) {
    const mesh = sphereMesh(def, m);
    const count = mesh.positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const value = Math.fround(mesh.positions[i * 3 + c] as number);
        min[c] = Math.min(min[c] as number, value);
        max[c] = Math.max(max[c] as number, value);
      }
    }
    const viewOf = (array: Float32Array | Uint16Array, target: number): number =>
      addView(Buffer.from(array.buffer, array.byteOffset, array.byteLength), target);
    const position = viewOf(mesh.positions, 34962);
    const normal = viewOf(mesh.normals, 34962);
    const uv = viewOf(mesh.uvs, 34962);
    const index = viewOf(mesh.indices, 34963);
    const accessorBase = accessors.length;
    accessors.push(
      { bufferView: position, componentType: 5126, count, type: "VEC3", min, max },
      { bufferView: normal, componentType: 5126, count, type: "VEC3" },
      { bufferView: uv, componentType: 5126, count, type: "VEC2" },
      { bufferView: index, componentType: 5123, count: mesh.indices.length, type: "SCALAR" },
    );
    meshes.push({
      name: mesh.name,
      primitives: [{ attributes: { POSITION: accessorBase, NORMAL: accessorBase + 1, TEXCOORD_0: accessorBase + 2 }, indices: accessorBase + 3, mode: 4 }],
    });
    nodes.push({ name: mesh.name, mesh: m });
  }
  const bin = Buffer.concat(chunks);
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0", generator: "mtek benchmarks/runtime/tools/assets.ts" },
      scene: 0,
      scenes: [{ nodes: nodes.map((_, i) => i) }],
      nodes,
      meshes,
      buffers: [{ byteLength: bin.length }],
      bufferViews,
      accessors,
    }),
    "utf8",
  );
  const jsonPadded = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]);
  const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const header = Buffer.alloc(12 + 8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  header.writeUInt32LE(jsonPadded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonPadded, binHeader, bin]);
}

// ---- textures ---------------------------------------------------------------------------------------------------

function hash32(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n = (ix: number, iy: number): number => hash32(ix, iy, seed) / 4294967296;
  const top = n(x0, y0) * (1 - sx) + n(x0 + 1, y0) * sx;
  const bottom = n(x0, y0 + 1) * (1 - sx) + n(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** RGBA pixels, row by row, top row first. */
export function texturePixels(def: AssetHeavyDefinition, textureIndex: number): Uint8Array {
  const size = def.textureSize;
  const pixels = new Uint8Array(size * size * 4);
  const hueA = (textureIndex * 47) % 256;
  const colorA = [64 + ((hueA * 3) % 160), 64 + ((hueA * 5) % 160), 64 + ((hueA * 7) % 160)];
  const colorB = [255 - (colorA[0] as number), 255 - (colorA[1] as number), 255 - (colorA[2] as number)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let wave = 0;
      let amplitude = 0.5;
      let frequency = 1 / 64;
      for (let octave = 0; octave < 4; octave += 1) {
        wave += amplitude * valueNoise(x * frequency, y * frequency, textureIndex * 8 + octave);
        amplitude /= 2;
        frequency *= 2;
      }
      const checker = ((x >> 5) ^ (y >> 5)) & 1 ? 0.12 : 0;
      const grain = ((hash32(x, y, 1000 + textureIndex) & 15) - 8) / 255;
      const t = Math.min(1, Math.max(0, wave * 1.3 + checker + grain));
      const offset = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        pixels[offset + c] = Math.round((colorA[c] as number) * (1 - t) + (colorB[c] as number) * t);
      }
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface AssetHashes {
  readonly glb: string;
  readonly texturePixels: readonly string[];
}

export function assetHashes(def: AssetHeavyDefinition): AssetHashes {
  return {
    glb: sha256(buildGlb(def)),
    texturePixels: Array.from({ length: def.textures }, (_, i) => sha256(texturePixels(def, i))),
  };
}

/** Writes `models/rocks.glb` and `textures/t<i>.png` below `directory`; returns the paths written (relative). */
export function writeAssets(def: AssetHeavyDefinition, directory: string, layout: "project" | "flat"): string[] {
  const glbPath = layout === "project" ? "models/rocks.glb" : "rocks.glb";
  const written: string[] = [];
  const put = (path: string, bytes: Uint8Array): void => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    written.push(path);
  };
  put(glbPath, buildGlb(def));
  for (let i = 0; i < def.textures; i += 1) {
    put(layout === "project" ? `textures/t${String(i)}.png` : `t${String(i)}.png`, encodePng(def.textureSize, def.textureSize, texturePixels(def, i)));
  }
  return written;
}
