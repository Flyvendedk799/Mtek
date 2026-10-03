// The bridge page (M0-08, disposable test glue): runs the shaders and writers the `bridge_spike`
// generator produced (`/bridge/<fixture>.*`) on the production runtime modules (device
// acquisition, resource registry, uniform arena) and exposes the probes the specs drive as
// `window.__bridge`. Nothing here is public API: values are written only through the generated
// writers, uploaded only through the arena, and every GPU object is created through the registry
// so its counters describe exactly what happened.
import { acquireDevice, type AcquiredDevice } from "../../../packages/runtime-web/src/gpu/device.ts";
import { ResourceRegistry } from "../../../packages/runtime-web/src/gpu/registry.ts";
import {
  UniformArena,
  roundUp,
  type ArenaViews,
} from "../../../packages/runtime-web/src/gpu/uniform-arena.ts";
import type { ArenaInfo, BridgeApi, ColorResult, ProbeResult } from "../support/bridge-api.ts";
import {
  type LayoutNode,
  type LayoutRecord,
  parseLayoutRecord,
  parseProbeManifest,
} from "../support/bridge-layout.ts";
import type { CpuValue, JsonValue } from "../support/bridge-values.ts";

/** `copyTextureToBuffer` requires `bytesPerRow` to be a multiple of 256. */
const BYTES_PER_ROW_ALIGNMENT = 256;
/** The probe target format and its bytes per pixel (four `u32`). */
const PROBE_FORMAT: GPUTextureFormat = "rgba32uint";
const PROBE_BYTES_PER_PIXEL = 16;
/** The colour target: sRGB-encoded 8-bit RGBA. */
const COLOR_FORMAT: GPUTextureFormat = "rgba8unorm-srgb";
const COLOR_BYTES_PER_PIXEL = 4;
const COLOR_SIZE = 16;
const COLOR_FIXTURE = "mixed";

type Writer = (views: ArenaViews, base: number, value: CpuValue) => void;

interface Context {
  readonly acquired: AcquiredDevice;
  readonly registry: ResourceRegistry;
  readonly errors: string[];
}

/** A block's arena, writer and the pipeline of one of its shaders. */
interface Block {
  readonly record: LayoutRecord;
  readonly writer: Writer;
  readonly arena: UniformArena;
  readonly paramsLayout: GPUBindGroupLayout;
  readonly emptyGroup: GPUBindGroup;
  readonly pipeline: GPURenderPipeline;
}

/** A render target and the buffer it is read back through. */
interface Target {
  readonly texture: GPUTexture;
  readonly readback: GPUBuffer;
  readonly bytesPerRow: number;
  readonly bytesPerPixel: number;
  readonly width: number;
  readonly height: number;
}

interface ProbeSession {
  readonly block: Block;
  readonly target: Target;
  readonly width: number;
  readonly slots: number[];
}

interface ColorSession {
  readonly block: Block;
  readonly target: Target;
  readonly slot: number;
}

let pendingContext: Promise<Context> | undefined;
let context: Context | undefined;
let disposed = false;
const probeSessions = new Map<string, ProbeSession>();
let colorSession: Promise<ColorSession> | undefined;

async function createContext(): Promise<Context> {
  const errors: string[] = [];
  const acquired = await acquireDevice({
    requiredFeatures: [],
    requiredLimits: {},
    onUncapturedError: (event) => errors.push(`uncaptured GPU error: ${event.error.message}`),
    onDeviceLost: (info) => {
      if (!disposed) errors.push(`device lost (${info.reason}): ${info.message}`);
    },
  });
  const registry = new ResourceRegistry(acquired.device, {
    onAllocationFailure: (diagnostic) => errors.push(`allocation failure: ${diagnostic.message}`),
  });
  context = { acquired, registry, errors };
  return context;
}

function ensureContext(): Promise<Context> {
  disposed = false;
  pendingContext ??= createContext();
  return pendingContext;
}

function currentContext(): Context {
  if (context === undefined) throw new Error("the bridge has not run anything yet");
  return context;
}

async function fetchText(file: string): Promise<string> {
  const response = await fetch(`/bridge/${file}`);
  if (!response.ok) throw new Error(`GET /bridge/${file}: HTTP ${response.status}`);
  return response.text();
}

/** The whole-block writer of `id` from the generated `<fixture>.writers.js` module. */
async function loadWriter(fixture: string, id: string): Promise<Writer> {
  const url = `/bridge/${fixture}.writers.js`;
  const loaded: unknown = await import(url);
  const table = (loaded as { writers?: Record<string, { all?: unknown } | undefined> }).writers;
  const all = table?.[id]?.all;
  if (typeof all !== "function") throw new Error(`${url}: no writer table entry for \`${id}\``);
  return all as Writer;
}

