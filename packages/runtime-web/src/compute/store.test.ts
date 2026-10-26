import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ResourceRegistry, type RegistryDevice } from "../gpu/registry.js";
import { asGpu } from "../test-support/fake-gpu.js";
import { FakeComputeDevice } from "../test-support/fake-compute.js";
import type { ComputeDefinition } from "./definition.js";
import type { ComputeDevice } from "./instance.js";
import { ComputeStore } from "./store.js";

const contract = JSON.parse(readFileSync(new URL("../../../../tests/codegen/compute-contract/expected.definition.json", import.meta.url), "utf8")) as ComputeDefinition;
const params = (): Uint8Array => new Uint8Array(contract.uniforms!.size);
function host() {
  const fake = new FakeComputeDevice();
  const device = asGpu<ComputeDevice>(fake);
  const registry = new ResourceRegistry(asGpu<RegistryDevice>(fake));
  const modules = new Map([[contract.id, asGpu<GPUShaderModule>(fake.createShaderModule({}))]]);
  return { fake, device, registry, modules };
}
function setup() {
  const gpu = host();
  return { ...gpu, store: new ComputeStore(gpu.device, gpu.registry, [contract], gpu.modules) };
}
const empty = (registry: ResourceRegistry): void => { expect(registry.snapshot()).toMatchObject({ liveBuffers: 0, livePipelines: 0, liveBindGroups: 0, liveListeners: 0 }); };
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { resolve, promise }; }
function holdCreation(fake: FakeComputeDevice) {
  const held = gate<{ message: string } | null>();
  const original = fake.popErrorScope.bind(fake);
  vi.spyOn(fake, "popErrorScope").mockImplementation(() => {
    const result = original();
    return fake.openErrorScopes === 0 ? held.promise : result;
  });
  return held;
}

describe("compute program ownership (CPU fake)", () => {
  it("rejects missing shaders/duplicates before allocation and does not retain disposed handles", async () => {
    const { store, registry, device, modules } = setup();
    expect(() => new ComputeStore(device, registry, [contract, contract], modules)).toThrow("duplicate");
    expect(() => new ComputeStore(device, registry, [contract], new Map())).toThrow("unavailable");
    await expect(store.create("missing", params())).rejects.toThrow("no program");
    for (let i = 0; i < 8; i++) {
      const handle = await store.create(contract.id, params());
      handle.dispose(); handle.dispose(); empty(registry);
    }
    expect(store.inspect().instances).toHaveLength(0);
    store.dispose();
  });

  it("rejects foreign/disposed render handles and invalidates old instances on replacement", async () => {
    const one = setup(), two = setup();
    const old = await one.store.create(contract.id, params());
    const foreign = await two.store.create(contract.id, params());
    expect(() => one.store.renderBuffer(foreign)).toThrow("current program");
    const buffer = one.store.renderBuffer(old);
    one.store.replace([contract], one.modules);
    expect(old.state).toBe("disposed");
    expect(() => one.store.renderBuffer(old)).toThrow("current program");
    await expect(old.dispatch([1])).rejects.toThrow("replaced");
    const replacement = await one.store.create(contract.id, params());
    expect(one.store.renderBuffer(replacement)).not.toBe(buffer);
    expect(replacement.inspect().completedDomain).toBeUndefined();
    one.store.dispose(); two.store.dispose(); empty(one.registry); empty(two.registry);
  });

  it("preserves live instances when candidate validation fails", async () => {
    const { store, registry, modules } = setup();
    const handle = await store.create(contract.id, params());
    const buffer = store.renderBuffer(handle);
    const invalid = structuredClone(contract); Object.assign(invalid.output.layout, { size: 0 });
    expect(() => store.replace([invalid], modules)).toThrow();
    expect(store.renderBuffer(handle)).toBe(buffer);
    await handle.dispatch([1]); store.dispose(); empty(registry);
  });

  it.each(["replace", "dispose", "loss"] as const)("cancels creation during %s without late resource resurrection", async (action) => {
    const { store, fake, registry, modules } = setup();
    const held = holdCreation(fake);
    const creating = store.create(contract.id, params());
    const rejected = expect(creating).rejects.toThrow();
    expect(registry.snapshot().liveBuffers).toBeGreaterThan(0);
    if (action === "replace") store.replace([contract], modules);
    else if (action === "loss") store.deviceLost();
    else store.dispose();
    empty(registry); await rejected; held.resolve(null); await Promise.resolve(); empty(registry);
    expect(store.inspect().instances).toHaveLength(0); store.dispose();
  });

  it("recovers existing handles and replaces every GPU buffer", async () => {
    const { store, registry } = setup();
    const handle = await store.create(contract.id, params());
    await handle.dispatch([3]);
    const buffer = store.renderBuffer(handle);
    store.deviceLost(); empty(registry);
    await expect(handle.dispatch([1])).rejects.toThrow("lost");
    expect(() => store.replace([contract], new Map())).toThrow("lost");
    const next = host(); await store.recover(next.device, next.registry, next.modules);
    expect(handle.inspect().completedDomain).toEqual([3, 1, 1]);
    expect(store.renderBuffer(handle)).not.toBe(buffer);
    store.dispose(); empty(next.registry);
    await expect(store.create(contract.id, params())).rejects.toThrow("disposed");
  });

  it("rolls back every recovered instance when a later one fails and permits a fresh attempt", async () => {
    const { store } = setup();
    const first = await store.create(contract.id, params()), second = await store.create(contract.id, params());
    await first.dispatch([2]); await second.dispatch([3]); store.deviceLost();
    const next = host();
    const original = next.fake.createComputePipeline.bind(next.fake);
    let attempts = 0;
    vi.spyOn(next.fake, "createComputePipeline").mockImplementation((descriptor) => {
      if (++attempts === 2) throw new Error("second pipeline failed"); return original(descriptor);
    });
    await expect(store.recover(next.device, next.registry, next.modules)).rejects.toThrow("second pipeline");
    expect(store.state).toBe("lost"); empty(next.registry);
    const last = host(); await store.recover(last.device, last.registry, last.modules);
    expect(first.inspect().completedDomain).toEqual([2, 1, 1]);
    expect(second.inspect().completedDomain).toEqual([3, 1, 1]);
    store.dispose(); empty(last.registry);
  });

  it("continues recovery if a host disposes one handle while it is replaying", async () => {
    const { store } = setup();
    const first = await store.create(contract.id, params()), second = await store.create(contract.id, params());
    await first.dispatch([1]); store.deviceLost();
    const next = host();
    const completion = gate<void>();
    vi.spyOn(next.fake.queue, "onSubmittedWorkDone").mockReturnValueOnce(completion.promise);
    const rebuilding = store.recover(next.device, next.registry, next.modules);
    for (let i = 0; i < 25 && next.fake.dispatches.length === 0; i++) await Promise.resolve();
    expect(next.fake.dispatches).toHaveLength(1);
    first.dispose(); await rebuilding;
    expect(store.state).toBe("ready"); expect(second.state).toBe("ready");
    expect(store.inspect().instances).toHaveLength(1);
    completion.resolve(); store.dispose(); empty(next.registry);
  });
});
