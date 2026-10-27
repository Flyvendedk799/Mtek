import { ResourceRegistry } from "../../../packages/runtime-web/src/gpu/registry.js";
import { GpuSkinning } from "../../../packages/runtime-web/src/render/gpu-skinning.js";
import { uploadBuffer } from "../../../packages/runtime-web/src/render/meshes.js";
import { deformSkin } from "../../../packages/runtime-web/src/mesh/skinning.js";
import { animatedSkin } from "../../../packages/runtime-web/src/test-support/animated-skin.js";
import { referenceTangentFrame } from "../../../packages/runtime-web/src/test-support/tangent-reference.js";
import { identity } from "../../../packages/runtime-web/src/math/mat4.js";

function encode(view: ArrayBufferView): string {
  let text = "";
  for (const byte of new Uint8Array(view.buffer, view.byteOffset, view.byteLength)) text += String.fromCharCode(byte);
  return btoa(text);
}

/** Real eight-storage-binding execution. The tangent oracle uses generic pivoted
 * inversion, not either implementation's cofactor/normal helper. */
export async function runTangentSkinningProbe(actors: number, vertices: number, mixed: boolean): Promise<{
  positionNormalError: number; tangentGpuError: number; tangentCpuError: number; orthogonalityError: number;
  uploaded: number; expectedUpload: number; outputBytes: number; expectedOutputBytes: number;
  validation: string | null; live: number; profiles: string[]; handedness: Record<string, number>; storageBufferLimit: number;
  rejectedRequests: string[]; invalidRequestsAllocatedNothing: boolean;
  borrowedInputSurvived: boolean;
  raw: { positions: string; normals: string; tangents: string; indices: readonly (readonly number[])[]; weights: readonly (readonly number[])[];
    instances: { profile: string; palette: string; actual: string; cpu: string; reference: string }[] };
}> {
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error("No adapter");
  const device = await adapter.requestDevice(), registry = new ResourceRegistry(device);
  device.pushErrorScope("validation");
  try {
    const base = animatedSkin(), skin = { ...base,
      indices: Array.from({ length: vertices }, (_, v) => base.indices[v % 3]!),
      weights: Array.from({ length: vertices }, (_, v) => base.weights[v % 3]!),
    };
    const positions = Float32Array.from({ length: vertices * 3 }, (_, k) => Math.sin(k * 0.2));
    const normals = Float32Array.from({ length: vertices * 3 }, (_, k) => k % 3 === 2 ? 0 : Math.SQRT1_2);
    const tangents = Float32Array.from({ length: vertices * 4 }, (_, k) => {
      const vertex = Math.floor(k / 4), axis = k % 4;
      if (axis === 3) return vertex % 11 === 0 ? 0 : vertex % 2 === 0 ? 1 : -1;
      return vertex % 13 === 0 || axis === 2 ? 0 : axis === 0 ? Math.SQRT1_2 : -Math.SQRT1_2;
    });
    const input = uploadBuffer(registry, device.queue, "positions", 0x80, positions);
    const normal = uploadBuffer(registry, device.queue, "normals", 0x80, normals);
    const tangent = uploadBuffer(registry, device.queue, "tangents", 0x84, tangents);
    const engine = new GpuSkinning(device, registry), source = engine.source(skin, normal, vertices, tangent);
    const short = registry.createBuffer({ size: 16, usage: 0x80 }), beforeInvalid = registry.snapshot(), rejectedRequests: string[] = [];
    const rejected = (name: string, action: () => unknown): void => {
      try { action(); } catch (error) { if (error instanceof Error && error.message.includes("tangent skinning")) { rejectedRequests.push(name); return; } throw error; }
      throw new Error(`Invalid request was accepted: ${name}`);
    };
    rejected("source without normals", () => engine.source(skin, undefined, vertices, tangent));
    rejected("instance without tangent input", () => engine.instance({ influences: source.influences, normals: normal }, input, input, normal, vertices, 3, tangent));
    rejected("instance without normal output", () => engine.instance(source, input, input, undefined, vertices, 3, tangent));
    rejected("short tangent output", () => engine.instance(source, input, input, normal, vertices, 3, short));
    rejected("short tangent input", () => engine.instance({ ...source, tangents: short }, input, input, normal, vertices, 3, tangent));
    const afterInvalid = registry.snapshot(), invalidRequestsAllocatedNothing = beforeInvalid.buffersAllocated === afterInvalid.buffersAllocated && beforeInvalid.pipelinesCreated === afterInvalid.pipelinesCreated && beforeInvalid.shaderModulesCreated === afterInvalid.shaderModulesCreated && beforeInvalid.bindGroupsCreated === afterInvalid.bindGroupsCreated;
    registry.release(short);
    const instances = Array.from({ length: actors }, (_, actor) => {
      const profile = mixed ? ["tangent", "normal", "position", "position", "tangent", "normal"][actor % 6]! : "tangent";
      const p = registry.createBuffer({ size: vertices * 12, usage: 0x84 });
      const n = profile !== "position" ? registry.createBuffer({ size: vertices * 12, usage: 0x84 }) : undefined;
      const t = profile === "tangent" ? registry.createBuffer({ size: vertices * 16, usage: 0x84 }) : undefined;
      const palette = new Float32Array(48);
      for (let j = 0; j < 3; j++) {
        const m = identity(), angle = actor * 0.1 + j * 0.25, sign = actor % 2 === 0 ? 1 : -1;
        m[0] = j === 2 ? 0 : Math.cos(angle) * 2 * sign; m[1] = j === 2 ? 0 : Math.sin(angle) * 2 * sign;
        m[4] = -Math.sin(angle) * 0.5; m[5] = Math.cos(angle) * 0.5;
        m[8] = 0.4; m[10] = 1.5; m[12] = actor * 0.2 + j;
        palette.set(m, j * 16);
      }
      return { profile, p, n, t, palette, gpu: engine.instance(source, input, p, n, vertices, 3, t) };
    });
    const before = registry.snapshot().uploadBytes;
    for (const instance of instances) engine.update(instance.gpu, instance.palette, vertices);
    engine.flush();
    const uploaded = registry.snapshot().uploadBytes - before;
    const outputBytes = instances.reduce((sum, i) => sum + i.p.size + (i.n?.size ?? 0) + (i.t?.size ?? 0), 0);
    const readback = device.createBuffer({ size: outputBytes, usage: 0x09 }), encoder = device.createCommandEncoder();
    let offset = 0;
    for (const i of instances) for (const buffer of [i.p, i.n, i.t]) if (buffer !== undefined) { encoder.copyBufferToBuffer(buffer, 0, readback, offset, buffer.size); offset += buffer.size; }
    device.queue.submit([encoder.finish()]); await readback.mapAsync(1);
    const actual = new Float32Array(readback.getMappedRange());
    let positionNormalError = 0, tangentGpuError = 0, tangentCpuError = 0, orthogonalityError = 0;
    const handedness = { positive: 0, negative: 0, unavailable: 0 }, rawInstances: { profile: string; palette: string; actual: string; cpu: string; reference: string }[] = [];
    offset = 0;
    for (const instance of instances) {
      const p = new Float32Array(vertices * 3), n = new Float32Array(vertices * 3), t = instance.t === undefined ? undefined : new Float32Array(vertices * 4);
      deformSkin(skin, instance.palette, positions, instance.n === undefined ? undefined : normals, p, n, instance.t === undefined ? undefined : tangents, t);
      for (let k = 0; k < p.length; k++) positionNormalError = Math.max(positionNormalError, Math.abs(actual[offset + k]! - p[k]!), instance.n === undefined ? 0 : Math.abs(actual[offset + p.length + k]! - n[k]!));
      if (t !== undefined) {
        const actualT = actual.subarray(offset + vertices * 6, offset + vertices * 10), reference = new Float32Array(vertices * 4);
        for (let v = 0; v < vertices; v++) {
          const expected = referenceTangentFrame(instance.palette, skin.indices[v]!, skin.weights[v]!, Array.from(normals.subarray(v * 3, v * 3 + 3)), Array.from(tangents.subarray(v * 4, v * 4 + 4))).tangent;
          reference.set(expected, v * 4);
          for (let k = 0; k < 4; k++) {
            tangentGpuError = Math.max(tangentGpuError, Math.abs(actualT[v * 4 + k]! - expected[k]!));
            tangentCpuError = Math.max(tangentCpuError, Math.abs(t[v * 4 + k]! - expected[k]!));
          }
          const w = actualT[v * 4 + 3]!; handedness[w === 0 ? "unavailable" : w > 0 ? "positive" : "negative"]++;
          if (w !== 0) orthogonalityError = Math.max(orthogonalityError, Math.abs([0, 1, 2].reduce((value, k) => value + actualT[v * 4 + k]! * actual[offset + vertices * 3 + v * 3 + k]!, 0)));
        }
        rawInstances.push({ profile: instance.profile, palette: encode(instance.palette), actual: encode(actualT), cpu: encode(t), reference: encode(reference) });
      }
      offset += vertices * (instance.profile === "tangent" ? 10 : instance.profile === "normal" ? 6 : 3);
    }
    readback.unmap(); readback.destroy();
    for (const i of instances) { engine.release(i.gpu); registry.release(i.p); if (i.n !== undefined) registry.release(i.n); if (i.t !== undefined) registry.release(i.t); }
    engine.releaseSource(source); engine.dispose();
    // The engine owns influences, palettes and groups. Its source merely borrows
    // the mesh's tangent stream, which must remain usable by another consumer.
    const borrowed = device.createBuffer({ size: 16, usage: 0x09 }), copy = device.createCommandEncoder();
    copy.copyBufferToBuffer(tangent, 16, borrowed, 0, 16); device.queue.submit([copy.finish()]); await borrowed.mapAsync(1);
    const borrowedInputSurvived = new Float32Array(borrowed.getMappedRange()).every((value, k) => value === tangents[k + 4]);
    borrowed.unmap(); borrowed.destroy();
    registry.release(input); registry.release(normal); registry.release(tangent);
    const counters = registry.snapshot(), live = counters.liveBuffers + counters.livePipelines + counters.liveShaderModules + counters.liveBindGroups;
    return { positionNormalError, tangentGpuError, tangentCpuError, orthogonalityError, uploaded, expectedUpload: actors * 3 * 64, outputBytes,
      expectedOutputBytes: instances.reduce((sum, i) => sum + vertices * (i.profile === "tangent" ? 40 : i.profile === "normal" ? 24 : 12), 0),
      validation: (await device.popErrorScope())?.message ?? null, live, profiles: instances.map(i => i.profile), handedness, storageBufferLimit: device.limits.maxStorageBuffersPerShaderStage,
      rejectedRequests, invalidRequestsAllocatedNothing, borrowedInputSurvived,
      raw: { positions: encode(positions), normals: encode(normals), tangents: encode(tangents), indices: skin.indices, weights: skin.weights, instances: rawInstances } };
  } finally { registry.destroyAll(); device.destroy(); }
}
