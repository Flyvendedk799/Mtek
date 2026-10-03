/**
 * Primitive mesh generation (`spec/stdlib.md` 4, normative).
 *
 * The runtime generates Box, Sphere and Plane geometry from descriptor values with
 * exactly these algorithms so tests can predict vertices and pixels. Every
 * primitive provides `position`, `normal` and `uv` (glTF convention: uv origin
 * top-left, `v` grows downward). Triangles are counter-clockwise when seen from
 * outside. Index format: `uint16` if the vertex count is at most 65 535, else
 * `uint32`. Trigonometry is evaluated in f64 (`Math.sin`/`Math.cos`) and stored as
 * f32.
 *
 * Descriptors use the manifest form (`spec/runtime-abi.md` 5: `"size": [1, 1, 1]`).
 * Values outside the ranges of `spec/stdlib.md` 3.4 throw `RangeError`; the
 * compiler already rejects them as `E5006`, so this is a defensive check.
 */

/** Generated geometry. Vertex attributes are tightly packed, one entry per vertex. */
export interface MeshData {
  /** `xyz` per vertex. */
  readonly positions: Float32Array;
  /** Unit `xyz` per vertex. */
  readonly normals: Float32Array;
  /** `uv` per vertex. */
  readonly uvs: Float32Array;
  /** Triangle list; `Uint16Array` up to 65 535 vertices, `Uint32Array` above. */
  readonly indices: Uint16Array | Uint32Array;
  /** Radius of the bounding sphere around the origin. */
  readonly boundingRadius: number;
}

/** Largest vertex count that is still indexed with 16 bits. */
export const MAX_UINT16_VERTICES = 65535;

export const SPHERE_MIN_SEGMENTS = 3;
export const SPHERE_MAX_SEGMENTS = 256;
export const SPHERE_MIN_RINGS = 2;
export const SPHERE_MAX_RINGS = 256;

type V3 = readonly [number, number, number];

interface BoxFace {
  /** Face normal `n`. */
  readonly n: V3;
  /** In-face axes with `u x v = n`. */
  readonly u: V3;
  readonly v: V3;
  /** Which half extent (0 = x, 1 = y, 2 = z) runs along `u` and along `v`. */
  readonly uAxis: 0 | 1 | 2;
  readonly vAxis: 0 | 1 | 2;
}

/** Faces in the normative order +X, -X, +Y, -Y, +Z, -Z. */
const BOX_FACES: readonly BoxFace[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], uAxis: 2, vAxis: 1 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], uAxis: 2, vAxis: 1 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], uAxis: 0, vAxis: 2 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], uAxis: 0, vAxis: 2 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], uAxis: 0, vAxis: 1 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], uAxis: 0, vAxis: 1 },
];

/** Per-vertex signs of `(a, b)` for `c + sa*a*u + sb*b*v` and the matching uv corner. */
const FACE_CORNERS: ReadonlyArray<{ readonly sa: number; readonly sb: number; readonly uv: readonly [number, number] }> = [
  { sa: -1, sb: -1, uv: [0, 1] },
  { sa: 1, sb: -1, uv: [1, 1] },
  { sa: 1, sb: 1, uv: [1, 0] },
  { sa: -1, sb: 1, uv: [0, 0] },
];

/** Indices of one quad relative to its first vertex. */
const QUAD_INDICES: readonly number[] = [0, 1, 2, 0, 2, 3];

function component(v: V3, axis: 0 | 1 | 2): number {
  return v[axis];
}

function requirePositiveFinite(value: number, what: string): void {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${what} must be finite and greater than 0 (got ${value})`);
  }
}

function requireIntegerInRange(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} must be an integer in ${min}..${max} (got ${value})`);
  }
}

/** Allocates the index array in the narrowest format that can address `vertexCount` vertices. */
function allocateIndices(vertexCount: number, indexCount: number): Uint16Array | Uint32Array {
  return vertexCount <= MAX_UINT16_VERTICES ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
}

/**
 * Writes the four vertices of `face` (centre `c`, half extents `halfU` along `u` and
 * `halfV` along `v`) as `c - a*u - b*v`, `c + a*u - b*v`, `c + a*u + b*v`,
 * `c - a*u + b*v` with uv corners `(0,1)`, `(1,1)`, `(1,0)`, `(0,0)`.
 */
function writeFace(
  face: BoxFace,
  centre: V3,
  halfU: number,
  halfV: number,
  vertexOffset: number,
  buffers: { positions: Float32Array; normals: Float32Array; uvs: Float32Array },
): void {
  for (let k = 0; k < 4; k++) {
    const corner = FACE_CORNERS[k];
    if (corner === undefined) throw new Error("unreachable: quad corner");
    const a = corner.sa * halfU;
    const b = corner.sb * halfV;
    const vertex = vertexOffset + k;
    for (let axis = 0; axis < 3; axis++) {
      const i = axis as 0 | 1 | 2;
      // `+ 0` normalises a negative zero produced by multiplying by a zero axis component
      buffers.positions[vertex * 3 + axis] = component(centre, i) + a * component(face.u, i) + b * component(face.v, i) + 0;
      buffers.normals[vertex * 3 + axis] = component(face.n, i);
    }
    buffers.uvs[vertex * 2] = corner.uv[0];
    buffers.uvs[vertex * 2 + 1] = corner.uv[1];
  }
}

