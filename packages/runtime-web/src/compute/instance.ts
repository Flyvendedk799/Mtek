/** Owned compute resources, not yet exposed by mountMtek. One in-flight dispatch
 * per instance; staged uploads may change while its immutable snapshot completes. */
import type { ResourceRegistry } from "../gpu/registry.js";
import { checkedDefinition, checkedDomain, copiedBytes, type ComputeDefinition, type ComputeDomain } from "./definition.js";

export type ComputeDevice = Pick<GPUDevice,
  "limits" | "lost" | "queue" | "createCommandEncoder" | "pushErrorScope" | "popErrorScope"
>;
type State = "ready" | "recovering" | "lost" | "failed" | "disposed";
interface DispatchSnapshot {
  readonly inputs: readonly Uint8Array<ArrayBuffer>[];
  readonly uniforms: Uint8Array<ArrayBuffer>;
  readonly domain: readonly [number, number, number];
}
interface Resources {
  readonly registry: ResourceRegistry;
  readonly generation: number;
  released: boolean;
  readonly buffers: GPUBuffer[];
  readonly dispatch: GPUBuffer;
  readonly uniforms?: GPUBuffer;
  readonly inputs: readonly GPUBuffer[];
  readonly output: GPUBuffer;
  readonly group: GPUBindGroup;
  readonly pipeline: GPUComputePipeline;
}
interface PendingOperation { readonly cancel: (error: Error) => void }

export class ComputeInstance {
  private definition: ComputeDefinition;
  private current: State = "recovering";
  private epoch = 0;
  private resources: Resources | undefined;
  private inputs: Uint8Array<ArrayBuffer>[];
  private uniforms: Uint8Array<ArrayBuffer>;
  private completed: DispatchSnapshot | undefined;
  private dispatchPending = false;
  private activeDispatch: Promise<void> | undefined;
  private readonly pending = new Set<PendingOperation>();
  private readonly staging = new Map<GPUBuffer, { registry: ResourceRegistry; generation: number }>();

  private constructor(
    private device: ComputeDevice,
    private registry: ResourceRegistry,
    definition: ComputeDefinition,
    uniforms: ArrayBufferView | undefined,
  ) {
    this.definition = checkedDefinition(definition, device.limits);
    this.inputs = this.definition.inputs.map((input) => new Uint8Array(input.layout.size));
    const size = this.definition.uniforms?.size ?? 0;
    if (size > 0 && uniforms === undefined) throw new RangeError("compute: packed uniform bytes are required");
    this.uniforms = uniforms === undefined ? new Uint8Array(0) : copiedBytes(uniforms, size);
  }

