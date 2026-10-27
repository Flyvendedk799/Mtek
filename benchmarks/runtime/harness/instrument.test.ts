// The instrument counts the WebGPU API the same way for every implementation; these tests run it against a minimal fake of the
// classes it wraps (the real API exists only in a browser) and check the arithmetic of what it reports.
import { beforeAll, describe, expect, it } from "vitest";

class FakeBuffer {
  destroyed = false;
  constructor(readonly size: number) {}
  destroy(): void {
    this.destroyed = true;
  }
}
class FakeTexture {
  constructor(readonly descriptor: unknown) {}
  destroy(): void {}
}
class FakeQuerySet {
  destroy(): void {}
}
class FakeRenderPass {
  draw(vertexCount: number, instanceCount?: number): void {
    void vertexCount;
    void instanceCount;
  }
  drawIndexed(indexCount: number, instanceCount?: number): void {
    void indexCount;
    void instanceCount;
  }
  drawIndirect(): void {}
  drawIndexedIndirect(): void {}
  setPipeline(): void {}
  setBindGroup(): void {}
  setVertexBuffer(): void {}
  setIndexBuffer(): void {}
}
class FakeEncoder {
  readonly passes: unknown[] = [];
  readonly commands: string[] = [];
  beginRenderPass(descriptor: unknown): FakeRenderPass {
    this.passes.push(descriptor);
    return new FakeRenderPass();
  }
  beginComputePass(): object {
    return {};
  }
  resolveQuerySet(): void {
    this.commands.push("resolve");
  }
  copyBufferToBuffer(): void {
    this.commands.push("copy");
  }
  finish(): object {
    this.commands.push("finish");
    return {};
  }
}
class FakeQueue {
  writeBuffer(...args: unknown[]): void {
    void args;
  }
  writeTexture(...args: unknown[]): void {
    void args;
  }
  copyExternalImageToTexture(...args: unknown[]): void {
    void args;
  }
  submit(): void {}
}
class FakeDevice {
  readonly features = new Set<string>(["timestamp-query"]);
  readonly lost = new Promise<never>(() => undefined);
  addEventListener(): void {}
  destroy(): void {}
  createBuffer(descriptor: { size: number }): FakeBuffer {
    return new FakeBuffer(descriptor.size);
  }
  createTexture(descriptor: unknown): FakeTexture {
    return new FakeTexture(descriptor);
  }
  createQuerySet(): FakeQuerySet {
    return new FakeQuerySet();
  }
  createSampler(): object {
    return {};
  }
  createShaderModule(): object {
    return {};
  }
  createBindGroup(): object {
    return {};
  }
  createBindGroupLayout(): object {
    return {};
  }
  createPipelineLayout(): object {
    return {};
  }
  createRenderPipeline(): object {
    return {};
  }
  createRenderPipelineAsync(): Promise<object> {
    return Promise.resolve({});
  }
  createComputePipeline(): object {
    return {};
  }
  createComputePipelineAsync(): Promise<object> {
    return Promise.resolve({});
  }
  createCommandEncoder(): FakeEncoder {
    return new FakeEncoder();
  }
}
class FakeAdapter {
  readonly features = new Set<string>(["timestamp-query"]);
  lastDescriptor: unknown;
  requestDevice(descriptor?: unknown): Promise<FakeDevice> {
    this.lastDescriptor = descriptor;
    return Promise.resolve(new FakeDevice());
  }
}

type Instrument = typeof import("./instrument.ts");
let instrument: Instrument;

beforeAll(async () => {
  Object.assign(globalThis, {
    GPUAdapter: FakeAdapter,
    GPUDevice: FakeDevice,
    GPUBuffer: FakeBuffer,
    GPUTexture: FakeTexture,
    GPUQueue: FakeQueue,
    GPUCommandEncoder: FakeEncoder,
    GPURenderPassEncoder: FakeRenderPass,
  });
  instrument = await import("./instrument.ts");
  instrument.installDeviceCapture({ timestampQuery: true });
  instrument.installCounters();
});

