import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";

/** The part of `GPUDevice` the registry wraps. */
export type RegistryDevice = Pick<
  GPUDevice,
  | "createBuffer"
  | "createTexture"
  | "createSampler"
  | "createShaderModule"
  | "createRenderPipeline"
  | "createRenderPipelineAsync"
  | "createBindGroup"
  | "createBindGroupLayout"
  | "createPipelineLayout"
  | "pushErrorScope"
  | "popErrorScope"
>;

/**
 * Registry counters named exactly as in `spec/runtime-abi.md` section 10.1 (the subset owned by the
 * registry; frame counters such as `drawCalls` belong to the renderer). Cumulative counters never
 * decrease; `live*` counters track objects that exist now.
 */
export interface RegistryCounters {
  readonly buffersAllocated: number;
  readonly texturesAllocated: number;
  readonly pipelinesCreated: number;
  readonly shaderModulesCreated: number;
  readonly bindGroupsCreated: number;
  readonly uploads: number;
  readonly uploadBytes: number;
  readonly liveBuffers: number;
  readonly liveTextures: number;
  readonly liveSamplers: number;
  readonly liveShaderModules: number;
  readonly livePipelines: number;
  readonly liveBindGroups: number;
  readonly liveListeners: number;
}

export interface RegistryOptions {
  /** Receives an `E8063` diagnostic when a buffer or texture allocation fails (reported asynchronously). */
  readonly onAllocationFailure?: (diagnostic: MtekDiagnostic) => void;
  /** Phase recorded in allocation diagnostics. Default `runtime:mount`; the runtime updates it per phase. */
  readonly phase?: MtekRuntimePhase;
}

/** Any resource `release` accepts. Bind group layouts and pipeline layouts are not tracked (no counter, no destroy). */
export type ReleasableResource =
  | GPUBuffer
  | GPUTexture
  | GPUSampler
  | GPUShaderModule
  | GPURenderPipeline
  | GPUBindGroup;

interface ListenerRecord {
  readonly target: EventTarget;
  readonly type: string;
  readonly listener: EventListenerOrEventListenerObject;
  readonly options: AddEventListenerOptions | boolean | undefined;
}

function isMultipleOfFour(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n % 4 === 0;
}

function describeLabel(label: string | undefined): string {
  return label === undefined || label === "" ? "(unlabelled)" : `'${label}'`;
}

/**
 * Creates and counts every GPU object and DOM listener of a running program
 * (`spec/runtime-abi.md` section 9.1), so tests can assert that nothing leaks (section 9.3).
 */
export class ResourceRegistry {
  /** Phase recorded in allocation diagnostics. */
  phase: MtekRuntimePhase;

  private readonly buffers = new Set<GPUBuffer>();
  private readonly textures = new Set<GPUTexture>();
  private readonly samplers = new Set<GPUSampler>();
  private readonly shaderModules = new Set<GPUShaderModule>();
  private readonly pipelines = new Set<GPURenderPipeline>();
  private readonly bindGroups = new Set<GPUBindGroup>();
  private readonly listeners = new Set<ListenerRecord>();

  private buffersAllocated = 0;
  private texturesAllocated = 0;
  private pipelinesCreated = 0;
  private shaderModulesCreated = 0;
  private bindGroupsCreated = 0;
  private uploads = 0;
  private uploadBytes = 0;

  private readonly onAllocationFailure: ((diagnostic: MtekDiagnostic) => void) | undefined;

  constructor(
    private readonly device: RegistryDevice,
    options: RegistryOptions = {},
  ) {
    this.onAllocationFailure = options.onAllocationFailure;
    this.phase = options.phase ?? "runtime:mount";
  }

  /** A copy of the current counters. */
  snapshot(): RegistryCounters {
    return {
      buffersAllocated: this.buffersAllocated,
      texturesAllocated: this.texturesAllocated,
      pipelinesCreated: this.pipelinesCreated,
      shaderModulesCreated: this.shaderModulesCreated,
      bindGroupsCreated: this.bindGroupsCreated,
      uploads: this.uploads,
      uploadBytes: this.uploadBytes,
      liveBuffers: this.buffers.size,
      liveTextures: this.textures.size,
      liveSamplers: this.samplers.size,
      liveShaderModules: this.shaderModules.size,
      livePipelines: this.pipelines.size,
      liveBindGroups: this.bindGroups.size,
      liveListeners: this.listeners.size,
    };
  }

  /** Delivers an `E8063` diagnostic (also used for failures the registry cannot observe itself, e.g. a size above `maxBufferSize`). */
  reportAllocationFailure(message: string, notes: readonly string[] = []): void {
    this.onAllocationFailure?.(makeRuntimeDiagnostic("E8063", { phase: this.phase, message, notes }));
  }

  /**
   * Runs `create` inside an `out-of-memory` error scope. The scope is popped synchronously (so scopes
   * stay balanced); its result arrives asynchronously and is reported as `E8063`.
   */
  private withOomScope<T>(what: string, create: () => T): T {
    this.device.pushErrorScope("out-of-memory");
    let result: T;
    try {
      result = create();
    } catch (e) {
      // The scope must be popped on every path. A thrown call produced no error to capture, so its
      // result is ignored; a RangeError is how WebGPU signals an allocation failure from a creation call.
      this.settleScope(what, false);
      if (e instanceof RangeError) {
        this.reportAllocationFailure(`Allocating the GPU ${what} failed: ${e.message}`);
      }
      throw e;
    }
    this.settleScope(what, true);
    return result;
  }