/** Turns transported JSON back into the CPU representation: a `mat4` is a `Float32Array`. */
function reviveValue(node: LayoutNode, value: JsonValue): CpuValue {
  switch (node.kind) {
    case "matrix":
      if (!Array.isArray(value)) throw new Error("expected a number array for a matrix");
      return Float32Array.from(value as readonly number[]);
    case "struct": {
      const source = value as { readonly [name: string]: JsonValue };
      const struct: Record<string, CpuValue> = {};
      for (const member of node.members) {
        const entry = source[member.name];
        if (entry === undefined) throw new Error(`missing member \`${member.name}\``);
        struct[member.name] = reviveValue(member.node, entry);
      }
      return struct;
    }
    case "array":
      if (!Array.isArray(value)) throw new Error("expected an array");
      return (value as readonly JsonValue[]).map((entry) => reviveValue(node.element, entry));
    case "scalar":
    case "vector":
      return value;
  }
}

/** Runs `create` and reports a WebGPU validation error raised while it ran. */
async function withValidation<T>(device: GPUDevice, what: string, create: () => T): Promise<T> {
  device.pushErrorScope("validation");
  let result: T;
  try {
    result = create();
  } catch (error) {
    await device.popErrorScope();
    throw error;
  }
  const failure = await device.popErrorScope();
  if (failure !== null) throw new Error(`${what}: validation error: ${failure.message}`);
  return result;
}

async function buildBlock(
  ctx: Context,
  fixture: string,
  shaderFile: string,
  format: GPUTextureFormat,
): Promise<Block> {
  const { device } = ctx.acquired;
  const { registry } = ctx;
  const [layoutText, code] = await Promise.all([
    fetchText(`${fixture}.layout.json`),
    fetchText(shaderFile),
  ]);
  const record = parseLayoutRecord(layoutText);
  const writer = await loadWriter(fixture, record.id);

  const shader = registry.createShaderModule({ label: shaderFile, code });
  const compilation = await shader.getCompilationInfo();
  const problems = compilation.messages
    .filter((message) => message.type === "error")
    .map((message) => `${message.lineNum}:${message.linePos} ${message.message}`);
  if (problems.length > 0) throw new Error(`${shaderFile}: ${problems.join("; ")}`);

  const arena = new UniformArena(device, registry, { id: record.id, size: record.size });
  const { paramsLayout, emptyGroup, pipeline } = await withValidation(device, shaderFile, () => {
    const emptyLayout = registry.createBindGroupLayout({ label: "mtek:group0:empty", entries: [] });
    const paramsLayout = registry.createBindGroupLayout({
      label: `mtek:group1:${record.id}`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", hasDynamicOffset: false, minBindingSize: record.size },
        },
      ],
    });
    const layout = registry.createPipelineLayout({
      bindGroupLayouts: [emptyLayout, paramsLayout],
    });
    return {
      paramsLayout,
      emptyGroup: registry.createBindGroup({ label: "mtek:group0:empty", layout: emptyLayout, entries: [] }),
      pipeline: registry.createRenderPipeline({
        label: shaderFile,
        layout,
        vertex: { module: shader, entryPoint: "vs_main" },
        fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      }),
    };
  });
  return { record, writer, arena, paramsLayout, emptyGroup, pipeline };
}

