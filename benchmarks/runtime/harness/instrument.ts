// The measurement instrument of the benchmark page: it wraps the WebGPU API once, before any application code runs, so that
// all three implementations of a workload are counted by the same code (decision 0095).
//
//  - `installDeviceCapture`  records every device an application requests (the page needs it for `onSubmittedWorkDone`),
//    reports uncaptured validation errors and device loss, and, when GPU time is wanted, adds `timestamp-query` to the request.
//    It is the only wrapper a timing pass installs (one call per device, not per frame).
//  - `installCounters`       counts creations, uploads, draw calls and destroys. Counting passes only: wrapping every draw
//    call costs a little CPU time, which a timing pass must not pay.
//  - `GpuTimer`              (installed with the counters) puts `timestampWrites` on every render pass the application begins and
//    resolves them in the encoder's `finish`, so the page can read the GPU time of the frame's passes. It exists only on
//    devices that were created with `timestamp-query`; without the feature the page labels GPU time unavailable.
//
// Nothing here estimates anything: a counter that cannot be observed through the API is not offered.

export interface GpuCounters {
  buffersCreated: number;
  bufferBytesCreated: number;
  texturesCreated: number;
  textureBytesCreated: number;
  samplersCreated: number;
  shaderModulesCreated: number;
  bindGroupsCreated: number;
  bindGroupLayoutsCreated: number;
  pipelineLayoutsCreated: number;
  renderPipelinesCreated: number;
  computePipelinesCreated: number;
  querySetsCreated: number;
  commandEncodersCreated: number;
  renderPassesBegun: number;
  computePassesBegun: number;
  submits: number;
  drawCalls: number;
  instancedDrawCalls: number;
  instancesDrawn: number;
  setPipeline: number;
  setBindGroup: number;
  setVertexBuffer: number;
  setIndexBuffer: number;
  writeBufferCalls: number;
  writeBufferBytes: number;
  writeTextureCalls: number;
  writeTextureBytes: number;
  externalImageCopies: number;
  externalImageBytes: number;
  mappedAtCreationBytes: number;
  buffersDestroyed: number;
  texturesDestroyed: number;
  liveBufferBytes: number;
  liveTextureBytes: number;
  devicesRequested: number;
  devicesDestroyed: number;
}

export type CounterName = keyof GpuCounters;

export function emptyCounters(): GpuCounters {
  return {
    buffersCreated: 0,
    bufferBytesCreated: 0,
    texturesCreated: 0,
    textureBytesCreated: 0,
    samplersCreated: 0,
    shaderModulesCreated: 0,
    bindGroupsCreated: 0,
    bindGroupLayoutsCreated: 0,
    pipelineLayoutsCreated: 0,
    renderPipelinesCreated: 0,
    computePipelinesCreated: 0,
    querySetsCreated: 0,
    commandEncodersCreated: 0,
    renderPassesBegun: 0,
    computePassesBegun: 0,
    submits: 0,
    drawCalls: 0,
    instancedDrawCalls: 0,
    instancesDrawn: 0,
    setPipeline: 0,
    setBindGroup: 0,
    setVertexBuffer: 0,
    setIndexBuffer: 0,
    writeBufferCalls: 0,
    writeBufferBytes: 0,
    writeTextureCalls: 0,
    writeTextureBytes: 0,
    externalImageCopies: 0,
    externalImageBytes: 0,
    mappedAtCreationBytes: 0,
    buffersDestroyed: 0,
    texturesDestroyed: 0,
    liveBufferBytes: 0,
    liveTextureBytes: 0,
    devicesRequested: 0,
    devicesDestroyed: 0,
  };
}

/** `after - before` for every counter. */
export function diffCounters(after: Readonly<GpuCounters>, before: Readonly<GpuCounters>): GpuCounters {
  const out = emptyCounters();
  for (const key of Object.keys(out) as CounterName[]) out[key] = after[key] - before[key];
  return out;
}

/** Bytes per texel of the formats the benchmarks use; any other format is counted with `unknownTextureFormats`. */
const TEXEL_BYTES: Readonly<Record<string, number>> = {
  r8unorm: 1,
  rg8unorm: 2,
  rgba8unorm: 4,
  "rgba8unorm-srgb": 4,
  bgra8unorm: 4,
  "bgra8unorm-srgb": 4,
  rg16float: 4,
  rgba16float: 8,
  rgba32float: 16,
  depth16unorm: 2,
  depth24plus: 4,
  "depth24plus-stencil8": 4,
  depth32float: 4,
};

