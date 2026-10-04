import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { ResourceRegistry } from "../gpu/registry.js";
import { resolveStructure, type ResolvedMaterial, type SceneStructure } from "../scene/structure.js";
import { asGpu, FakeResource } from "../test-support/fake-gpu.js";
import { FakeHostDevice, minimalManifestJson, type FakeHostHooks } from "../test-support/fake-host.js";
import { validManifest } from "../test-support/mount-fixture.js";
import {
  BindingPlan,
  PipelineCache,
  materialPipelineKey,
  pipelineDescriptor,
  pipelineKey,
  vertexBufferLayouts,
  type PipelineKeyParts,
} from "./pipelines.js";

const BASE: PipelineKeyParts = {
  shaderHash: "a".repeat(64),
  vertexAttributes: ["position"],
  colorFormat: "rgba8unorm-srgb",
  depthFormat: "depth24plus",
  cullMode: "back",
  topology: "triangle-list",
};

function setup(hooks: FakeHostHooks = {}, manifestJson: Record<string, unknown> = validManifest()): {
  device: FakeHostDevice;
  registry: ResourceRegistry;
  plan: BindingPlan;
  cache: PipelineCache;
  structure: SceneStructure;
  material: ResolvedMaterial;
  module: GPUShaderModule;
  manifest: MtekManifest;
} {
  const parsed = checkManifest(manifestJson);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
  const manifest = parsed.manifest;
  const resolved = resolveStructure(manifest);
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
  const structure = resolved.structure;
  const device = new FakeHostDevice({}, hooks);
  const registry = new ResourceRegistry(asGpu<GPUDevice>(device));
  const plan = new BindingPlan(registry, structure.frameLayout, structure.objectLayout);
  const cache = new PipelineCache(asGpu<GPUDevice>(device), registry, plan, manifest);
  const material = structure.materials[0];
  if (material === undefined) throw new Error("no material");
  const module = registry.createShaderModule({ code: "// ok" });
  return { device, registry, plan, cache, structure, material, module, manifest };
}

describe("pipelineKey", () => {
  it("is equal for equal parts, whatever object holds them", () => {
    expect(pipelineKey(BASE)).toBe(pipelineKey({ ...BASE, vertexAttributes: ["position"] }));
    expect(pipelineKey(BASE)).toBe(
      pipelineKey({ topology: "triangle-list", cullMode: "back", depthFormat: "depth24plus", colorFormat: "rgba8unorm-srgb", vertexAttributes: ["position"], shaderHash: "a".repeat(64) }),
    );
  });

  it.each<[string, Partial<PipelineKeyParts>]>([
    ["shader hash", { shaderHash: "b".repeat(64) }],
    ["vertex attribute set", { vertexAttributes: ["position", "normal"] }],
    ["vertex attribute set (uv)", { vertexAttributes: ["position", "uv"] }],
    ["colour format", { colorFormat: "bgra8unorm-srgb" }],
    ["depth format", { depthFormat: "depth32float" }],
    ["cull mode", { cullMode: "none" }],
    ["topology", { topology: "line-list" }],
  ])("differs when the %s differs", (_, change) => {
    expect(pipelineKey({ ...BASE, ...change })).not.toBe(pipelineKey(BASE));
  });

  it("cannot be confused by part boundaries", () => {
    expect(pipelineKey({ ...BASE, vertexAttributes: ["position", "normal"] })).not.toBe(pipelineKey({ ...BASE, vertexAttributes: ["position"], colorFormat: "normal" as GPUTextureFormat }));
  });

  it("of a material uses its shader, its attributes and the fixed depth format, cull mode and topology", () => {
    const { material } = setup();
    expect(materialPipelineKey(material, "rgba8unorm-srgb")).toBe(pipelineKey({ ...BASE, shaderHash: material.shader.hash }));
  });
});

