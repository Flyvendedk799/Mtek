/**
 * Shared primitive meshes (`spec/stdlib.md` 4: "Generated meshes with identical
 * descriptor values are shared (immutable), keyed by the canonical descriptor").
 */
import type { MtekMeshPrimitive } from "../abi/manifest-types.js";
import { generateBox, generatePlane, generateSphere } from "./primitives.js";
import type { MeshData } from "./primitives.js";

/** A primitive mesh descriptor in the manifest form (`spec/runtime-abi.md` 5). */
export type MeshDescriptor =
  | { readonly kind: "box"; readonly size: readonly [number, number, number] }
  | { readonly kind: "sphere"; readonly radius: number; readonly segments: number; readonly rings: number }
  | { readonly kind: "plane"; readonly size: readonly [number, number] };

/** A mesh read from a packaged file: one primitive of a `mesh-data` asset, with its layout from the manifest (`spec/runtime-abi.md` 5.5). */
export interface AssetMeshSource {
  readonly kind: "asset";
  /** Url of the `mesh-data` entry. */
  readonly asset: string;
  /** Index into that entry's `primitives`. */
  readonly primitive: number;
  readonly layout: MtekMeshPrimitive;
}

/** Where a manifest mesh comes from: generated from a descriptor, or read from an asset file. */
export type MeshSource = MeshDescriptor | AssetMeshSource;

/** Canonical text of a number: exact (shortest round-trip) and without a negative zero. */
function canonicalNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

/**
 * The canonical key of a descriptor: the kind followed by its parameters in a fixed
 * order, independent of property order in the descriptor object.
 */
export function meshKey(descriptor: MeshSource): string {
  switch (descriptor.kind) {
    case "asset":
      return `asset:${descriptor.asset}#${String(descriptor.primitive)}`;
    case "box":
      return `box:${descriptor.size.map(canonicalNumber).join(",")}`;
    case "plane":
      return `plane:${descriptor.size.map(canonicalNumber).join(",")}`;
    case "sphere":
      return `sphere:${[descriptor.radius, descriptor.segments, descriptor.rings].map(canonicalNumber).join(",")}`;
  }
}

function generate(descriptor: MeshDescriptor): MeshData {
  switch (descriptor.kind) {
    case "box":
      return generateBox(descriptor.size);
    case "plane":
      return generatePlane(descriptor.size);
    case "sphere":
      return generateSphere(descriptor.radius, descriptor.segments, descriptor.rings);
  }
}

/**
 * Holds one immutable {@link MeshData} per canonical descriptor. The returned object
 * is frozen; the typed arrays inside are shared and must not be written to.
 * Descriptors that fail validation throw and are not cached.
 */
export class MeshCache {
  private readonly meshes = new Map<string, MeshData>();
  private generatedCount = 0;

  /** Number of distinct meshes currently held. */
  get size(): number {
    return this.meshes.size;
  }

  /** Number of meshes generated over the lifetime of this cache (cache misses). */
  get generated(): number {
    return this.generatedCount;
  }

  /** Returns the shared mesh for `descriptor`, generating it on first use. */
  get(descriptor: MeshDescriptor): MeshData {
    const key = meshKey(descriptor);
    const cached = this.meshes.get(key);
    if (cached !== undefined) return cached;
    const mesh = Object.freeze(generate(descriptor));
    this.meshes.set(key, mesh);
    this.generatedCount++;
    return mesh;
  }

  /** Drops every mesh (the `generated` counter keeps counting). */
  clear(): void {
    this.meshes.clear();
  }
}
