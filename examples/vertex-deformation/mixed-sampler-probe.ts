import { SAMPLER_PRESETS } from "../../packages/runtime-web/src/render/resources.js";

/** Compare imported sampler descriptors to explicit WebGPU settings at three image scales. */
export async function runMixedSamplerProbe() {
  const adapter = await navigator.gpu.requestAdapter(); if (adapter === null) throw new Error("No adapter");
  const device = await adapter.requestDevice(), owned: { destroy(): void }[] = [];
  device.pushErrorScope("validation");
  try {
    const module = device.createShaderModule({ code: `
struct V { @builtin(position) p:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i];
  return V(vec4f(p,0,1), (p*0.5+0.5)*1.7-0.25);
}
@group(0) @binding(0) var tex:texture_2d<f32>;
@group(0) @binding(1) var smp:sampler;
@fragment fn fs(v:V)->@location(0) vec4f { return textureSample(tex,smp,v.uv); }
` });
    const pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] } });
    const source = device.createTexture({ size: [4, 4], format: "rgba8unorm", mipLevelCount: 3, usage: 6 }); owned.push(source);
    for (let level = 0; level < 3; level++) {
      const size = 4 >> level, bytes = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) bytes.set([(x + y) % 2 * 255, x * 73 + level * 27, y * 61 + level * 35, 255], (y * size + x) * 4);
      device.queue.writeTexture({ texture: source, mipLevel: level }, bytes, { bytesPerRow: size * 4 }, [size, size]);
    }
    const shot = async (descriptor: GPUSamplerDescriptor, size: number): Promise<Uint8Array> => {
      const texture = device.createTexture({ size: [size, size], format: "rgba8unorm", usage: 17 });
      const buffer = device.createBuffer({ size: 256 * size, usage: 9 });
      try {
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: source.createView() }, { binding: 1, resource: device.createSampler(descriptor) }] });
        const encoder = device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end(); encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, [size, size]); device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(1); const mapped = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) pixels.set(mapped.subarray(y * 256, y * 256 + size * 4), y * size * 4);
        buffer.unmap(); return pixels;
      } finally { buffer.destroy(); texture.destroy(); }
    };
    const cases: object[] = [], sensitivity: object[] = [];
    for (const mag of ["linear", "nearest"] as const) for (const wrap of ["repeat", "clamp"] as const) for (const mip of ["level0", "mip_nearest", "mip_linear"] as const) for (const size of [2, 3, 17]) {
      const min = mag === "linear" ? "nearest" : "linear", addressModeU = wrap === "repeat" ? "repeat" : "clamp-to-edge";
      const name = `sampler.mag_${mag}_min_${min}_${wrap}_${mip}`;
      const expected: GPUSamplerDescriptor = { magFilter: mag, minFilter: min, mipmapFilter: mip === "mip_linear" ? "linear" : "nearest", addressModeU, addressModeV: addressModeU, ...(mip === "level0" ? { lodMaxClamp: 0 } : {}) };
      const actualPixels = await shot(SAMPLER_PRESETS[name]!, size), expectedPixels = await shot(expected, size);
      let maxError = 0; for (let i = 0; i < actualPixels.length; i++) maxError = Math.max(maxError, Math.abs(actualPixels[i]! - expectedPixels[i]!));
      cases.push({ name, size, maxError }); if (maxError !== 0) throw new Error(`Imported sampler ${name} differs from explicit WebGPU settings`);
      if (wrap === "repeat" && ((mip === "level0" && size === 17) || (mip === "mip_nearest" && size === 3))) {
        const magnifying = size === 17, wrong = await shot({ ...expected, ...(magnifying ? { magFilter: min } : { minFilter: mag }) }, size);
        let changedPixels = 0; for (let i = 0; i < wrong.length; i += 4) if (wrong.subarray(i, i + 4).some((v, c) => Math.abs(v - actualPixels[i + c]!) > 2)) changedPixels++;
        sensitivity.push({ name, size, filter: magnifying ? "magnification" : "minification", changedPixels });
        if (changedPixels === 0) throw new Error(`Sampler probe did not exercise ${magnifying ? "mag" : "min"} filtering`);
      }
    }
    const validation = await device.popErrorScope(); if (validation !== null) throw new Error(validation.message);
    return { cases, sensitivity, validation: null, deviceDestroyedAfterProbe: true };
  } finally { for (const resource of owned) resource.destroy(); device.destroy(); }
}
