/** Real WebGPU acceptance probes. Imported by the lab page; nothing requests a
 * device until a probe is explicitly invoked. CPU references live separately. */
import type { MtekApp, MtekMountOptions, MtekMountProgram } from "../../../packages/runtime-web/src/host/types.js";
import type { MtekManifest } from "../../../packages/runtime-web/src/abi/manifest-types.js";
import { POSITION_DOMAINS, INVOCATION_DOMAIN, positionInput, positionReference, invocationReference, mismatchWords, pixelDifference, type Domain } from "../support/compute-reference.ts";
import { COMPOSITE_PARAMS, compositeCases, compositeReference, compositeMismatches, type CompositeCase } from "../support/compute-composite-reference.ts";

interface ProgramModule { default: MtekMountProgram; mountMtek(canvas: HTMLCanvasElement, program: MtekMountProgram, options: MtekMountOptions): Promise<MtekApp> }
interface NumericCase { name: string; domain: Domain; wordCount: number; strideWords?: number; definedWordOffsets?: readonly number[]; paddingComparison?: string; cpuMismatches: number; directMismatches: number; mtekBase64: string; cpuBase64: string; directBase64: string }
export interface NumericalReport { format: string; cases: NumericCase[]; diagnostics: string[]; directErrors: string[]; disposed: Readonly<Record<string, number>> }
export interface RenderReport {
  format: string; width: number; height: number; cpuDifferentPixels: number; directDifferentPixels: number; changedFromOriginal: number;
  recoveredDifferentPixels: number; disposedAttachmentDifferentPixels: number; oldHandleState: string; resetHandleState: string; resetAttachmentState: string; replacementAttachmentState: string;
  outputMismatches: number; cpuBase64: string; directBase64: string; mtekBase64: string; recoveredBase64: string;
  diagnostics: string[]; directErrors: string[]; disposed: Readonly<Record<string, number>>;
}
export interface ComputeAcceptanceApi { numerical(): Promise<NumericalReport>; render(): Promise<RenderReport> }

