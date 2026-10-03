/**
 * A fake WebGPU implementation for unit tests (no browser, no GPU).
 *
 * It records every call and models the API contracts the runtime relies on, throwing where a real
 * implementation would raise a validation error:
 *  - `writeBuffer`: `bufferOffset` and the written byte size are multiples of 4; for `ArrayBuffer`
 *    sources `dataOffset`/`size` are in bytes, for typed arrays in elements; the range must fit in the
 *    source and in the destination; the destination must carry `COPY_DST`, must not be destroyed and
 *    must be large enough.
 *  - `createBuffer`: positive size, a non-zero usage, `size <= limits.maxBufferSize`.
 *  - `createBindGroup`: buffers must not be destroyed, binding ranges must fit in the buffer and be
 *    aligned to `minUniformBufferOffsetAlignment` for uniform bindings.
 *  - error scopes form a stack; `popErrorScope` on an empty stack rejects; an injected out-of-memory
 *    error is captured by the innermost scope with the `out-of-memory` filter, else it is delivered
 *    to `onuncapturederror`.
 *
 * The fakes are structurally minimal. `asGpu` is the single, documented place where a fake is
 * presented as the nominally typed WebGPU interface (the `__brand` members of `@webgpu/types` make a
 * structural implementation impossible).
 */

/** Presents a fake as the WebGPU interface type it stands in for. */
export function asGpu<T>(fake: object): T {
  return fake as T;
}

const USAGE_COPY_DST = 0x08;
const USAGE_UNIFORM = 0x40;

export const DEFAULT_LIMITS: Readonly<Record<string, number>> = {
  maxTextureDimension1D: 8192,
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 256,
  maxBindGroups: 4,
  maxBindingsPerBindGroup: 1000,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
  maxUniformBuffersPerShaderStage: 12,
  maxUniformBufferBindingSize: 65536,
  maxStorageBufferBindingSize: 134217728,
  minUniformBufferOffsetAlignment: 256,
  minStorageBufferOffsetAlignment: 256,
  maxVertexBuffers: 8,
  maxBufferSize: 268435456,
  maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048,
  maxInterStageShaderVariables: 16,
  maxColorAttachments: 8,
  maxComputeWorkgroupStorageSize: 16384,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupsPerDimension: 65535,
};

export interface FakeBufferDescriptor {
  readonly size: number;
  readonly usage: number;
  readonly label?: string;
  readonly mappedAtCreation?: boolean;
}

export class FakeBuffer {
  readonly size: number;
  readonly usage: number;
  readonly label: string;
  destroyed = false;
  /** GPU-side contents as written through the queue (zero-initialised, as WebGPU requires). */
  readonly contents: Uint8Array;

  constructor(
    descriptor: FakeBufferDescriptor,
    private readonly log: (event: string) => void,
  ) {
    this.size = descriptor.size;
    this.usage = descriptor.usage;
    this.label = descriptor.label ?? "";
    this.contents = new Uint8Array(descriptor.size);
  }

  destroy(): void {
    // Destroying twice is allowed by WebGPU (no-op).
    if (!this.destroyed) this.log(`destroy:${this.label}`);
    this.destroyed = true;
  }
}

export interface FakeWrite {
  readonly buffer: FakeBuffer;
  readonly bufferOffset: number;
  /** Bytes written. */
  readonly size: number;
}

export class FakeQueue {
  readonly writes: FakeWrite[] = [];

  constructor(private readonly log: (event: string) => void) {}