  static async create(
    device: ComputeDevice,
    registry: ResourceRegistry,
    definition: ComputeDefinition,
    module: GPUShaderModule,
    uniforms?: ArrayBufferView,
    signal?: AbortSignal,
  ): Promise<ComputeInstance> {
    const instance = new ComputeInstance(device, registry, definition, uniforms);
    const cancel = (): void => instance.dispose();
    try {
      if (signal?.aborted === true) throw new Error("compute creation was cancelled");
      signal?.addEventListener("abort", cancel, { once: true });
      instance.watchDevice();
      const epoch = instance.epoch;
      await instance.allocate(module);
      instance.assertEpoch(epoch);
      instance.current = "ready";
      return instance;
    } catch (error) {
      instance.dispose();
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  get state(): State { return this.current; }

  /** A copied layout/resource description; callers never receive the live GPU owners. */
  inspect(): { state: State; definition: ComputeDefinition; pendingReadbacks: number; dispatchPending: boolean; completedDomain?: readonly [number, number, number] } {
    return {
      state: this.current,
      definition: structuredClone(this.definition),
      pendingReadbacks: this.staging.size,
      dispatchPending: this.dispatchPending,
      ...(this.completed === undefined ? {} : { completedDomain: [...this.completed.domain] as [number, number, number] }),
    };
  }

  upload(name: string, data: ArrayBufferView): void {
    const resources = this.ready();
    const index = this.definition.inputs.findIndex((input) => input.name === name);
    if (index < 0) throw new RangeError(`compute: no input named '${name}'`);
    const bytes = copiedBytes(data, this.definition.inputs[index]!.layout.size);
    this.write(resources.inputs[index]!, bytes);
    this.inputs[index] = bytes;
  }

  setUniforms(data: ArrayBufferView): void {
    const resources = this.ready();
    const bytes = copiedBytes(data, this.definition.uniforms?.size ?? 0);
    if (resources.uniforms !== undefined) this.write(resources.uniforms, bytes);
    this.uniforms = bytes;
  }

  async dispatch(domain: ComputeDomain): Promise<void> {
    const resources = this.ready();
    if (this.dispatchPending) throw new Error("compute: wait for the previous dispatch before submitting another");
    const checked = checkedDomain(domain, this.definition, this.device.limits);
    const snapshot: DispatchSnapshot = {
      inputs: this.inputs.map((bytes) => bytes.slice()),
      uniforms: this.uniforms.slice(),
      domain: checked.domain,
    };
    this.dispatchPending = true;
    const epoch = this.epoch;
    try {
      const completion = this.interruptible(this.submit(resources, checked.domain, checked.groups));
      this.activeDispatch = completion;
      await completion;
      this.assertEpoch(epoch);
      this.completed = snapshot;
    } catch (error) {
      // A validation failure can clear/partially change output: never expose it as valid.
      if (this.epoch === epoch && this.current === "ready") this.invalidate("failed", "compute dispatch failed");
      throw error;
    } finally {
      if (this.epoch === epoch) { this.dispatchPending = false; this.activeDispatch = undefined; }
    }
  }

  /** A queue-ordered copy; every call owns its own staging buffer. */
  async readback(): Promise<ArrayBuffer> {
    const resources = this.ready();
    if (this.staging.size >= 4) throw new RangeError("compute: at most four readbacks may be pending per instance");
    const registry = this.registry;
    const device = this.device;
    const epoch = this.epoch;
    const dispatch = this.activeDispatch;
    const size = this.definition.output.layout.size;
    const staging = registry.createBuffer({ label: `${this.definition.id} readback`, size, usage: 0x09 });
    const generation = registry.generation;
    this.staging.set(staging, { registry, generation });
    try {
      device.pushErrorScope("validation");
      let checked: Promise<GPUError | null>;
      try {
        const encoder = device.createCommandEncoder({ label: "mtek compute readback" });
        encoder.copyBufferToBuffer(resources.output, 0, staging, 0, size);
        device.queue.submit([encoder.finish()]);
      } finally {
        checked = device.popErrorScope();
        void checked.catch(() => undefined);
      }
      // Mapping orders the copy, not unrelated GPU promises (WebGPU §3.2.2).
      await this.interruptible(Promise.all([staging.mapAsync(0x01), checked, dispatch]).then(([, error]) => {
        if (error !== null) throw new Error(`compute readback validation: ${error.message}`);
      }));
      this.assertEpoch(epoch);
      return staging.getMappedRange().slice(0);
    } finally {
      if (this.staging.delete(staging) && registry.generation === generation) {
        try { staging.unmap(); } finally { registry.release(staging); }
      }
    }
  }

  /** Internal renderer bridge only. Call again after recovery; ownership stays here. */
  renderBuffer(): GPUBuffer { return this.ready().output; }

  /** Recovery rebuilds the last completed output, then restores later staged uploads. */
  async recover(device: ComputeDevice, registry: ResourceRegistry, module: GPUShaderModule): Promise<void> {
    if (this.current !== "lost") throw new Error(`compute: cannot recover an instance that is ${this.current}`);
    this.definition = checkedDefinition(this.definition, device.limits);
    this.current = "recovering";
    this.device = device;
    this.registry = registry;
    const epoch = ++this.epoch;
    try {
      this.watchDevice();
      await this.allocate(module);
      this.assertEpoch(epoch);
      const resources = this.resources!;
      const completed = this.completed;
      if (completed !== undefined) {
        for (let i = 0; i < resources.inputs.length; i++) this.write(resources.inputs[i]!, completed.inputs[i]!);
        if (resources.uniforms !== undefined) this.write(resources.uniforms, completed.uniforms);
        const checked = checkedDomain(completed.domain, this.definition, device.limits);
        await this.interruptible(this.submit(resources, checked.domain, checked.groups));
        this.assertEpoch(epoch);
        for (let i = 0; i < resources.inputs.length; i++) this.write(resources.inputs[i]!, this.inputs[i]!);
        if (resources.uniforms !== undefined) this.write(resources.uniforms, this.uniforms);
      }
      this.current = "ready";
    } catch (error) {
      if (this.epoch === epoch) this.invalidate("lost", "compute recovery failed");
      throw error;
    }
  }

  /** Called by the owner before registry retirement as well as by device.lost. */
  deviceLost(): void {
    if (this.current === "disposed" || this.current === "lost" || this.current === "failed") return;
    this.invalidate("lost", "compute device was lost");
  }

  dispose(): void {
    if (this.current === "disposed") return;
    this.invalidate("disposed", "compute instance was disposed");
    this.inputs = [];
    this.uniforms = new Uint8Array(0);
    this.completed = undefined;
  }

  private watchDevice(): void {
    const epoch = this.epoch;
    // A live device's never-settling lost promise must not retain disposed instances.
    const reference = new WeakRef(this);
    void this.device.lost.then(() => {
      const owner = reference.deref();
      if (owner?.epoch === epoch) owner.deviceLost();
    });
  }

  private ready(): Resources {
    if (this.current !== "ready" || this.resources === undefined) throw new Error(`compute: instance is ${this.current}`);
    return this.resources;
  }

  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch || this.current === "disposed" || this.current === "lost" || this.current === "failed") throw new Error(`compute: operation ended while instance is ${this.current}`);
  }