const base = new URL("./", import.meta.url);
async function text(path: string): Promise<string> { const response = await fetch(new URL(path, base)); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response.text(); }
async function program(): Promise<ProgramModule> { return await import(new URL("program/app.js", base).href) as ProgramModule; }
function encoded(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function mount(module: ProgramModule, diagnostics: string[]): Promise<MtekApp> {
  return module.mountMtek(document.querySelector<HTMLCanvasElement>("#mtek")!, module.default, {
    test: { manualClock: true, disableInstancing: true, renderTarget: { width: 128, height: 128 }, recovery: { delaysMs: [0, 0, 0] } },
    onDiagnostic: (diagnostic) => diagnostics.push(`${diagnostic.code}: ${diagnostic.message}`),
    extensions: [{ id: "acceptance-isolate-shape", apiVersion: 1, setup(context) {
      const twin = context.readTransforms().find((entity) => entity.name === "Twin");
      if (twin === undefined) throw new Error("compiler fixture has no Twin");
      context.writeTransforms([{ id: twin.id, position: { x: 100, y: 0, z: 0 } }]);
    } }],
  });
}
class ReferenceDevice {
  readonly resources: (GPUBuffer | GPUTexture)[] = [];
  readonly errors: string[] = [];
  private constructor(readonly device: GPUDevice) { device.addEventListener("uncapturederror", (event) => this.errors.push(event.error.message)); }
  static async create(): Promise<ReferenceDevice> {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (adapter === null) throw new Error("no adapter for independent WGSL reference");
    return new ReferenceDevice(await adapter.requestDevice());
  }
  own<T extends GPUBuffer | GPUTexture>(resource: T): T { this.resources.push(resource); return resource; }
  buffer(size: number, usage: GPUBufferUsageFlags, bytes?: ArrayBuffer): GPUBuffer {
    const buffer = this.own(this.device.createBuffer({ size, usage }));
    if (bytes !== undefined) this.device.queue.writeBuffer(buffer, 0, bytes);
    return buffer;
  }
  async checked<T>(operation: () => Promise<T>): Promise<T> {
    this.device.pushErrorScope("validation");
    const outcome = await operation().then((value) => ({ value }), (error: unknown) => ({ error }));
    const validation = await this.device.popErrorScope();
    if ("error" in outcome) throw outcome.error;
    if (validation !== null) throw new Error(`reference validation: ${validation.message}`);
    return outcome.value;
  }
  async module(file: string): Promise<GPUShaderModule> {
    const module = this.device.createShaderModule({ code: await text(`reference/${file}.wgsl`) });
    const errors = (await module.getCompilationInfo()).messages.filter((message) => message.type === "error");
    if (errors.length) throw new Error(errors.map((message) => `${file}:${message.lineNum}:${message.linePos}: ${message.message}`).join("\n"));
    return module;
  }
  async read(buffer: GPUBuffer, size: number): Promise<ArrayBuffer> {
    const staging = this.buffer(size, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
    this.device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
    try { return staging.getMappedRange().slice(0); } finally { staging.unmap(); }
  }
  async compute(kind: "positions" | "invocation", domain: Domain, input?: Float32Array, shift = 0): Promise<{ buffer: GPUBuffer; bytes: ArrayBuffer }> {
    return this.checked(async () => {
      const module = await this.module(kind), device = this.device;
      const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      const config = new ArrayBuffer(16); new Uint32Array(config).set(domain); new DataView(config).setFloat32(12, shift, true);
      const uniform = this.buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, config);
      const size = kind === "positions" ? 72 * 4 : 257 * 56;
      const output = this.buffer(size, GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC);
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: uniform } }];
      if (input !== undefined) entries.push({ binding: 1, resource: { buffer: this.buffer(input.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, input.slice().buffer) } });
      entries.push({ binding: kind === "positions" ? 2 : 1, resource: { buffer: output } });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group);
      const workgroup = kind === "positions" ? [64, 1, 1] : [4, 2, 2];
      pass.dispatchWorkgroups(Math.ceil(domain[0] / workgroup[0]!), Math.ceil(domain[1] / workgroup[1]!), Math.ceil(domain[2] / workgroup[2]!)); pass.end();
      device.queue.submit([encoder.finish()]); return { buffer: output, bytes: await this.read(output, size) };
    });
  }
  async image(positions: GPUBuffer, clear: readonly number[]): Promise<Uint8Array> {
    return this.checked(async () => {
      const device = this.device, module = await this.module("quad");
      const pipeline = await device.createRenderPipelineAsync({ layout: "auto", vertex: { module, entryPoint: "vs", buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }] },
        fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm-srgb" }] }, primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" }, depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" } });
      // Fixed source fixture camera: identity orientation, position (0,0,5),
      // fov_y=f32(0.9), near=f32(0.1), far=1000; independently assembled P*V.
      const values = new Float32Array(20), near = Math.fround(0.1), far = 1000;
      values[0] = values[5] = 1 / Math.tan(Math.fround(0.9) / 2); values[10] = far / (near - far); values[11] = -1;
      const projectionZ = Math.fround(near * far / (near - far)); values[14] = values[10] * -5 + projectionZ; values[15] = 5;
      const linear = (value: number): number => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      values.set([linear(107 / 255), linear(92 / 255), 1, 1], 16);
      const uniform = this.buffer(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, values.buffer);
      const indices = new Uint16Array([0, 1, 2, 0, 2, 3]), index = this.buffer(12, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, indices.buffer);
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
      const target = this.own(device.createTexture({ size: [128, 128], format: "rgba8unorm-srgb", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }));
      const depth = this.own(device.createTexture({ size: [128, 128], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT }));
      const staging = this.buffer(128 * 128 * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), clearValue: { r: clear[0]!, g: clear[1]!, b: clear[2]!, a: clear[3]! }, loadOp: "clear", storeOp: "store" }], depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } });
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.setVertexBuffer(0, positions); pass.setIndexBuffer(index, "uint16"); pass.drawIndexed(6); pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: staging, bytesPerRow: 512 }, [128, 128]); device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ); try { return new Uint8Array(staging.getMappedRange().slice(0)); } finally { staging.unmap(); }
    });
  }
  async composite(probe: CompositeCase, domain: Domain, enabled = false): Promise<ArrayBuffer> {
    return this.checked(async () => {
      const device = this.device, module = await this.module("composite");
      const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      const config = new ArrayBuffer(48), words = new Uint32Array(config), floats = new Float32Array(config);
      words.set(domain); words[3] = probe.kind; floats[4] = 1.5; words[5] = enabled ? 1 : 0;
      floats.set([-0.5, 0.25, 2, 3], 8);
      const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      const output = this.buffer(probe.input.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const buffers = [this.buffer(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, config),
        this.buffer(probe.input.byteLength, storage, probe.input),
        this.buffer(probe.scalar.byteLength, storage, probe.scalar.buffer),
        this.buffer(probe.small.byteLength, storage, probe.small.buffer), output];
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(domain[0] / 4), Math.ceil(domain[1] / 2), Math.ceil(domain[2] / 2)); pass.end();
      device.queue.submit([encoder.finish()]); return this.read(output, probe.input.byteLength);
    });
  }
  dispose(): void { for (const resource of this.resources) resource.destroy(); this.resources.length = 0; this.device.destroy(); }
}