describe("the counting instrument", () => {
  it("counts creations and the bytes of buffers and textures, and live bytes after destroy", () => {
    const device = new FakeDevice();
    const before = instrument.snapshotCounters();
    const buffer = device.createBuffer({ size: 1024 });
    device.createBuffer({ size: 256 });
    device.createTexture({ size: [4, 4], format: "rgba8unorm-srgb" });
    device.createTexture({ size: { width: 2, height: 2, depthOrArrayLayers: 3 }, format: "depth24plus", sampleCount: 1 });
    const mid = instrument.diffCounters(instrument.snapshotCounters(), before);
    expect(mid.buffersCreated).toBe(2);
    expect(mid.bufferBytesCreated).toBe(1280);
    expect(mid.texturesCreated).toBe(2);
    expect(mid.textureBytesCreated).toBe(4 * 4 * 4 + 2 * 2 * 3 * 4);
    expect(mid.liveBufferBytes).toBe(1280);
    buffer.destroy();
    buffer.destroy(); // a second destroy changes nothing
    const after = instrument.diffCounters(instrument.snapshotCounters(), before);
    expect(after.buffersDestroyed).toBe(1);
    expect(after.liveBufferBytes).toBe(256);
  });

  it("counts writeBuffer bytes with the typed-array element semantics of dataOffset and size", () => {
    const queue = new FakeQueue();
    const before = instrument.snapshotCounters();
    const floats = new Float32Array(100);
    queue.writeBuffer(undefined, 0, floats);
    queue.writeBuffer(undefined, 0, floats, 10);
    queue.writeBuffer(undefined, 0, floats, 10, 20);
    queue.writeBuffer(undefined, 0, new ArrayBuffer(64));
    queue.writeBuffer(undefined, 0, new ArrayBuffer(64), 16, 8);
    const diff = instrument.diffCounters(instrument.snapshotCounters(), before);
    expect(diff.writeBufferCalls).toBe(5);
    // 400 bytes; (100 - 10) floats = 360; 20 floats = 80; 64 bytes; 8 bytes.
    expect(diff.writeBufferBytes).toBe(400 + 360 + 80 + 64 + 8);
  });

  it("counts every RG16Float mip and array layer used by native BRDF lookup textures", () => {
    const device = new FakeDevice(), before = instrument.snapshotCounters();
    const texture = device.createTexture({ size: [8, 4, 6], format: "rg16float", mipLevelCount: 4 });
    // Two 16-bit channels, six fixed array layers, and four 2D mip levels.
    const expected = (8 * 4 + 4 * 2 + 2 * 1 + 1 * 1) * 4 * 6;
    const allocated = instrument.diffCounters(instrument.snapshotCounters(), before);
    expect(allocated.textureBytesCreated).toBe(expected);
    expect(allocated.liveTextureBytes).toBe(expected);
    expect(instrument.unknownTextureFormats()).not.toContain("rg16float");
    texture.destroy();
    expect(instrument.diffCounters(instrument.snapshotCounters(), before).liveTextureBytes).toBe(0);
  });

  it("shrinks volume depth across mips and includes multisample storage", () => {
    const device = new FakeDevice(), before = instrument.snapshotCounters();
    const volume = device.createTexture({ size: [8, 4, 4], format: "r8unorm", dimension: "3d", mipLevelCount: 4 });
    const msaa = device.createTexture({ size: [8, 4], format: "rgba8unorm", sampleCount: 4 });
    expect(instrument.diffCounters(instrument.snapshotCounters(), before).textureBytesCreated)
      .toBe(8 * 4 * 4 + 4 * 2 * 2 + 2 * 1 * 1 + 1 + 8 * 4 * 4 * 4);
    volume.destroy();
    msaa.destroy();
    expect(instrument.diffCounters(instrument.snapshotCounters(), before).liveTextureBytes).toBe(0);
  });

  it("counts texture uploads and external image copies", () => {
    const queue = new FakeQueue();
    const before = instrument.snapshotCounters();
    queue.writeTexture({}, new Uint8Array(1), { bytesPerRow: 256 }, [64, 8] as never);
    queue.copyExternalImageToTexture({}, {}, [512, 512] as never);
    const diff = instrument.diffCounters(instrument.snapshotCounters(), before);
    expect(diff.writeTextureBytes).toBe(256 * 8);
    expect(diff.externalImageBytes).toBe(512 * 512 * 4);
  });

  it("counts every kind of draw call and the instances an instanced draw covers", () => {
    const pass = new FakeRenderPass();
    const before = instrument.snapshotCounters();
    pass.draw(3);
    pass.draw(3, 1);
    pass.drawIndexed(36, 2000);
    pass.drawIndexed(36);
    pass.drawIndirect();
    pass.drawIndexedIndirect();
    const diff = instrument.diffCounters(instrument.snapshotCounters(), before);
    expect(diff.drawCalls).toBe(6);
    expect(diff.instancedDrawCalls).toBe(1);
    expect(diff.instancesDrawn).toBe(1 + 1 + 2000 + 1 + 1 + 1);
  });

  it("counts pipelines of both kinds, also created asynchronously, and the rest of the objects", async () => {
    const device = new FakeDevice();
    const before = instrument.snapshotCounters();
    device.createRenderPipeline();
    await device.createRenderPipelineAsync();
    device.createComputePipeline();
    device.createShaderModule();
    device.createBindGroup();
    device.createBindGroup();
    device.createSampler();
    device.createCommandEncoder();
    const diff = instrument.diffCounters(instrument.snapshotCounters(), before);
    expect(diff.renderPipelinesCreated).toBe(2);
    expect(diff.computePipelinesCreated).toBe(1);
    expect(diff.shaderModulesCreated).toBe(1);
    expect(diff.bindGroupsCreated).toBe(2);
    expect(diff.samplersCreated).toBe(1);
    expect(diff.commandEncodersCreated).toBe(1);
  });

  it("captures the device an adapter gives out and adds timestamp-query to the request when asked", async () => {
    const adapter = new FakeAdapter();
    const device = await adapter.requestDevice({ requiredFeatures: ["shader-f16"] });
    expect(instrument.currentDevice()?.device).toBe(device);
    expect((adapter.lastDescriptor as GPUDeviceDescriptor).requiredFeatures).toEqual(["shader-f16", "timestamp-query"]);
  });

  it("does not add timestamp-query when the adapter lacks it", async () => {
    const adapter = new FakeAdapter();
    adapter.features.delete("timestamp-query");
    await adapter.requestDevice({});
    expect((adapter.lastDescriptor as GPUDeviceDescriptor).requiredFeatures).toBeUndefined();
  });
});

