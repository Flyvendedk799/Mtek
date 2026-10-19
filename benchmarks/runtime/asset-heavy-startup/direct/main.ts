// Asset-heavy startup, direct WebGPU. The GLB and the eight PNG files are fetched in parallel with the device request; the
// meshes become vertex and index buffers, the images are decoded with `createImageBitmap` (no colour conversion, no
// premultiplication) and copied into `rgba8unorm-srgb` textures; one pipeline samples the texture of each of the 12 draws.
import { assetHeavy, type AssetHeavyDefinition } from "../../common/layout.ts";
import {
  BUFFER_COPY_DST,
  BUFFER_UNIFORM,
  COLOR_FORMAT,
  DEPTH_FORMAT,
  createDirectContext,
  createIndexBuffer,
  createVertexBuffer,
  destroyDirectContext,
  readTarget,
  viewProjection,
  writeModel,
} from "../../harness/kit/direct.ts";
import type { BenchApp, Create, FrameSplit } from "../../harness/types.ts";
import workload from "../workload.json" with { type: "json" };

const TEXTURE_BINDING = 0x04;
const TEXTURE_COPY_DST = 0x02;
const TEXTURE_RENDER_ATTACHMENT = 0x10;

const WGSL = /* wgsl */ `
struct Frame { view_proj: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> object: Object;
@group(1) @binding(1) var skin: texture_2d<f32>;
@group(1) @binding(2) var skin_sampler: sampler;

struct VsOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex fn vs(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>) -> VsOut {
  var out: VsOut;
  out.clip = frame.view_proj * object.model * vec4<f32>(position, 1.0);
  out.uv = uv;
  return out;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
  let texel = textureSampleLevel(skin, skin_sampler, in.uv, 0.0);
  return vec4<f32>(texel.xyz, 1.0);
}
`;

interface GlbMesh {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint16Array;
}

/** Reads the meshes named `Rock<n>` from a GLB: one primitive each, tightly packed float32 attributes and uint16 indices. */
function parseGlb(bytes: ArrayBuffer, count: number): GlbMesh[] {
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as {
    meshes: Array<{ name: string; primitives: Array<{ attributes: Record<string, number>; indices: number }> }>;
    accessors: Array<{ bufferView: number; count: number }>;
    bufferViews: Array<{ byteOffset: number; byteLength: number }>;
  };
  const binStart = 20 + jsonLength + 8;
  const slice = (accessor: number): { offset: number; count: number } => {
    const a = json.accessors[accessor] as { bufferView: number; count: number };
    const v = json.bufferViews[a.bufferView] as { byteOffset: number };
    return { offset: binStart + v.byteOffset, count: a.count };
  };
  const out: GlbMesh[] = [];
  for (let i = 0; i < count; i += 1) {
    const mesh = json.meshes.find((m) => m.name === `Rock${String(i)}`);
    if (mesh === undefined) throw new Error(`the GLB has no mesh Rock${String(i)}`);
    const primitive = mesh.primitives[0] as (typeof mesh.primitives)[number];
    const position = slice(primitive.attributes["POSITION"] as number);
    const uv = slice(primitive.attributes["TEXCOORD_0"] as number);
    const index = slice(primitive.indices);
    out.push({
      positions: new Float32Array(bytes, position.offset, position.count * 3),
      uvs: new Float32Array(bytes, uv.offset, uv.count * 2),
      indices: new Uint16Array(bytes, index.offset, index.count),
    });
  }
  return out;
}

export const create: Create = async (context): Promise<BenchApp> => {
  const def = workload.definition as unknown as AssetHeavyDefinition;
  const placed = assetHeavy(def);
  const base = context.assetBase;
  const glbRequest = fetch(`${base}rocks.glb`).then((r) => r.arrayBuffer());
  const imageRequests = Array.from({ length: def.textures }, (_, i) =>
    fetch(`${base}t${String(i)}.png`)
      .then((r) => r.blob())
      .then((blob) => createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })),
  );
  const [glb, bitmaps, direct] = await Promise.all([glbRequest, Promise.all(imageRequests), createDirectContext()]);
  const { device } = direct;
  const meshes = parseGlb(glb, def.meshes).map((mesh) => ({
    positions: createVertexBuffer(device, mesh.positions),
    uvs: createVertexBuffer(device, mesh.uvs),
    indices: createIndexBuffer(device, mesh.indices),
    indexCount: mesh.indices.length,
  }));
  const textures = bitmaps.map((bitmap) => {
    const texture = device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: COLOR_FORMAT,
      usage: TEXTURE_BINDING | TEXTURE_COPY_DST | TEXTURE_RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
    bitmap.close();
    return texture;
  });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });

  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] },
      ],
    },
    fragment: { module, entryPoint: "fs", targets: [{ format: COLOR_FORMAT }] },
    primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
    depthStencil: { format: DEPTH_FORMAT, depthCompare: "less", depthWriteEnabled: true },
  });
  const frameBuffer = device.createBuffer({ size: 64, usage: BUFFER_UNIFORM | BUFFER_COPY_DST });
  device.queue.writeBuffer(frameBuffer, 0, viewProjection(workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] }));
  const frameGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: frameBuffer } }] });
  const model = new Float32Array(16);
  const entities = placed.map((entity) => {
    writeModel(model, 0, entity.position, 0, 1);
    const buffer = device.createBuffer({ size: 64, usage: BUFFER_UNIFORM | BUFFER_COPY_DST });
    device.queue.writeBuffer(buffer, 0, model);
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: (textures[entity.textureIndex] as GPUTexture).createView() },
        { binding: 2, resource: sampler },
      ],
    });
    return { buffer, group, mesh: meshes[entity.meshIndex] as (typeof meshes)[number] };
  });

  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(): void {
      const t0 = performance.now();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: direct.colorView, clearValue: direct.clear, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: direct.depthView, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, frameGroup);
      for (const entity of entities) {
        pass.setBindGroup(1, entity.group);
        pass.setVertexBuffer(0, entity.mesh.positions);
        pass.setVertexBuffer(1, entity.mesh.uvs);
        pass.setIndexBuffer(entity.mesh.indices, "uint16");
        pass.drawIndexed(entity.mesh.indexCount);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      split = { updateMs: 0, renderPrepMs: performance.now() - t0 };
    },
    split: () => split,
    readPixels: () => readTarget(direct),
    dispose(): void {
      for (const mesh of meshes) for (const buffer of [mesh.positions, mesh.uvs, mesh.indices]) buffer.destroy();
      for (const entity of entities) entity.buffer.destroy();
      for (const texture of textures) texture.destroy();
      frameBuffer.destroy();
      destroyDirectContext(direct);
    },
  };
};
