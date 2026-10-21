/**
 * Render pipelines (`spec/runtime-abi.md` section 8.4, `spec/gpu-layout.md` section 6,
 * `spec/materials.md` sections 3.3 and 6).
 *
 *  - The cache key is exactly `(shader hash, vertex attribute set, color format, depth format, cull mode,
 *    topology)`. Parameter values are not part of it, so editing a param never creates a pipeline.
 *  - The binding plan is fixed: group 0 `MtekFrame` (vertex + fragment), group 1 the material's parameter
 *    block (fragment; an empty layout when the material has no value params, so group numbers never
 *    shift) followed by one binding per texture and sampler param (decision 0054), group 2 `MtekObject`
 *    (vertex) with a dynamic offset.
 *  - One vertex buffer per vertex attribute, in slot order position, normal, uv: `float32x3` at location
 *    0 (stride 12), `float32x3` at location 1 (stride 12), `float32x2` at location 2 (stride 8).
 *  - The instanced variant of a pipeline (decision 0059) runs the shader's `instancedVertexEntry` and adds one
 *    more vertex buffer, step mode `instance`, after the attribute buffers: the model matrix as four `float32x4`
 *    columns at locations 3 to 6, the normal matrix as four at locations 7 to 10, stride 128. Its cache key is
 *    the key of the plain pipeline with `instance_matrices` appended to the vertex attribute set.
 *  - Opaque rendering: back faces culled, counter-clockwise front faces, depth test `less` with writes.
 *  - Creation runs inside a validation error scope; a failure becomes `E8051` at the material's
 *    declaration (shader compilation messages were mapped through the span map when the module was
 *    created, `host/shaders.ts`).
 */
import type { MtekLayoutRecord, MtekManifest, MtekMaterialResource, MtekVertexAttribute } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { resolveSpan, spanOfSymbol } from "../host/failures.js";
import { DEPTH_FORMAT } from "../host/surface.js";
import type { ResolvedMaterial } from "../scene/structure.js";

// WebGPU shader stage flags (constants of the standard).
const STAGE_VERTEX = 0x1;
const STAGE_FRAGMENT = 0x2;

export const CULL_MODE: GPUCullMode = "back";
export const FRONT_FACE: GPUFrontFace = "ccw";
export const TOPOLOGY: GPUPrimitiveTopology = "triangle-list";
export const DEPTH_COMPARE: GPUCompareFunction = "less";

/** The name the instance matrices have in the vertex attribute set of an instanced pipeline's key. */
export const INSTANCE_MATRICES = "instance_matrices";
/** `shaderLocation` of the first column of the instance model matrix: right after the fixed attributes (0 to 2). */
export const INSTANCE_MODEL_LOCATION = 3;
/** `shaderLocation` of the first column of the instance normal matrix. */
export const INSTANCE_NORMAL_LOCATION = 7;
/** Bytes per instance: the model matrix, then the normal matrix, 16 `f32` each, column-major. */
export const INSTANCE_STRIDE = 128;
/** `f32` per instance. */
export const INSTANCE_FLOATS = INSTANCE_STRIDE / 4;

/** The parts of the pipeline cache key (`spec/runtime-abi.md` section 8.4), nothing else. */
export interface PipelineKeyParts {
  readonly shaderHash: string;
  /** In vertex-buffer slot order; `instance_matrices` last for the instanced variant (decision 0059). */
  readonly vertexAttributes: readonly (MtekVertexAttribute | typeof INSTANCE_MATRICES)[];
  readonly colorFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly cullMode: GPUCullMode;
  readonly topology: GPUPrimitiveTopology;
}

/** The cache key: equal exactly when every part is equal. */
export function pipelineKey(parts: PipelineKeyParts): string {
  return JSON.stringify([parts.shaderHash, parts.vertexAttributes, parts.colorFormat, parts.depthFormat, parts.cullMode, parts.topology]);
}

const VERTEX_FORMATS: Readonly<Record<MtekVertexAttribute, { readonly location: number; readonly format: GPUVertexFormat; readonly stride: number }>> = {
  position: { location: 0, format: "float32x3", stride: 12 },
  normal: { location: 1, format: "float32x3", stride: 12 },
  uv: { location: 2, format: "float32x2", stride: 8 },
};

