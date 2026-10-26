import type { MtekManifest } from "../abi/manifest-types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { identity, multiply, orthographic, viewMatrix } from "../math/mat4.js";
import type { DrawItem } from "./renderer.js";
import type { PackedLight } from "./lights.js";
import type { MtekRenderingOptions } from "./options.js";
import { vertexBufferLayouts, type BindingPlan } from "./pipelines.js";
import type { SceneStructure } from "../scene/structure.js";
import { diffuseEnvironment, SHADOW_QUALITY } from "./environment.js";
import { prefilterEnvironment } from "./environment-gpu.js";
import { vertexBufferOf } from "./meshes.js";

export interface SceneLightingDevice {
  readonly queue: GPUQueue;
  createCommandEncoder?(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
}

const SHADOW_SHADER = `
struct Light { matrix:mat4x4f }
struct Object { model:mat4x4f, normal:mat4x4f }
@group(0) @binding(0) var<uniform> light:Light;
@group(1) @binding(0) var<uniform> object:Object;
@vertex fn main(@location(0) position:vec3f)->@builtin(position) vec4f {
  return light.matrix*object.model*vec4f(position,1);
}
`;

export function sceneLightingProblem(manifest: MtekManifest, options: MtekRenderingOptions | undefined): string | undefined {
  const active = manifest.shaders.some(shader => shader.lighting === 1);
  if ((options?.shadows !== undefined || options?.environment !== undefined) && !active) return "Shadows and environment lighting require rebuilding this scene with a compiler that emits scene lighting ABI 1 and a lit material.";
  const name = options?.shadows?.light;
  if (name !== undefined) {
    const matches = manifest.scene.entities.filter(entity => entity.name === name || entity.symbol === name);
    const entity = matches[0];
    if (matches.length !== 1 || entity === undefined || !manifest.scene.lights.some(light => light.entity === entity.index && light.kind === "directional")) return `Shadow light '${name}' must uniquely name a directional-light entity in the scene; use its full symbol when names are repeated.`;
  }
  for (const material of manifest.materials) {
    const shader = manifest.shaders.find(shader => shader.hash === material.shader);
    if (shader?.lighting === 1 && (material.resources.filter(r => r.kind === "texture").length > 13 || material.resources.filter(r => r.kind === "sampler").length > 14)) return `Lit material '${material.id}' exceeds the default texture/sampler limits after reserving scene lighting bindings.`;
  }
  return undefined;
}

/** Private GPU ABI: mat4, shadow params, shadow filter, environment, nine SH vec4s = 256 bytes. */
export class SceneLighting {
  readonly group: GPUBindGroup;
  readonly castsShadows: boolean;
  private readonly buffer: GPUBuffer;
  private readonly shadow: GPUTexture;
  private readonly resources: Array<GPUBuffer | GPUTexture | GPUSampler | GPUShaderModule | GPURenderPipeline | GPUBindGroup> = [];
  private readonly values = new Float32Array(64);
  private readonly previous = new Float32Array(64).fill(NaN);
  private readonly lightIndex: number;
  private readonly shadowGroup: GPUBindGroup | undefined;
  private readonly pipeline: GPURenderPipeline | undefined;
  private readonly deformedPipelines = new Map<string, GPURenderPipeline>();
  private readonly deformedFrame: GPUBuffer | undefined;
  private readonly deformedGroup: GPUBindGroup | undefined;

