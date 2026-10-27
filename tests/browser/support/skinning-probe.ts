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
  withNormals: boolean | "mixed" = true,
): Promise<{
  error: number;
  uploaded: number;
  expectedUpload: number;
  live: number;
  validation: string | null;
  outputBytes: number;
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
      normal = withNormals !== false ? uploadBuffer(registry, device.queue, "normals", 0x80, normals) : undefined;
    const engine = new GpuSkinning(device, registry),
      source = engine.source(skin, normal, vertices);
    const instances = Array.from({ length: actors }, (_, actor) => {
      const needsNormals = withNormals === "mixed" ? actor % 2 === 0 : withNormals;
      const p = registry.createBuffer({
          size: positions.byteLength,
          usage: 0x84,
        }),
        n = needsNormals ? registry.createBuffer({ size: normals.byteLength, usage: 0x84 }) : undefined;
      return { p, n, palette: new Float32Array(48), gpu: engine.instance(source, input, p, n, vertices, 3) };
    });
    const before = registry.snapshot().uploadBytes;
    instances.forEach(({ gpu, palette }, actor) => {
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
    });
    engine.flush();
    const uploaded = registry.snapshot().uploadBytes - before;
    const outputBytes = instances.reduce((sum, instance) => sum + instance.p.size + (instance.n?.size ?? 0), 0);
    const readback = device.createBuffer({
        size: outputBytes,
        usage: 0x09,
      }),
      encoder = device.createCommandEncoder();
    let offset = 0;
    for (const { p, n } of instances) {
      encoder.copyBufferToBuffer(p, 0, readback, offset, p.size);
      offset += p.size;
      if (n !== undefined) { encoder.copyBufferToBuffer(n, 0, readback, offset, n.size); offset += n.size; }
    }
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(1);
    const actual = new Float32Array(readback.getMappedRange()),
      expectedP = new Float32Array(positions.length),
      expectedN = new Float32Array(normals.length);
    let error = 0;
    offset = 0;
    for (const { palette, n } of instances) {
      deformSkin(skin, palette, positions, n === undefined ? undefined : normals, expectedP, expectedN);
      for (let i = 0; i < positions.length; i++)
        error = Math.max(error, Math.abs(actual[offset + i]! - expectedP[i]!),
          n === undefined ? 0 : Math.abs(actual[offset + positions.length + i]! - expectedN[i]!));
      offset += positions.length * (n === undefined ? 1 : 2);
    }
    readback.unmap();
    readback.destroy();
    for (const { p, n, gpu } of instances) {
      engine.release(gpu);
      registry.release(p);
      if (n !== undefined) registry.release(n);
    }
    engine.releaseSource(source);
    engine.dispose();
    registry.release(input);
    if (normal !== undefined) registry.release(normal);
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
      outputBytes,
    };
  } finally {
    registry.destroyAll();
    device.destroy();
  }
}
