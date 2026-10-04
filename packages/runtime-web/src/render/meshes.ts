/**
 * GPU meshes (`spec/stdlib.md` section 4, `spec/materials.md` section 3.3): each canonical primitive
 * descriptor is generated once (`mesh/cache.ts`) and uploaded once, with one vertex buffer per attribute
 * (position, normal, uv: non-interleaved, so a pipeline binds exactly the attributes its material reads)
 * and an index buffer in the generated format (`uint16` up to 65 535 vertices, else `uint32`).
 * The bounding radius is kept for frustum culling (M4).
 */
import type { MtekVertexAttribute } from "../abi/manifest-types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { roundUp } from "../gpu/uniform-arena.js";
import { MeshCache, meshKey } from "../mesh/cache.js";
import type { ResolvedMesh } from "../scene/structure.js";

// WebGPU buffer usage flags (constants of the standard; the globals do not exist outside a browser).
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_INDEX = 0x10;
const BUFFER_USAGE_VERTEX = 0x20;

export interface GpuMesh {
  /** The canonical descriptor key (`meshKey`). */
  readonly key: string;
  /** Upload order: a stable number for sorting the draw list by mesh. */
  readonly order: number;
  readonly vertexBuffers: Readonly<Record<MtekVertexAttribute, GPUBuffer>>;
  readonly indexBuffer: GPUBuffer;
  readonly indexFormat: GPUIndexFormat;
  readonly indexCount: number;
  readonly vertexCount: number;
  /** Radius of the bounding sphere around the mesh origin. */
  readonly boundingRadius: number;
}

/** Uploads `data` into a new buffer; the buffer size is rounded up to 4 bytes as `writeBuffer` requires. */
export function uploadBuffer(registry: ResourceRegistry, queue: GPUQueue, label: string, usage: number, data: ArrayBufferView): GPUBuffer {
  const size = roundUp(4, data.byteLength);
  const buffer = registry.createBuffer({ label, size, usage: usage | BUFFER_USAGE_COPY_DST });
  let source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (size !== data.byteLength) {
    const padded = new Uint8Array(size);
    padded.set(source);
    source = padded;
  }
  // `registry.writeBuffer` takes an ArrayBuffer and byte offsets; copy when the view does not start at 0.
  const bytes = source.byteOffset === 0 && source.byteLength === source.buffer.byteLength ? (source.buffer as ArrayBuffer) : source.slice().buffer;
  registry.writeBuffer(queue, buffer, 0, bytes, 0, size);
  return buffer;
}

/** The meshes of one mounted scene. */
export class MeshStore {
  private readonly byKey = new Map<string, GpuMesh>();
  private readonly byId = new Map<string, GpuMesh>();

  constructor(
    private readonly registry: ResourceRegistry,
    private readonly queue: GPUQueue,
    private readonly cache: MeshCache = new MeshCache(),
  ) {}

  /** Number of distinct meshes on the GPU. */
  get size(): number {
    return this.byKey.size;
  }

  /** Generates and uploads every mesh not uploaded yet; descriptors with equal values share one upload. */
  upload(meshes: readonly ResolvedMesh[]): void {
    for (const mesh of meshes) {
      const key = meshKey(mesh.descriptor);
      let gpu = this.byKey.get(key);
      if (gpu === undefined) {
        const data = this.cache.get(mesh.descriptor);
        const label = `mtek mesh ${key}`;
        gpu = {
          key,
          order: this.byKey.size,
          vertexBuffers: {
            position: uploadBuffer(this.registry, this.queue, `${label} position`, BUFFER_USAGE_VERTEX, data.positions),
            normal: uploadBuffer(this.registry, this.queue, `${label} normal`, BUFFER_USAGE_VERTEX, data.normals),
            uv: uploadBuffer(this.registry, this.queue, `${label} uv`, BUFFER_USAGE_VERTEX, data.uvs),
          },
          indexBuffer: uploadBuffer(this.registry, this.queue, `${label} index`, BUFFER_USAGE_INDEX, data.indices),
          indexFormat: data.indices instanceof Uint16Array ? "uint16" : "uint32",
          indexCount: data.indices.length,
          vertexCount: data.positions.length / 3,
          boundingRadius: data.boundingRadius,
        };
        this.byKey.set(key, gpu);
      }
      this.byId.set(mesh.id, gpu);
    }
  }

  /** The uploaded mesh of a manifest mesh id. */
  get(id: string): GpuMesh {
    const mesh = this.byId.get(id);
    if (mesh === undefined) throw new Error(`internal error: mesh '${id}' was not uploaded`);
    return mesh;
  }
}