  constructor(private readonly device: SceneLightingDevice, private readonly registry: ResourceRegistry,
    plan: BindingPlan, manifest: MtekManifest, private readonly options?: MtekRenderingOptions,
    authored?: { readonly structure: SceneStructure; readonly modules: ReadonlyMap<string, GPUShaderModule> }) {
    const settings = options?.shadows, env = options?.environment;
    this.castsShadows = settings !== undefined;
    const entity = manifest.scene.entities.find(entity => entity.name === settings?.light || entity.symbol === settings?.light);
    this.lightIndex = manifest.scene.lights.findIndex(light => light.entity === entity?.index);
    const quality = SHADOW_QUALITY[settings?.quality ?? "medium"];
    try {
      this.buffer = registry.createBuffer({ label: "mtek scene lighting", size: 256, usage: 0x48 }); this.resources.push(this.buffer);
      this.shadow = registry.createTexture({ label: "mtek directional shadow", size: settings === undefined ? [1, 1] : [quality.size, quality.size], format: "depth32float", usage: 0x14 }); this.resources.push(this.shadow);
      const shadowSampler = registry.createSampler({ compare: "less-equal", magFilter: "nearest", minFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }); this.resources.push(shadowSampler);
      if ((settings !== undefined || env !== undefined) && device.createCommandEncoder === undefined) throw new Error("The lighting backend requires GPU command encoding");
      const environment = prefilterEnvironment({ queue: device.queue, createCommandEncoder: descriptor => {
        if (device.createCommandEncoder === undefined) throw new Error("GPU command encoding is unavailable");
        return device.createCommandEncoder(descriptor);
      } }, registry, env);
      this.resources.push(environment.texture, environment.brdf);
      const sampler = registry.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }); this.resources.push(sampler);
      this.group = registry.createBindGroup({ layout: plan.sceneLighting(), entries: [
        { binding: 0, resource: { buffer: this.buffer } }, { binding: 1, resource: this.shadow.createView() },
        { binding: 2, resource: shadowSampler }, { binding: 3, resource: environment.texture.createView({ dimension: "cube" }) },
        { binding: 4, resource: sampler }, { binding: 5, resource: environment.brdf.createView() },
      ] }); this.resources.push(this.group);
      this.values.set(identity());
      this.values[16] = settings === undefined ? 0 : this.lightIndex + 1;
      this.values[17] = settings?.bias ?? 0.001; this.values[18] = settings?.normalBias ?? 0.01;
      this.values[20] = 1 / quality.size; this.values[21] = quality.radius;
      this.values[24] = env === undefined ? 0 : env.intensity ?? 1;
      this.values[25] = Math.cos(env?.rotation ?? 0); this.values[26] = Math.sin(env?.rotation ?? 0);
      this.values[27] = environment.levels - 1;
      if (env !== undefined) this.values.set(diffuseEnvironment(env), 28);
      if (settings !== undefined) {
        const layout = registry.createBindGroupLayout({ entries: [{ binding: 0, visibility: 1, buffer: { type: "uniform", minBindingSize: 64 } }] });
        const module = registry.createShaderModule({ label: "mtek shadow caster", code: SHADOW_SHADER }); this.resources.push(module);
        this.pipeline = registry.createRenderPipeline({ label: "mtek directional shadow", layout: registry.createPipelineLayout({ bindGroupLayouts: [layout, plan.object] }),
          vertex: { module, entryPoint: "main", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
          primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" }, depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" } }); this.resources.push(this.pipeline);
        this.shadowGroup = registry.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.buffer } }] }); this.resources.push(this.shadowGroup);
        const deformed = authored?.structure.materials.filter(material => material.shader.vertexDeformation === 1) ?? [];
        if (deformed.length > 0 && authored !== undefined) {
          this.deformedFrame = registry.createBuffer({ label: "mtek deformed shadow frame", size: authored.structure.frameLayout.size, usage: 0x48 }); this.resources.push(this.deformedFrame);
          this.deformedGroup = registry.createBindGroup({ layout: plan.frame, entries: [{ binding: 0, resource: { buffer: this.deformedFrame } }] }); this.resources.push(this.deformedGroup);
          for (const material of deformed) {
            const module = authored.modules.get(material.shader.hash);
            if (module === undefined) throw new Error(`No authored shadow shader for ${material.id}`);
            const pipeline = registry.createRenderPipeline({ label: `mtek authored shadow ${material.id}`,
              layout: plan.pipelineLayout(material.layout, material.resources, false, true),
              vertex: { module, entryPoint: material.shader.vertexEntry, buffers: vertexBufferLayouts(material.shader.vertexAttributes) },
              primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
              depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
            });
            this.resources.push(pipeline); this.deformedPipelines.set(material.id, pipeline);
          }
        }
      }
    } catch (error) { this.dispose(); throw error; }
  }

  update(lights: readonly PackedLight[]): void {
    const settings = this.options?.shadows, direction = lights[this.lightIndex]?.direction;
    if (settings !== undefined && direction !== undefined) {
      const center = settings.center ?? [0, 0, 0], distance = settings.distance ?? 20;
      const target = { x: center[0], y: center[1], z: center[2] };
      const position = { x: target.x - direction.x * distance, y: target.y - direction.y * distance, z: target.z - direction.z * distance };
      this.values.set(multiply(orthographic(settings.size ?? 20, 1, settings.near ?? 0.1, settings.far ?? 40), viewMatrix(position, { target })));
    }
    if (this.values.some((value, i) => !Object.is(value, this.previous[i]))) {
      this.registry.writeBuffer(this.device.queue, this.buffer, 0, this.values.buffer, 0, this.values.byteLength);
      if (this.deformedFrame !== undefined) this.registry.writeBuffer(this.device.queue, this.deformedFrame, 0, this.values.buffer, 0, 64);
      this.previous.set(this.values);
    }
  }

  /** Camera culling is intentionally irrelevant: every visible opaque entity can cast. */
  encodeShadows(encoder: GPUCommandEncoder, draws: readonly DrawItem[], objects: GPUBindGroup, slotOffset: (draw: DrawItem) => number, timestampWrites?: GPURenderPassTimestampWrites, materialGroup?: (draw: DrawItem) => GPUBindGroup): number {
    if (this.pipeline === undefined || this.shadowGroup === undefined) return 0;
    const pass = encoder.beginRenderPass({
      ...(timestampWrites?.beginningOfPassWriteIndex === undefined ? {} : { timestampWrites: { querySet: timestampWrites.querySet, beginningOfPassWriteIndex: timestampWrites.beginningOfPassWriteIndex } }),
      colorAttachments: [], depthStencilAttachment: { view: this.shadow.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.shadowGroup);
    let count = 0;
    let currentPipeline = this.pipeline;
    for (const draw of draws) {
      if (draw.translucent === true) continue;
      if (draw.vertexDeformation === 1) {
        const pipeline = this.deformedPipelines.get(draw.materialId ?? "");
        if (pipeline === undefined || this.deformedGroup === undefined || materialGroup === undefined) throw new Error("Authored shadow pipeline is unavailable");
        if (currentPipeline !== pipeline) { pass.setPipeline(pipeline); pass.setBindGroup(0, this.deformedGroup); currentPipeline = pipeline; }
        pass.setBindGroup(1, materialGroup(draw)); pass.setBindGroup(2, objects, [slotOffset(draw)]);
        draw.attributes.forEach((attribute, slot) => pass.setVertexBuffer(slot, vertexBufferOf(draw.gpuMesh, attribute)));
      } else {
        if (currentPipeline !== this.pipeline) { pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.shadowGroup); currentPipeline = this.pipeline; }
        pass.setBindGroup(1, objects, [slotOffset(draw)]);
        pass.setVertexBuffer(0, vertexBufferOf(draw.gpuMesh, "position"));
      }
      pass.setIndexBuffer(draw.gpuMesh.indexBuffer, draw.gpuMesh.indexFormat); pass.drawIndexed(draw.gpuMesh.indexCount); count++;
    }
    pass.end(); return count;
  }

  dispose(): void { for (const resource of this.resources) this.registry.release(resource); this.resources.length = 0; this.deformedPipelines.clear(); }
}