/** Box with full extents `size = (sx, sy, sz)`: 24 vertices (flat normals), 36 indices. */
export function generateBox(size: readonly [number, number, number]): MeshData {
  const [sx, sy, sz] = size;
  requirePositiveFinite(sx, "box size x");
  requirePositiveFinite(sy, "box size y");
  requirePositiveFinite(sz, "box size z");
  const h: V3 = [sx / 2, sy / 2, sz / 2];

  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const uvs = new Float32Array(24 * 2);
  const indices = allocateIndices(24, 36);

  BOX_FACES.forEach((face, f) => {
    const centre: V3 = [face.n[0] * h[0], face.n[1] * h[1], face.n[2] * h[2]];
    writeFace(face, centre, component(h, face.uAxis), component(h, face.vAxis), f * 4, { positions, normals, uvs });
    QUAD_INDICES.forEach((offset, k) => {
      indices[f * 6 + k] = f * 4 + offset;
    });
  });

  return { positions, normals, uvs, indices, boundingRadius: Math.hypot(h[0], h[1], h[2]) };
}

/**
 * Plane of extents `size = (sx, sz)` along X and Z: the +Y face of a box with half
 * extents `(sx / 2, ., sz / 2)` placed at `y = 0`. 4 vertices, 6 indices, normal
 * `(0, 1, 0)`. Single-sided (back-face culled from below).
 */
export function generatePlane(size: readonly [number, number]): MeshData {
  const [sx, sz] = size;
  requirePositiveFinite(sx, "plane size x");
  requirePositiveFinite(sz, "plane size z");
  const top = BOX_FACES[2];
  if (top === undefined) throw new Error("unreachable: +Y face");

  const positions = new Float32Array(4 * 3);
  const normals = new Float32Array(4 * 3);
  const uvs = new Float32Array(4 * 2);
  const indices = allocateIndices(4, 6);

  writeFace(top, [0, 0, 0], sx / 2, sz / 2, 0, { positions, normals, uvs });
  QUAD_INDICES.forEach((offset, k) => {
    indices[k] = offset;
  });

  return { positions, normals, uvs, indices, boundingRadius: Math.hypot(sx, sz) / 2 };
}

/**
 * UV sphere of `radius`, `segments` (3..256) around Y and `rings` (2..256) from pole
 * to pole. `(rings + 1) * (segments + 1)` vertices; the seam column duplicates
 * `j = 0` with `u = 1`. Triangles at the poles that would be degenerate are
 * skipped, so there are `segments * (2 * rings - 2) * 3` indices.
 */
export function generateSphere(radius: number, segments: number, rings: number): MeshData {
  requirePositiveFinite(radius, "sphere radius");
  requireIntegerInRange(segments, SPHERE_MIN_SEGMENTS, SPHERE_MAX_SEGMENTS, "sphere segments");
  requireIntegerInRange(rings, SPHERE_MIN_RINGS, SPHERE_MAX_RINGS, "sphere rings");

  const columns = segments + 1;
  const vertexCount = (rings + 1) * columns;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i <= rings; i++) {
    const theta = (Math.PI * i) / rings;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let j = 0; j <= segments; j++) {
      const phi = (2 * Math.PI * j) / segments;
      const dx = sinTheta * Math.sin(phi);
      const dy = cosTheta;
      const dz = sinTheta * Math.cos(phi);
      const k = i * columns + j;
      positions[k * 3] = radius * dx;
      positions[k * 3 + 1] = radius * dy;
      positions[k * 3 + 2] = radius * dz;
      normals[k * 3] = dx;
      normals[k * 3 + 1] = dy;
      normals[k * 3 + 2] = dz;
      uvs[k * 2] = j / segments;
      uvs[k * 2 + 1] = i / rings;
    }
  }

  const indices = allocateIndices(vertexCount, segments * (2 * rings - 2) * 3);
  let w = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * columns + j;
      const b = (i + 1) * columns + j;
      const c = (i + 1) * columns + j + 1;
      const d = i * columns + j + 1;
      if (i !== rings - 1) {
        indices[w++] = a;
        indices[w++] = b;
        indices[w++] = c;
      }
      if (i !== 0) {
        indices[w++] = a;
        indices[w++] = c;
        indices[w++] = d;
      }
    }
  }

  return { positions, normals, uvs, indices, boundingRadius: radius };
}
