/**
 * Render pipelines (`spec/runtime-abi.md` section 8.4, `spec/gpu-layout.md` section 6,
 * `spec/materials.md` sections 3.3 and 6).
 *
 *  - The cache key is exactly `(shader hash, vertex attribute set, color format, depth format, cull mode,
 *    topology)`. Parameter values are not part of it, so editing a param never creates a pipeline.
 *  - The binding plan is fixed: group 0 `MtekFrame` (vertex + fragment), group 1 the material's parameter
 *    block (fragment; an empty layout when the material has no value params, so group numbers never
 *    shift), group 2 `MtekObject` (vertex) with a dynamic offset.
 *  - One vertex buffer per vertex attribute, in slot order position, normal, uv: `float32x3` at location
 *    0 (stride 12), `float32x3` at location 1 (stride 12), `float32x2` at location 2 (stride 8).
 *  - Opaque rendering: back faces culled, counter-clockwise front faces, depth test `less` with writes.
 *  - Creation runs inside a validation error scope; a failure becomes `E8051` at the material's
 *    declaration (shader compilation messages were mapped through the span map when the module was
 *    created, `host/shaders.ts`).
 */
import type { MtekLayoutRecord, MtekManifest, MtekVertexAttribute } from "../abi/manifest-types.js";
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

/** The parts of the pipeline cache key (`spec/runtime-abi.md` section 8.4), nothing else. */
export interface PipelineKeyParts {
  readonly shaderHash: string;
  /** In vertex-buffer slot order. */
  readonly vertexAttributes: readonly MtekVertexAttribute[];
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

function uniformEntry(size: number, visibility: number, hasDynamicOffset: boolean): GPUBindGroupLayoutEntry {
  return { binding: 0, visibility, buffer: { type: "uniform", hasDynamicOffset, minBindingSize: size } };
}

/**
 * The bind group layouts of the fixed binding plan for one device, and the pipeline layout of each
 * material parameter block size. Layouts are created once and shared, so bind groups made for one
 * pipeline are valid for every other.
 */
export class BindingPlan {
  readonly frame: GPUBindGroupLayout;
  readonly object: GPUBindGroupLayout;
  private readonly materialLayouts = new Map<number, GPUBindGroupLayout>();
  private readonly pipelineLayouts = new Map<number, GPUPipelineLayout>();
  private emptyGroup: GPUBindGroup | undefined;

  constructor(
    private readonly registry: ResourceRegistry,
    frameLayout: MtekLayoutRecord,
    objectLayout: MtekLayoutRecord,
  ) {
    this.frame = registry.createBindGroupLayout({ label: "mtek group 0 (MtekFrame)", entries: [uniformEntry(frameLayout.size, STAGE_VERTEX | STAGE_FRAGMENT, false)] });
    this.object = registry.createBindGroupLayout({ label: "mtek group 2 (MtekObject)", entries: [uniformEntry(objectLayout.size, STAGE_VERTEX, true)] });
  }

  /** Group 1 of a material: its parameter block (fragment stage), or the empty layout (`size` 0). */
  material(layout: MtekLayoutRecord | null): GPUBindGroupLayout {
    const size = layout?.size ?? 0;
    let found = this.materialLayouts.get(size);
    if (found === undefined) {
      found = this.registry.createBindGroupLayout({
        label: size === 0 ? "mtek group 1 (no params)" : `mtek group 1 (${String(size)}-byte params)`,
        entries: size === 0 ? [] : [uniformEntry(size, STAGE_FRAGMENT, false)],
      });
      this.materialLayouts.set(size, found);
    }
    return found;
  }

  /** The bind group of the empty group-1 layout, shared by every material without value params. */
  emptyMaterialGroup(): GPUBindGroup {
    this.emptyGroup ??= this.registry.createBindGroup({ label: "mtek group 1 (no params)", layout: this.material(null), entries: [] });
    return this.emptyGroup;
  }

  pipelineLayout(layout: MtekLayoutRecord | null): GPUPipelineLayout {
    const size = layout?.size ?? 0;
    let found = this.pipelineLayouts.get(size);
    if (found === undefined) {
      found = this.registry.createPipelineLayout({
        label: `mtek pipeline layout (${String(size)}-byte params)`,
        bindGroupLayouts: [this.frame, this.material(layout), this.object],
      });
      this.pipelineLayouts.set(size, found);
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
}

export type PipelineResult =
  | { readonly ok: true; readonly key: string; readonly pipeline: GPURenderPipeline }
  | { readonly ok: false; readonly diagnostic: MtekDiagnostic };

/** The key of a material's pipeline for a colour format, with the fixed depth format, cull mode and topology. */
export function materialPipelineKey(material: ResolvedMaterial, colorFormat: GPUTextureFormat): string {
  return pipelineKey({
    shaderHash: material.shader.hash,
    vertexAttributes: material.shader.vertexAttributes,
    colorFormat,
    depthFormat: DEPTH_FORMAT,
    cullMode: CULL_MODE,
    topology: TOPOLOGY,
  });
}

/** The render pipeline descriptor of a material (exported for tests). */
export function pipelineDescriptor(plan: BindingPlan, request: PipelineRequest): GPURenderPipelineDescriptor {
  const { material, module, colorFormat } = request;
  return {
    label: `mtek pipeline ${material.id}`,
    layout: plan.pipelineLayout(material.layout),
    vertex: { module, entryPoint: material.shader.vertexEntry, buffers: vertexBufferLayouts(material.shader.vertexAttributes) },
    fragment: { module, entryPoint: material.shader.fragmentEntry, targets: [{ format: colorFormat }] },
    primitive: { topology: TOPOLOGY, cullMode: CULL_MODE, frontFace: FRONT_FACE },
    depthStencil: { format: DEPTH_FORMAT, depthCompare: DEPTH_COMPARE, depthWriteEnabled: true },
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

  /** Returns the cached pipeline of the request's key, or creates it inside a validation error scope. */
  async obtain(request: PipelineRequest): Promise<PipelineResult> {
    const key = materialPipelineKey(request.material, request.colorFormat);
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
      notes: [`pipeline key: ${materialPipelineKey(request.material, request.colorFormat)}`],
    });
  }
}
