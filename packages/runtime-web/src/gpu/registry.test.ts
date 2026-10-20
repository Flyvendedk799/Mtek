import { describe, expect, it, vi } from "vitest";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { FakeDevice, FakeImageBitmap, asGpu, type FakeTexture } from "../test-support/fake-gpu.js";
import { ResourceRegistry, type RegistryDevice } from "./registry.js";

const UNIFORM_COPY_DST = 0x40 | 0x08;

function setup(): { fake: FakeDevice; registry: ResourceRegistry; failures: MtekDiagnostic[] } {
  const fake = new FakeDevice();
  const failures: MtekDiagnostic[] = [];
  const registry = new ResourceRegistry(asGpu<RegistryDevice>(fake), {
    onAllocationFailure: (d) => failures.push(d),
  });
  return { fake, registry, failures };
}

function buffer(registry: ResourceRegistry, size = 64, label = "b"): GPUBuffer {
  return registry.createBuffer({ size, usage: UNIFORM_COPY_DST, label });
}

describe("counter names (spec/runtime-abi.md section 10.1)", () => {
  it("exposes exactly the registry counters under their specified names, all zero at start", () => {
    const { registry } = setup();
    expect(registry.snapshot()).toEqual({
      buffersAllocated: 0,
      texturesAllocated: 0,
      pipelinesCreated: 0,
      shaderModulesCreated: 0,
      bindGroupsCreated: 0,
      uploads: 0,
      uploadBytes: 0,
      liveBuffers: 0,
      liveTextures: 0,
      liveSamplers: 0,
      liveShaderModules: 0,
      livePipelines: 0,
      liveBindGroups: 0,
      liveListeners: 0,
    });
  });
});

describe("creation wrappers", () => {
  it.each(["dispose", "recycle"] as const)("does not register a late pipeline after %s retires its generation", async (ending) => {
    const { registry, fake } = setup();
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const original = fake.createRenderPipelineAsync.bind(fake);
    vi.spyOn(fake, "createRenderPipelineAsync").mockImplementation(async (descriptor) => {
      const pipeline = await original(descriptor);
      await gate;
      return pipeline;
    });
    const pending = registry.createRenderPipelineAsync({} as GPURenderPipelineDescriptor);
    if (ending === "dispose") registry.destroyAll();
    else registry.recycle(asGpu<RegistryDevice>(new FakeDevice()));
    buffer(registry);
    registry.createRenderPipeline({} as GPURenderPipelineDescriptor);
    const before = registry.snapshot();
    finish();
    await expect(pending).rejects.toThrow(/retired/);
    expect(registry.snapshot()).toEqual(before);
    registry.destroyAll();
  });

  it("count cumulative and live objects per kind and pass descriptors through", () => {
    const { registry, fake } = setup();
    const b = buffer(registry, 128, "uniforms");
    expect(registry.createTexture({ size: [4, 4], format: "rgba8unorm", usage: 0x04 })).toBeDefined();
    registry.createSampler({});
    registry.createShaderModule({ code: "// wgsl" });
    registry.createRenderPipeline({} as GPURenderPipelineDescriptor);
    const layout = registry.createBindGroupLayout({ entries: [] });
    registry.createPipelineLayout({ bindGroupLayouts: [layout] });
    registry.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: b, offset: 0, size: 64 } }] });

    expect(fake.buffers).toHaveLength(1);
    expect((b as unknown as { label: string }).label).toBe("uniforms");
    expect(registry.snapshot()).toMatchObject({
      buffersAllocated: 1,
      texturesAllocated: 1,
      pipelinesCreated: 1,
      shaderModulesCreated: 1,
      bindGroupsCreated: 1,
      liveBuffers: 1,
      liveTextures: 1,
      liveSamplers: 1,
      liveShaderModules: 1,
      livePipelines: 1,
      liveBindGroups: 1,
    });
  });

  it("counts the async pipeline variant when it resolves", async () => {
    const { registry } = setup();
    const p = registry.createRenderPipelineAsync({} as GPURenderPipelineDescriptor);
    await p;
    expect(registry.snapshot().pipelinesCreated).toBe(1);
    expect(registry.snapshot().livePipelines).toBe(1);
  });

  it("does not count a rejected async pipeline", async () => {
    const fake = new FakeDevice();
    fake.createRenderPipelineAsync = () => Promise.reject(new Error("bad pipeline"));
    const registry = new ResourceRegistry(asGpu<RegistryDevice>(fake));
    await expect(registry.createRenderPipelineAsync({} as GPURenderPipelineDescriptor)).rejects.toThrow("bad pipeline");
    expect(registry.snapshot().pipelinesCreated).toBe(0);
    expect(registry.snapshot().livePipelines).toBe(0);
  });
});

