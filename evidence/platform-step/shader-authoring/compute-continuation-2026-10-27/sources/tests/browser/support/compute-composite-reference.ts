/** Fixed acceptance contracts, independent of generated layouts and writers.
 * Padding is deliberately poisoned on upload and excluded from active output
 * comparisons: WGSL struct assignment does not specify padding bytes. Every
 * byte in undispatched output slots must still be zero. */
import type { Domain } from "./compute-reference.ts";

export interface CompositeCase {
  name: string; kind: number; strideWords: number; fields: readonly number[];
  input: ArrayBuffer; scalar: Float32Array<ArrayBuffer>; small: Float32Array<ArrayBuffer>;
}
export const COMPOSITE_PARAMS = { gain: 1.5, enabled: false, offset: { x: -0.5, y: 0.25, z: 2 }, table: [3, 7] };
export function compositeCases(): CompositeCase[] {
  return [
    { name: "ScalarCopy", kind: 1, strideWords: 1, fields: [0] },
    { name: "VectorCopy", kind: 2, strideWords: 4, fields: [0, 1, 2, 3] },
    { name: "MatrixCopy", kind: 3, strideWords: 16, fields: Array.from({ length: 16 }, (_, i) => i) },
    { name: "ArrayCopy", kind: 4, strideWords: 8, fields: [0, 4] },
    { name: "Transform", kind: 5, strideWords: 24, fields: [0, 1, 2, 3, 4, 8, 12, 16, 20, 21, 22, 23] },
    { name: "Required", kind: 6, strideWords: 1, fields: [0] },
  ].map(contract => {
    const input = new ArrayBuffer(17 * contract.strideWords * 4), words = new Uint32Array(input), floats = new Float32Array(input);
    const scalar = new Float32Array(17), small = new Float32Array(17);
    words.fill(0xdeadbeef);
    for (let i = 0; i < 17; i++) {
      scalar[i] = i * 0.125; small[i] = i * 0.5;
      for (const field of contract.fields) floats[i * contract.strideWords + field] = (i * 16 + field) * 0.25;
      if (contract.kind === 5) words[i * 24 + 3] = i % 2;
    }
    return { ...contract, input, scalar, small };
  });
}
export function compositeReference(probe: CompositeCase, domain: Domain, enabled = false): ArrayBuffer {
  const count = domain[0] * domain[1] * domain[2];
  if (domain.some(axis => !Number.isInteger(axis) || axis < 1) || count > 17) throw new RangeError("invalid composite domain");
  const output = new ArrayBuffer(probe.input.byteLength), source = new Uint32Array(probe.input), words = new Uint32Array(output), floats = new Float32Array(output);
  for (let i = 0; i < count; i++) {
    const at = i * probe.strideWords;
    for (const field of probe.fields) words[at + field] = source[at + field]!;
    if (probe.kind === 6) floats[at] = Math.fround(i + 1.5);
    if (probe.kind === 5) {
      for (const [axis, offset] of [-0.5, 0.25, 2].entries()) floats[at + axis] = Math.fround(floats[at + axis]! + Math.fround(offset * 1.5));
      words[at + 3] = enabled ? 1 : 0;
      floats[at + 8] = Math.fround(Math.fround(probe.scalar[i]! + probe.small[i]!) + 3);
    }
  }
  return output;
}
export function compositeMismatches(actual: ArrayBuffer, expected: ArrayBuffer, probe: CompositeCase, domain: Domain): number {
  if (actual.byteLength !== expected.byteLength) return Math.max(actual.byteLength, expected.byteLength) / 4;
  const a = new Uint32Array(actual), b = new Uint32Array(expected), active = domain[0] * domain[1] * domain[2] * probe.strideWords;
  let mismatches = 0;
  for (let i = 0; i < a.length; i++) if ((i >= active || probe.fields.includes(i % probe.strideWords)) && a[i] !== b[i]) mismatches++;
  return mismatches;
}

/** Uses a deliberately different 48-byte parameter ABI and scalar word-addressed
 * storage instead of the compiler's 144-byte uniforms / generated struct types. */
export const COMPOSITE_WGSL = `
struct Config { dimensions: vec3u, kind: u32, gain: f32, enabled: u32, padding: vec2u, offset: vec3f, table: f32 }
@group(0) @binding(0) var<uniform> config: Config;
@group(0) @binding(1) var<storage, read> source: array<u32>;
@group(0) @binding(2) var<storage, read> scalar: array<f32>;
@group(0) @binding(3) var<storage, read> small: array<f32>;
@group(0) @binding(4) var<storage, read_write> result: array<u32>;
@compute @workgroup_size(4, 2, 2)
fn main(@builtin(global_invocation_id) p: vec3u) {
  if (any(p >= config.dimensions)) { return; }
  let i = p.x + config.dimensions.x * (p.y + config.dimensions.y * p.z);
  if (config.kind == 1u) { result[i] = source[i]; }
  if (config.kind == 2u || config.kind == 3u) {
    let size = select(4u, 16u, config.kind == 3u);
    for (var k = 0u; k < size; k++) { result[i * size + k] = source[i * size + k]; }
  }
  if (config.kind == 4u) { result[i * 8u] = source[i * 8u]; result[i * 8u + 4u] = source[i * 8u + 4u]; }
  if (config.kind == 6u) { result[i] = bitcast<u32>(f32(i) + config.gain); }
  if (config.kind == 5u) {
    let at = i * 24u;
    result[at] = bitcast<u32>(bitcast<f32>(source[at]) + config.offset.x * config.gain);
    result[at+1u] = bitcast<u32>(bitcast<f32>(source[at+1u]) + config.offset.y * config.gain);
    result[at+2u] = bitcast<u32>(bitcast<f32>(source[at+2u]) + config.offset.z * config.gain);
    result[at+3u] = config.enabled;
    result[at+4u] = source[at+4u];
    result[at+8u] = bitcast<u32>((scalar[i] + small[i]) + config.table);
    result[at+12u] = source[at+12u]; result[at+16u] = source[at+16u];
    for (var k = 20u; k < 24u; k++) { result[at+k] = source[at+k]; }
  }
}`;
