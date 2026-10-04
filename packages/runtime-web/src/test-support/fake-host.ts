/**
 * Fakes for the host layer (mount, app, surface): the rendering part of WebGPU on top of `fake-gpu.ts`,
 * and the small slice of the DOM the runtime touches. Like `fake-gpu.ts` they model the contracts the
 * runtime relies on and throw (or raise a validation error) where the real API would:
 *
 *  - `GPUCanvasContext.configure`: the device must be a fake device, `viewFormats` may only differ from
 *    `format` by sRGB-ness; `getCurrentTexture` needs a configured context and a non-empty canvas, and
 *    its texture only accepts views in `format` or `viewFormats`.
 *  - render passes: attachments must be render-attachment textures of identical size; the depth
 *    attachment must be a depth format. `copyTextureToBuffer`: source `COPY_SRC`, destination
 *    `COPY_DST`, `bytesPerRow` a multiple of 256 for multi-row copies and large enough, the buffer large
 *    enough. Commands run when the command buffer is submitted; using a destroyed resource then raises
 *    a validation error; a command buffer can be submitted once.
 *  - clearing an `-srgb` view encodes the linear clear value to sRGB (the hardware conversion).
 *  - shader modules report compilation messages and raise a validation error for errors.
 *  - render pipelines: a pipeline layout, one colour target, a depth format; `hooks.pipelineError` makes
 *    creation fail. Render pass encoders check, at every `drawIndexed`, that the pipeline matches the
 *    attachment formats, that every bind group of the pipeline layout is set with its own layout and the
 *    right number of aligned dynamic offsets, that every vertex buffer slot and the index buffer are set
 *    with the right usage, and that the indices fit; draws are recorded with the pass.
 *  - DOM listeners dedupe on (type, listener, capture) like `EventTarget`.
 *
 * `asDom` is the single documented place where a fake is presented as a nominally typed DOM interface.
 */
/// <reference types="vite/client" />
import type { DocumentLike, FetchResponseLike, HostEnvironment, ResizeObserverLike } from "../host/environment.js";
import {
  FakeAdapter,
  FakeBindGroup,
  FakeBuffer,
  FakeDevice,
  FakeGpu,
  FakeResource,
  FakeTexture,
  FakeTextureView,
  type FakeAdapterOptions,
  type FakeCommandBuffer,
} from "./fake-gpu.js";

/** Presents a fake as the DOM interface type it stands in for. */
export function asDom<T>(fake: object): T {
  return fake as T;
}

const USAGE_TEXTURE_COPY_SRC = 0x01;
const USAGE_TEXTURE_RENDER_ATTACHMENT = 0x10;
const USAGE_BUFFER_COPY_DST = 0x08;