describe("release", () => {
  it("destroys buffers and textures and decrements live counts, keeping cumulative counts", () => {
    const { registry, fake } = setup();
    const b = buffer(registry);
    registry.release(b);
    expect(fake.buffers[0]?.destroyed).toBe(true);
    expect(registry.snapshot().liveBuffers).toBe(0);
    expect(registry.snapshot().buffersAllocated).toBe(1);
  });

  it("drops every other kind from the live counts", () => {
    const { registry } = setup();
    const s = registry.createSampler();
    const m = registry.createShaderModule({ code: "" });
    const p = registry.createRenderPipeline({} as GPURenderPipelineDescriptor);
    const g = registry.createBindGroup({ layout: registry.createBindGroupLayout({ entries: [] }), entries: [] });
    for (const r of [s, m, p, g]) registry.release(r);
    expect(registry.snapshot()).toMatchObject({
      liveSamplers: 0,
      liveShaderModules: 0,
      livePipelines: 0,
      liveBindGroups: 0,
      shaderModulesCreated: 1,
      pipelinesCreated: 1,
      bindGroupsCreated: 1,
    });
  });

  it("refuses to release an unknown or already released resource", () => {
    const { registry } = setup();
    const b = buffer(registry);
    registry.release(b);
    expect(() => registry.release(b)).toThrow(/not registered|already released/);
    expect(() => registry.release(asGpu<GPUBuffer>({}))).toThrow(/not registered|already released/);
    expect(registry.snapshot().liveBuffers).toBe(0);
  });
});