  private async interruptible<T>(operation: Promise<T>): Promise<T> {
    let reject!: (error: Error) => void;
    const interrupted = new Promise<never>((_, fail) => { reject = fail; });
    const pending = { cancel: reject };
    this.pending.add(pending);
    try { return await Promise.race([operation, interrupted]); }
    finally { this.pending.delete(pending); }
  }

  private write(buffer: GPUBuffer, bytes: Uint8Array<ArrayBuffer>): void {
    this.registry.writeBuffer(this.device.queue, buffer, 0, bytes.buffer, 0, bytes.byteLength);
  }

  private async allocate(module: GPUShaderModule): Promise<void> {
    const { device, registry, definition } = this;
    const epoch = this.epoch;
    const buffers: GPUBuffer[] = [];
    let pipeline: GPUComputePipeline | undefined;
    let group: GPUBindGroup | undefined;
    let owned: Resources | undefined;
    const generation = registry.generation;
    const create = (size: number, usage: number, label: string): GPUBuffer => {
      const buffer = registry.createBuffer({ size, usage, label: `${definition.id} ${label}` });
      buffers.push(buffer);
      return buffer;
    };
    device.pushErrorScope("validation");
    let checked: Promise<GPUError | null> | undefined;
    try {
      const dispatch = create(definition.dispatch.size, 0x48, "dispatch");
      const uniforms = definition.uniforms === undefined ? undefined : create(definition.uniforms.size, 0x48, "uniforms");
      const inputs = definition.inputs.map((input) => create(input.layout.size, 0x88, input.name));
      const output = create(definition.output.layout.size, 0xac, definition.output.name);
      const entries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: 4, buffer: { type: "uniform", minBindingSize: definition.dispatch.size } },
        ...(uniforms === undefined ? [] : [{ binding: 1, visibility: 4, buffer: { type: "uniform" as const, minBindingSize: definition.uniforms!.size } }]),
        ...definition.inputs.map((input, i) => ({ binding: i + 2, visibility: 4, buffer: { type: "read-only-storage" as const, minBindingSize: input.layout.size } })),
        { binding: inputs.length + 2, visibility: 4, buffer: { type: "storage", minBindingSize: definition.output.layout.size } },
      ];
      const layout = registry.createBindGroupLayout({ entries });
      pipeline = registry.createComputePipeline({ label: definition.id, layout: registry.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: definition.entryPoint } });
      group = registry.createBindGroup({ layout, entries: [
        { binding: 0, resource: { buffer: dispatch } },
        ...(uniforms === undefined ? [] : [{ binding: 1, resource: { buffer: uniforms } }]),
        ...inputs.map((buffer, i) => ({ binding: i + 2, resource: { buffer } })),
        { binding: inputs.length + 2, resource: { buffer: output } },
      ] });
      for (let i = 0; i < inputs.length; i++) this.write(inputs[i]!, this.inputs[i]!);
      if (uniforms !== undefined) this.write(uniforms, this.uniforms);
      // Publish ownership before the asynchronous scope result, so dispose/loss
      // releases even an allocation that has not finished validation yet.
      owned = { registry, generation, released: false, buffers, dispatch, inputs, output, group, pipeline, ...(uniforms === undefined ? {} : { uniforms }) };
      this.resources = owned;
      checked = device.popErrorScope();
      const error = await this.interruptible(checked);
      this.assertEpoch(epoch);
      if (error !== null) throw new Error(`compute allocation validation: ${error.message}`);
    } catch (error) {
      if (checked === undefined) void device.popErrorScope().catch(() => undefined);
      if (owned !== undefined) this.releaseOwned(owned);
      else if (registry.generation === generation) {
        if (group !== undefined) registry.release(group);
        if (pipeline !== undefined) registry.release(pipeline);
        for (const buffer of buffers) registry.release(buffer);
      }
      if (this.resources === owned) this.resources = undefined;
      throw error;
    }
  }

  private async submit(resources: Resources, domain: readonly [number, number, number], groups: readonly [number, number, number]): Promise<void> {
    const device = this.device;
    device.pushErrorScope("validation");
    let checked: Promise<GPUError | null>;
    try {
      const bytes = new Uint8Array(this.definition.dispatch.size);
      const view = new DataView(bytes.buffer);
      this.definition.dispatch.root.members.forEach((field, i) => view.setUint32(field.node.offset, domain[i]!, true));
      this.write(resources.dispatch, bytes);
      const encoder = device.createCommandEncoder({ label: "mtek authored compute" });
      encoder.clearBuffer(resources.output);
      const pass = encoder.beginComputePass();
      pass.setPipeline(resources.pipeline);
      pass.setBindGroup(0, resources.group);
      pass.dispatchWorkgroups(...groups);
      pass.end();
      device.queue.submit([encoder.finish()]);
    } finally {
      checked = device.popErrorScope();
      void checked.catch(() => undefined);
    }
    const [error] = await Promise.all([checked, device.queue.onSubmittedWorkDone()]);
    if (error !== null) throw new Error(`compute dispatch validation: ${error.message}`);
  }

  private invalidate(state: State, reason: string): void {
    this.current = state;
    this.epoch++;
    this.dispatchPending = false;
    this.activeDispatch = undefined;
    for (const operation of this.pending) operation.cancel(new Error(reason));
    this.pending.clear();
    for (const [buffer, owner] of this.staging) {
      if (owner.registry.generation === owner.generation) owner.registry.release(buffer);
    }
    this.staging.clear();
    if (this.resources !== undefined) {
      this.releaseOwned(this.resources);
      this.resources = undefined;
    }
  }

  private releaseOwned(resources: Resources): void {
    if (resources.released) return;
    resources.released = true;
    if (resources.registry.generation !== resources.generation) return;
    resources.registry.release(resources.group);
    resources.registry.release(resources.pipeline);
    for (const buffer of resources.buffers) resources.registry.release(buffer);
  }
}