function createTarget(
  ctx: Context,
  label: string,
  format: GPUTextureFormat,
  bytesPerPixel: number,
  width: number,
  height: number,
): Target {
  const bytesPerRow = roundUp(BYTES_PER_ROW_ALIGNMENT, width * bytesPerPixel);
  const texture = ctx.registry.createTexture({
    label,
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const readback = ctx.registry.createBuffer({
    label: `${label}:readback`,
    size: bytesPerRow * height,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  return { texture, readback, bytesPerRow, bytesPerPixel, width, height };
}

/** Writes `values` into `slot` through the generated writer; the arena marks the slot dirty if the bytes changed. */
function writeValues(block: Block, slot: number, values: JsonValue): boolean {
  const revived = reviveValue(block.record.root, values);
  return block.arena.writeIfChanged(slot, (views, base) => {
    block.writer(views, base, revived);
  });
}

/**
 * Uploads dirty slots, draws the block's shader once per slot into its own band of `rowHeight`
 * rows (top to bottom), copies the target to the readback buffer (`bytesPerRow` padded to 256),
 * maps it and returns the tightly packed bytes, row by row.
 */
async function drawAndReadBack(
  ctx: Context,
  block: Block,
  target: Target,
  slots: readonly number[],
  rowHeight: number,
): Promise<Uint8Array> {
  const { device } = ctx.acquired;
  block.arena.flush(device.queue);
  const rows = slots.length * rowHeight;
  await withValidation(device, block.record.id, () => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.texture.createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(block.pipeline);
    pass.setBindGroup(0, block.emptyGroup);
    slots.forEach((slot, index) => {
      const top = index * rowHeight;
      pass.setBindGroup(1, block.arena.bindGroupForSlot(slot, block.paramsLayout));
      pass.setViewport(0, top, target.width, rowHeight, 0, 1);
      pass.setScissorRect(0, top, target.width, rowHeight);
      pass.draw(3);
    });
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: target.texture },
      { buffer: target.readback, bytesPerRow: target.bytesPerRow },
      { width: target.width, height: rows },
    );
    device.queue.submit([encoder.finish()]);
  });

  await target.readback.mapAsync(GPUMapMode.READ);
  try {
    const mapped = new Uint8Array(target.readback.getMappedRange());
    const rowBytes = target.width * target.bytesPerPixel;
    const packed = new Uint8Array(rowBytes * rows);
    for (let row = 0; row < rows; row++) {
      packed.set(mapped.subarray(row * target.bytesPerRow, row * target.bytesPerRow + rowBytes), row * rowBytes);
    }
    return packed;
  } finally {
    target.readback.unmap();
  }
}

function arenaInfo(arena: UniformArena): ArenaInfo {
  return {
    id: arena.id,
    slotStride: arena.slotStride,
    capacity: arena.capacity,
    liveSlots: arena.liveSlots,
  };
}

async function probeRows(ctx: Context, session: ProbeSession, changed: boolean): Promise<ProbeResult> {
  const bytes = await drawAndReadBack(ctx, session.block, session.target, session.slots, 1);
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const wordsPerRow = session.width * 4;
  const rows = session.slots.map((_, index) =>
    Array.from(words.subarray(index * wordsPerRow, (index + 1) * wordsPerRow)),
  );
  return {
    slots: [...session.slots],
    width: session.width,
    rows,
    arena: arenaInfo(session.block.arena),
    changed,
  };
}

function releaseBlock(ctx: Context, block: Block): void {
  block.arena.dispose();
  ctx.registry.release(block.pipeline);
  ctx.registry.release(block.emptyGroup);
}

function releaseTarget(ctx: Context, target: Target): void {
  ctx.registry.release(target.texture);
  ctx.registry.release(target.readback);
}

async function runProbe(fixture: string, valuesA: JsonValue, valuesB?: JsonValue): Promise<ProbeResult> {
  const ctx = await ensureContext();
  const previous = probeSessions.get(fixture);
  if (previous !== undefined) {
    probeSessions.delete(fixture);
    releaseBlock(ctx, previous.block);
    releaseTarget(ctx, previous.target);
  }

  const block = await buildBlock(ctx, fixture, `${fixture}.probe.wgsl`, PROBE_FORMAT);
  const manifest = parseProbeManifest(await fetchText(`${fixture}.probe.json`));
  if (manifest.id !== block.record.id) {
    throw new Error(`${fixture}: probe.json describes \`${manifest.id}\`, not \`${block.record.id}\``);
  }
  const instances = valuesB === undefined ? [valuesA] : [valuesA, valuesB];
  const target = createTarget(ctx, `${fixture}:probe`, PROBE_FORMAT, PROBE_BYTES_PER_PIXEL, manifest.width, instances.length);
  const slots = instances.map((values) => {
    const slot = block.arena.allocate();
    writeValues(block, slot, values);
    return slot;
  });
  const session: ProbeSession = { block, target, width: manifest.width, slots };
  probeSessions.set(fixture, session);
  return probeRows(ctx, session, true);
}

async function updateAndRerun(fixture: string, slot: number, values: JsonValue): Promise<ProbeResult> {
  const ctx = currentContext();
  const session = probeSessions.get(fixture);
  if (session === undefined) throw new Error(`updateAndRerun: no probe session for \`${fixture}\``);
  if (!session.slots.includes(slot)) throw new Error(`updateAndRerun: slot ${slot} is not part of \`${fixture}\``);
  const changed = writeValues(session.block, slot, values);
  return probeRows(ctx, session, changed);
}

function startColorSession(ctx: Context): Promise<ColorSession> {
  colorSession ??= (async (): Promise<ColorSession> => {
    const block = await buildBlock(ctx, COLOR_FIXTURE, `${COLOR_FIXTURE}.color.wgsl`, COLOR_FORMAT);
    const target = createTarget(ctx, `${COLOR_FIXTURE}:color`, COLOR_FORMAT, COLOR_BYTES_PER_PIXEL, COLOR_SIZE, COLOR_SIZE);
    return { block, target, slot: block.arena.allocate() };
  })();
  return colorSession;
}

async function renderColor(values: JsonValue): Promise<ColorResult> {
  const ctx = await ensureContext();
  const session = await startColorSession(ctx);
  writeValues(session.block, session.slot, values);
  const pixels = await drawAndReadBack(ctx, session.block, session.target, [session.slot], COLOR_SIZE);
  const at = ((COLOR_SIZE / 2) * COLOR_SIZE + COLOR_SIZE / 2) * COLOR_BYTES_PER_PIXEL;
  return {
    width: COLOR_SIZE,
    height: COLOR_SIZE,
    pixels: Array.from(pixels),
    centre: [pixels[at] ?? -1, pixels[at + 1] ?? -1, pixels[at + 2] ?? -1, pixels[at + 3] ?? -1],
  };
}

const api: BridgeApi = {
  runProbe,
  updateAndRerun,
  renderColor,
  counters: () => currentContext().registry.snapshot(),
  errors: () => (context === undefined ? [] : [...context.errors]),
  dispose: () => {
    disposed = true;
    context?.registry.destroyAll();
    context?.acquired.device.destroy();
    probeSessions.clear();
    colorSession = undefined;
    context = undefined;
    pendingContext = undefined;
  },
};

window.__bridge = api;
