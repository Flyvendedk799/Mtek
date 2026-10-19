// The hand-written WebGPU helpers the direct reference implementations share: a device, the offscreen colour and depth
// targets of the protocol, the camera matrices, a box mesh, an instanced unlit pipeline and the picture readback.
// Everything is plain WebGPU written for this benchmark; nothing here comes from Mtek's runtime.
import protocol from "../../protocol.json" with { type: "json" };
import { hexToLinear, type Vec3 } from "../../common/layout.ts";
import type { PixelsRgba } from "../types.ts";

export const TARGET_WIDTH = protocol.target.width;
export const TARGET_HEIGHT = protocol.target.height;
export const COLOR_FORMAT: GPUTextureFormat = "rgba8unorm-srgb";
export const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";

const BUFFER_VERTEX = 0x20;
const BUFFER_INDEX = 0x10;
const BUFFER_UNIFORM = 0x40;
const BUFFER_COPY_DST = 0x08;
const BUFFER_COPY_SRC = 0x04;
const BUFFER_MAP_READ = 0x01;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const TEXTURE_COPY_SRC = 0x01;

export interface DirectContext {
  readonly device: GPUDevice;
  readonly color: GPUTexture;
  readonly colorView: GPUTextureView;
  readonly depth: GPUTexture;
  readonly depthView: GPUTextureView;
  readonly clear: GPUColor;
}

/** Adapter, device (no optional features: the page adds `timestamp-query` itself when asked) and the two targets. */
export async function createDirectContext(): Promise<DirectContext> {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (adapter === null) throw new Error("navigator.gpu.requestAdapter() resolved to null");
  const device = await adapter.requestDevice();
  const color = device.createTexture({
    size: [TARGET_WIDTH, TARGET_HEIGHT],
    format: COLOR_FORMAT,
    usage: TEXTURE_RENDER_ATTACHMENT | TEXTURE_COPY_SRC,
  });
  const depth = device.createTexture({ size: [TARGET_WIDTH, TARGET_HEIGHT], format: DEPTH_FORMAT, usage: TEXTURE_RENDER_ATTACHMENT });
  const [r, g, b] = hexToLinear(protocol.clearColorSrgb);
  return { device, color, colorView: color.createView(), depth, depthView: depth.createView(), clear: { r, g, b, a: 1 } };
}

export function destroyDirectContext(context: DirectContext): void {
  context.color.destroy();
  context.depth.destroy();
  context.device.destroy();
}

/** Reads the colour target back: copy to a mappable buffer (rows padded to 256 bytes), map, strip the padding. */
export async function readTarget(context: DirectContext): Promise<PixelsRgba> {
  const { device } = context;
  const bytesPerRow = Math.ceil((TARGET_WIDTH * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * TARGET_HEIGHT, usage: BUFFER_COPY_DST | BUFFER_MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: context.color }, { buffer, bytesPerRow }, [TARGET_WIDTH, TARGET_HEIGHT]);
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(1);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const data = new Uint8Array(TARGET_WIDTH * TARGET_HEIGHT * 4);
  for (let y = 0; y < TARGET_HEIGHT; y += 1) {
    data.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + TARGET_WIDTH * 4), y * TARGET_WIDTH * 4);
  }
  buffer.unmap();
  buffer.destroy();
  return { width: TARGET_WIDTH, height: TARGET_HEIGHT, data };
}

// ---- matrices (column-major, 16 numbers) ---------------------------------------------------------------------------

export type Mat4 = Float32Array;

export function multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Float32Array = new Float32Array(16)): Float32Array {
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + row] as number) * (b[col * 4 + k] as number);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Right-handed perspective looking down -Z with depth in [0, 1] (WebGPU clip space). */
export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

/** The view matrix of a camera at `eye` looking at `target` with +Y up. */
export function lookAt(eye: Vec3, target: Vec3): Float32Array {
  const fx = target[0] - eye[0];
  const fy = target[1] - eye[1];
  const fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz);
  const f: Vec3 = [fx / fl, fy / fl, fz / fl];
  // r = normalize(f x up) with up = (0, 1, 0)
  const rx = -f[2];
  const rz = f[0];
  const rl = Math.hypot(rx, rz);
  const r: Vec3 = [rx / rl, 0, rz / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const out = new Float32Array(16);
  out[0] = r[0];
  out[1] = u[0];
  out[2] = -f[0];
  out[4] = r[1];
  out[5] = u[1];
  out[6] = -f[1];
  out[8] = r[2];
  out[9] = u[2];
  out[10] = -f[2];
  out[12] = -dot(r, eye);
  out[13] = -dot(u, eye);
  out[14] = dot(f, eye);
  out[15] = 1;
  return out;
}