  writeBuffer(
    buffer: FakeBuffer,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset = 0,
    size?: number,
  ): void {
    if (buffer.destroyed) throw new Error(`writeBuffer: buffer "${buffer.label}" is destroyed`);
    if ((buffer.usage & USAGE_COPY_DST) === 0) throw new Error(`writeBuffer: buffer "${buffer.label}" lacks COPY_DST`);
    const isView = ArrayBuffer.isView(data);
    const elementSize = isView && "BYTES_PER_ELEMENT" in data ? Number(data.BYTES_PER_ELEMENT) : 1;
    const sourceBytes = isView ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const sourceElements = sourceBytes.byteLength / elementSize;
    const elementCount = size ?? sourceElements - dataOffset;
    const byteOffset = dataOffset * elementSize;
    const byteSize = elementCount * elementSize;
    if (!Number.isInteger(bufferOffset) || bufferOffset < 0) throw new Error("writeBuffer: invalid bufferOffset");
    if (!Number.isInteger(byteSize) || byteSize < 0) throw new Error("writeBuffer: invalid size");
    if (bufferOffset % 4 !== 0) throw new Error(`writeBuffer: bufferOffset ${bufferOffset} is not a multiple of 4`);
    if (byteSize % 4 !== 0) throw new Error(`writeBuffer: size ${byteSize} is not a multiple of 4`);
    if (dataOffset < 0 || dataOffset + elementCount > sourceElements) {
      throw new Error("writeBuffer: data range exceeds the source");
    }
    if (bufferOffset + byteSize > buffer.size) throw new Error("writeBuffer: write exceeds the buffer");
    buffer.contents.set(sourceBytes.subarray(byteOffset, byteOffset + byteSize), bufferOffset);
    this.writes.push({ buffer, bufferOffset, size: byteSize });
  }
}

export interface FakeBindGroupEntry {
  readonly binding: number;
  readonly resource: { readonly buffer: FakeBuffer; readonly offset?: number; readonly size?: number };
}

export interface FakeBindGroupDescriptor {
  readonly label?: string;
  readonly layout: object;
  readonly entries: readonly FakeBindGroupEntry[];
}

export class FakeBindGroup {
  constructor(readonly descriptor: FakeBindGroupDescriptor) {}
}

export class FakeResource {
  constructor(
    readonly kind: string,
    readonly descriptor: unknown,
  ) {}
}

export class FakeTexture {
  destroyed = false;

  constructor(readonly descriptor: unknown) {}

  destroy(): void {
    this.destroyed = true;
  }
}

interface ErrorScope {
  readonly filter: string;
  error: { readonly message: string } | null;
}

export class FakeDevice {
  readonly limits: Record<string, number>;
  readonly queue: FakeQueue;
  readonly buffers: FakeBuffer[] = [];
  readonly textures: FakeTexture[] = [];
  readonly bindGroups: FakeBindGroup[] = [];
  /** Ordered log of observable events (`destroy:<label>`, `pushErrorScope:<filter>`, ...). Tests may append. */
  readonly events: string[] = [];
  readonly uncapturedErrors: string[] = [];
  onuncapturederror: ((event: { readonly error: { readonly message: string } }) => void) | null = null;
  private readonly scopes: ErrorScope[] = [];
  private oomBudget = 0;
  private readonly lostResolvers: Array<(info: { reason: string; message: string }) => void> = [];
  readonly lost: Promise<{ reason: string; message: string }>;

  constructor(limits: Record<string, number> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.queue = new FakeQueue((e) => this.events.push(e));
    this.lost = new Promise((resolve) => this.lostResolvers.push(resolve));
  }

  /** The next `count` buffer or texture creations fail with an out-of-memory error. */
  failNextAllocations(count = 1): void {
    this.oomBudget = count;
  }

  /** Resolves `device.lost`. */
  loseDevice(reason: string, message: string): void {
    for (const resolve of this.lostResolvers) resolve({ reason, message });
  }

  get openErrorScopes(): number {
    return this.scopes.length;
  }

  pushErrorScope(filter: string): void {
    this.events.push(`pushErrorScope:${filter}`);
    this.scopes.push({ filter, error: null });
  }

  popErrorScope(): Promise<{ readonly message: string } | null> {
    this.events.push("popErrorScope");
    const scope = this.scopes.pop();
    if (scope === undefined) return Promise.reject(new Error("OperationError: popErrorScope on an empty stack"));
    return Promise.resolve(scope.error);
  }