describe("destroyAll", () => {
  it("destroys everything, removes listeners and leaves zero live objects", () => {
    const { registry, fake } = setup();
    buffer(registry, 64, "one");
    buffer(registry, 64, "two");
    registry.createTexture({ size: [1, 1], format: "rgba8unorm", usage: 0x04 });
    registry.createSampler();
    registry.createShaderModule({ code: "" });
    registry.createRenderPipeline({} as GPURenderPipelineDescriptor);
    registry.createBindGroup({ layout: registry.createBindGroupLayout({ entries: [] }), entries: [] });
    const target = new EventTarget();
    const handler = vi.fn();
    registry.addEventListener(target, "ping", handler);

    registry.destroyAll();

    expect(fake.buffers.every((b) => b.destroyed)).toBe(true);
    const c = registry.snapshot();
    expect(c.liveBuffers + c.liveTextures + c.liveSamplers + c.liveShaderModules + c.livePipelines + c.liveBindGroups + c.liveListeners).toBe(0);
    expect(c.buffersAllocated).toBe(2);
    target.dispatchEvent(new Event("ping"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("is idempotent", () => {
    const { registry } = setup();
    buffer(registry);
    registry.destroyAll();
    expect(() => registry.destroyAll()).not.toThrow();
  });
});

describe("event listeners", () => {
  it("are counted, delivered, and removable exactly once", () => {
    const { registry } = setup();
    const target = new EventTarget();
    const handler = vi.fn();
    const remove = registry.addEventListener(target, "ping", handler);
    expect(registry.snapshot().liveListeners).toBe(1);
    target.dispatchEvent(new Event("ping"));
    expect(handler).toHaveBeenCalledTimes(1);
    remove();
    remove();
    expect(registry.snapshot().liveListeners).toBe(0);
    target.dispatchEvent(new Event("ping"));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("out-of-memory error scopes", () => {
  it("wraps buffer creation in a balanced out-of-memory scope", () => {
    const { registry, fake } = setup();
    buffer(registry);
    expect(fake.events).toEqual(["pushErrorScope:out-of-memory", "popErrorScope"]);
    expect(fake.openErrorScopes).toBe(0);
  });

  it("wraps texture creation as well", () => {
    const { registry, fake } = setup();
    registry.createTexture({ size: [1, 1], format: "rgba8unorm", usage: 0x04 });
    expect(fake.events).toEqual(["pushErrorScope:out-of-memory", "popErrorScope"]);
  });

  it("reports E8063 through the callback when a buffer allocation fails", async () => {
    const { registry, fake, failures } = setup();
    fake.failNextAllocations(1);
    buffer(registry, 4096, "arena:big");
    expect(failures).toHaveLength(0); // popErrorScope is asynchronous
    await Promise.resolve();
    await Promise.resolve();
    expect(failures).toHaveLength(1);
    const d = failures[0];
    expect(d?.code).toBe("MTEK-E8063");
    expect(d?.title).toBe("GPU allocation failed");
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain("arena:big");
    expect(d?.message).toContain("4096");
    expect(fake.uncapturedErrors).toEqual([]);
  });

  it("reports E8063 when a texture allocation fails", async () => {
    const { registry, fake, failures } = setup();
    fake.failNextAllocations(1);
    registry.createTexture({ size: [8192, 8192], format: "rgba8unorm", usage: 0x04, label: "big-tex" });
    await Promise.resolve();
    await Promise.resolve();
    expect(failures.map((f) => f.code)).toEqual(["MTEK-E8063"]);
    expect(failures[0]?.message).toContain("big-tex");
  });

  it("does not report anything when allocation succeeds", async () => {
    const { registry, failures } = setup();
    buffer(registry);
    await Promise.resolve();
    await Promise.resolve();
    expect(failures).toEqual([]);
  });

  it("uses the registry's current phase in the diagnostic", async () => {
    const { registry, fake, failures } = setup();
    registry.phase = "runtime:render";
    fake.failNextAllocations(1);
    buffer(registry);
    await Promise.resolve();
    await Promise.resolve();
    expect(failures[0]?.phase).toBe("runtime:render");
  });

  it("pops the scope and rethrows, without an E8063 report, when createBuffer throws for a bad descriptor", async () => {
    const { registry, fake, failures } = setup();
    expect(() => registry.createBuffer({ size: 0, usage: UNIFORM_COPY_DST })).toThrow();
    expect(fake.openErrorScopes).toBe(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(failures).toEqual([]);
    expect(registry.snapshot().buffersAllocated).toBe(0);
  });

  it("reports E8063 and rethrows when createBuffer throws a RangeError (allocation failure)", async () => {
    const { registry, fake, failures } = setup();
    fake.createBuffer = () => {
      throw new RangeError("Failed to allocate");
    };
    expect(() => registry.createBuffer({ size: 64, usage: UNIFORM_COPY_DST, label: "mapped" })).toThrow(RangeError);
    expect(fake.openErrorScopes).toBe(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(failures.map((f) => f.code)).toEqual(["MTEK-E8063"]);
    expect(registry.snapshot().buffersAllocated).toBe(0);
  });

  it("reportAllocationFailure builds an E8063 diagnostic on demand", () => {
    const { registry, failures } = setup();
    registry.reportAllocationFailure("The uniform arena 'Pulse' cannot grow to 2 GiB.");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.code).toBe("MTEK-E8063");
  });
});

describe("recycle (device recovery)", () => {
  it("destroys and forgets every GPU object, keeps listeners and cumulative counters, and creates on the new device", () => {
    const { registry, fake } = setup();
    const b = buffer(registry, 64, "old");
    registry.createTexture({ size: [4, 4], format: "rgba8unorm", usage: 0x04 });
    registry.createSampler({});
    registry.createShaderModule({ code: "// wgsl" });
    registry.addEventListener(new EventTarget(), "change", () => undefined);

    const next = new FakeDevice();
    registry.recycle(asGpu<RegistryDevice>(next));
    expect((b as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect(fake.textures[0]?.destroyed).toBe(true);
    expect(registry.snapshot()).toMatchObject({
      buffersAllocated: 1,
      texturesAllocated: 1,
      shaderModulesCreated: 1,
      liveBuffers: 0,
      liveTextures: 0,
      liveSamplers: 0,
      liveShaderModules: 0,
      liveListeners: 1,
    });
    // An old object cannot be released twice through the registry; the new device receives new objects.
    expect(() => {
      registry.release(b);
    }).toThrow(/not registered/);
    buffer(registry, 32, "new");
    expect(next.buffers).toHaveLength(1);
    expect(fake.buffers).toHaveLength(1);
    expect(registry.snapshot()).toMatchObject({ buffersAllocated: 2, liveBuffers: 1 });
  });
});

describe("writeBuffer", () => {
  it("writes through the queue and counts uploads and uploadBytes", () => {
    const { registry, fake } = setup();
    const b = buffer(registry, 256);
    const queue = asGpu<GPUQueue>(fake.queue);
    const data = new ArrayBuffer(64);
    new Uint8Array(data).fill(7);
    registry.writeBuffer(queue, b, 16, data, 8, 32);
    expect(fake.queue.writes).toEqual([{ buffer: fake.buffers[0], bufferOffset: 16, size: 32 }]);
    expect(fake.buffers[0]?.contents.subarray(16, 48).every((v) => v === 7)).toBe(true);
    expect(registry.snapshot().uploads).toBe(1);
    expect(registry.snapshot().uploadBytes).toBe(32);
  });

  it("rejects offsets and sizes that are not multiples of 4 before touching the queue", () => {
    const { registry, fake } = setup();
    const b = buffer(registry, 256);
    const queue = asGpu<GPUQueue>(fake.queue);
    const data = new ArrayBuffer(64);
    expect(() => registry.writeBuffer(queue, b, 2, data, 0, 8)).toThrow(RangeError);
    expect(() => registry.writeBuffer(queue, b, 0, data, 0, 6)).toThrow(RangeError);
    expect(fake.queue.writes).toHaveLength(0);
    expect(registry.snapshot().uploads).toBe(0);
  });
});

describe("copyExternalImage", () => {
  const TEXTURE_USAGE = 0x04 | 0x02 | 0x10; // TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT

  it("copies a decoded image into the texture as it is stored and counts one upload of width x height x 4 bytes", () => {
    const { registry, fake } = setup();
    const texture = registry.createTexture({ size: [2, 1], format: "rgba8unorm-srgb", usage: TEXTURE_USAGE });
    const bitmap = new FakeImageBitmap(2, 1, Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 128]));
    registry.copyExternalImage(asGpu<GPUQueue>(fake.queue), asGpu<ImageBitmap>(bitmap), texture);
    expect([...(texture as unknown as FakeTexture).pixels]).toEqual([10, 20, 30, 255, 40, 50, 60, 128]);
    // No flip and no premultiplication are asked for; the destination colour space is sRGB.
    expect(fake.queue.externalCopies.map((copy) => [copy.width, copy.height, copy.colorSpace])).toEqual([[2, 1, "srgb"]]);
    expect(registry.snapshot()).toMatchObject({ uploads: 1, uploadBytes: 8 });
  });

  it("is refused by the destination rules of WebGPU: a texture without RENDER_ATTACHMENT cannot receive an image", () => {
    const { registry, fake } = setup();
    const texture = registry.createTexture({ size: [1, 1], format: "rgba8unorm", usage: 0x04 | 0x02 });
    const bitmap = new FakeImageBitmap(1, 1, Uint8Array.from([1, 2, 3, 4]));
    expect(() => registry.copyExternalImage(asGpu<GPUQueue>(fake.queue), asGpu<ImageBitmap>(bitmap), texture)).toThrow(/RENDER_ATTACHMENT/);
    expect(registry.snapshot().uploads).toBe(0);
  });
});