export function viewProjection(camera: { position: Vec3; target: Vec3 }): Float32Array {
  const { fovY, near, far } = protocol.camera;
  return multiply(perspective(fovY, TARGET_WIDTH / TARGET_HEIGHT, near, far), lookAt(camera.position, camera.target));
}

/** Writes `T(position) * Ry(yaw) * S(scale)` into `out` at element offset `offset`; `scale` is uniform (a number) or per axis. */
export function writeModel(out: Float32Array, offset: number, position: Vec3, yaw: number, scale: number | Vec3): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const [sx, sy, sz] = typeof scale === "number" ? [scale, scale, scale] : scale;
  out[offset + 0] = c * sx;
  out[offset + 1] = 0;
  out[offset + 2] = -s * sx;
  out[offset + 3] = 0;
  out[offset + 4] = 0;
  out[offset + 5] = sy;
  out[offset + 6] = 0;
  out[offset + 7] = 0;
  out[offset + 8] = s * sz;
  out[offset + 9] = 0;
  out[offset + 10] = c * sz;
  out[offset + 11] = 0;
  out[offset + 12] = position[0];
  out[offset + 13] = position[1];
  out[offset + 14] = position[2];
  out[offset + 15] = 1;
}

/** Writes `T(position) * R(quaternion) * S(1)` into `out` at `offset`. */
export function writeModelQuat(out: Float32Array, offset: number, position: Vec3, q: { x: number; y: number; z: number; w: number }): void {
  const { x, y, z, w } = q;
  out[offset + 0] = 1 - 2 * (y * y + z * z);
  out[offset + 1] = 2 * (x * y + z * w);
  out[offset + 2] = 2 * (x * z - y * w);
  out[offset + 3] = 0;
  out[offset + 4] = 2 * (x * y - z * w);
  out[offset + 5] = 1 - 2 * (x * x + z * z);
  out[offset + 6] = 2 * (y * z + x * w);
  out[offset + 7] = 0;
  out[offset + 8] = 2 * (x * z + y * w);
  out[offset + 9] = 2 * (y * z - x * w);
  out[offset + 10] = 1 - 2 * (x * x + y * y);
  out[offset + 11] = 0;
  out[offset + 12] = position[0];
  out[offset + 13] = position[1];
  out[offset + 14] = position[2];
  out[offset + 15] = 1;
}

// ---- geometry --------------------------------------------------------------------------------------------------

/** An axis-aligned box of the given full extents: 24 vertices (4 per face), 36 indices, counter-clockwise faces seen from outside. */
export function boxGeometry(size: number): { positions: Float32Array; indices: Uint16Array } {
  const h = size / 2;
  // Per face: the four corners in counter-clockwise order seen from outside.
  const faces: Array<Array<[number, number, number]>> = [
    [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]], // +X
    [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]], // -X
    [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]], // +Y
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]], // -Y
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]], // +Z
    [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]], // -Z
  ];
  const positions = new Float32Array(24 * 3);
  const indices = new Uint16Array(36);
  faces.forEach((face, f) => {
    face.forEach((corner, i) => positions.set(corner, (f * 4 + i) * 3));
    indices.set([0, 1, 2, 0, 2, 3].map((n) => f * 4 + n), f * 6);
  });
  return { positions, indices };
}

export function createVertexBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({ size: data.byteLength, usage: BUFFER_VERTEX | BUFFER_COPY_DST });
  device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
  return buffer;
}

export function createIndexBuffer(device: GPUDevice, data: Uint16Array): GPUBuffer {
  // Index data must be a multiple of 4 bytes for writeBuffer.
  const size = Math.ceil(data.byteLength / 4) * 4;
  const buffer = device.createBuffer({ size, usage: BUFFER_INDEX | BUFFER_COPY_DST });
  const padded = new Uint16Array(size / 2);
  padded.set(data);
  device.queue.writeBuffer(buffer, 0, padded.buffer, 0, size);
  return buffer;
}

// ---- the instanced unlit renderer -------------------------------------------------------------------------------