describe("the GPU timer", () => {
  it("brackets the passes of one encoder, resolves them before finish and skips a second encoder", () => {
    const device = new FakeDevice();
    const timer = instrument.installGpuTimer(device as unknown as GPUDevice);
    const first = new FakeEncoder();
    first.beginRenderPass({ colorAttachments: [] });
    first.beginRenderPass({ colorAttachments: [] });
    first.finish();
    const timed = first.passes as Array<{ timestampWrites?: { beginningOfPassWriteIndex: number; endOfPassWriteIndex: number } }>;
    expect(timed[0]?.timestampWrites).toMatchObject({ beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 });
    expect(timed[1]?.timestampWrites).toMatchObject({ beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 });
    expect(first.commands).toEqual(["resolve", "copy", "finish"]);
    const second = new FakeEncoder();
    second.beginRenderPass({ colorAttachments: [] });
    second.finish();
    expect(timer.encodersSkipped).toBe(0);
    // While one encoder is open, another encoder's pass is not timed.
    const open = new FakeEncoder();
    open.beginRenderPass({ colorAttachments: [] });
    const other = new FakeEncoder();
    other.beginRenderPass({ colorAttachments: [] });
    expect((other.passes[0] as { timestampWrites?: unknown }).timestampWrites).toBeUndefined();
    expect(timer.encodersSkipped).toBe(1);
    open.finish();
  });

  it("leaves a pass that already has timestampWrites alone", () => {
    const encoder = new FakeEncoder();
    const own = { querySet: {}, beginningOfPassWriteIndex: 0 };
    encoder.beginRenderPass({ colorAttachments: [], timestampWrites: own });
    expect((encoder.passes[0] as { timestampWrites: unknown }).timestampWrites).toBe(own);
  });
});
