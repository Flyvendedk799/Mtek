/** Independent acceptance references. No compiler layouts, emitters or runtime
 * math are imported here; these are fixed probe contracts, not general packers. */
export const POSITION_CAPACITY = 72;
export const INVOCATION_CAPACITY = 257;
export const INVOCATION_WORDS = 14; // A storage struct of 14 u32 members has alignment 4 and size 56.
export type Domain = readonly [number, number, number];
export const POSITION_DOMAINS: readonly Domain[] = [[1, 1, 1], [71, 1, 1], [72, 1, 1], [3, 4, 6]];
export const INVOCATION_DOMAIN: Domain = [5, 3, 3];

/** One front-facing quad; remaining source-box faces collapse to degenerate triangles. */
export function positionInput(): Float32Array<ArrayBuffer> {
  const result = new Float32Array(POSITION_CAPACITY);
  result.set([-0.8, -0.55, 0, 0.8, -0.55, 0, 0.8, 0.55, 0, -0.8, 0.55, 0]);
  return result;
}
export function positionReference(input: Float32Array, shift: number, domain: Domain): Float32Array<ArrayBuffer> {
  const result = new Float32Array(POSITION_CAPACITY), count = domain[0] * domain[1] * domain[2];
  if (input.length !== POSITION_CAPACITY || count > POSITION_CAPACITY || domain.some((axis) => !Number.isInteger(axis) || axis < 1)) throw new RangeError("invalid position reference domain/input");
  for (let i = 0; i < count; i++) result[i] = Math.fround(input[i]! + Math.fround(shift));
  return result;
}
export function invocationReference(domain: Domain): Uint32Array<ArrayBuffer> {
  const result = new Uint32Array(INVOCATION_CAPACITY * INVOCATION_WORDS);
  if (domain.some((axis) => !Number.isInteger(axis) || axis < 1) || domain[0] * domain[1] * domain[2] > INVOCATION_CAPACITY) throw new RangeError("invalid invocation reference domain");
  const groups = [Math.ceil(domain[0] / 4), Math.ceil(domain[1] / 2), Math.ceil(domain[2] / 2)];
  for (let z = 0; z < domain[2]; z++) for (let y = 0; y < domain[1]; y++) for (let x = 0; x < domain[0]; x++) {
    const i = x + domain[0] * (y + domain[1] * z), lx = x % 4, ly = y % 2, lz = z % 2;
    result.set([i, x, y, z, lx, ly, lz, Math.floor(x / 4), Math.floor(y / 2), Math.floor(z / 2), groups[0]!, groups[1]!, groups[2]!, lx + 4 * (ly + 2 * lz)], i * INVOCATION_WORDS);
  }
  return result;
}
export function mismatchWords(actual: ArrayBuffer, expected: ArrayBuffer): number {
  if (actual.byteLength !== expected.byteLength) return Math.max(actual.byteLength, expected.byteLength) / 4;
  const a = new Uint32Array(actual), b = new Uint32Array(expected);
  let count = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
  return count;
}
export function pixelDifference(a: Uint8Array, b: Uint8Array, tolerance = 2): number {
  if (a.length !== b.length || a.length % 4 !== 0) throw new RangeError("pixel dimensions differ");
  let count = 0;
  for (let i = 0; i < a.length; i += 4) if ([0, 1, 2, 3].some((channel) => Math.abs(a[i + channel]! - b[i + channel]!) > tolerance)) count++;
  return count;
}

export const POSITION_WGSL = `
struct Config { dimensions: vec3<u32>, shift: f32 }
@group(0) @binding(0) var<uniform> config: Config;
@group(0) @binding(1) var<storage, read> input: array<f32, 72>;
@group(0) @binding(2) var<storage, read_write> output: array<f32, 72>;
@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) p: vec3<u32>) {
  if (any(p >= config.dimensions)) { return; }
  let i = p.x + config.dimensions.x * (p.y + config.dimensions.y * p.z);
  output[i] = input[i] + config.shift;
}`;
export const INVOCATION_WGSL = `
@group(0) @binding(0) var<uniform> dimensions: vec3<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32, 3598>;
@compute @workgroup_size(4, 2, 2)
fn main(@builtin(global_invocation_id) p: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>, @builtin(local_invocation_index) localIndex: u32) {
  if (any(p >= dimensions)) { return; }
  let i = (p.x + dimensions.x * (p.y + dimensions.y * p.z)) * 14u;
  output[i] = i / 14u;
  output[i+1u] = p.x; output[i+2u] = p.y; output[i+3u] = p.z;
  output[i+4u] = local.x; output[i+5u] = local.y; output[i+6u] = local.z;
  output[i+7u] = group.x; output[i+8u] = group.y; output[i+9u] = group.z;
  output[i+10u] = groups.x; output[i+11u] = groups.y; output[i+12u] = groups.z;
  output[i+13u] = localIndex;
}`;

/** Independent flat renderer. Projection/translation is built analytically in the host. */
export const QUAD_WGSL = `
struct Frame { viewProjection: mat4x4<f32>, color: vec4<f32> }
@group(0) @binding(0) var<uniform> frame: Frame;
@vertex fn vs(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return frame.viewProjection * vec4<f32>(position, 1.0);
}
@fragment fn fs() -> @location(0) vec4<f32> { return frame.color; }
`;
