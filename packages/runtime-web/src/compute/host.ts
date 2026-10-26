/** The host-facing compute API: source defaults plus generated uniform writers,
 * and the mounted program's ownership/recovery boundary. */
import type { MtekComputeProgram, MtekLayoutNode, MtekLayoutRecord, MtekManifest } from "../abi/manifest-types.js";
import type { LayoutWriters } from "../scene/program.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { ComputeDevice } from "./instance.js";
import { ComputeStore } from "./store.js";
import type { ComputeDomain } from "./definition.js";

export type MtekComputeLayout = MtekLayoutNode;
export interface MtekComputeBufferInfo { readonly name: string; readonly capacity: number; readonly stride: number; readonly bytes: number; readonly layout: MtekComputeLayout }
export interface MtekComputeInspection {
  readonly id: string;
  readonly state: "ready" | "recovering" | "lost" | "failed" | "disposed";
  readonly inputs: readonly MtekComputeBufferInfo[];
  readonly output: MtekComputeBufferInfo;
  readonly pendingReadbacks: number;
  readonly dispatchPending: boolean;
  readonly completedDomain?: readonly [number, number, number];
}
export interface MtekComputeHandle {
  readonly state: MtekComputeInspection["state"];
  upload(name: string, data: ArrayBufferView): void;
  setParam(name: string, value: unknown): void;
  dispatch(domain: ComputeDomain): Promise<void>;
  readback(): Promise<ArrayBuffer>;
  inspect(): MtekComputeInspection;
  dispose(): void;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value); }
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new TypeError("compute parameter requires a finite f32");
  return Math.fround(value);
}