const UNLIT_INSTANCED_WGSL = /* wgsl */ `
struct Frame { view_proj: mat4x4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) m0: vec4<f32>,
  @location(2) m1: vec4<f32>,
  @location(3) m2: vec4<f32>,
  @location(4) m3: vec4<f32>,
  @location(5) color: vec4<f32>,
};
struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec3<f32>,
};

@vertex fn vs(in: VsIn) -> VsOut {
  var out: VsOut;
  let model = mat4x4<f32>(in.m0, in.m1, in.m2, in.m3);
  out.clip = frame.view_proj * model * vec4<f32>(in.position, 1.0);
  out.color = in.color.rgb;
  return out;
}

@fragment fn fs(in: VsOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;

/**
 * Draws `count` boxes of one mesh with ONE instanced draw call. Per-instance data lives in two vertex buffers: the model
 * matrices (64 bytes each) and the colours (16 bytes each, linear RGBA), so a workload can rewrite only what it changes.
 */
export class InstancedBoxes {
  readonly matrices: Float32Array;
  readonly colors: Float32Array;
  private readonly pipeline: GPURenderPipeline;
  private readonly frameBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly positions: GPUBuffer;
  private readonly indices: GPUBuffer;
  private readonly matrixBuffer: GPUBuffer;
  private readonly colorBuffer: GPUBuffer;
  private readonly indexCount: number;

  constructor(
    private readonly context: DirectContext,
    readonly count: number,
    boxSize: number,
    camera: { position: Vec3; target: Vec3 },
    pipeline?: GPURenderPipeline,
  ) {
    const { device } = context;
    this.matrices = new Float32Array(count * 16);
    this.colors = new Float32Array(count * 4);
    const geometry = boxGeometry(boxSize);
    this.indexCount = geometry.indices.length;
    this.positions = createVertexBuffer(device, geometry.positions);
    this.indices = createIndexBuffer(device, geometry.indices);
    this.matrixBuffer = device.createBuffer({ size: this.matrices.byteLength, usage: BUFFER_VERTEX | BUFFER_COPY_DST });
    this.colorBuffer = device.createBuffer({ size: this.colors.byteLength, usage: BUFFER_VERTEX | BUFFER_COPY_DST });
    this.frameBuffer = device.createBuffer({ size: 64, usage: BUFFER_UNIFORM | BUFFER_COPY_DST });
    device.queue.writeBuffer(this.frameBuffer, 0, viewProjection(camera));
    this.pipeline = pipeline ?? InstancedBoxes.createPipeline(device);
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.frameBuffer } }],
    });
  }

  /** The unlit instanced pipeline; a renderer that rebuilds its scene keeps one and passes it to every new scene. */
  static createPipeline(device: GPUDevice): GPURenderPipeline {
    const module = device.createShaderModule({ code: UNLIT_INSTANCED_WGSL });
    return device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [
          { arrayStride: 12, stepMode: "vertex", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
          {
            arrayStride: 64,
            stepMode: "instance",
            attributes: [1, 2, 3, 4].map((location, i) => ({ shaderLocation: location, offset: i * 16, format: "float32x4" as const })),
          },
          { arrayStride: 16, stepMode: "instance", attributes: [{ shaderLocation: 5, offset: 0, format: "float32x4" }] },
        ],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: COLOR_FORMAT }] },
      primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
      depthStencil: { format: DEPTH_FORMAT, depthCompare: "less", depthWriteEnabled: true },
    });
  }

  uploadMatrices(): void {
    this.context.device.queue.writeBuffer(this.matrixBuffer, 0, this.matrices.buffer, this.matrices.byteOffset, this.matrices.byteLength);
  }

  uploadColors(): void {
    this.context.device.queue.writeBuffer(this.colorBuffer, 0, this.colors.buffer, this.colors.byteOffset, this.colors.byteLength);
  }

  /** Records one pass (clear, one instanced draw) and submits it. */
  render(): void {
    const { device, colorView, depthView, clear } = this.context;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: colorView, clearValue: clear, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.positions);
    pass.setVertexBuffer(1, this.matrixBuffer);
    pass.setVertexBuffer(2, this.colorBuffer);
    pass.setIndexBuffer(this.indices, "uint16");
    pass.drawIndexed(this.indexCount, this.count);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** Releases the buffers (the device and targets belong to the context). */
  destroy(): void {
    for (const buffer of [this.positions, this.indices, this.matrixBuffer, this.colorBuffer, this.frameBuffer]) buffer.destroy();
  }
}

export function setColor(out: Float32Array, index: number, rgb: Vec3): void {
  out[index * 4] = rgb[0];
  out[index * 4 + 1] = rgb[1];
  out[index * 4 + 2] = rgb[2];
  out[index * 4 + 3] = 1;
}

export { BUFFER_COPY_DST, BUFFER_COPY_SRC, BUFFER_INDEX, BUFFER_MAP_READ, BUFFER_UNIFORM, BUFFER_VERTEX, TEXTURE_COPY_SRC, TEXTURE_RENDER_ATTACHMENT };