/** Linear to sRGB transfer function, 0..1 to a byte. */
export function encodeSrgbByte(linear: number): number {
  const clamped = Math.min(Math.max(linear, 0), 1);
  const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

// ---------------------------------------------------------------- GPU

export interface FakeCompilationMessage {
  readonly message: string;
  readonly type: "error" | "warning" | "info";
  readonly lineNum: number;
  readonly linePos: number;
  readonly offset: number;
  readonly length: number;
}

/**
 * Default compiler of the fake: every line containing `@@error <text>` is a compile error located at the
 * marker (1-based line and column), like Tint reporting a position.
 */
export function defaultShaderMessages(code: string): FakeCompilationMessage[] {
  const messages: FakeCompilationMessage[] = [];
  code.split("\n").forEach((line, index) => {
    const at = line.indexOf("@@error");
    if (at >= 0) {
      messages.push({
        message: line.slice(at + "@@error".length).trim() || "error",
        type: "error",
        lineNum: index + 1,
        linePos: at + 1,
        offset: 0,
        length: 0,
      });
    }
  });
  return messages;
}

export class FakeShaderModule extends FakeResource {
  constructor(
    descriptor: { readonly code: string },
    private readonly messages: readonly FakeCompilationMessage[],
  ) {
    super("shaderModule", descriptor);
  }

  getCompilationInfo(): Promise<{ readonly messages: readonly FakeCompilationMessage[] }> {
    return Promise.resolve({ messages: this.messages });
  }
}

/** One recorded `drawIndexed` with the state it used. */
export interface FakeDrawRecord {
  readonly pipeline: FakeResource;
  /** Bind groups 0..n-1 of the pipeline layout as set at the draw. */
  readonly bindGroups: readonly FakeBindGroup[];
  /** Dynamic offsets per group. */
  readonly dynamicOffsets: readonly (readonly number[])[];
  readonly vertexBuffers: readonly FakeBuffer[];
  readonly indexBuffer: FakeBuffer;
  readonly indexFormat: string;
  readonly indexCount: number;
}

export interface FakeRenderPassRecord {
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly viewFormat: string;
  readonly clearValue: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
  readonly depthWidth: number;
  readonly depthHeight: number;
  readonly draws: readonly FakeDrawRecord[];
}

/** The fields of a render pipeline descriptor the fakes interpret. */
export interface FakePipelineDescriptor {
  readonly label?: string;
  readonly layout: unknown;
  readonly vertex: {
    readonly module: unknown;
    readonly entryPoint?: string;
    readonly buffers?: readonly {
      readonly arrayStride: number;
      readonly stepMode?: string;
      readonly attributes: readonly { readonly shaderLocation: number; readonly offset: number; readonly format: string }[];
    }[];
  };
  readonly fragment?: { readonly module: unknown; readonly entryPoint?: string; readonly targets: readonly { readonly format: string }[] };
  readonly primitive?: { readonly topology?: string; readonly cullMode?: string; readonly frontFace?: string };
  readonly depthStencil?: { readonly format: string; readonly depthCompare?: string; readonly depthWriteEnabled?: boolean };
}

interface FakeLayoutEntry {
  readonly binding: number;
  readonly buffer?: { readonly type?: string; readonly hasDynamicOffset?: boolean; readonly minBindingSize?: number };
}

function layoutEntries(layout: unknown): readonly FakeLayoutEntry[] {
  if (!(layout instanceof FakeResource) || layout.kind !== "bindGroupLayout") throw new Error("not a bind group layout");
  return (layout.descriptor as { entries: readonly FakeLayoutEntry[] }).entries;
}

function pipelineGroupLayouts(pipeline: FakeResource): readonly unknown[] {
  const layout = (pipeline.descriptor as FakePipelineDescriptor).layout;
  if (!(layout instanceof FakeResource) || layout.kind !== "pipelineLayout") throw new Error("the pipeline has no explicit pipeline layout");
  return (layout.descriptor as { bindGroupLayouts: readonly unknown[] }).bindGroupLayouts;
}

const USAGE_BUFFER_INDEX = 0x10;
const USAGE_BUFFER_VERTEX = 0x20;

/** A render pass encoder that validates its commands like a WebGPU implementation and records draws. */
export class FakeRenderPassEncoder {
  readonly draws: FakeDrawRecord[] = [];
  ended = false;
  private pipeline: FakeResource | null = null;
  private readonly groups: (FakeBindGroup | undefined)[] = [];
  private readonly offsets: (readonly number[])[] = [];
  private readonly vertexBuffers: (FakeBuffer | undefined)[] = [];
  private index: { buffer: FakeBuffer; format: string } | null = null;

  constructor(
    private readonly colorFormat: string,
    private readonly depthFormat: string | undefined,
    private readonly alignment: number,
  ) {}

  private recording(what: string): void {
    if (this.ended) throw new Error(`${what}: the render pass has ended`);
  }

  setPipeline(pipeline: FakeResource): void {
    this.recording("setPipeline");
    if (!(pipeline instanceof FakeResource) || pipeline.kind !== "renderPipeline") throw new Error("setPipeline: not a render pipeline");
    const descriptor = pipeline.descriptor as FakePipelineDescriptor;
    const target = descriptor.fragment?.targets[0]?.format;
    if (target !== this.colorFormat) throw new Error(`setPipeline: the pipeline targets ${String(target)} but the pass renders to ${this.colorFormat}`);
    if (descriptor.depthStencil?.format !== this.depthFormat) {
      throw new Error(`setPipeline: the pipeline depth format ${String(descriptor.depthStencil?.format)} differs from the pass depth format ${String(this.depthFormat)}`);
    }
    this.pipeline = pipeline;
  }

  setBindGroup(index: number, group: FakeBindGroup, dynamicOffsets: readonly number[] = []): void {
    this.recording("setBindGroup");
    if (!(group instanceof FakeBindGroup)) throw new Error("setBindGroup: not a bind group");
    this.groups[index] = group;
    this.offsets[index] = [...dynamicOffsets];
  }

  setVertexBuffer(slot: number, buffer: FakeBuffer): void {
    this.recording("setVertexBuffer");
    if ((buffer.usage & USAGE_BUFFER_VERTEX) === 0) throw new Error(`setVertexBuffer: buffer "${buffer.label}" lacks VERTEX`);
    this.vertexBuffers[slot] = buffer;
  }

  setIndexBuffer(buffer: FakeBuffer, format: string): void {
    this.recording("setIndexBuffer");
    if ((buffer.usage & USAGE_BUFFER_INDEX) === 0) throw new Error(`setIndexBuffer: buffer "${buffer.label}" lacks INDEX`);
    if (format !== "uint16" && format !== "uint32") throw new Error(`setIndexBuffer: invalid format ${format}`);
    this.index = { buffer, format };
  }

  drawIndexed(indexCount: number): void {
    this.recording("drawIndexed");
    const pipeline = this.pipeline;
    if (pipeline === null) throw new Error("drawIndexed: no pipeline is set");
    const groupLayouts = pipelineGroupLayouts(pipeline);
    const groups: FakeBindGroup[] = [];
    groupLayouts.forEach((layout, i) => {
      const group = this.groups[i];
      if (group === undefined) throw new Error(`drawIndexed: bind group ${String(i)} is not set`);
      if (group.descriptor.layout !== layout) throw new Error(`drawIndexed: bind group ${String(i)} was made for another layout`);
      const dynamic = layoutEntries(layout).filter((entry) => entry.buffer?.hasDynamicOffset === true);
      const offsets = this.offsets[i] ?? [];
      if (offsets.length !== dynamic.length) {
        throw new Error(`drawIndexed: bind group ${String(i)} needs ${String(dynamic.length)} dynamic offsets, got ${String(offsets.length)}`);
      }
      offsets.forEach((offset, k) => {
        if (offset % this.alignment !== 0) throw new Error(`drawIndexed: dynamic offset ${String(offset)} is not aligned to ${String(this.alignment)}`);
        const entry = group.descriptor.entries.find((e) => e.binding === dynamic[k]?.binding);
        if (entry === undefined) throw new Error("drawIndexed: no entry for a dynamic binding");
        const size = entry.resource.size ?? entry.resource.buffer.size;
        if ((entry.resource.offset ?? 0) + offset + size > entry.resource.buffer.size) throw new Error("drawIndexed: dynamic offset beyond the buffer");
      });
      groups.push(group);
    });
    const buffers = (pipeline.descriptor as FakePipelineDescriptor).vertex.buffers ?? [];
    const vertexBuffers = buffers.map((layout, slot) => {
      const buffer = this.vertexBuffers[slot];
      if (buffer === undefined) throw new Error(`drawIndexed: vertex buffer slot ${String(slot)} is not set`);
      if (buffer.size % layout.arrayStride !== 0) {
        throw new Error(`drawIndexed: vertex buffer slot ${String(slot)} is not a whole number of ${String(layout.arrayStride)}-byte vertices`);
      }
      return buffer;
    });
    if (this.index === null) throw new Error("drawIndexed: no index buffer is set");
    const bytes = this.index.format === "uint16" ? 2 : 4;
    if (indexCount * bytes > this.index.buffer.size) throw new Error("drawIndexed: the indices exceed the index buffer");
    this.draws.push({
      pipeline,
      bindGroups: groups,
      dynamicOffsets: groups.map((_, i) => this.offsets[i] ?? []),
      vertexBuffers,
      indexBuffer: this.index.buffer,
      indexFormat: this.index.format,
      indexCount,
    });
  }

  end(): void {
    if (this.ended) throw new Error("end: the render pass already ended");
    this.ended = true;
  }
}

interface ColorAttachment {
  readonly view: FakeTextureView;
  readonly clearValue?: { r: number; g: number; b: number; a: number };
  readonly loadOp: string;
  readonly storeOp: string;
}

interface RenderPassDescriptor {
  readonly colorAttachments: readonly ColorAttachment[];
  readonly depthStencilAttachment?: { readonly view: FakeTextureView; readonly depthClearValue?: number; readonly depthLoadOp?: string; readonly depthStoreOp?: string };
}

class FakeCommandBufferImpl implements FakeCommandBuffer {
  private submitted = false;

  constructor(private readonly commands: ReadonlyArray<() => void>) {}

  execute(): void {
    if (this.submitted) throw new Error("submit: a command buffer can only be submitted once");
    this.submitted = true;
    for (const command of this.commands) command();
  }
}

export class FakeCommandEncoder {
  private readonly commands: Array<() => void> = [];
  private passOpen = false;
  private finished = false;

  constructor(private readonly device: FakeHostDevice) {}

  private ensureRecording(what: string): void {
    if (this.finished) throw new Error(`${what}: the command encoder is finished`);
    if (this.passOpen) throw new Error(`${what}: a render pass is still open`);
  }

  beginRenderPass(descriptor: RenderPassDescriptor): FakeRenderPassEncoder {
    this.ensureRecording("beginRenderPass");
    const color = descriptor.colorAttachments[0];
    if (color === undefined) throw new Error("beginRenderPass: at least one color attachment is required");
    const colorTexture = color.view.texture;
    if ((colorTexture.usage & USAGE_TEXTURE_RENDER_ATTACHMENT) === 0) {
      throw new Error("beginRenderPass: the color attachment's texture lacks RENDER_ATTACHMENT");
    }
    const depth = descriptor.depthStencilAttachment;
    if (depth !== undefined) {
      const depthTexture = depth.view.texture;
      if ((depthTexture.usage & USAGE_TEXTURE_RENDER_ATTACHMENT) === 0) {
        throw new Error("beginRenderPass: the depth attachment's texture lacks RENDER_ATTACHMENT");
      }
      if (!depth.view.format.startsWith("depth")) throw new Error("beginRenderPass: the depth attachment has a non-depth format");
      if (depthTexture.width !== colorTexture.width || depthTexture.height !== colorTexture.height) {
        throw new Error("beginRenderPass: attachments must have the same size");
      }
    }
    this.passOpen = true;
    const pass = new FakeRenderPassEncoder(color.view.format, depth?.view.format, this.device.limits["minUniformBufferOffsetAlignment"] ?? 256);
    const clear = color.clearValue ?? { r: 0, g: 0, b: 0, a: 0 };
    this.commands.push(() => {
      if (colorTexture.destroyed || (depth !== undefined && depth.view.texture.destroyed)) {
        this.device.raiseValidation("render pass uses a destroyed texture");
        return;
      }
      const srgb = color.view.format.endsWith("-srgb");
      const bytes = [clear.r, clear.g, clear.b].map((c) => (srgb ? encodeSrgbByte(c) : Math.round(Math.min(Math.max(c, 0), 1) * 255)));
      bytes.push(Math.round(Math.min(Math.max(clear.a, 0), 1) * 255));
      const pixels = colorTexture.pixels;
      for (let i = 0; i < pixels.length; i += 4) pixels.set(bytes, i);
      this.device.renderPasses.push({
        targetWidth: colorTexture.width,
        targetHeight: colorTexture.height,
        viewFormat: color.view.format,
        clearValue: clear,
        depthWidth: depth?.view.texture.width ?? 0,
        depthHeight: depth?.view.texture.height ?? 0,
        draws: [...pass.draws],
      });
    });
    const end = pass.end.bind(pass);
    pass.end = () => {
      end();
      this.passOpen = false;
    };
    return pass;
  }

  copyTextureToBuffer(
    source: { readonly texture: FakeTexture },
    destination: { readonly buffer: FakeBuffer; readonly bytesPerRow: number },
    copySize: readonly [number, number],
  ): void {
    this.ensureRecording("copyTextureToBuffer");
    const [width, height] = copySize;
    const { texture } = source;
    const { buffer, bytesPerRow } = destination;
    if ((texture.usage & USAGE_TEXTURE_COPY_SRC) === 0) throw new Error("copyTextureToBuffer: the texture lacks COPY_SRC");
    if ((buffer.usage & USAGE_BUFFER_COPY_DST) === 0) throw new Error("copyTextureToBuffer: the buffer lacks COPY_DST");
    if (width > texture.width || height > texture.height) throw new Error("copyTextureToBuffer: the copy exceeds the texture");
    if (height > 1 && bytesPerRow % 256 !== 0) throw new Error("copyTextureToBuffer: bytesPerRow must be a multiple of 256");
    if (bytesPerRow < width * 4) throw new Error("copyTextureToBuffer: bytesPerRow is smaller than one row");
    if (bytesPerRow * (height - 1) + width * 4 > buffer.size) throw new Error("copyTextureToBuffer: the buffer is too small");
    this.commands.push(() => {
      if (texture.destroyed || buffer.destroyed) {
        this.device.raiseValidation("copyTextureToBuffer uses a destroyed resource");
        return;
      }
      for (let row = 0; row < height; row += 1) {
        buffer.contents.set(texture.pixels.subarray(row * texture.width * 4, row * texture.width * 4 + width * 4), row * bytesPerRow);
      }
    });
  }

  finish(): FakeCommandBuffer {
    this.ensureRecording("finish");
    this.finished = true;
    return new FakeCommandBufferImpl(this.commands);
  }
}

export interface FakeHostHooks {
  /** The fake shader compiler. Default: {@link defaultShaderMessages}. */
  readonly shaderMessages?: (code: string) => readonly FakeCompilationMessage[];
  /** A message makes render pipeline creation fail (async creation rejects with a `GPUPipelineError`). */
  readonly pipelineError?: (descriptor: FakePipelineDescriptor) => string | undefined;
}

export class FakeHostDevice extends FakeDevice {
  readonly features = new Set<string>();
  readonly renderPasses: FakeRenderPassRecord[] = [];
  readonly shaderModules: FakeShaderModule[] = [];
  destroyed = false;

  constructor(
    limits: Record<string, number> = {},
    private readonly hooks: FakeHostHooks = {},
  ) {
    super(limits);
  }

  /** Raises a validation error: captured by an open `validation` scope, else uncaptured. */
  raiseValidation(message: string): void {
    this.raise("validation", message);
  }

  /** `GPUDevice.destroy`: `lost` resolves with reason `destroyed`. Resources are not auto-destroyed here, so tests can check that the runtime released each one itself. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.push("device.destroy");
    this.loseDevice("destroyed", "device destroyed");
  }

  createCommandEncoder(): FakeCommandEncoder {
    return new FakeCommandEncoder(this);
  }

  /** Checks the parts of a pipeline descriptor the runtime relies on; returns the problem or undefined. */
  private pipelineProblem(descriptor: FakePipelineDescriptor): string | undefined {
    const layout = descriptor.layout;
    if (!(layout instanceof FakeResource) || layout.kind !== "pipelineLayout") return "the layout is not a pipeline layout";
    if (typeof descriptor.vertex.entryPoint !== "string" || !(descriptor.vertex.module instanceof FakeShaderModule)) {
      return "the vertex stage has no module or entry point";
    }
    if (descriptor.fragment?.targets.length !== 1) return "exactly one colour target is required";
    if (descriptor.depthStencil?.format.startsWith("depth") !== true) return "the depth format is not a depth format";
    return this.hooks.pipelineError?.(descriptor);
  }

  override createRenderPipeline(descriptor: FakePipelineDescriptor): FakeResource {
    const problem = this.pipelineProblem(descriptor);
    if (problem !== undefined) this.raiseValidation(`createRenderPipeline: ${problem}`);
    return new FakeResource("renderPipeline", descriptor);
  }

  override createRenderPipelineAsync(descriptor: FakePipelineDescriptor): Promise<FakeResource> {
    const problem = this.pipelineProblem(descriptor);
    if (problem !== undefined) {
      const error = new Error(`createRenderPipelineAsync: ${problem}`);
      error.name = "GPUPipelineError";
      return Promise.reject(error);
    }
    return Promise.resolve(new FakeResource("renderPipeline", descriptor));
  }

  override createShaderModule(descriptor: { readonly code: string }): FakeShaderModule {
    const messages = (this.hooks.shaderMessages ?? defaultShaderMessages)(descriptor.code);
    const module = new FakeShaderModule(descriptor, messages);
    for (const message of messages) {
      if (message.type === "error") this.raiseValidation(`shader error: ${message.message}`);
    }
    this.shaderModules.push(module);
    return module;
  }
}

export interface FakeHostAdapterOptions extends FakeAdapterOptions, FakeHostHooks {
  /** The first `failAllocations` buffer/texture creations of every device fail with out-of-memory. */
  readonly failAllocations?: number;
}

export class FakeHostAdapter extends FakeAdapter {
  /** The devices of this adapter, typed as host devices (same objects as `devices`). */
  readonly hostDevices: FakeHostDevice[] = [];

  constructor(private readonly hostOptions: FakeHostAdapterOptions = {}) {
    super(hostOptions);
  }

  override requestDevice(
    descriptor: { requiredFeatures?: string[]; requiredLimits?: Record<string, number> } = {},
  ): Promise<FakeHostDevice> {
    this.deviceRequests.push(descriptor);
    if (this.hostOptions.requestDeviceError !== undefined) return Promise.reject(this.hostOptions.requestDeviceError);
    const device = new FakeHostDevice(descriptor.requiredLimits ?? {}, this.hostOptions);
    for (const feature of descriptor.requiredFeatures ?? []) device.features.add(feature);
    if (this.hostOptions.failAllocations !== undefined) device.failNextAllocations(this.hostOptions.failAllocations);
    this.devices.push(device);
    this.hostDevices.push(device);
    return Promise.resolve(device);
  }
}

export interface FakeHostGpuOptions {
  readonly preferredFormat?: string;
  readonly wgslLanguageFeatures?: readonly string[];
}

export class FakeHostGpu extends FakeGpu {
  readonly wgslLanguageFeatures: Set<string>;
  private readonly preferredFormat: string;

  constructor(adapter: FakeAdapter | null, options: FakeHostGpuOptions = {}) {
    super(adapter);
    this.preferredFormat = options.preferredFormat ?? "bgra8unorm";
    this.wgslLanguageFeatures = new Set(options.wgslLanguageFeatures ?? []);
  }

  getPreferredCanvasFormat(): string {
    return this.preferredFormat;
  }
}

export interface FakeCanvasConfiguration {
  readonly device: FakeHostDevice;
  readonly format: string;
  readonly viewFormats: readonly string[];
  readonly alphaMode: string;
}

export class FakeCanvasContext {
  configuration: FakeCanvasConfiguration | null = null;
  configureCalls = 0;
  unconfigureCalls = 0;
  currentTextureCalls = 0;

  constructor(private readonly canvas: FakeCanvas) {}

  configure(configuration: { device: unknown; format: string; viewFormats?: readonly string[]; alphaMode?: string }): void {
    if (!(configuration.device instanceof FakeHostDevice)) throw new TypeError("configure: device is not a GPUDevice");
    if (configuration.format !== "bgra8unorm" && configuration.format !== "rgba8unorm" && configuration.format !== "rgba16float") {
      throw new TypeError(`configure: unsupported canvas format ${configuration.format}`);
    }
    const viewFormats = configuration.viewFormats ?? [];
    for (const view of viewFormats) {
      if (view.replace(/-srgb$/, "") !== configuration.format.replace(/-srgb$/, "")) {
        throw new TypeError(`configure: view format ${view} is not compatible with ${configuration.format}`);
      }
    }
    this.configureCalls += 1;
    this.configuration = { device: configuration.device, format: configuration.format, viewFormats, alphaMode: configuration.alphaMode ?? "opaque" };
  }

  unconfigure(): void {
    this.unconfigureCalls += 1;
    this.configuration = null;
  }

  getCurrentTexture(): FakeTexture {
    if (this.configuration === null) throw new Error("getCurrentTexture: InvalidStateError, the context is not configured");
    if (this.canvas.width === 0 || this.canvas.height === 0) throw new Error("getCurrentTexture: the canvas has zero size");
    this.currentTextureCalls += 1;
    return new FakeTexture({
      label: "canvas",
      size: [this.canvas.width, this.canvas.height],
      format: this.configuration.format,
      usage: USAGE_TEXTURE_RENDER_ATTACHMENT,
      viewFormats: this.configuration.viewFormats,
    });
  }
}

// ---------------------------------------------------------------- DOM

type Listener = EventListenerOrEventListenerObject;

interface ListenerEntry {
  readonly type: string;
  readonly listener: Listener;
  readonly capture: boolean;
}

export class FakeEventTarget {
  private readonly entries: ListenerEntry[] = [];
  /** Every add/remove call, in order: `add:type` / `remove:type` (only calls that changed something). */
  readonly listenerLog: string[] = [];

  addEventListener(type: string, listener: Listener, options?: AddEventListenerOptions | boolean): void {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    if (this.entries.some((e) => e.type === type && e.listener === listener && e.capture === capture)) return;
    this.entries.push({ type, listener, capture });
    this.listenerLog.push(`add:${type}`);
  }

  removeEventListener(type: string, listener: Listener, options?: EventListenerOptions | boolean): void {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    const index = this.entries.findIndex((e) => e.type === type && e.listener === listener && e.capture === capture);
    if (index >= 0) {
      this.entries.splice(index, 1);
      this.listenerLog.push(`remove:${type}`);
    }
  }

  get listenerCount(): number {
    return this.entries.length;
  }

  dispatch(type: string): void {
    for (const entry of [...this.entries]) {
      if (entry.type !== type) continue;
      const event = { type };
      if (typeof entry.listener === "function") entry.listener(event as Event);
      else entry.listener.handleEvent(event as Event);
    }
  }
}

export class FakeElement extends FakeEventTarget {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  clientWidth = 0;
  clientHeight = 0;
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  private ownText = "";

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {
    super();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }

  set textContent(value: string) {
    this.replaceChildren();
    this.ownText = value;
  }

  get nextSibling(): FakeElement | null {
    const siblings = this.parentElement?.children;
    if (siblings === undefined) return null;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.insertBefore(node, null);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of [...this.children]) child.remove();
    this.ownText = "";
    this.append(...nodes);
  }

  insertBefore(node: FakeElement, reference: FakeElement | null): FakeElement {
    node.remove();
    const index = reference === null ? this.children.length : this.children.indexOf(reference);
    if (index < 0) throw new Error("insertBefore: the reference node is not a child");
    this.children.splice(index, 0, node);
    node.parentElement = this;
    return node;
  }

  remove(): void {
    const parent = this.parentElement;
    if (parent === null) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }

  /** Depth-first search by attribute presence. */
  find(attribute: string): FakeElement | undefined {
    if (this.attributes.has(attribute)) return this;
    for (const child of this.children) {
      const found = child.find(attribute);
      if (found !== undefined) return found;
    }
    return undefined;
  }
}