/** Validate/copy the CPU shape consumed by generated writers; no offsets are calculated here. */
function normalized(node: MtekLayoutNode, type: string, value: unknown): unknown {
  switch (node.kind) {
    case "scalar":
      if (node.scalar === "bool32") { if (typeof value !== "boolean") throw new TypeError("compute parameter requires a bool"); return value; }
      if (node.scalar === "f32") return finite(value);
      if (typeof value !== "number" || !Number.isInteger(value) || value < (node.scalar === "i32" ? -0x8000_0000 : 0) || value > (node.scalar === "i32" ? 0x7fff_ffff : 0xffff_ffff)) throw new TypeError(`compute parameter requires ${node.scalar}`);
      return value;
    case "vector": {
      const keys = (type === "color" ? ["r", "g", "b", "a"] : ["x", "y", "z", "w"]).slice(0, node.components);
      if (Array.isArray(value)) {
        if (value.length !== keys.length) throw new TypeError("compute vector parameter has wrong length");
        return Object.fromEntries(keys.map((key, i) => [key, finite(value[i])]));
      }
      if (!record(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new TypeError("compute vector parameter has wrong components");
      return Object.fromEntries(keys.map((key) => [key, finite(value[key])]));
    }
    case "matrix":
      if ((!Array.isArray(value) && !(value instanceof Float32Array)) || value.length !== 16) throw new TypeError("compute mat4 parameter requires 16 column-major values");
      return Array.from(value, finite);
    case "array": {
      if (!Array.isArray(value) || value.length !== node.length) throw new TypeError("compute array parameter has wrong length");
      const split = type.lastIndexOf(",");
      const elementType = type.startsWith("array<") && split >= 0 ? type.slice(6, split).trim() : "";
      return Array.from(value, (element) => normalized(node.element, elementType, element));
    }
    case "struct": {
      if (!record(value) || Object.keys(value).length !== node.members.length || node.members.some((member) => !Object.hasOwn(value, member.name))) throw new TypeError("compute struct parameter has wrong fields");
      return Object.fromEntries(node.members.map((member) => [member.name, normalized(member.node, member.mtekType, value[member.name])]));
    }
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function layoutKey(layout: MtekLayoutRecord): string { return canonical({ ...layout, root: { ...layout.root, name: undefined } }); }

export function computeModules(manifest: MtekManifest, modules: ReadonlyMap<string, GPUShaderModule>): ReadonlyMap<string, GPUShaderModule> {
  return new Map((manifest.computePrograms ?? []).map((compute) => {
    const module = modules.get(compute.shader.hash);
    if (module === undefined) throw new Error(`compute shader '${compute.definition.id}' is unavailable`);
    return [compute.definition.id, module];
  }));
}

export class ComputeHost {
  private readonly store: ComputeStore;
  private programs: ReadonlyMap<string, MtekComputeProgram>;
  private manifest: MtekManifest | undefined;
  private readonly handles = new Set<MtekComputeHandle>();
  private disposed = false;

  constructor(
    manifest: MtekManifest,
    private writers: ReadonlyMap<string, LayoutWriters>,
    device: ComputeDevice,
    registry: ResourceRegistry,
    modules: ReadonlyMap<string, GPUShaderModule>,
    private assertActive: () => void,
    private report: (id: string, error: unknown) => void,
  ) {
    this.manifest = manifest;
    this.programs = new Map((manifest.computePrograms ?? []).map((program) => [program.definition.id, structuredClone(program)]));
    if (this.programs.size !== (manifest.computePrograms ?? []).length) throw new Error("duplicate compute program identity");
    for (const program of this.programs.values()) this.checkProgram(program);
    this.store = new ComputeStore(device, registry, [...this.programs.values()].map((program) => program.definition), computeModules(manifest, modules));
  }

  async create(id: string, params: Readonly<Record<string, unknown>> = {}): Promise<MtekComputeHandle> {
    this.ready();
    const program = this.programs.get(id);
    if (program === undefined) throw new RangeError(`no compute program '${id}'`);
    if (!record(params)) throw new TypeError("compute parameters must be an object");
    const fields = new Map(program.params.map((param) => [param.name, param]));
    for (const name of Object.keys(params)) if (!fields.has(name)) throw new RangeError(`unknown compute parameter '${name}'`);
    for (const param of program.params) if (!param.hasDefault && !Object.hasOwn(params, param.name)) throw new TypeError(`required compute parameter '${param.name}' is missing`);
    let bytes = Uint8Array.from(program.defaults);
    for (const [name, value] of Object.entries(params)) bytes = this.packed(program, bytes, name, value);
    const raw = await this.store.create(id, bytes);
    if (this.disposed) { raw.dispose(); throw new Error("compute program was replaced or disposed"); }
    const handle: MtekComputeHandle = Object.freeze({
      get state() { return raw.state; },
      upload: (name: string, data: ArrayBufferView) => { this.ready(); raw.upload(name, data); },
      setParam: (name: string, value: unknown) => { this.ready(); const next = this.packed(program, bytes, name, value); raw.setUniforms(next); bytes = next; },
      dispatch: async (domain: ComputeDomain) => { this.ready(); try { await raw.dispatch(domain); } catch (error) { if (!this.disposed && raw.state !== "lost" && raw.state !== "disposed") this.report(id, error); throw error; } },
      readback: async () => { this.ready(); try { return await raw.readback(); } catch (error) { if (!this.disposed && raw.state !== "lost" && raw.state !== "disposed") this.report(id, error); throw error; } },
      inspect: () => {
        const snapshot = raw.inspect();
        const info = (buffer: typeof snapshot.definition.output): MtekComputeBufferInfo => ({ name: buffer.name, capacity: buffer.layout.length, stride: buffer.layout.stride, bytes: buffer.layout.size, layout: buffer.layout });
        return { id, state: snapshot.state, inputs: snapshot.definition.inputs.map(info), output: info(snapshot.definition.output), pendingReadbacks: snapshot.pendingReadbacks, dispatchPending: snapshot.dispatchPending, ...(snapshot.completedDomain === undefined ? {} : { completedDomain: snapshot.completedDomain }) };
      },
      dispose: () => { raw.dispose(); bytes = new Uint8Array(0); this.handles.delete(handle); },
    });
    this.handles.add(handle);
    return handle;
  }

  deviceLost(): void { this.store.deviceLost(); }
  async recover(device: ComputeDevice, registry: ResourceRegistry, modules: ReadonlyMap<string, GPUShaderModule>): Promise<void> {
    if (this.disposed || this.manifest === undefined) throw new Error("compute program was disposed");
    await this.store.recover(device, registry, computeModules(this.manifest, modules));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of this.handles) handle.dispose();
    this.store.dispose(); this.programs = new Map(); this.writers = new Map(); this.manifest = undefined;
    this.report = () => undefined; this.assertActive = () => { throw new Error("compute program was disposed"); };
  }

  private ready(): void { if (this.disposed) throw new Error("compute program was replaced or disposed"); this.assertActive(); }
  private packed(program: MtekComputeProgram, old: Uint8Array<ArrayBuffer>, name: string, value: unknown): Uint8Array<ArrayBuffer> {
    const layout = program.definition.uniforms;
    const member = layout?.root.members.find((member) => member.name === name);
    if (layout === undefined || member === undefined) throw new RangeError(`unknown compute parameter '${name}'`);
    const normalizedValue = normalized(member.node, member.mtekType, value);
    const bytes = old.slice();
    const writer = this.writers.get(layout.id)!.fields.get(name)!;
    writer({ f32: new Float32Array(bytes.buffer), u32: new Uint32Array(bytes.buffer), i32: new Int32Array(bytes.buffer) }, 0, normalizedValue);
    return bytes;
  }
  private checkProgram(program: MtekComputeProgram): void {
    const layout = program.definition.uniforms;
    if (program.api !== 1 || program.defaults.length !== (layout?.size ?? 0) || program.defaults.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error("compute uniform defaults have an invalid shape");
    if (program.params.length !== (layout?.root.members.length ?? 0) || program.params.length > 64) throw new Error("compute parameters disagree with their layout");
    if (layout === undefined) return;
    const declared = this.manifest!.layouts.find((candidate) => candidate.id === layout.id);
    if (declared === undefined || layoutKey(declared) !== layoutKey(layout)) throw new Error("compute layout disagrees with generated writer layout");
    const writer = this.writers.get(layout.id);
    if (writer === undefined || typeof writer.all !== "function") throw new Error("compute uniform writer is missing");
    for (const [i, param] of program.params.entries()) {
      const member = layout.root.members[i]!;
      if (param.name !== member.name || param.type !== member.mtekType || !writer.fields.has(param.name) || typeof writer.fields.get(param.name) !== "function") throw new Error("compute parameter writer/layout mismatch");
    }
  }
}