  private settleScope(what: string, report: boolean): void {
    this.device.popErrorScope().then(
      (error) => {
        if (error !== null && report) {
          this.reportAllocationFailure(`Allocating the GPU ${what} failed: out of memory.`, [
            `browser message: ${error.message}`,
          ]);
        }
      },
      () => {
        // popErrorScope rejects when the device is lost; device loss is reported through `device.lost`.
      },
    );
  }

  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    const what = `buffer ${describeLabel(descriptor.label)} (${String(descriptor.size)} bytes)`;
    const buffer = this.withOomScope(what, () => this.device.createBuffer(descriptor));
    this.buffers.add(buffer);
    this.buffersAllocated += 1;
    return buffer;
  }

  createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
    const what = `texture ${describeLabel(descriptor.label)}`;
    const texture = this.withOomScope(what, () => this.device.createTexture(descriptor));
    this.textures.add(texture);
    this.texturesAllocated += 1;
    return texture;
  }

  createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler {
    const sampler = this.device.createSampler(descriptor);
    this.samplers.add(sampler);
    return sampler;
  }

  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
    const module = this.device.createShaderModule(descriptor);
    this.shaderModules.add(module);
    this.shaderModulesCreated += 1;
    return module;
  }

  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    const pipeline = this.device.createRenderPipeline(descriptor);
    this.pipelines.add(pipeline);
    this.pipelinesCreated += 1;
    return pipeline;
  }

  /** Counted when the pipeline is ready; a rejected creation is not counted. */
  async createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline> {
    const pipeline = await this.device.createRenderPipelineAsync(descriptor);
    this.pipelines.add(pipeline);
    this.pipelinesCreated += 1;
    return pipeline;
  }

  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup {
    const group = this.device.createBindGroup(descriptor);
    this.bindGroups.add(group);
    this.bindGroupsCreated += 1;
    return group;
  }

  /** Layouts are cheap, immutable and uncounted (`spec/runtime-abi.md` section 10.1 has no counter for them). */
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout {
    return this.device.createBindGroupLayout(descriptor);
  }

  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout {
    return this.device.createPipelineLayout(descriptor);
  }

  /**
   * `queue.writeBuffer` with the counters of `spec/runtime-abi.md` section 10.1. `dataOffset` and
   * `size` are in bytes (the data is an `ArrayBuffer`). `bufferOffset` and `size` must be multiples of
   * 4, as WebGPU requires.
   */
  writeBuffer(queue: GPUQueue, buffer: GPUBuffer, bufferOffset: number, data: ArrayBuffer, dataOffset: number, size: number): void {
    if (!isMultipleOfFour(bufferOffset)) throw new RangeError(`writeBuffer: bufferOffset ${String(bufferOffset)} is not a multiple of 4`);
    if (!isMultipleOfFour(size)) throw new RangeError(`writeBuffer: size ${String(size)} is not a multiple of 4`);
    if (!Number.isInteger(dataOffset) || dataOffset < 0 || dataOffset + size > data.byteLength) {
      throw new RangeError("writeBuffer: the data range exceeds the source");
    }
    queue.writeBuffer(buffer, bufferOffset, data, dataOffset, size);
    this.uploads += 1;
    this.uploadBytes += size;
  }

  /** Adds a DOM listener; the returned function removes it (once). `destroyAll` removes any that remain. */
  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): () => void {
    const record: ListenerRecord = { target, type, listener, options };
    target.addEventListener(type, listener, options);
    this.listeners.add(record);
    return () => {
      if (this.listeners.delete(record)) target.removeEventListener(type, listener, options);
    };
  }

  /** Releases one resource: buffers and textures are destroyed, the rest are dropped from the live counts. */
  release(resource: ReleasableResource): void {
    // Membership is by object identity, so the casts below only select the set to look in.
    if (this.buffers.delete(resource as GPUBuffer)) {
      (resource as GPUBuffer).destroy();
    } else if (this.textures.delete(resource as GPUTexture)) {
      (resource as GPUTexture).destroy();
    } else if (
      !this.samplers.delete(resource as GPUSampler) &&
      !this.shaderModules.delete(resource as GPUShaderModule) &&
      !this.pipelines.delete(resource as GPURenderPipeline) &&
      !this.bindGroups.delete(resource as GPUBindGroup)
    ) {
      throw new Error("ResourceRegistry.release: the resource is not registered or was already released");
    }
  }

  /** Destroys every buffer and texture, drops everything else and removes every listener. Cumulative counters are kept. */
  destroyAll(): void {
    for (const record of this.listeners) record.target.removeEventListener(record.type, record.listener, record.options);
    this.listeners.clear();
    for (const buffer of this.buffers) buffer.destroy();
    this.buffers.clear();
    for (const texture of this.textures) texture.destroy();
    this.textures.clear();
    this.samplers.clear();
    this.shaderModules.clear();
    this.pipelines.clear();
    this.bindGroups.clear();
  }
}
