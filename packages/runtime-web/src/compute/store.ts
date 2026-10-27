/** Internal mounted-lifetime owner behind the public host handles. Ordinary
 * source builds remain gated pending real GPU acceptance. */
import type { ResourceRegistry } from "../gpu/registry.js";
import { checkedDefinition, type ComputeDefinition, type ComputeDomain } from "./definition.js";
import { ComputeInstance, type ComputeDevice } from "./instance.js";

export interface ComputeHandle {
  readonly state: ComputeInstance["state"];
  upload(name: string, data: ArrayBufferView): void;
  setUniforms(data: ArrayBufferView): void;
  dispatch(domain: ComputeDomain): Promise<void>;
  readback(): Promise<ArrayBuffer>;
  inspect(): ReturnType<ComputeInstance["inspect"]>;
  dispose(): void;
}

type State = "ready" | "lost" | "recovering" | "disposed";

function definitionsFor(definitions: readonly ComputeDefinition[], device: ComputeDevice, modules: ReadonlyMap<string, GPUShaderModule>): ReadonlyMap<string, ComputeDefinition> {
  const checked = new Map<string, ComputeDefinition>();
  for (const definition of definitions) {
    if (checked.has(definition.id)) throw new Error(`compute: duplicate program '${definition.id}'`);
    if (!modules.has(definition.id)) throw new Error(`compute: shader for '${definition.id}' is unavailable`);
    checked.set(definition.id, checkedDefinition(definition, device.limits));
  }
  return checked;
}

export class ComputeStore {
  private current: State = "ready";
  private epoch = 0;
  private creations = new AbortController();
  private definitions: ReadonlyMap<string, ComputeDefinition>;
  private modules: ReadonlyMap<string, GPUShaderModule>;
  private readonly instances = new Map<ComputeInstance, string>();
  private readonly handles = new WeakMap<ComputeHandle, ComputeInstance>();

  constructor(
    private device: ComputeDevice,
    private registry: ResourceRegistry,
    definitions: readonly ComputeDefinition[],
    modules: ReadonlyMap<string, GPUShaderModule>,
  ) {
    this.definitions = definitionsFor(definitions, device, modules);
    this.modules = new Map(modules);
  }

  get state(): State { return this.current; }

  async create(id: string, uniforms?: ArrayBufferView): Promise<ComputeHandle> {
    this.ready();
    const definition = this.definitions.get(id);
    if (definition === undefined) throw new RangeError(`compute: no program '${id}'`);
    const epoch = this.epoch;
    const instance = await ComputeInstance.create(this.device, this.registry, definition, this.modules.get(id)!, uniforms, this.creations.signal);
    if (this.current !== "ready" || this.epoch !== epoch) {
      instance.dispose();
      throw new Error("compute: program changed while creating the instance");
    }
    this.instances.set(instance, id);
    const ready = (): void => { this.ready(); if (!this.instances.has(instance)) throw new Error("compute: handle was disposed or replaced"); };
    const handle: ComputeHandle = Object.freeze({
      get state() { return instance.state; },
      upload: (name: string, data: ArrayBufferView) => { ready(); instance.upload(name, data); },
      setUniforms: (data: ArrayBufferView) => { ready(); instance.setUniforms(data); },
      dispatch: async (domain: ComputeDomain) => { ready(); await instance.dispatch(domain); },
      readback: async () => { ready(); return instance.readback(); },
      inspect: () => instance.inspect(),
      dispose: () => { instance.dispose(); this.instances.delete(instance); },
    });
    this.handles.set(handle, instance);
    return handle;
  }

  /** Renderer-only lookup: cross-store, disposed and replaced handles are rejected. */
  renderBuffer(handle: ComputeHandle): GPUBuffer {
    this.ready();
    const instance = this.handles.get(handle);
    if (instance === undefined || !this.instances.has(instance)) throw new Error("compute: handle does not belong to the current program");
    return instance.renderBuffer();
  }

  renderReadyBuffer(handle: ComputeHandle): GPUBuffer | undefined {
    const instance = this.handles.get(handle);
    if (instance === undefined || !this.instances.has(instance)) return undefined;
    return this.current === "ready" ? instance.renderReadyBuffer() : undefined;
  }

  inspect(): { state: State; instances: readonly ReturnType<ComputeInstance["inspect"]>[] } {
    return { state: this.current, instances: [...this.instances.keys()].map((instance) => instance.inspect()) };
  }

  /** Call only when replacement commits; validation failure preserves old instances. */
  replace(definitions: readonly ComputeDefinition[], modules: ReadonlyMap<string, GPUShaderModule>): void {
    this.ready();
    const checked = definitionsFor(definitions, this.device, modules);
    this.epoch++;
    this.creations.abort();
    this.creations = new AbortController();
    for (const instance of this.instances.keys()) instance.dispose();
    this.instances.clear();
    this.definitions = checked;
    this.modules = new Map(modules);
    this.current = "ready";
  }

  deviceLost(): void {
    if (this.current === "disposed" || this.current === "lost") return;
    this.current = "lost";
    this.epoch++;
    this.creations.abort();
    for (const instance of this.instances.keys()) instance.deviceLost();
    this.modules = new Map();
  }

  async recover(device: ComputeDevice, registry: ResourceRegistry, modules: ReadonlyMap<string, GPUShaderModule>): Promise<void> {
    if (this.current !== "lost") throw new Error(`compute: cannot recover a store that is ${this.current}`);
    const recoveredModules = new Map(modules);
    const definitions = definitionsFor([...this.definitions.values()], device, recoveredModules);
    this.current = "recovering";
    const epoch = ++this.epoch;
    try {
      for (const [instance, id] of this.instances) {
        if (instance.state === "failed") continue;
        try {
          await instance.recover(device, registry, recoveredModules.get(id)!);
        } catch (error) {
          if (this.instances.has(instance)) throw error;
        }
        if (this.current !== "recovering" || epoch !== this.epoch) throw new Error("compute: recovery was superseded");
      }
      this.device = device;
      this.registry = registry;
      this.modules = recoveredModules;
      this.definitions = definitions;
      this.creations = new AbortController();
      this.current = "ready";
    } catch (error) {
      if (this.epoch === epoch) this.deviceLost();
      throw error;
    }
  }

  dispose(): void {
    if (this.current === "disposed") return;
    this.current = "disposed";
    this.epoch++;
    this.creations.abort();
    for (const instance of this.instances.keys()) instance.dispose();
    this.instances.clear();
    this.definitions = new Map();
    this.modules = new Map();
  }

  private ready(): void { if (this.current !== "ready") throw new Error(`compute: store is ${this.current}`); }
}