/** The vertex buffer layouts of `spec/materials.md` section 3.3: slot `k` is the `k`-th present attribute. */
export function vertexBufferLayouts(attributes: readonly MtekVertexAttribute[]): GPUVertexBufferLayout[] {
  return attributes.map((attribute) => {
    const { location, format, stride } = VERTEX_FORMATS[attribute];
    return { arrayStride: stride, stepMode: "vertex", attributes: [{ shaderLocation: location, offset: 0, format }] };
  });
}

/**
 * The instance vertex buffer layout: step mode `instance`, the eight `float32x4` columns of the model and
 * normal matrices at locations 3 to 10 (the locations of `mtek_vs_instanced`, `lowering/standard_stage.rs`).
 */
export function instanceBufferLayout(): GPUVertexBufferLayout {
  const attributes: GPUVertexAttribute[] = [];
  for (let column = 0; column < 4; column++) attributes.push({ shaderLocation: INSTANCE_MODEL_LOCATION + column, offset: column * 16, format: "float32x4" });
  for (let column = 0; column < 4; column++) attributes.push({ shaderLocation: INSTANCE_NORMAL_LOCATION + column, offset: 64 + column * 16, format: "float32x4" });
  return { arrayStride: INSTANCE_STRIDE, stepMode: "instance", attributes };
}

function uniformEntry(size: number, visibility: number, hasDynamicOffset: boolean): GPUBindGroupLayoutEntry {
  return { binding: 0, visibility, buffer: { type: "uniform", hasDynamicOffset, minBindingSize: size } };
}

/** The shape of a group-1 layout: the block size in bytes and the kind at each resource binding, e.g. `32 bytes, 1t 2s`. */
function materialLayoutKey(size: number, resources: readonly MtekMaterialResource[]): string {
  const kinds = resources.map((resource) => `${String(resource.binding)}${resource.kind === "texture" ? "t" : "s"}`);
  return [`${String(size)} bytes`, ...kinds].join(" ");
}

/**
 * The bind group layouts of the fixed binding plan for one device, and the pipeline layout of each
 * material parameter block size. Layouts are created once and shared, so bind groups made for one
 * pipeline are valid for every other.
 */
export class BindingPlan {
  readonly frame: GPUBindGroupLayout;
  readonly object: GPUBindGroupLayout;
  private readonly materialLayouts = new Map<string, GPUBindGroupLayout>();
  private readonly pipelineLayouts = new Map<string, GPUPipelineLayout>();
  private emptyGroup: GPUBindGroup | undefined;

  constructor(
    private readonly registry: ResourceRegistry,
    frameLayout: MtekLayoutRecord,
    objectLayout: MtekLayoutRecord,
  ) {
    this.frame = registry.createBindGroupLayout({ label: "mtek group 0 (MtekFrame)", entries: [uniformEntry(frameLayout.size, STAGE_VERTEX | STAGE_FRAGMENT, false)] });
    this.object = registry.createBindGroupLayout({ label: "mtek group 2 (MtekObject)", entries: [uniformEntry(objectLayout.size, STAGE_VERTEX, true)] });
  }