async function numerical(): Promise<NumericalReport> {
  const diagnostics: string[] = [], module = await program(), app = await mount(module, diagnostics);
  const reference = await ReferenceDevice.create().catch((error: unknown) => { app.dispose(); throw error; });
  try {
    const cases: NumericCase[] = [], input = positionInput(), shift = 0.25;
    const handle = await app.createCompute("src/main.mtek::Positions", { shift });
    // A view with canaries exercises byteOffset handling on actual queue uploads.
    const padded = new Float32Array(76); padded.fill(999); padded.set(input, 2); handle.upload("source", padded.subarray(2, 74));
    for (const domain of POSITION_DOMAINS) {
      await handle.dispatch(domain); const actual = await handle.readback(), cpu = positionReference(input, shift, domain).buffer;
      const direct = await reference.compute("positions", domain, input, shift);
      cases.push({ name: "positions", domain, wordCount: 72, cpuMismatches: mismatchWords(actual, cpu), directMismatches: mismatchWords(actual, direct.bytes), mtekBase64: encoded(actual), cpuBase64: encoded(cpu), directBase64: encoded(direct.bytes) });
    }
    handle.dispose();
    const invocation = await app.createCompute("src/main.mtek::InvocationProbe"), layout = invocation.inspect().output;
    if (layout.stride !== 56 || layout.bytes !== 257 * 56) throw new Error("invocation output differs from the independent fixed 14-u32 struct contract");
    await invocation.dispatch(INVOCATION_DOMAIN); const actual = await invocation.readback(), cpu = invocationReference(INVOCATION_DOMAIN).buffer;
    const direct = await reference.compute("invocation", INVOCATION_DOMAIN);
    cases.push({ name: "all-14-invocation-fields", domain: INVOCATION_DOMAIN, wordCount: 257 * 14, cpuMismatches: mismatchWords(actual, cpu), directMismatches: mismatchWords(actual, direct.bytes), mtekBase64: encoded(actual), cpuBase64: encoded(cpu), directBase64: encoded(direct.bytes) });
    invocation.dispose();
    for (const probe of compositeCases()) {
      const composite = await app.createCompute(`src/main.mtek::${probe.name}`, probe.kind === 5 ? COMPOSITE_PARAMS : probe.kind === 6 ? { bias: 1.5 } : {});
      if (probe.kind === 5) {
        composite.upload("records", new Uint8Array(probe.input)); composite.upload("scalar", probe.scalar); composite.upload("small", probe.small);
        composite.upload("matrices", new Float32Array(17 * 16));
      } else if (probe.kind !== 6) composite.upload("source", new Uint8Array(probe.input));
      const domains: Domain[] = probe.kind === 5 ? [[17, 1, 1], [2, 2, 4], [3, 2, 2]] : [[17, 1, 1]];
      for (const domain of domains) {
        const enabled = probe.kind === 5 && domain[0] === 3;
        if (enabled) composite.setParam("enabled", true);
        await composite.dispatch(domain); const actual = await composite.readback(), cpu = compositeReference(probe, domain, enabled), direct = await reference.composite(probe, domain, enabled);
        cases.push({ name: probe.name, domain, wordCount: probe.input.byteLength / 4,
          strideWords: probe.strideWords, definedWordOffsets: probe.fields, paddingComparison: "Ignore active ABI padding; check every undispatched tail word for zero",
          cpuMismatches: compositeMismatches(actual, cpu, probe, domain), directMismatches: compositeMismatches(actual, direct, probe, domain),
          mtekBase64: encoded(actual), cpuBase64: encoded(cpu), directBase64: encoded(direct) });
      }
      composite.dispose();
    }
    app.dispose();
    return { format: "mtek-compute-numerical-acceptance/1", cases, diagnostics, directErrors: [...reference.errors], disposed: app.debug!.counters() };
  } finally { app.dispose(); reference.dispose(); }
}

