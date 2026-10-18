/**
 * The packaged layout of an asset mesh (`spec/runtime-abi.md` section 5.5, decision 0058 item 6): where each
 * attribute and the index data of a primitive lie in its `mesh-data` file. The compiler writes the file, the
 * runtime reads these regions; `regionProblem` is the runtime's own check that a manifest is consistent with
 * the file it names (a broken manifest is `E8006`, never an out-of-range read).
 */
import type { MtekMeshPrimitive, MtekVertexAttribute } from "../abi/manifest-types.js";

/** Bytes per vertex of each attribute: `position` and `normal` are `f32 x 3`, `uv` is `f32 x 2`. */
export const ATTRIBUTE_BYTES: Readonly<Record<MtekVertexAttribute, number>> = { position: 12, normal: 12, uv: 8 };

export interface MeshRegion {
  /** The vertex attribute, or `"index"`. */
  readonly name: MtekVertexAttribute | "index";
  /** Byte offset from the start of the file. */
  readonly offset: number;
  readonly byteLength: number;
}

/** The regions of `primitive` in the order position, normal, uv, index; attributes it lacks are absent. */
export function meshRegions(primitive: MtekMeshPrimitive): MeshRegion[] {
  const regions: MeshRegion[] = [];
  for (const name of ["position", "normal", "uv"] as const) {
    const offset = primitive.offsets[name];
    if (primitive.attributes.includes(name) && offset !== undefined) {
      regions.push({ name, offset, byteLength: primitive.vertexCount * ATTRIBUTE_BYTES[name] });
    }
  }
  regions.push({ name: "index", offset: primitive.offsets.indices, byteLength: primitive.indexCount * (primitive.indexFormat === "uint16" ? 2 : 4) });
  return regions;
}

/**
 * Why the primitive's regions cannot be read from a file of `fileBytes` bytes, or `undefined` when they can:
 * every listed attribute has an offset, counts are positive, every offset is a multiple of 4 and every region lies
 * inside the file, and the bounding sphere is finite.
 */
export function regionProblem(primitive: MtekMeshPrimitive, fileBytes: number): string | undefined {
  if (!primitive.attributes.includes("position")) return "it has no position attribute";
  for (const name of primitive.attributes) {
    if (primitive.offsets[name] === undefined) return `the attribute '${name}' has no offset`;
  }
  if (!Number.isInteger(primitive.vertexCount) || primitive.vertexCount < 1) return `its vertex count is ${String(primitive.vertexCount)}`;
  if (!Number.isInteger(primitive.indexCount) || primitive.indexCount < 1) return `its index count is ${String(primitive.indexCount)}`;
  for (const region of meshRegions(primitive)) {
    if (!Number.isInteger(region.offset) || region.offset < 0 || region.offset % 4 !== 0) {
      return `the ${region.name} data starts at byte ${String(region.offset)}, which is not a multiple of 4`;
    }
    if (region.offset + region.byteLength > fileBytes) {
      return `the ${region.name} data (bytes ${String(region.offset)} to ${String(region.offset + region.byteLength)}) lies outside the ${String(fileBytes)}-byte file`;
    }
  }
  const { center, radius } = primitive.boundingSphere;
  if (!center.every(Number.isFinite) || !Number.isFinite(radius) || radius < 0) return "its bounding sphere is not finite";
  return undefined;
}
