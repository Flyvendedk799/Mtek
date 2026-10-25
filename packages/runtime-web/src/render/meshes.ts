/**
 * GPU meshes (`spec/stdlib.md` section 4, `spec/materials.md` section 3.3): each canonical primitive
 * descriptor is generated once (`mesh/cache.ts`) and uploaded once, with one vertex buffer per attribute
 * (position, normal, uv: non-interleaved, so a pipeline binds exactly the attributes its material reads)
 * and an index buffer in the generated format (`uint16` up to 65 535 vertices, else `uint32`).
 * The bounding sphere is kept for frustum culling (M4).
 *
 * A mesh that comes from a packaged file (`spec/runtime-abi.md` section 5.5, decision 0060) is uploaded from the
 * file's verified bytes with the same buffers: one vertex buffer per attribute the primitive has and one index
 * buffer, each from its region of the file, created through the registry (so inside an out-of-memory scope,
 * `E8063`). Its bounding sphere is the manifest's (centre and radius in the mesh's local space). The bytes are
 * retained by the `LoadedAssets`, so rebuilding the buffers after a device loss needs no network.
 */
import type { MtekVertexAttribute } from "../abi/manifest-types.js";
import type { LoadedAssets } from "../assets/loader.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { roundUp } from "../gpu/uniform-arena.js";
import { meshRegions } from "../mesh/asset.js";
import { MeshCache, meshKey, type AssetMeshSource } from "../mesh/cache.js";
import type { ResolvedMesh } from "../scene/structure.js";
import type { SkeletonPlayer } from "../scene/skeleton.js";
import { deformSkin } from "../mesh/skinning.js";
import { SkinBounds } from "../mesh/skin-bounds.js";
import { GpuSkinning, type GpuSkinSource, type GpuSkinInstance } from "./gpu-skinning.js";

// WebGPU buffer usage flags (constants of the standard; the globals do not exist outside a browser).
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_INDEX = 0x10;
const BUFFER_USAGE_VERTEX = 0x20;

export interface GpuMesh {
  /** The canonical descriptor key (`meshKey`). */
  readonly key: string;
  /** Upload order: a stable number for sorting the draw list by mesh. */
  readonly order: number;
  /** One buffer per attribute the mesh has: all three for a primitive shape, the packaged ones for an asset mesh. */
  readonly vertexBuffers: Readonly<Partial<Record<MtekVertexAttribute, GPUBuffer>>>;
  readonly indexBuffer: GPUBuffer;
  readonly indexFormat: GPUIndexFormat;
  readonly indexCount: number;
  readonly vertexCount: number;
  /** Centre of the bounding sphere in the mesh's local space: the origin for a primitive shape. */
  readonly boundingCenter: readonly [number, number, number];
  /** Radius of the bounding sphere. */
  readonly boundingRadius: number;
}

const ORIGIN: readonly [number, number, number] = [0, 0, 0];
type SkinMesh = Omit<GpuMesh, "boundingCenter" | "boundingRadius"> & { boundingCenter: [number, number, number]; boundingRadius: number };
export type SkinDevice = Pick<GPUDevice, "queue"> & Partial<Pick<GPUDevice, "createCommandEncoder" | "createComputePipeline">>;