  /**
   * Group 1 of a material: its parameter block at binding 0 (fragment stage; absent without value
   * params), then one binding per texture or sampler (`spec/gpu-layout.md` section 6). The layout
   * depends only on the block size and the kinds of the resources, so materials with the same shape
   * share it.
   */
  material(layout: MtekLayoutRecord | null, resources: readonly MtekMaterialResource[] = []): GPUBindGroupLayout {
    const size = layout?.size ?? 0;
    const key = materialLayoutKey(size, resources);
    let found = this.materialLayouts.get(key);
    if (found === undefined) {
      const entries: GPUBindGroupLayoutEntry[] = size === 0 ? [] : [uniformEntry(size, STAGE_FRAGMENT, false)];
      for (const resource of resources) {
        entries.push(
          resource.kind === "texture"
            ? { binding: resource.binding, visibility: STAGE_FRAGMENT, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } }
            : { binding: resource.binding, visibility: STAGE_FRAGMENT, sampler: { type: "filtering" } },
        );
      }
      found = this.registry.createBindGroupLayout({
        label: size === 0 && resources.length === 0 ? "mtek group 1 (no params)" : `mtek group 1 (${key})`,
        entries,
      });
      this.materialLayouts.set(key, found);
    }
    return found;
  }

  /** The bind group of the empty group-1 layout, shared by every material without value params or resources. */
  emptyMaterialGroup(): GPUBindGroup {
    this.emptyGroup ??= this.registry.createBindGroup({ label: "mtek group 1 (no params)", layout: this.material(null), entries: [] });
    return this.emptyGroup;
  }

  pipelineLayout(layout: MtekLayoutRecord | null, resources: readonly MtekMaterialResource[] = []): GPUPipelineLayout {
    const key = materialLayoutKey(layout?.size ?? 0, resources);
    let found = this.pipelineLayouts.get(key);
    if (found === undefined) {
      found = this.registry.createPipelineLayout({
        label: `mtek pipeline layout (${key})`,
        bindGroupLayouts: [this.frame, this.material(layout, resources), this.object],
      });
      this.pipelineLayouts.set(key, found);
    }
    return found;
  }
}

export interface PipelineRequest {
  readonly material: ResolvedMaterial;
  readonly module: GPUShaderModule;
  readonly colorFormat: GPUTextureFormat;
  /** The phase recorded in a failure diagnostic. Default `runtime:mount`. */
  readonly phase?: MtekRuntimePhase;
  /** The instanced variant (needs the shader's `instancedVertexEntry`). Default: the plain pipeline. */
  readonly instanced?: boolean;
  /** The alpha-blended variant for translucent draws (decision 0138): no depth writes, never instanced. */
  readonly blended?: boolean;
}

/** Whether `material` has a colour param, whose alpha below 1 makes its draws translucent (decision 0138). */
export function canBlend(material: { readonly params: readonly { readonly name: string; readonly type: string }[] }): boolean {
  return material.params.some((param) => param.type === "color");
}

/** The built-in `Sprite` material (decision 0170): its draws are always translucent, whatever the tint's alpha. */
export const SPRITE_MATERIAL = "std/materials.mtek::Sprite";

/** Whether every draw of `material` is translucent (the built-in `Sprite`, decision 0170). */
export function alwaysBlends(material: { readonly id: string }): boolean {
  return material.id === SPRITE_MATERIAL || material.id === `material:${SPRITE_MATERIAL}`;
}

/** Straight-alpha "over" blending of the translucent pass (decision 0138). */
export const ALPHA_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export type PipelineResult =
  | { readonly ok: true; readonly key: string; readonly pipeline: GPURenderPipeline }
  | { readonly ok: false; readonly diagnostic: MtekDiagnostic };

/** The key of a material's pipeline (the instanced variant when `instanced`) for a colour format, with the fixed depth format, cull mode and topology. */
export function materialPipelineKey(material: ResolvedMaterial, colorFormat: GPUTextureFormat, instanced = false): string {
  return pipelineKey({
    shaderHash: material.shader.hash,
    vertexAttributes: instanced ? [...material.shader.vertexAttributes, INSTANCE_MATRICES] : material.shader.vertexAttributes,
    colorFormat,
    depthFormat: DEPTH_FORMAT,
    cullMode: CULL_MODE,
    topology: TOPOLOGY,
  });
}

