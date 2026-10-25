import { ResourceRegistry } from "../../../packages/runtime-web/src/gpu/registry.js";
import { GpuSkinning } from "../../../packages/runtime-web/src/render/gpu-skinning.js";
import { uploadBuffer } from "../../../packages/runtime-web/src/render/meshes.js";
import { deformSkin } from "../../../packages/runtime-web/src/mesh/skinning.js";
import { animatedSkin } from "../../../packages/runtime-web/src/test-support/animated-skin.js";
import { identity } from "../../../packages/runtime-web/src/math/mat4.js";

/** Actual compute execution and readback; fake-GPU tests cannot validate WGSL arithmetic. */
export async function runSkinningProbe(
  actors: number,
  vertices: number,
): Promise<{
  error: number;
  uploaded: number;
  expectedUpload: number;
  live: number;
  validation: string | null;
}> {
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error("No adapter");
  const device = await adapter.requestDevice(),
    registry = new ResourceRegistry(device);
  device.pushErrorScope("validation");
  try {
    const base = animatedSkin(),
      indices = Array.from(
        { length: vertices },
        (_, v) => base.indices[v % 3]!,
      ),
      weights = Array.from(
        { length: vertices },
        (_, v) => base.weights[v % 3]!,
      );
    const skin = { ...base, indices, weights };
    const positions = Float32Array.from(
      { length: vertices * 3 },
      (_, i) => Math.sin(i * 0.2) * 3,
    );
    const normals = Float32Array.from({ length: vertices * 3 }, (_, i) =>
      i % 3 === 0 ? Math.SQRT1_2 : i % 3 === 1 ? Math.SQRT1_2 : 0,
    );
    const input = uploadBuffer(
        registry,
        device.queue,
        "positions",
        0x80,
        positions,
      ),
      normal = uploadBuffer(registry, device.queue, "normals", 0x80, normals);
    const engine = new GpuSkinning(device, registry),
      source = engine.source(skin, normal, vertices);
    const instances = Array.from({ length: actors }, () => {
      const p = registry.createBuffer({
          size: positions.byteLength,
          usage: 0x84,
        }),
        n = registry.createBuffer({ size: normals.byteLength, usage: 0x84 });
      return { p, n, gpu: engine.instance(source, input, p, n, vertices, 3) };
    });
    const before = registry.snapshot().uploadBytes;
    let lastPalette = new Float32Array(48);
    instances.forEach(({ gpu }, actor) => {
      const palette = new Float32Array(48);
      for (let j = 0; j < 3; j++) {
        const m = identity(),
          a = actor * 0.1 + j * 0.3;
        m[0] = Math.cos(a) * 2;
        m[1] = Math.sin(a) * 2;
        m[4] = -Math.sin(a);
        m[5] = Math.cos(a);
        m[8] = 0.4;
        m[12] = actor * 0.3 + j;
        palette.set(m, j * 16);
      }
      engine.update(gpu, palette, vertices);
      lastPalette = palette;
    });
    engine.flush();
    const uploaded = registry.snapshot().uploadBytes - before;
    const readback = device.createBuffer({
        size: positions.byteLength * 2,
        usage: 0x09,
      }),
      encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      instances.at(-1)!.p,
      0,
      readback,
      0,
      positions.byteLength,
    );
    encoder.copyBufferToBuffer(
      instances.at(-1)!.n,
      0,
      readback,
      positions.byteLength,
      normals.byteLength,
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(1);
    const actual = new Float32Array(readback.getMappedRange()),
      expectedP = new Float32Array(positions.length),
      expectedN = new Float32Array(normals.length);
    deformSkin(skin, lastPalette, positions, normals, expectedP, expectedN);
    let error = 0;
    for (let i = 0; i < positions.length; i++)
      error = Math.max(
        error,
        Math.abs(actual[i]! - expectedP[i]!),
        Math.abs(actual[positions.length + i]! - expectedN[i]!),
      );
    readback.unmap();
    readback.destroy();
    for (const { p, n, gpu } of instances) {
      engine.release(gpu);
      registry.release(p);
      registry.release(n);
    }
    engine.releaseSource(source);
    engine.dispose();
    registry.release(input);
    registry.release(normal);
    const counters = registry.snapshot(),
      live =
        counters.liveBuffers +
        counters.livePipelines +
        counters.liveShaderModules +
        counters.liveBindGroups;
    const validation = (await device.popErrorScope())?.message ?? null;
    return {
      error,
      uploaded,
      expectedUpload: actors * 3 * 64,
      live,
      validation,
    };
  } finally {
    registry.destroyAll();
    device.destroy();
  }
}