async function waitForRecovery(app: MtekApp, diagnostics: readonly string[]): Promise<void> {
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    if (app.state === "running" && diagnostics.some((diagnostic) => diagnostic.startsWith("MTEK-W8061"))) return;
    if (app.state === "failed" || app.state === "disposed") throw new Error(`recovery ended ${app.state}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("compute recovery did not complete");
}
async function render(): Promise<RenderReport> {
  const diagnostics: string[] = [], module = await program(), app = await mount(module, diagnostics);
  const reference = await ReferenceDevice.create().catch((error: unknown) => { app.dispose(); throw error; });
  const shot = async (): Promise<Uint8Array> => { app.debug!.step(1, 1 / 60); return (await app.debug!.readPixels()).data; };
  try {
    const manifest = JSON.parse(await text("program/program.manifest.json")) as MtekManifest;
    const original = await shot(), input = positionInput(), shift = 0.25, cpu = positionReference(input, shift, [72, 1, 1]);
    const handle = await app.createCompute("src/main.mtek::Positions", { shift }); handle.upload("source", input); await handle.dispatch([72]);
    const attachment = handle.attachPositions("src/main.mtek::Demo.Shape", { center: [0, 0, 0], radius: 2 });
    const actual = await shot(), output = await handle.readback();
    const direct = await reference.compute("positions", [72, 1, 1], input, shift);
    const directImage = await reference.image(direct.buffer, manifest.scene.fields.clearColor);
    const cpuBuffer = reference.buffer(cpu.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, cpu.buffer);
    const cpuImage = await reference.image(cpuBuffer, manifest.scene.fields.clearColor);
    handle.setParam("shift", 0.5); // Recovery must replay 0.25, retaining 0.5 only as staged input.
    app.debug!.loseDevice(); await waitForRecovery(app, diagnostics); const recovered = await shot();
    attachment.dispose(); const detached = await shot();
    const nextAttachment = handle.attachPositions("src/main.mtek::Demo.Shape", { center: [0, 0, 0], radius: 2 });
    app.debug!.pressKey("KeyR"); app.debug!.step(1, 1 / 60);
    const deadline = performance.now() + 15000;
    while (nextAttachment.state !== "disposed" && performance.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 5)); app.debug!.step(1, 1 / 60); }
    const resetAttachmentState = nextAttachment.state, resetHandleState = handle.state;
    const replacementAttachment = handle.attachPositions("src/main.mtek::Demo.Shape", { center: [0, 0, 0], radius: 2 });
    if (app.replaceProgram === undefined) throw new Error("acceptance package must include development replacement support");
    const replacement = await app.replaceProgram(module.default); if (!replacement.ok) throw new Error(JSON.stringify(replacement.diagnostics));
    app.debug!.step(1, 1 / 60);
    const oldHandleState = handle.state, replacementAttachmentState = replacementAttachment.state;
    app.dispose();
    const preview = document.querySelector<HTMLCanvasElement>("#preview");
    preview?.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(actual), 128, 128), 0, 0);
    return { format: "mtek-compute-render-acceptance/1", width: 128, height: 128,
      cpuDifferentPixels: pixelDifference(actual, cpuImage), directDifferentPixels: pixelDifference(actual, directImage), changedFromOriginal: pixelDifference(actual, original),
      recoveredDifferentPixels: pixelDifference(actual, recovered), disposedAttachmentDifferentPixels: pixelDifference(original, detached),
      outputMismatches: mismatchWords(output, cpu.buffer), oldHandleState, resetHandleState, resetAttachmentState, replacementAttachmentState,
      cpuBase64: encoded(cpuImage), directBase64: encoded(directImage), mtekBase64: encoded(actual), recoveredBase64: encoded(recovered), diagnostics, directErrors: [...reference.errors], disposed: app.debug!.counters() };
  } finally { app.dispose(); reference.dispose(); }
}

const api: ComputeAcceptanceApi = { numerical, render };
(window as unknown as { __computeAcceptance: ComputeAcceptanceApi }).__computeAcceptance = api;
for (const [id, action] of [["numbers", numerical], ["render", render]] as const) document.getElementById(id)!.addEventListener("click", () => {
  const status = document.getElementById("status")!, buttons = [...document.querySelectorAll("button")];
  for (const button of buttons) button.disabled = true; status.textContent = "Running correctness probe…";
  void action().then((report) => { status.textContent = JSON.stringify(report, (key, value: unknown) => key.endsWith("Base64") ? "retained in downloadable/test report" : value, 2); })
    .catch((error: unknown) => { status.textContent = String(error); }).finally(() => { for (const button of buttons) button.disabled = false; });
});