describe("vertexBufferLayouts", () => {
  it("has one buffer per attribute in slot order with the fixed locations, formats and strides", () => {
    expect(vertexBufferLayouts(["position"])).toEqual([{ arrayStride: 12, stepMode: "vertex", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }]);
    expect(vertexBufferLayouts(["position", "normal", "uv"])).toEqual([
      { arrayStride: 12, stepMode: "vertex", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
      { arrayStride: 12, stepMode: "vertex", attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
      { arrayStride: 8, stepMode: "vertex", attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },
    ]);
    // uv without normal keeps uv at location 2, in slot 1.
    expect(vertexBufferLayouts(["position", "uv"])[1]?.attributes[0]?.shaderLocation).toBe(2);
  });
});

function entriesOf(layout: unknown): unknown {
  if (!(layout instanceof FakeResource)) throw new Error("not a fake layout");
  return (layout.descriptor as { entries: unknown }).entries;
}

describe("BindingPlan", () => {
  it("follows spec/gpu-layout.md section 6: frame, material (or empty), object with a dynamic offset", () => {
    const { plan, material } = setup();
    expect(entriesOf(plan.frame)).toEqual([{ binding: 0, visibility: 0x3, buffer: { type: "uniform", hasDynamicOffset: false, minBindingSize: 288 } }]);
    expect(entriesOf(plan.object)).toEqual([{ binding: 0, visibility: 0x1, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 128 } }]);
    expect(entriesOf(plan.material(material.layout))).toEqual([{ binding: 0, visibility: 0x2, buffer: { type: "uniform", hasDynamicOffset: false, minBindingSize: 16 } }]);
    expect(entriesOf(plan.material(null))).toEqual([]);
    // Shared: the same layout objects every time, so bind groups are valid for every pipeline.
    expect(plan.material(material.layout)).toBe(plan.material(material.layout));
    expect(plan.pipelineLayout(material.layout)).toBe(plan.pipelineLayout(material.layout));
    const layout = plan.pipelineLayout(null);
    expect((layout as unknown as FakeResource).descriptor).toMatchObject({ bindGroupLayouts: [plan.frame, plan.material(null), plan.object] });
    expect(plan.emptyMaterialGroup()).toBe(plan.emptyMaterialGroup());
  });
});

describe("PipelineCache", () => {
  it("builds the descriptor of the fixed vertex interface and opaque state", () => {
    const { plan, material, module } = setup();
    const descriptor = pipelineDescriptor(plan, { material, module, colorFormat: "bgra8unorm-srgb" });
    expect(descriptor).toMatchObject({
      layout: plan.pipelineLayout(material.layout),
      vertex: { module, entryPoint: "mtek_vs", buffers: vertexBufferLayouts(["position"]) },
      fragment: { module, entryPoint: "mtek_fs", targets: [{ format: "bgra8unorm-srgb" }] },
      primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
      depthStencil: { format: "depth24plus", depthCompare: "less", depthWriteEnabled: true },
    });
  });

  it("creates a pipeline once per key inside a validation error scope; a cache hit creates nothing", async () => {
    const { cache, registry, material, module, device } = setup();
    const first = await cache.obtain({ material, module, colorFormat: "rgba8unorm-srgb" });
    expect(first.ok).toBe(true);
    expect(device.events.filter((e) => e.startsWith("pushErrorScope:validation") || e === "popErrorScope")).toEqual(["pushErrorScope:validation", "popErrorScope"]);
    const again = await cache.obtain({ material, module, colorFormat: "rgba8unorm-srgb" });
    expect(again.ok && first.ok && again.pipeline === first.pipeline).toBe(true);
    expect(registry.snapshot()).toMatchObject({ pipelinesCreated: 1, livePipelines: 1 });
    expect(cache.size).toBe(1);
    // Another colour format is another key.
    await cache.obtain({ material, module, colorFormat: "bgra8unorm-srgb" });
    expect(registry.snapshot().pipelinesCreated).toBe(2);
    expect(device.openErrorScopes).toBe(0);
  });

  it("maps a failed creation to E8051 at the material declaration", async () => {
    const json = validManifest();
    const { cache, material, module, registry } = setup({ pipelineError: () => "entry point mtek_vs has an incompatible interface" }, json);
    const result = await cache.obtain({ material, module, colorFormat: "rgba8unorm-srgb" });
    if (result.ok) throw new Error("expected a failure");
    expect(result.diagnostic.code).toBe("MTEK-E8051");
    expect(result.diagnostic.message).toContain("std/materials.mtek::Unlit");
    expect(result.diagnostic.message).toContain("incompatible interface");
    // validManifest() adds the material symbol at span 3.
    expect(result.diagnostic.source).toMatchObject({ file: "src/main.mtek", startByte: 60 });
    expect(result.diagnostic.notes[0]).toContain("pipeline key");
    expect(registry.snapshot().livePipelines).toBe(0);
    expect(cache.size).toBe(0);
  });

  it("without a material symbol the diagnostic has no source", async () => {
    const { cache, material, module } = setup({ pipelineError: () => "bad" }, minimalManifestJson());
    const result = await cache.obtain({ material, module, colorFormat: "rgba8unorm-srgb" });
    expect(result.ok ? null : result.diagnostic.source).toBeNull();
  });
});
