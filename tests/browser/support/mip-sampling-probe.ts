import { ResourceRegistry } from "../../../packages/runtime-web/src/gpu/registry.js";
import { MipmapGenerator, mipLevelCount } from "../../../packages/runtime-web/src/render/mipmaps.js";
import { SAMPLER_PRESETS } from "../../../packages/runtime-web/src/render/resources.js";

// Unlike a mip readback alone, this proves that a minified draw selects the chain,
// while glTF's base-level-only sampler retains the original level-zero behavior.
export async function runMipSamplingProbe(): Promise<{ pixels: number[][]; error: string | null; live: number }> {
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error("No adapter");
  const device = await adapter.requestDevice(), registry = new ResourceRegistry(device);
  device.pushErrorScope("validation");
  try {
    const mips = new MipmapGenerator(device, registry);
    const module = registry.createShaderModule({ code: `
struct V { @builtin(position) p:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i];
  return V(vec4f(p,0,1), p*0.5+0.5);
}
@group(0) @binding(0) var tex:texture_2d<f32>;
@group(0) @binding(1) var smp:sampler;
@fragment fn fs(v:V)->@location(0) vec4f { return textureSample(tex,smp,v.uv); }
` });
    const layout = registry.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, texture: {} }, { binding: 1, visibility: 2, sampler: {} },
    ] });
    const pipelineLayout = registry.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipeline = registry.createRenderPipeline({ layout: pipelineLayout,
      vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] } });
    const pixels: number[][] = [];
    const data = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = (x + y) % 2 * 255; data.set([v, v, v, 255], (y * 64 + x) * 4);
    }
    for (const format of ["rgba8unorm", "rgba8unorm-srgb"] as const) {
      const source = registry.createTexture({ size: [64, 64], format, mipLevelCount: mipLevelCount(64, 64), usage: 0x16 });
      registry.writeTexture(device.queue, source, data, 256, 64, 64);
      mips.generate(source, format, 64, 64);
      for (const preset of ["sampler.nearest_repeat_level0", "sampler.nearest_repeat"]) {
        const sampler = registry.createSampler(SAMPLER_PRESETS[preset]);
        const group = registry.createBindGroup({ layout, entries: [{ binding: 0, resource: source.createView() }, { binding: 1, resource: sampler }] });
        const output = registry.createTexture({ size: [1, 1], format: "rgba8unorm", usage: 0x11 });
        const buffer = device.createBuffer({ size: 256, usage: 9 }), encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
        encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: 256 }, [1, 1]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(1);
        pixels.push(Array.from(new Uint8Array(buffer.getMappedRange()).slice(0, 4)));
        buffer.unmap(); buffer.destroy();
        registry.release(output); registry.release(group); registry.release(sampler);
      }
      registry.release(source);
    }
    mips.dispose();
    registry.destroyAll();
    const c = registry.snapshot();
    return { pixels, error: (await device.popErrorScope())?.message ?? null,
      live: c.liveTextures + c.liveBuffers + c.liveSamplers + c.livePipelines + c.liveBindGroups + c.liveShaderModules };
  } finally { registry.destroyAll(); device.destroy(); }
}
