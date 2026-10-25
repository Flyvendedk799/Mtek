import type { MtekSkin } from "../abi/manifest-types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { uploadBuffer } from "./meshes.js";

/** Compute output uses the existing packed float3 vertex ABI, including custom materials. */
export const SKINNING_WGSL = `
struct Influence { joints: vec4u, weights: vec4f }
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> normals: array<f32>;
@group(0) @binding(2) var<storage, read> influences: array<Influence>;
@group(0) @binding(3) var<storage, read> palette: array<mat4x4f>;
@group(0) @binding(4) var<storage, read_write> outputPositions: array<f32>;
@group(0) @binding(5) var<storage, read_write> outputNormals: array<f32>;
@compute @workgroup_size(64)
fn skin(@builtin(global_invocation_id) id: vec3u) {
  let v = id.x;
  if (v >= arrayLength(&influences)) { return; }
  let inf = influences[v];
  let m = palette[inf.joints.x] * inf.weights.x + palette[inf.joints.y] * inf.weights.y
        + palette[inf.joints.z] * inf.weights.z + palette[inf.joints.w] * inf.weights.w;
  let at = v * 3u;
  let p = m * vec4f(positions[at], positions[at+1u], positions[at+2u], 1.0);
  outputPositions[at] = p.x; outputPositions[at+1u] = p.y; outputPositions[at+2u] = p.z;
  let n = vec3f(normals[at], normals[at+1u], normals[at+2u]);
  let a = m[0].xyz; let b = m[1].xyz; let c = m[2].xyz;
  let cofactor = mat3x3f(cross(b,c), cross(c,a), cross(a,b));
  let determinant = dot(a,cross(b,c));
  var transformed = cofactor * n * select(1.0, -1.0, determinant < 0.0);
  if (length(transformed) < 1e-10) { transformed = n; }
  let result = transformed / max(length(transformed), 1e-30);
  outputNormals[at] = result.x; outputNormals[at+1u] = result.y; outputNormals[at+2u] = result.z;
}`;

export interface GpuSkinSource {
  readonly influences: GPUBuffer;
  readonly normals: GPUBuffer;
  readonly ownsNormals: boolean;
}
export interface GpuSkinInstance {
  readonly palette: GPUBuffer;
  readonly group: GPUBindGroup;
  readonly normals: GPUBuffer;
  readonly ownsNormals: boolean;
}

export class GpuSkinning {
  private readonly module: GPUShaderModule;
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPUComputePipeline;
  private encoder: GPUCommandEncoder | undefined;
  private pass: GPUComputePassEncoder | undefined;

  constructor(
    private readonly device: Pick<GPUDevice, "createCommandEncoder" | "queue">,
    private readonly registry: ResourceRegistry,
  ) {
    this.module = registry.createShaderModule({
      label: "mtek GPU skinning",
      code: SKINNING_WGSL,
    });
    this.layout = registry.createBindGroupLayout({
      entries: Array.from({ length: 6 }, (_, binding) => ({
        binding,
        visibility: 4,
        buffer: { type: binding < 4 ? "read-only-storage" : "storage" },
      })),
    });
    this.pipeline = registry.createComputePipeline({
      label: "mtek GPU skinning",
      layout: registry.createPipelineLayout({
        bindGroupLayouts: [this.layout],
      }),
      compute: { module: this.module, entryPoint: "skin" },
    });
  }

  source(
    skin: MtekSkin,
    normals: GPUBuffer | undefined,
    count: number,
  ): GpuSkinSource {
    const data = new ArrayBuffer(count * 32),
      ids = new Uint32Array(data),
      weights = new Float32Array(data);
    for (let v = 0; v < count; v++)
      for (let k = 0; k < 4; k++) {
        ids[v * 8 + k] = skin.indices[v]![k]!;
        weights[v * 8 + 4 + k] = skin.weights[v]![k]!;
      }
    return {
      influences: uploadBuffer(
        this.registry,
        this.device.queue,
        "skin influences",
        0x80,
        ids,
      ),
      normals:
        normals ??
        uploadBuffer(
          this.registry,
          this.device.queue,
          "skin absent normals",
          0x80,
          new Float32Array(count * 3),
        ),
      ownsNormals: normals === undefined,
    };
  }

  instance(
    source: GpuSkinSource,
    position: GPUBuffer,
    outputPosition: GPUBuffer,
    outputNormal: GPUBuffer | undefined,
    count: number,
    joints: number,
  ): GpuSkinInstance {
    const palette = this.registry.createBuffer({
      label: "skin palette",
      size: joints * 64,
      usage: 0x88,
    });
    const normals =
      outputNormal ??
      this.registry.createBuffer({
        label: "skin unused normals",
        size: count * 12,
        usage: 0x80,
      });
    const buffers = [
      position,
      source.normals,
      source.influences,
      palette,
      outputPosition,
      normals,
    ];
    const group = this.registry.createBindGroup({
      layout: this.layout,
      entries: buffers.map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
    return { palette, group, normals, ownsNormals: outputNormal === undefined };
  }

  update(
    instance: GpuSkinInstance,
    palette: Float32Array,
    count: number,
  ): void {
    this.registry.writeBuffer(
      this.device.queue,
      instance.palette,
      0,
      palette.buffer as ArrayBuffer,
      palette.byteOffset,
      palette.byteLength,
    );
    this.encoder ??= this.device.createCommandEncoder({
      label: "mtek skinning",
    });
    if (this.pass === undefined) {
      this.pass = this.encoder.beginComputePass();
      this.pass.setPipeline(this.pipeline);
    }
    this.pass.setBindGroup(0, instance.group);
    this.pass.dispatchWorkgroups(Math.ceil(count / 64));
  }

  flush(): void {
    if (this.encoder === undefined) return;
    this.pass?.end();
    this.pass = undefined;
    this.device.queue.submit([this.encoder.finish()]);
    this.encoder = undefined;
  }
  release(instance: GpuSkinInstance): void {
    this.registry.release(instance.group);
    this.registry.release(instance.palette);
    if (instance.ownsNormals) this.registry.release(instance.normals);
  }
  releaseSource(source: GpuSkinSource): void {
    this.registry.release(source.influences);
    if (source.ownsNormals) this.registry.release(source.normals);
  }
  dispose(): void {
    this.encoder = undefined;
    this.pass = undefined;
    this.registry.release(this.pipeline);
    this.registry.release(this.module);
  }
}