export class FakeCanvas extends FakeElement {
  width = 300;
  height = 150;
  context: FakeCanvasContext | null = null;
  private contextType: string | null = null;

  constructor(ownerDocument: FakeDocument) {
    super("canvas", ownerDocument);
  }

  getContext(type: string): FakeCanvasContext | null {
    if (this.contextType !== null && this.contextType !== type) return null;
    if (type !== "webgpu") return null;
    this.contextType = type;
    this.context ??= new FakeCanvasContext(this);
    return this.context;
  }

  /** Models a canvas that already has another context type (e.g. a 2d context). */
  claimContext(type: string): void {
    this.contextType = type;
  }
}

export class FakeDocument extends FakeEventTarget {
  readonly body: FakeElement;
  visibilityState: DocumentVisibilityState = "visible";

  constructor() {
    super();
    this.body = new FakeElement("body", this);
  }

  createElement(tag: string): FakeElement {
    return tag === "canvas" ? new FakeCanvas(this) : new FakeElement(tag, this);
  }

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatch("visibilitychange");
  }
}

export class FakeResizeObserver {
  readonly targets = new Set<FakeElement>();
  disconnected = false;

  constructor(private readonly callback: () => void) {}

  observe(target: FakeElement): void {
    if (this.disconnected) return;
    this.targets.add(target);
  }