export interface DeviceRecord {
  readonly device: GPUDevice;
  readonly features: readonly string[];
  lost: { reason: string; message: string } | null;
  readonly errors: string[];
  destroyed: boolean;
}

interface Hooks {
  readonly devices: DeviceRecord[];
  /** Problems of devices that were destroyed and dropped by `pruneDestroyedDevices`. */
  readonly retiredProblems: string[];
  readonly counters: GpuCounters;
  readonly unknownTextureFormats: Set<string>;
  timer: GpuTimer | null;
  wantTimestamps: boolean;
  countersInstalled: boolean;
  captureInstalled: boolean;
}

const hooks: Hooks = {
  devices: [],
  retiredProblems: [],
  counters: emptyCounters(),
  unknownTextureFormats: new Set(),
  timer: null,
  wantTimestamps: false,
  countersInstalled: false,
  captureInstalled: false,
};

type AnyFunction = (...args: unknown[]) => unknown;

/** Replaces `target[name]` by `wrap(original)`; the wrapper is called with the original `this`. */
function patch(target: object, name: string, wrap: (original: AnyFunction) => AnyFunction): void {
  const record = target as Record<string, unknown>;
  const original = record[name];
  if (typeof original !== "function") throw new Error(`the WebGPU API has no ${name} to wrap`);
  const wrapped = wrap(original as AnyFunction);
  Object.defineProperty(target, name, { value: wrapped, configurable: true, writable: true });
}

export function devices(): readonly DeviceRecord[] {
  return hooks.devices;
}

/**
 * Drops the records of destroyed devices so the instrument does not keep every device of a long mount/dispose run alive (that would
 * hide a leak in the application, or cause one). Their validation errors and losses are kept as text.
 */
export function pruneDestroyedDevices(): void {
  for (let i = hooks.devices.length - 1; i >= 0; i -= 1) {
    const record = hooks.devices[i];
    if (record === undefined || !record.destroyed) continue;
    for (const error of record.errors.slice(0, 5)) hooks.retiredProblems.push(`uncaptured error: ${error}`);
    if (record.lost !== null && record.lost.reason !== "destroyed") hooks.retiredProblems.push(`lost (${record.lost.reason}): ${record.lost.message}`);
    hooks.devices.splice(i, 1);
  }
}

export function retiredProblems(): readonly string[] {
  return hooks.retiredProblems;
}

/** The device of the application under test: the last one requested that is not destroyed. */
export function currentDevice(): DeviceRecord | undefined {
  for (let i = hooks.devices.length - 1; i >= 0; i -= 1) {
    const record = hooks.devices[i];
    if (record !== undefined && !record.destroyed) return record;
  }
  return undefined;
}

export function installDeviceCapture(options: { readonly timestampQuery: boolean }): void {
  hooks.wantTimestamps = options.timestampQuery;
  if (hooks.captureInstalled) return;
  hooks.captureInstalled = true;
  patch(GPUAdapter.prototype, "requestDevice", (original) =>
    async function (this: GPUAdapter, ...args: unknown[]): Promise<GPUDevice> {
      const descriptor = (args[0] ?? {}) as GPUDeviceDescriptor;
      let effective = descriptor;
      if (hooks.wantTimestamps && this.features.has("timestamp-query")) {
        const required = new Set<GPUFeatureName>(descriptor.requiredFeatures ?? []);
        required.add("timestamp-query");
        effective = { ...descriptor, requiredFeatures: [...required] };
      }
      const device = (await original.call(this, effective)) as GPUDevice;
      const record: DeviceRecord = { device, features: [...device.features].sort(), lost: null, errors: [], destroyed: false };
      hooks.devices.push(record);
      hooks.counters.devicesRequested += 1;
      void device.lost.then((info) => {
        record.lost = { reason: info.reason, message: info.message };
        if (info.reason === "destroyed") record.destroyed = true;
      });
      device.addEventListener("uncapturederror", (event) => {
        record.errors.push((event).error.message);
      });
      return device;
    },
  );
  patch(GPUDevice.prototype, "destroy", (original) =>
    function (this: GPUDevice, ...args: unknown[]): unknown {
      const record = hooks.devices.find((r) => r.device === this);
      if (record !== undefined) record.destroyed = true;
      hooks.counters.devicesDestroyed += 1;
      return original.apply(this, args);
    },
  );
}