/** The render pipeline descriptor of a material (exported for tests). */
export function pipelineDescriptor(plan: BindingPlan, request: PipelineRequest): GPURenderPipelineDescriptor {
  const { material, module, colorFormat } = request;
  const buffers = vertexBufferLayouts(material.shader.vertexAttributes);
  let entryPoint = material.shader.vertexEntry;
  if (request.instanced === true) {
    const instancedEntry = material.shader.instancedVertexEntry;
    if (instancedEntry === undefined) throw new Error(`internal error: the shader of '${material.id}' has no instanced vertex entry`);
    entryPoint = instancedEntry;
    buffers.push(instanceBufferLayout());
  }
  return {
    label: request.instanced === true ? `mtek pipeline ${material.id} (instanced)` : `mtek pipeline ${material.id}`,
    layout: plan.pipelineLayout(material.layout, material.resources),
    vertex: { module, entryPoint, buffers },
    fragment: {
      module,
      entryPoint: material.shader.fragmentEntry,
      targets: [request.blended === true ? { format: colorFormat, blend: ALPHA_BLEND } : { format: colorFormat }],
    },
    primitive: { topology: TOPOLOGY, cullMode: CULL_MODE, frontFace: FRONT_FACE },
    // Translucent draws test depth against the opaque scene but do not write it (decision 0138).
    depthStencil: { format: DEPTH_FORMAT, depthCompare: DEPTH_COMPARE, depthWriteEnabled: request.blended !== true },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.message === "" ? error.name : error.message) : String(error);
}

/** Pipelines by key. A key is created at most once; a cache hit creates nothing. */
export class PipelineCache {
  private readonly pipelines = new Map<string, GPURenderPipeline>();

  constructor(
    private readonly device: Pick<GPUDevice, "pushErrorScope" | "popErrorScope">,
    private readonly registry: ResourceRegistry,
    private readonly plan: BindingPlan,
    private readonly manifest: MtekManifest,
  ) {}

  get size(): number {
    return this.pipelines.size;
  }

  get(key: string): GPURenderPipeline | undefined {
    return this.pipelines.get(key);
  }

  /**
   * Seeds the cache with pipelines from a previous program so unchanged shader hashes reuse them
   * (`spec/runtime-abi.md` section 11.3 — a colour edit creates no pipeline).
   */
  adopt(key: string, pipeline: GPURenderPipeline): void {
    if (!this.pipelines.has(key)) this.pipelines.set(key, pipeline);
  }

  /** Copies every entry of `other` into this cache (for hot reload reuse). */
  adoptAll(other: PipelineCache): void {
    for (const [key, pipeline] of other.pipelines) this.adopt(key, pipeline);
  }

  /** Returns the cached pipeline of the request's key, or creates it inside a validation error scope. */
  async obtain(request: PipelineRequest): Promise<PipelineResult> {
    const key = materialPipelineKey(request.material, request.colorFormat, request.instanced === true) + (request.blended === true ? "|blend" : "");
    const cached = this.pipelines.get(key);
    if (cached !== undefined) return { ok: true, key, pipeline: cached };

    const descriptor = pipelineDescriptor(this.plan, request);
    this.device.pushErrorScope("validation");
    const creation = this.registry.createRenderPipelineAsync(descriptor).then(
      (pipeline) => ({ pipeline, error: undefined }),
      (error: unknown) => ({ pipeline: undefined, error: errorText(error) }),
    );
    const scope = this.device.popErrorScope().then(
      (error) => (error === null ? undefined : error.message),
      // popErrorScope rejects when the device is lost; the loss is reported through device.lost.
      () => undefined,
    );
    const [created, scopeError] = await Promise.all([creation, scope]);
    const message = created.error ?? scopeError;
    if (created.pipeline === undefined || message !== undefined) {
      if (created.pipeline !== undefined) this.registry.release(created.pipeline);
      return { ok: false, diagnostic: this.failure(request, message ?? "the pipeline was not created") };
    }
    this.pipelines.set(key, created.pipeline);
    return { ok: true, key, pipeline: created.pipeline };
  }

  private failure(request: PipelineRequest, message: string): MtekDiagnostic {
    const spanId = spanOfSymbol(this.manifest, request.material.id);
    return makeRuntimeDiagnostic("E8051", {
      phase: request.phase ?? "runtime:mount",
      message: `The render pipeline for material '${request.material.id}' could not be created: ${message}`,
      source: spanId === undefined ? null : resolveSpan(this.manifest, spanId),
      notes: [`pipeline key: ${materialPipelineKey(request.material, request.colorFormat, request.instanced === true)}`],
    });
  }
}
