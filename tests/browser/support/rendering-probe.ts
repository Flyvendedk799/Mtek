import { ResourceRegistry } from "../../../packages/runtime-web/src/gpu/registry.js";
import {
  MipmapGenerator,
  mipLevelCount,
} from "../../../packages/runtime-web/src/render/mipmaps.js";
import { PostProcessor } from "../../../packages/runtime-web/src/render/post-processing.js";

export async function runRenderingProbe(): Promise<{
  mipSrgb: number[];
  mipLinear: number[];
  post: number[];
  validation: string | null;
  live: number;
}> {
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error("No adapter");
  const device = await adapter.requestDevice(),
    registry = new ResourceRegistry(device);
  device.pushErrorScope("validation");
  const read = async (texture: GPUTexture, mipLevel = 0): Promise<number[]> => {
    const buffer = device.createBuffer({ size: 256, usage: 9 }),
      encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture, mipLevel },
      { buffer, bytesPerRow: 256 },
      [1, 1],
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(1);
    const pixel = Array.from(
      new Uint8Array(buffer.getMappedRange()).slice(0, 4),
    );
    buffer.unmap();
    buffer.destroy();
    return pixel;
  };
  try {
    const mips = new MipmapGenerator(device, registry),
      pixels: number[][] = [];
    for (const format of ["rgba8unorm-srgb", "rgba8unorm"] as const) {
      const texture = registry.createTexture({
        size: [3, 1],
        mipLevelCount: mipLevelCount(3, 1),
        format,
        usage: 0x17,
      });
      registry.writeTexture(
        device.queue,
        texture,
        new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
        12,
        3,
        1,
      );
      mips.generate(texture, format, 3, 1);
      pixels.push(await read(texture, 1));
      registry.release(texture);
    }
    mips.dispose();
    const effects = [
      {
        id: "invert",
        wgsl: "fn effect(c:vec4f,uv:vec2f)->vec4f{return vec4f(vec3f(1)-c.rgb,c.a);}",
      },
      {
        id: "dim",
        wgsl: "fn effect(c:vec4f,uv:vec2f)->vec4f{return vec4f(c.rgb*0.5,c.a);}",
      },
    ];
    const post = new PostProcessor(registry, "rgba8unorm-srgb", effects);
    const output = registry.createTexture({
        size: [1, 1],
        format: "rgba8unorm-srgb",
        usage: 0x11,
      }),
      encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: post.input(1, 1),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [1, 0, 0, 1],
        },
      ],
    });
    pass.end();
    post.encode(encoder, output.createView());
    device.queue.submit([encoder.finish()]);
    const pixel = await read(output);
    post.dispose();
    registry.release(output);
    const c = registry.snapshot();
    return {
      mipSrgb: pixels[0]!,
      mipLinear: pixels[1]!,
      post: pixel,
      validation: (await device.popErrorScope())?.message ?? null,
      live:
        c.liveTextures +
        c.liveSamplers +
        c.livePipelines +
        c.liveShaderModules +
        c.liveBindGroups,
    };
  } finally {
    registry.destroyAll();
    device.destroy();
  }
}