/** A snapshot copy of the counters. */
export function snapshotCounters(): GpuCounters {
  return { ...hooks.counters };
}

export function unknownTextureFormats(): string[] {
  return [...hooks.unknownTextureFormats].sort();
}

function textureBytes(descriptor: GPUTextureDescriptor): number {
  const size = descriptor.size;
  let width: number;
  let height: number;
  let layers: number;
  if (Array.isArray(size)) {
    width = size[0] ?? 1;
    height = size[1] ?? 1;
    layers = size[2] ?? 1;
  } else {
    const s = size;
    width = s.width;
    height = s.height ?? 1;
    layers = s.depthOrArrayLayers ?? 1;
  }
  const per = TEXEL_BYTES[descriptor.format];
  if (per === undefined) hooks.unknownTextureFormats.add(descriptor.format);
  const samples = descriptor.sampleCount ?? 1;
  let texels = 0;
  for (let mip = 0; mip < (descriptor.mipLevelCount ?? 1); mip += 1) {
    texels += Math.max(1, Math.floor(width / 2 ** mip))
      * Math.max(1, Math.floor(height / 2 ** mip))
      * (descriptor.dimension === "3d" ? Math.max(1, Math.floor(layers / 2 ** mip)) : layers);
  }
  return texels * (per ?? 4) * samples;
}