/** The vertex buffer of `attribute`; every mesh drawn with a material has the attributes it reads (checked at mount). */
export function vertexBufferOf(mesh: GpuMesh, attribute: MtekVertexAttribute): GPUBuffer {
  const buffer = mesh.vertexBuffers[attribute];
  if (buffer === undefined) throw new Error(`internal error: the mesh '${mesh.key}' has no '${attribute}' attribute`);
  return buffer;
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
  private readonly skinSources = new Map<string, { positions: Float32Array; normals?: Float32Array; bounds: SkinBounds; gpu?: GpuSkinSource }>();
  private readonly skinInstances = new Map<number, { mesh: SkinMesh; sourceKey: string; positions: Float32Array; normals: Float32Array; revision: number; boundsRevision: number; gpu?: GpuSkinInstance }>();
  private gpuSkinning: GpuSkinning | undefined;

  forEntity(id: string, slot: number, player?: SkeletonPlayer): GpuMesh {
    const source = this.get(id);
    if (player === undefined) return source;
    const existing = this.skinInstances.get(slot);
    if (existing !== undefined) return existing.mesh;
    const positions=new Float32Array(this.gpuSkinning===undefined?source.vertexCount*3:0), normals=new Float32Array(this.gpuSkinning===undefined?source.vertexCount*3:0);
    const usage = BUFFER_USAGE_VERTEX | (this.gpuSkinning === undefined ? 0 : 0x80);
    const output=(label:string,data:Float32Array):GPUBuffer=>this.gpuSkinning===undefined
      ?uploadBuffer(this.registry,this.queue,label,usage,data)
      :this.registry.createBuffer({label,size:source.vertexCount*12,usage});
    const mesh: SkinMesh={...source, key:source.key+"@"+String(slot), boundingCenter: [0,0,0], boundingRadius:Infinity,
      vertexBuffers:{...source.vertexBuffers,
        position:output("skin positions",positions),
        ...(source.vertexBuffers.normal===undefined?{}:{normal:output("skin normals",normals)})}};
    const gpuSource = this.skinSources.get(source.key)?.gpu;
    const gpu = gpuSource === undefined ? undefined : this.gpuSkinning!.instance(gpuSource, source.vertexBuffers.position!, mesh.vertexBuffers.position!, mesh.vertexBuffers.normal, source.vertexCount, player.skin.joints.length);
    this.skinInstances.set(slot,{mesh,sourceKey:source.key,positions,normals,revision:-1,boundsRevision:-1,...(gpu === undefined ? {} : {gpu})});
    return mesh;
  }

  updateSkin(slot: number, player: SkeletonPlayer): void {
    const instance=this.skinInstances.get(slot);
    if(instance===undefined || instance.revision===player.revision) return;
    const source=this.skinSources.get(instance.sourceKey);
    if(source===undefined) throw new Error("Missing skin source vertices");
    if (instance.gpu !== undefined) {
      this.gpuSkinning!.update(instance.gpu, player.palette, instance.mesh.vertexCount);
      instance.revision = player.revision;
      return;
    }
    deformSkin(player.skin,player.palette,source.positions,source.normals,instance.positions,instance.normals);
    this.registry.writeBuffer(this.queue,instance.mesh.vertexBuffers.position!,0,instance.positions.buffer as ArrayBuffer,0,instance.positions.byteLength);
    if(instance.mesh.vertexBuffers.normal!==undefined) this.registry.writeBuffer(this.queue,instance.mesh.vertexBuffers.normal,0,instance.normals.buffer as ArrayBuffer,0,instance.normals.byteLength);
    instance.revision=player.revision;
  }

  /** Bounds are evaluated before culling; deformation only runs for visible actors. */
  updateSkinBounds(slot: number, player: SkeletonPlayer): boolean {
    const instance = this.skinInstances.get(slot);
    if (instance === undefined || instance.boundsRevision === player.revision) return false;
    const source = this.skinSources.get(instance.sourceKey)!;
    const mesh = instance.mesh;
    mesh.boundingRadius = source.bounds.sphere(player.palette, mesh.boundingCenter);
    instance.boundsRevision = player.revision;
    return true;
  }

  flushSkins(): void { this.gpuSkinning?.flush(); }

  releaseSkin(slot: number): void {
    const instance=this.skinInstances.get(slot);
    if(instance===undefined) return;
    if (instance.gpu !== undefined) this.gpuSkinning!.release(instance.gpu);
    this.registry.release(instance.mesh.vertexBuffers.position!);
    if(instance.mesh.vertexBuffers.normal!==undefined) this.registry.release(instance.mesh.vertexBuffers.normal);
    this.skinInstances.delete(slot);
  }

  constructor(
    private readonly registry: ResourceRegistry,
    private readonly queue: GPUQueue,
    private readonly cache: MeshCache = new MeshCache(),
    /** The device's `maxBufferSize`: a region of an asset mesh above it is an allocation failure (`E8063`). */
    private readonly maxBufferSize: number = Infinity,
    device?: SkinDevice,
  ) {
    if (device?.createComputePipeline !== undefined && device.createCommandEncoder !== undefined) this.gpuSkinning = new GpuSkinning({ queue: device.queue, createCommandEncoder: device.createCommandEncoder.bind(device) }, registry);
  }

  /** Number of distinct meshes on the GPU. */
  get size(): number {
    return this.byKey.size;
  }

  /**
   * Generates (primitive shapes) or reads from `assets` (asset meshes) and uploads every mesh not uploaded yet;
   * descriptors with equal values share one upload.
   */
  upload(meshes: readonly ResolvedMesh[], assets?: LoadedAssets): void {
    for (const mesh of meshes) {
      const key = meshKey(mesh.descriptor);
      let gpu = this.byKey.get(key);
      if (gpu === undefined) {
        gpu = mesh.descriptor.kind === "asset" ? this.uploadAsset(key, mesh.descriptor, assets) : this.uploadPrimitive(key, mesh);
        this.byKey.set(key, gpu);
      }
      this.byId.set(mesh.id, gpu);
    }
  }

  private uploadPrimitive(key: string, mesh: ResolvedMesh): GpuMesh {
    if (mesh.descriptor.kind === "asset") throw new Error("internal error: uploadPrimitive of an asset mesh");
    const data = this.cache.get(mesh.descriptor);
    const label = `mtek mesh ${key}`;
    return {
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
      boundingCenter: ORIGIN,
      boundingRadius: data.boundingRadius,
    };
  }

  /** One buffer per region of the primitive in its file: the vertex attributes it has, then the indices. */
  private uploadAsset(key: string, source: AssetMeshSource, assets: LoadedAssets | undefined): GpuMesh {
    if (assets === undefined) throw new Error(`internal error: the mesh '${key}' comes from an asset, but no assets were loaded`);
    const bytes = assets.bytes(source.asset);
    const { layout } = source;
    if(source.skin!==undefined) {
      const floats=(offset: number): Float32Array => new Float32Array(bytes.slice(offset,offset+layout.vertexCount*12).buffer);
      const positions = floats(layout.offsets.position);
      this.skinSources.set(key,{positions,bounds:new SkinBounds(source.skin,positions),...(layout.offsets.normal===undefined?{}:{normals:floats(layout.offsets.normal)})});
    }
    const label = `mtek mesh ${key}`;
    const regions = meshRegions(layout);
    // A region the device cannot allocate is reported like a failed allocation, before anything is created.
    for (const region of regions) {
      const size = roundUp(4, region.byteLength);
      if (size > this.maxBufferSize) {
        const message = `Allocating the GPU buffer '${label} ${region.name}' (${String(size)} bytes) failed: it exceeds the device's maxBufferSize (${String(this.maxBufferSize)}).`;
        this.registry.reportAllocationFailure(message);
        throw new RangeError(message);
      }
    }
    const vertexBuffers: Partial<Record<MtekVertexAttribute, GPUBuffer>> = {};
    let indexBuffer: GPUBuffer | undefined;
    for (const region of regions) {
      const data = bytes.subarray(region.offset, region.offset + region.byteLength);
      if (region.name === "index") indexBuffer = uploadBuffer(this.registry, this.queue, `${label} index`, BUFFER_USAGE_INDEX, data);
      else vertexBuffers[region.name] = uploadBuffer(this.registry, this.queue, `${label} ${region.name}`, BUFFER_USAGE_VERTEX | (source.skin === undefined || this.gpuSkinning === undefined || region.name === "uv" ? 0 : 0x80), data);
    }
    if (indexBuffer === undefined) throw new Error("internal error: meshRegions returned no index region");
    if (source.skin !== undefined && this.gpuSkinning !== undefined) this.skinSources.get(key)!.gpu = this.gpuSkinning.source(source.skin, vertexBuffers.normal, layout.vertexCount);
    return {
      key,
      order: this.byKey.size,
      vertexBuffers,
      indexBuffer,
      indexFormat: layout.indexFormat,
      indexCount: layout.indexCount,
      vertexCount: layout.vertexCount,
      boundingCenter: layout.boundingSphere.center,
      boundingRadius: layout.boundingSphere.radius,
    };
  }

  /** The uploaded mesh of a manifest mesh id. */
  get(id: string): GpuMesh {
    const mesh = this.byId.get(id);
    if (mesh === undefined) throw new Error(`internal error: mesh '${id}' was not uploaded`);
    return mesh;
  }

  /** Releases every uploaded buffer (hot reload: discard a retired scene). */
  dispose(): void {
    for(const slot of this.skinInstances.keys()) this.releaseSkin(slot);
    for (const source of this.skinSources.values()) if (source.gpu !== undefined) this.gpuSkinning!.releaseSource(source.gpu);
    this.skinSources.clear();
    this.gpuSkinning?.dispose(); this.gpuSkinning = undefined;
    for (const gpu of this.byKey.values()) {
      for (const buffer of Object.values(gpu.vertexBuffers)) this.registry.release(buffer);
      this.registry.release(gpu.indexBuffer);
    }
    this.byKey.clear();
    this.byId.clear();
  }
}
