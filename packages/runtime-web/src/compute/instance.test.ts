import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { MtekLayoutArrayNode, MtekLayoutRecord } from "../abi/manifest-types.js";
import { ResourceRegistry, type RegistryDevice } from "../gpu/registry.js";
import { asGpu, type FakeBuffer } from "../test-support/fake-gpu.js";
import { FakeComputeDevice } from "../test-support/fake-compute.js";
import { checkedDefinition, checkedDomain, type ComputeDefinition } from "./definition.js";
import { ComputeInstance, type ComputeDevice } from "./instance.js";

const scalar = { kind: "scalar", offset: 0, size: 4, align: 4, scalar: "f32" } as const;
const storage: MtekLayoutArrayNode = { kind: "array", offset: 0, size: 32, align: 4, length: 8, stride: 4, padded: false, element: scalar };
const dispatch: MtekLayoutRecord = {
  id: "compute:dispatch", wgslStruct: "MtekComputeDispatch", size: 12, align: 4,
  root: { kind: "struct", offset: 0, size: 12, align: 4, members: ["x", "y", "z"].map((name, i) => ({ name, mtekType: "u32", node: { ...scalar, offset: i * 4, scalar: "u32" } })) },
};
const uniforms: MtekLayoutRecord = { id: "compute:test:params", wgslStruct: "Params", size: 4, align: 4, root: { kind: "struct", offset: 0, size: 4, align: 4, members: [{ name: "gain", mtekType: "f32", node: scalar }] } };
function definition(): ComputeDefinition { return { id: "test::Scale", entryPoint: "mtek_cs", workgroupSize: [4, 1, 1], dispatch, uniforms, inputs: [{ name: "source", layout: storage }], output: { name: "result", layout: storage } }; }
const floats = (buffer: FakeBuffer): Float32Array => new Float32Array(buffer.contents.buffer);
function setup(limits: Record<string, number> = {}) {
  const fake = new FakeComputeDevice(limits);
  const device = asGpu<ComputeDevice>(fake);
  const registry = new ResourceRegistry(asGpu<RegistryDevice>(fake));
  const module = asGpu<GPUShaderModule>(fake.createShaderModule({}));
  // A CPU callback on fake bindings, not a WGSL interpreter or GPU reference.
  fake.kernel = (buffers) => {
    const domain = new Uint32Array(buffers.get(0)!.contents.buffer);
    const input = floats(buffers.get(2)!);
    const output = floats(buffers.get(3)!);
    const gain = floats(buffers.get(1)!)[0]!;
    for (let i = 0; i < domain[0]! * domain[1]! * domain[2]!; i++) output[i] = input[i]! * gain;
  };
  return { fake, device, registry, module };
}
const input = (): Float32Array => Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
async function created() {
  const host = setup();
  const instance = await ComputeInstance.create(host.device, host.registry, definition(), host.module, Float32Array.of(2));
  instance.upload("source", input());
  return { ...host, instance };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const zeros = (registry: ResourceRegistry): void => {
  expect(registry.snapshot()).toMatchObject({ liveBuffers: 0, livePipelines: 0, liveBindGroups: 0, liveListeners: 0 });
};

describe("compute resources (CPU fake; no WGSL execution)", () => {
  it("consumes the compiler's shared scalar/struct/array/bool layouts without a second layout calculation", async () => {
    const host = setup(); host.fake.kernel = () => undefined;
    const contract = JSON.parse(readFileSync(new URL("../../../../tests/codegen/compute-contract/expected.definition.json", import.meta.url), "utf8")) as ComputeDefinition;
    const instance = await ComputeInstance.create(host.device, host.registry, contract, host.module, new Uint8Array(contract.uniforms!.size));
    for (const input of contract.inputs) instance.upload(input.name, new Uint8Array(input.layout.size));
    await instance.dispatch([17]);
    const buffers = host.fake.dispatches[0]!.buffers;
    expect(buffers.get(0)!.size).toBe(contract.dispatch.size);
    expect(buffers.get(1)!.size).toBe(contract.uniforms!.size);
    contract.inputs.forEach((input, i) => expect(buffers.get(i + 2)!.size).toBe(input.layout.size));
    expect(buffers.get(6)!.size).toBe(contract.output.layout.size);
    expect((await instance.readback()).byteLength).toBe(contract.output.layout.size);
    instance.dispose(); zeros(host.registry);
  });
  it("copies uploads/subviews, clears tails, orders dispatch/readback and releases every owned resource", async () => {
    const { instance, registry, fake } = await created();
    const backing = new Float32Array(10); backing.set(input(), 1);
    instance.upload("source", backing.subarray(1, 9)); backing.fill(99);
    await instance.dispatch([8]);
    expect([...new Float32Array(await instance.readback())]).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    await instance.dispatch([3]);
    expect([...new Float32Array(await instance.readback())]).toEqual([2, 4, 6, 0, 0, 0, 0, 0]);
    expect(fake.dispatches.map((call) => call.groups)).toEqual([[2, 1, 1], [1, 1, 1]]);
    expect(fake.events.filter((event) => ["clearBuffer", "dispatch", "copyBufferToBuffer"].includes(event))).toEqual(["clearBuffer", "dispatch", "copyBufferToBuffer", "clearBuffer", "dispatch", "copyBufferToBuffer"]);
    expect(instance.renderBuffer().usage & 0x20).toBe(0x20);
    instance.dispose(); instance.dispose(); zeros(registry);
    expect(fake.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(fake.openErrorScopes).toBe(0);
  });

  it("keeps staged uploads/uniform edits out of the completed recovery snapshot", async () => {
    const { instance, fake, registry } = await created();
    const completion = deferred<void>();
    vi.spyOn(fake.queue, "onSubmittedWorkDone").mockReturnValueOnce(completion.promise);
    const work = instance.dispatch([5]);
    instance.upload("source", Float32Array.from(input(), (n) => n + 10));
    instance.setUniforms(Float32Array.of(7));
    completion.resolve(); await work;
    const before = await instance.readback();
    fake.loseDevice("unknown", "test"); await Promise.resolve();
    expect(instance.state).toBe("lost"); zeros(registry);
    const recovered = setup();
    await instance.recover(recovered.device, recovered.registry, recovered.module);
    expect(await instance.readback()).toEqual(before);
    await instance.dispatch([2]);
    expect([...new Float32Array(await instance.readback())]).toEqual([77, 84, 0, 0, 0, 0, 0, 0]);
    instance.dispose(); zeros(recovered.registry);
  });

  it("recovers the previous completed dispatch when a later submission is interrupted", async () => {
    const { instance, fake } = await created();
    await instance.dispatch([2]);
    const previous = await instance.readback();
    const completion = deferred<void>();
    vi.spyOn(fake.queue, "onSubmittedWorkDone").mockReturnValueOnce(completion.promise);
    instance.upload("source", new Float32Array(8).fill(99));
    const pending = instance.dispatch([7]);
    const rejected = expect(pending).rejects.toThrow("lost");
    instance.deviceLost(); await rejected;
    const next = setup(); await instance.recover(next.device, next.registry, next.module);
    expect(await instance.readback()).toEqual(previous);
    completion.resolve(); await Promise.resolve();
    expect(instance.inspect().completedDomain).toEqual([2, 1, 1]);
    instance.dispose(); zeros(next.registry);
  });

  it.each(["dispose", "loss"] as const)("settles a readback whose GPU mapping never settles after %s", async (ending) => {
    const { instance, fake, registry } = await created();
    const original = fake.createBuffer.bind(fake);
    vi.spyOn(fake, "createBuffer").mockImplementation((descriptor) => {
      const buffer = original(descriptor);
      if ((descriptor.usage & 1) !== 0) vi.spyOn(buffer, "mapAsync").mockReturnValue(new Promise(() => undefined));
      return buffer;
    });
    const reading = instance.readback();
    const rejected = expect(reading).rejects.toThrow(ending === "dispose" ? "disposed" : "lost");
    if (ending === "dispose") instance.dispose(); else instance.deviceLost();
    await rejected; zeros(registry);
    instance.dispose();
  });

  it("limits concurrent work and provides independent readback copies", async () => {
    const { instance, fake, registry } = await created();
    const completion = deferred<void>();
    vi.spyOn(fake.queue, "onSubmittedWorkDone").mockReturnValueOnce(completion.promise);
    const pending = instance.dispatch([8]);
    await expect(instance.dispatch([8])).rejects.toThrow("previous dispatch");
    const reads = Array.from({ length: 4 }, () => instance.readback());
    await expect(instance.readback()).rejects.toThrow("four readbacks");
    completion.resolve(); await pending;
    const copies = await Promise.all(reads);
    new Float32Array(copies[0]!).fill(123);
    expect(new Float32Array(copies[1]!)[0]).toBe(2);
    instance.dispose(); zeros(registry);
  });

  it("does not expose mutable definitions, domains, or completed snapshot state", async () => {
    const { fake, device, registry, module } = setup();
    const source = structuredClone(definition());
    const instance = await ComputeInstance.create(device, registry, source, module, Float32Array.of(2));
    Object.assign(source.inputs[0]!.layout.element, { offset: 4 });
    const copy = instance.inspect();
    Object.assign(copy.definition.output.layout, { length: 99 });
    const domain: [number] = [2];
    const pending = instance.dispatch(domain); domain[0] = 7; await pending;
    expect(instance.inspect().definition.output.layout.length).toBe(8);
    expect(instance.inspect().completedDomain).toEqual([2, 1, 1]);
    expect(fake.dispatches[0]!.groups).toEqual([1, 1, 1]);
    instance.dispose(); zeros(registry);
  });

  it("rolls back partial allocation, invalid pipelines and dispatch validation failures", async () => {
    const host = setup();
    const pipeline = vi.spyOn(host.fake, "createComputePipeline").mockImplementation(() => { throw new Error("pipeline failed"); });
    await expect(ComputeInstance.create(host.device, host.registry, definition(), host.module, Float32Array.of(2))).rejects.toThrow("pipeline failed");
    zeros(host.registry); expect(host.fake.openErrorScopes).toBe(0); pipeline.mockRestore();
    const instance = await ComputeInstance.create(host.device, host.registry, definition(), host.module, Float32Array.of(2));
    host.fake.rejectDispatch = true;
    await expect(instance.dispatch([2])).rejects.toThrow("dispatch validation");
    expect(instance.state).toBe("failed"); zeros(host.registry);
    expect(() => instance.renderBuffer()).toThrow("failed"); instance.dispose();
  });

  it("does not expose readback data before an in-flight dispatch passes validation", async () => {
    const { instance, fake, registry } = await created();
    const gate = deferred<void>();
    vi.spyOn(fake.queue, "onSubmittedWorkDone").mockReturnValueOnce(gate.promise);
    fake.rejectDispatch = true;
    const dispatch = instance.dispatch([2]);
    const dispatched = expect(dispatch).rejects.toThrow("dispatch validation");
    const readback = instance.readback();
    const read = expect(readback).rejects.toThrow();
    gate.resolve(); await dispatched; await read;
    zeros(registry); instance.dispose();
  });

  it("rolls back asynchronously rejected creation and supports a kernel without inputs or uniforms", async () => {
    const host = setup();
    const original = host.fake.createComputePipeline.bind(host.fake);
    const mocked = vi.spyOn(host.fake, "createComputePipeline").mockImplementation((descriptor) => {
      host.fake.validation("invalid compute pipeline"); return original(descriptor);
    });
    await expect(ComputeInstance.create(host.device, host.registry, definition(), host.module, Float32Array.of(2))).rejects.toThrow("allocation validation");
    zeros(host.registry); mocked.mockRestore();
    host.fake.kernel = () => undefined;
    const instance = await ComputeInstance.create(host.device, host.registry, {
      id: "no-inputs", entryPoint: "mtek_cs", workgroupSize: [4, 1, 1], dispatch, inputs: [], output: { name: "result", layout: storage },
    }, host.module);
    instance.setUniforms(new Uint8Array(0));
    expect(() => instance.setUniforms(new Uint8Array(4))).toThrow();
    await instance.dispatch([2]);
    expect([...new Float32Array(await instance.readback())]).toEqual(new Array(8).fill(0));
    expect([...host.fake.dispatches[0]!.buffers.keys()]).toEqual([0, 2]);
    instance.dispose(); zeros(host.registry);
  });

  it("handles repeated recovery losses and retries without accumulating resources", async () => {
    const { instance } = await created();
    await instance.dispatch([4]); instance.deviceLost();
    const next = setup();
    const completion = deferred<void>();
    vi.spyOn(next.fake.queue, "onSubmittedWorkDone").mockReturnValueOnce(completion.promise);
    const rebuilding = instance.recover(next.device, next.registry, next.module);
    const rejected = expect(rebuilding).rejects.toThrow("lost");
    // Wait until recovery submits, without a timer or GPU work.
    for (let i = 0; i < 20 && next.fake.dispatches.length === 0; i++) await Promise.resolve();
    expect(next.fake.dispatches).toHaveLength(1);
    instance.deviceLost(); await rejected; zeros(next.registry);
    const last = setup(); await instance.recover(last.device, last.registry, last.module);
    expect([...new Float32Array(await instance.readback())]).toEqual([2, 4, 6, 8, 0, 0, 0, 0]);
    completion.resolve(); instance.dispose(); zeros(last.registry);
  });

  it("releases allocation ownership immediately during recovery validation and tolerates registry retirement", async () => {
    const { instance } = await created(); instance.deviceLost();
    const next = setup();
    const gate = deferred<{ message: string } | null>();
    const original = next.fake.popErrorScope.bind(next.fake);
    vi.spyOn(next.fake, "popErrorScope").mockImplementation(() => {
      const popped = original();
      return next.fake.openErrorScopes === 0 ? gate.promise : popped;
    });
    const recovering = instance.recover(next.device, next.registry, next.module);
    const rejected = expect(recovering).rejects.toThrow("disposed");
    expect(next.registry.snapshot().liveBuffers).toBeGreaterThan(0);
    instance.dispose(); zeros(next.registry); await rejected;
    gate.resolve(null); await Promise.resolve(); zeros(next.registry);
    const last = await created();
    last.registry.destroyAll(); last.instance.deviceLost(); last.instance.dispose(); zeros(last.registry);
  });

  it("does not resurrect a creation cancelled around asynchronous validation completion", async () => {
    for (let delay = 0; delay < 14; delay++) {
      const host = setup();
      const signal = new AbortController();
      const held = deferred<{ message: string } | null>();
      const pop = host.fake.popErrorScope.bind(host.fake);
      vi.spyOn(host.fake, "popErrorScope").mockImplementation(() => {
        const result = pop(); return host.fake.openErrorScopes === 0 ? held.promise : result;
      });
      const creating = ComputeInstance.create(host.device, host.registry, definition(), host.module, Float32Array.of(2), signal.signal);
      // Attach rejection handling before testing cancellation at each microtask boundary.
      const settled = creating.then((instance) => ({ instance }), () => ({ instance: undefined }));
      held.resolve(null);
      for (let i = 0; i < delay; i++) await Promise.resolve();
      signal.abort();
      const { instance } = await settled;
      if (instance !== undefined) { expect(instance.renderBuffer()).toBeDefined(); instance.dispose(); }
      zeros(host.registry);
    }
  });

  it("recovers an instance without a completed dispatch from current staged bytes and a zero output", async () => {
    const { instance } = await created();
    instance.setUniforms(Float32Array.of(3)); instance.deviceLost();
    const next = setup(); await instance.recover(next.device, next.registry, next.module);
    expect([...new Float32Array(await instance.readback())]).toEqual(new Array(8).fill(0));
    await instance.dispatch([3]);
    expect([...new Float32Array(await instance.readback())]).toEqual([3, 6, 9, 0, 0, 0, 0, 0]);
    instance.dispose(); zeros(next.registry);
  });

  it("starts with independent zero input/output, and isolates instances", async () => {
    const host = setup();
    const one = await ComputeInstance.create(host.device, host.registry, definition(), host.module, Float32Array.of(2));
    const two = await ComputeInstance.create(host.device, host.registry, definition(), host.module, Float32Array.of(3));
    one.upload("source", input()); await one.dispatch([8]); await two.dispatch([8]);
    expect([...new Float32Array(await two.readback())]).toEqual(new Array(8).fill(0));
    one.dispose(); expect(two.renderBuffer()).toBeDefined(); two.dispose(); zeros(host.registry);
  });
});

describe("compute validation before allocation or submission", () => {
  it.each([[0], [-1], [1.5], [NaN], [Infinity], [9], [0xffff_ffff, 0xffff_ffff], [2, 2, 3], [], [1, 1, 1, 1]])("rejects logical domain %j without GPU work", async (...domain) => {
    const { instance, fake } = await created();
    const before = fake.queue.submits;
    await expect(instance.dispatch(domain as unknown as [number])).rejects.toThrow("compute:");
    expect(fake.queue.submits).toBe(before); instance.dispose();
  });

  it("validates the actual device's workgroup counts, storage, uniform and invocation limits", async () => {
    const host = setup({ maxComputeWorkgroupsPerDimension: 1 });
    const instance = await ComputeInstance.create(host.device, host.registry, definition(), host.module, Float32Array.of(2));
    await expect(instance.dispatch([8])).rejects.toThrow("workgroup count"); instance.dispose();
    for (const [limit, value] of [
      ["maxBufferSize", 16], ["maxStorageBufferBindingSize", 16], ["maxUniformBufferBindingSize", 8],
      ["maxComputeWorkgroupSizeX", 2], ["maxComputeInvocationsPerWorkgroup", 2],
      ["maxStorageBuffersPerShaderStage", 1], ["maxUniformBuffersPerShaderStage", 1], ["maxBindingsPerBindGroup", 3],
    ] as const) {
      const failing = setup({ [limit]: value });
      await expect(ComputeInstance.create(failing.device, failing.registry, definition(), failing.module, Float32Array.of(2))).rejects.toThrow("compute:");
      expect(failing.fake.buffers).toHaveLength(0); zeros(failing.registry);
    }
  });

  it("rejects malformed, cyclic, overlapping and oversized layouts before allocation", () => {
    const { device } = setup();
    for (const patch of [{ stride: 0 }, { size: 33 }, { length: 0 }, { padded: true }, { element: { ...scalar, size: 8 } }]) {
      const bad = structuredClone(definition()); Object.assign(bad.output.layout, patch);
      expect(() => checkedDefinition(bad, device.limits)).toThrow("compute:");
    }
    const cyclic = structuredClone(definition());
    Object.assign(cyclic.output.layout, { element: cyclic.output.layout });
    expect(() => checkedDefinition(cyclic, device.limits)).toThrow();
    const overlapping = structuredClone(definition());
    Object.assign(overlapping.dispatch.root.members[1]!.node, { offset: 0 });
    expect(() => checkedDefinition(overlapping, device.limits)).toThrow("overlapping");
    const unaligned = structuredClone(definition());
    Object.assign(unaligned.uniforms!, { size: 5 });
    Object.assign(unaligned.uniforms!.root, { size: 5 });
    expect(() => checkedDefinition(unaligned, device.limits)).toThrow("alignment");
  });

  it("requires full-size packed uploads and copies only a view's byte range", async () => {
    const { instance, fake } = await created();
    const writes = fake.queue.writes.length;
    expect(() => instance.upload("unknown", input())).toThrow("no input");
    expect(() => instance.upload("source", new Float32Array(7))).toThrow("exactly 32");
    expect(() => instance.setUniforms(new Uint8Array(3))).toThrow("exactly 4");
    expect(fake.queue.writes).toHaveLength(writes);
    const host = setup();
    await expect(ComputeInstance.create(host.device, host.registry, definition(), host.module)).rejects.toThrow("uniform bytes are required");
    expect(host.fake.buffers).toHaveLength(0);
    instance.dispose();
    expect(() => instance.upload("source", input())).toThrow("disposed");
    await expect(instance.recover(host.device, host.registry, host.module)).rejects.toThrow("disposed");
  });

  it("normalizes omitted axes and validates domain product without integer overflow", () => {
    const { device } = setup();
    expect(checkedDomain([3], definition(), device.limits)).toEqual({ domain: [3, 1, 1], groups: [1, 1, 1] });
    expect(checkedDomain([2, 2, 2], definition(), device.limits)).toEqual({ domain: [2, 2, 2], groups: [1, 2, 2] });
    expect(() => checkedDomain([1, null] as unknown as [number], definition(), device.limits)).toThrow();
  });
});