  private raise(filter: string, message: string): void {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope?.filter === filter) {
        scope.error ??= { message };
        return;
      }
    }
    this.uncapturedErrors.push(message);
    this.onuncapturederror?.({ error: { message } });
  }

  private consumeOom(): boolean {
    if (this.oomBudget <= 0) return false;
    this.oomBudget -= 1;
    return true;
  }

  createBuffer(descriptor: FakeBufferDescriptor): FakeBuffer {
    if (!(descriptor.size > 0) || !Number.isInteger(descriptor.size)) {
      throw new Error("createBuffer: size must be a positive integer");
    }
    if (descriptor.usage === 0) throw new Error("createBuffer: usage must not be zero");
    const max = this.limits["maxBufferSize"];
    if (max !== undefined && descriptor.size > max) throw new Error("createBuffer: size exceeds maxBufferSize");
    if (this.consumeOom()) this.raise("out-of-memory", `out of memory creating buffer "${descriptor.label ?? ""}"`);
    const buffer = new FakeBuffer(descriptor, (e) => this.events.push(e));
    this.buffers.push(buffer);
    return buffer;
  }

  createTexture(descriptor: unknown): FakeTexture {
    if (this.consumeOom()) this.raise("out-of-memory", "out of memory creating texture");
    const texture = new FakeTexture(descriptor);
    this.textures.push(texture);
    return texture;
  }

  createSampler(descriptor?: unknown): FakeResource {
    return new FakeResource("sampler", descriptor);
  }

  createShaderModule(descriptor: unknown): FakeResource {
    return new FakeResource("shaderModule", descriptor);
  }

  createRenderPipeline(descriptor: unknown): FakeResource {
    return new FakeResource("renderPipeline", descriptor);
  }

  createRenderPipelineAsync(descriptor: unknown): Promise<FakeResource> {
    return Promise.resolve(new FakeResource("renderPipeline", descriptor));
  }

  createBindGroupLayout(descriptor: unknown): FakeResource {
    return new FakeResource("bindGroupLayout", descriptor);
  }

  createPipelineLayout(descriptor: unknown): FakeResource {
    return new FakeResource("pipelineLayout", descriptor);
  }

  createBindGroup(descriptor: FakeBindGroupDescriptor): FakeBindGroup {
    const alignment = this.limits["minUniformBufferOffsetAlignment"] ?? 256;
    for (const entry of descriptor.entries) {
      const { buffer, offset = 0, size } = entry.resource;
      if (buffer.destroyed) throw new Error(`createBindGroup: buffer "${buffer.label}" is destroyed`);
      const bound = size ?? buffer.size - offset;
      if (offset + bound > buffer.size) throw new Error("createBindGroup: binding range exceeds the buffer");
      if ((buffer.usage & USAGE_UNIFORM) !== 0 && offset % alignment !== 0) {
        throw new Error(`createBindGroup: offset ${offset} violates minUniformBufferOffsetAlignment ${alignment}`);
      }
    }
    const group = new FakeBindGroup(descriptor);
    this.bindGroups.push(group);
    return group;
  }
}

export interface FakeAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly isFallbackAdapter?: boolean;
}

export interface FakeAdapterOptions {
  readonly features?: readonly string[];
  readonly limits?: Record<string, number>;
  readonly info?: FakeAdapterInfo | undefined;
  /** When set, `requestDevice` rejects with this error. */
  readonly requestDeviceError?: Error;
}

export class FakeAdapter {
  readonly features: Set<string>;
  readonly limits: Record<string, number>;
  readonly info: FakeAdapterInfo | undefined;
  readonly deviceRequests: Array<{ requiredFeatures?: string[]; requiredLimits?: Record<string, number> }> = [];
  readonly devices: FakeDevice[] = [];

  constructor(private readonly options: FakeAdapterOptions = {}) {
    this.features = new Set(options.features ?? []);
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.info =
      "info" in options
        ? options.info
        : { vendor: "fake", architecture: "fake-arch", device: "fake-device", description: "Fake adapter", isFallbackAdapter: false };
  }

  requestDevice(descriptor: { requiredFeatures?: string[]; requiredLimits?: Record<string, number> } = {}): Promise<FakeDevice> {
    this.deviceRequests.push(descriptor);
    if (this.options.requestDeviceError !== undefined) return Promise.reject(this.options.requestDeviceError);
    // A real device exposes the default limits plus exactly the limits it requested - not the
    // (possibly larger) adapter limits.
    const device = new FakeDevice(descriptor.requiredLimits ?? {});
    this.devices.push(device);
    return Promise.resolve(device);
  }
}

export class FakeGpu {
  readonly adapterRequests: Array<{ powerPreference?: string }> = [];

  constructor(private readonly adapter: FakeAdapter | null) {}

  requestAdapter(options: { powerPreference?: string } = {}): Promise<FakeAdapter | null> {
    this.adapterRequests.push(options);
    return Promise.resolve(this.adapter);
  }
}