  disconnect(): void {
    this.disconnected = true;
    this.targets.clear();
  }

  /** Fires the callback if still observing, like a layout change would. */
  trigger(): void {
    if (this.targets.size > 0) this.callback();
  }
}

// ---------------------------------------------------------------- environment

/** A scripted file server: a string is a 200 response, a number an HTTP error status, an Error a network failure. */
export type FakeFile = string | number | Error;

export interface FakeHostOptions {
  readonly adapter?: FakeHostAdapterOptions | null;
  readonly gpu?: FakeHostGpuOptions;
  readonly files?: Record<string, FakeFile>;
  readonly littleEndian?: boolean;
  readonly devicePixelRatio?: number;
  /** Simulates a browser without `navigator.gpu`. */
  readonly noGpu?: boolean;
  /** `false` simulates a browser without `ResizeObserver`. */
  readonly resizeObserver?: boolean;
}

export class FakeHost {
  readonly document = new FakeDocument();
  readonly canvas: FakeCanvas;
  readonly adapter: FakeHostAdapter | null;
  readonly gpu: FakeHostGpu;
  readonly files = new Map<string, FakeFile>();
  readonly fetched: string[] = [];
  readonly resizeObservers: FakeResizeObserver[] = [];
  devicePixelRatio: number;
  nowMs = 0;
  private nextFrame = 1;
  private readonly frames = new Map<number, (nowMs: number) => void>();
  readonly environment: HostEnvironment;