export function installCounters(): void {
  if (hooks.countersInstalled) return;
  hooks.countersInstalled = true;
  const c = hooks.counters;
  const bufferSizes = new WeakMap<object, number>();
  const textureSizes = new WeakMap<object, number>();

  patch(GPUDevice.prototype, "createBuffer", (original) =>
    function (this: GPUDevice, ...args: unknown[]): unknown {
      const descriptor = args[0] as GPUBufferDescriptor;
      const buffer = original.apply(this, args) as GPUBuffer;
      c.buffersCreated += 1;
      c.bufferBytesCreated += descriptor.size;
      c.liveBufferBytes += descriptor.size;
      bufferSizes.set(buffer, descriptor.size);
      if (descriptor.mappedAtCreation === true) c.mappedAtCreationBytes += descriptor.size;
      return buffer;
    },
  );
  patch(GPUBuffer.prototype, "destroy", (original) =>
    function (this: GPUBuffer, ...args: unknown[]): unknown {
      const size = bufferSizes.get(this);
      if (size !== undefined) {
        bufferSizes.delete(this);
        c.buffersDestroyed += 1;
        c.liveBufferBytes -= size;
      }
      return original.apply(this, args);
    },
  );
  patch(GPUDevice.prototype, "createTexture", (original) =>
    function (this: GPUDevice, ...args: unknown[]): unknown {
      const descriptor = args[0] as GPUTextureDescriptor;
      const texture = original.apply(this, args) as GPUTexture;
      const bytes = textureBytes(descriptor);
      c.texturesCreated += 1;
      c.textureBytesCreated += bytes;
      c.liveTextureBytes += bytes;
      textureSizes.set(texture, bytes);
      return texture;
    },
  );
  patch(GPUTexture.prototype, "destroy", (original) =>
    function (this: GPUTexture, ...args: unknown[]): unknown {
      const bytes = textureSizes.get(this);
      if (bytes !== undefined) {
        textureSizes.delete(this);
        c.texturesDestroyed += 1;
        c.liveTextureBytes -= bytes;
      }
      return original.apply(this, args);
    },
  );

  const count = (proto: object, name: string, counter: CounterName): void => {
    patch(proto, name, (original) =>
      function (this: unknown, ...args: unknown[]): unknown {
        c[counter] += 1;
        return original.apply(this, args);
      },
    );
  };
  count(GPUDevice.prototype, "createSampler", "samplersCreated");
  count(GPUDevice.prototype, "createShaderModule", "shaderModulesCreated");
  count(GPUDevice.prototype, "createBindGroup", "bindGroupsCreated");
  count(GPUDevice.prototype, "createBindGroupLayout", "bindGroupLayoutsCreated");
  count(GPUDevice.prototype, "createPipelineLayout", "pipelineLayoutsCreated");
  count(GPUDevice.prototype, "createRenderPipeline", "renderPipelinesCreated");
  count(GPUDevice.prototype, "createRenderPipelineAsync", "renderPipelinesCreated");
  count(GPUDevice.prototype, "createComputePipeline", "computePipelinesCreated");
  count(GPUDevice.prototype, "createComputePipelineAsync", "computePipelinesCreated");
  count(GPUDevice.prototype, "createQuerySet", "querySetsCreated");
  count(GPUDevice.prototype, "createCommandEncoder", "commandEncodersCreated");
  count(GPUCommandEncoder.prototype, "beginComputePass", "computePassesBegun");
  count(GPUQueue.prototype, "submit", "submits");
  count(GPURenderPassEncoder.prototype, "setPipeline", "setPipeline");
  count(GPURenderPassEncoder.prototype, "setBindGroup", "setBindGroup");
  count(GPURenderPassEncoder.prototype, "setVertexBuffer", "setVertexBuffer");
  count(GPURenderPassEncoder.prototype, "setIndexBuffer", "setIndexBuffer");

  patch(GPUQueue.prototype, "writeBuffer", (original) =>
    function (this: GPUQueue, ...args: unknown[]): unknown {
      // writeBuffer(buffer, bufferOffset, data, dataOffset?, size?): `size` counts elements of a typed array, bytes otherwise.
      const data = args[2] as ArrayBufferView | ArrayBuffer;
      const dataOffset = (args[3] as number | undefined) ?? 0;
      const size = args[4] as number | undefined;
      const isView = ArrayBuffer.isView(data);
      const unit = isView && !(data instanceof DataView) ? (data as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT : 1;
      const total = isView ? (data.byteLength / unit) : (data).byteLength;
      const elements = size ?? total - dataOffset;
      c.writeBufferCalls += 1;
      c.writeBufferBytes += elements * unit;
      return original.apply(this, args);
    },
  );
  patch(GPUQueue.prototype, "writeTexture", (original) =>
    function (this: GPUQueue, ...args: unknown[]): unknown {
      const size = args[3] as GPUExtent3D;
      const layout = args[2] as GPUTexelCopyBufferLayout;
      let height: number;
      let layers: number;
      if (Array.isArray(size)) {
        height = size[1] ?? 1;
        layers = size[2] ?? 1;
      } else {
        const s = size;
        height = s.height ?? 1;
        layers = s.depthOrArrayLayers ?? 1;
      }
      c.writeTextureCalls += 1;
      c.writeTextureBytes += (layout.bytesPerRow ?? 0) * height * layers;
      return original.apply(this, args);
    },
  );
  patch(GPUQueue.prototype, "copyExternalImageToTexture", (original) =>
    function (this: GPUQueue, ...args: unknown[]): unknown {
      const size = args[2] as GPUExtent3D;
      let width: number;
      let height: number;
      if (Array.isArray(size)) {
        width = size[0] ?? 1;
        height = size[1] ?? 1;
      } else {
        const s = size;
        width = s.width;
        height = s.height ?? 1;
      }
      c.externalImageCopies += 1;
      c.externalImageBytes += width * height * 4;
      return original.apply(this, args);
    },
  );

  patch(GPUCommandEncoder.prototype, "beginRenderPass", (original) =>
    function (this: GPUCommandEncoder, ...args: unknown[]): unknown {
      c.renderPassesBegun += 1;
      const timer = hooks.timer;
      if (timer !== null) args[0] = timer.instrumentPass(this, args[0] as GPURenderPassDescriptor);
      return original.apply(this, args);
    },
  );
  patch(GPUCommandEncoder.prototype, "finish", (original) =>
    function (this: GPUCommandEncoder, ...args: unknown[]): unknown {
      hooks.timer?.beforeFinish(this);
      return original.apply(this, args);
    },
  );

  const draw = (proto: object, name: string, instancesIndex: number | null): void => {
    patch(proto, name, (original) =>
      function (this: unknown, ...args: unknown[]): unknown {
        c.drawCalls += 1;
        const instances = instancesIndex === null ? 1 : ((args[instancesIndex] as number | undefined) ?? 1);
        if (instances > 1) c.instancedDrawCalls += 1;
        c.instancesDrawn += instances;
        return original.apply(this, args);
      },
    );
  };
  draw(GPURenderPassEncoder.prototype, "draw", 1);
  draw(GPURenderPassEncoder.prototype, "drawIndexed", 1);
  draw(GPURenderPassEncoder.prototype, "drawIndirect", null);
  draw(GPURenderPassEncoder.prototype, "drawIndexedIndirect", null);
}

// ---- GPU time ---------------------------------------------------------------------------------------------------

const MAX_TIMED_PASSES = 8;
const QUERY_RESOLVE = 0x200;
const COPY_SRC = 0x04;
const COPY_DST = 0x08;
const MAP_READ = 0x01;

/**
 * Brackets the render passes of one command encoder per frame with timestamp queries. One encoder per frame is timed (all
 * three implementations record a frame in one encoder); a frame that uses more is counted in `encodersSkipped` and not timed.
 */
export class GpuTimer {
  readonly querySet: GPUQuerySet;
  private readonly resolveBuffer: GPUBuffer;
  private readonly readBuffer: GPUBuffer;
  private timedEncoder: GPUCommandEncoder | null = null;
  private passes = 0;
  encodersSkipped = 0;
  passesSkipped = 0;
  private lastPasses = 0;

  constructor(device: GPUDevice) {
    this.querySet = device.createQuerySet({ type: "timestamp", count: MAX_TIMED_PASSES * 2 });
    this.resolveBuffer = device.createBuffer({ size: MAX_TIMED_PASSES * 16, usage: QUERY_RESOLVE | COPY_SRC });
    this.readBuffer = device.createBuffer({ size: MAX_TIMED_PASSES * 16, usage: MAP_READ | COPY_DST });
  }

  instrumentPass(encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor): GPURenderPassDescriptor {
    if (this.timedEncoder !== null && this.timedEncoder !== encoder) {
      this.encodersSkipped += 1;
      return descriptor;
    }
    if (this.passes >= MAX_TIMED_PASSES || descriptor.timestampWrites !== undefined) {
      this.passesSkipped += 1;
      return descriptor;
    }
    this.timedEncoder = encoder;
    const slot = this.passes;
    this.passes += 1;
    return {
      ...descriptor,
      timestampWrites: { querySet: this.querySet, beginningOfPassWriteIndex: 2 * slot, endOfPassWriteIndex: 2 * slot + 1 },
    };
  }

  beforeFinish(encoder: GPUCommandEncoder): void {
    if (encoder !== this.timedEncoder || this.passes === 0) return;
    encoder.resolveQuerySet(this.querySet, 0, 2 * this.passes, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 16 * this.passes);
    this.lastPasses = this.passes;
    this.timedEncoder = null;
    this.passes = 0;
  }

  /** GPU milliseconds of the passes of the last finished encoder; call after the frame's work is done. `null` when no pass was timed. */
  async readMs(): Promise<number | null> {
    const passes = this.lastPasses;
    this.lastPasses = 0;
    if (passes === 0) return null;
    await this.readBuffer.mapAsync(1);
    const values = new BigUint64Array(this.readBuffer.getMappedRange().slice(0, 16 * passes));
    this.readBuffer.unmap();
    let ns = 0n;
    for (let i = 0; i < passes; i += 1) {
      const begin = values[2 * i] as bigint;
      const end = values[2 * i + 1] as bigint;
      if (end >= begin) ns += end - begin;
    }
    return Number(ns) / 1e6;
  }

  destroy(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readBuffer.destroy();
  }
}

export function installGpuTimer(device: GPUDevice): GpuTimer {
  if (!device.features.has("timestamp-query")) throw new Error("the device was created without timestamp-query");
  if (!hooks.countersInstalled) throw new Error("the GPU timer is installed with the counters");
  const timer = new GpuTimer(device);
  hooks.timer = timer;
  return timer;
}

export function currentTimer(): GpuTimer | null {
  return hooks.timer;
}
