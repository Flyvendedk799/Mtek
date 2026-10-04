// The numeric probe page (task M2-08): runs `/numeric/probe.wgsl` — the compiler's WGSL for the probe
// material plus the test-only harness of `support/numeric-probe.ts` — over the slot plan
// `/numeric/probe.json` and returns the `rgba32uint` target's words. Exposed as `window.__numeric`.
import { acquireDevice } from "../../../packages/runtime-web/src/gpu/device.ts";
import type { NumericProbeResult } from "../support/numeric-api.ts";
import type { ProbePlan } from "../support/numeric-probe.ts";

const FORMAT: GPUTextureFormat = "rgba32uint";
const BYTES_PER_PIXEL = 16;
const ROW_ALIGNMENT = 256;
/** The bind group of the harness's storage buffers (the material module uses groups 0 to 2). */
const PROBE_GROUP = 3;

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response.text();
}

function storageBuffer(device: GPUDevice, label: string, words: readonly number[]): GPUBuffer {
  const data = Uint32Array.from(words.length === 0 ? [0] : words);
  const buffer = device.createBuffer({
    label,
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

async function run(): Promise<NumericProbeResult> {
  const errors: string[] = [];
  const [code, planText] = await Promise.all([fetchText("/numeric/probe.wgsl"), fetchText("/numeric/probe.json")]);
  const plan = JSON.parse(planText) as ProbePlan;
  const { device } = await acquireDevice({
    requiredFeatures: [],
    requiredLimits: {},
    onUncapturedError: (event) => errors.push(`uncaptured GPU error: ${event.error.message}`),
  });
  try {
    device.pushErrorScope("validation");
    const module = device.createShaderModule({ label: "numeric probe", code });
    const info = await module.getCompilationInfo();
    const messages = info.messages.map((m) => `${m.type} ${m.lineNum}:${m.linePos} ${m.message}`);
    const compileErrors = info.messages.filter((m) => m.type === "error");
    if (compileErrors.length > 0) throw new Error(`probe.wgsl does not compile: ${messages.join("; ")}`);

    const pipeline = await device.createRenderPipelineAsync({
      label: "numeric probe",
      layout: "auto",
      vertex: { module, entryPoint: "probe_vs" },
      fragment: { module, entryPoint: "probe_fs", targets: [{ format: FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    const words = storageBuffer(device, "probe words", plan.words);
    const slots = storageBuffer(device, "probe slots", plan.slotTable);
    const groups: GPUBindGroup[] = [];
    for (let group = 0; group <= PROBE_GROUP; group++) {
      groups.push(device.createBindGroup({
        label: `probe group ${group}`,
        layout: pipeline.getBindGroupLayout(group),
        entries: group === PROBE_GROUP
          ? [{ binding: 0, resource: { buffer: words } }, { binding: 1, resource: { buffer: slots } }]
          : [],
      }));
    }
    const texture = device.createTexture({
      label: "probe target",
      size: { width: plan.width, height: plan.height },
      format: FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const bytesPerRow = Math.ceil((plan.width * BYTES_PER_PIXEL) / ROW_ALIGNMENT) * ROW_ALIGNMENT;
    const readback = device.createBuffer({
      label: "probe readback",
      size: bytesPerRow * plan.height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: texture.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(pipeline);
    groups.forEach((group, index) => pass.setBindGroup(index, group));
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, { width: plan.width, height: plan.height });
    device.queue.submit([encoder.finish()]);
    const validation = await device.popErrorScope();
    if (validation !== null) throw new Error(`validation error: ${validation.message}`);

    await readback.mapAsync(GPUMapMode.READ);
    const mapped = new Uint32Array(readback.getMappedRange());
    const wordsPerRow = bytesPerRow / 4;
    const out: number[] = [];
    for (let row = 0; row < plan.height; row++) {
      out.push(...mapped.subarray(row * wordsPerRow, row * wordsPerRow + plan.width * 4));
    }
    readback.unmap();
    return { words: out, compilationMessages: messages, errors };
  } finally {
    device.destroy();
  }
}

window.__numeric = { run };