  constructor(options: FakeHostOptions = {}) {
    this.canvas = new FakeCanvas(this.document);
    this.canvas.clientWidth = 200;
    this.canvas.clientHeight = 100;
    this.adapter = options.adapter === null ? null : new FakeHostAdapter(options.adapter ?? {});
    this.gpu = new FakeHostGpu(this.adapter, options.gpu);
    this.devicePixelRatio = options.devicePixelRatio ?? 1;
    for (const [url, file] of Object.entries(options.files ?? {})) this.files.set(url, file);
    const observers = this.resizeObservers;
    const observerFactory =
      options.resizeObserver === false
        ? undefined
        : class extends FakeResizeObserver {
            constructor(callback: () => void) {
              super(callback);
              observers.push(this);
            }
          };
    this.environment = {
      gpu: options.noGpu === true ? null : asDom<GPU>(this.gpu),
      ...(options.littleEndian === undefined ? {} : { littleEndian: options.littleEndian }),
      fetch: (url) => this.fetch(url),
      document: asDom<DocumentLike>(this.document),
      ResizeObserver: observerFactory === undefined ? undefined : asDom<new (callback: () => void) => ResizeObserverLike>(observerFactory),
      requestAnimationFrame: (callback) => {
        const id = this.nextFrame++;
        this.frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (handle) => {
        this.frames.delete(handle);
      },
      devicePixelRatio: () => this.devicePixelRatio,
      // Advances a little on every read so frame timing counters are non-zero and deterministic.
      now: () => (this.nowMs += 0.25),
    };
  }

  /** The first device the runtime created. */
  get device(): FakeHostDevice {
    const device = this.adapter?.devices[0];
    if (!(device instanceof FakeHostDevice)) throw new Error("no device was created");
    return device;
  }

  get context(): FakeCanvasContext {
    if (this.canvas.context === null) throw new Error("the canvas has no WebGPU context");
    return this.canvas.context;
  }

  get pendingFrames(): number {
    return this.frames.size;
  }

  /** Fires every pending animation-frame callback once, like a browser tick at `nowMs`. */
  tickFrames(nowMs: number): void {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(nowMs);
  }

  private fetch(url: string): Promise<FetchResponseLike> {
    this.fetched.push(url);
    const file = this.files.get(url);
    if (file instanceof Error) return Promise.reject(file);
    if (file === undefined || typeof file === "number") {
      const status = file ?? 404;
      return Promise.resolve({ ok: false, status, text: () => Promise.resolve("") });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(file) });
  }
}

// ---------------------------------------------------------------- manifests

const manifestFiles = import.meta.glob<string>("../../../../tests/abi/manifests/valid/minimal.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** The shared minimal valid manifest, as a fresh mutable object (so a test can change one field). */
export function minimalManifestJson(): Record<string, unknown> {
  const text = Object.values(manifestFiles)[0];
  if (text === undefined) throw new Error("tests/abi/manifests/valid/minimal.json is missing");
  return JSON.parse(text) as Record<string, unknown>;
}

export const BASE_URL = "https://example.test/app/";
export const MANIFEST_URL = `${BASE_URL}program.manifest.json`;

/** A program module as `app.js` would export it (only the members M1 reads are meaningful). */
export function fakeProgram(): {
  readonly abi: 1;
  readonly baseUrl: URL;
  readonly manifestUrl: URL;
  readonly writers: Record<string, never>;
  readonly functions: Record<string, never>;
  readonly scenes: Record<string, never>;
  readonly prefabs: Record<string, never>;
} {
  return {
    abi: 1,
    baseUrl: new URL(BASE_URL),
    manifestUrl: new URL(MANIFEST_URL),
    writers: {},
    functions: {},
    scenes: {},
    prefabs: {},
  };
}
