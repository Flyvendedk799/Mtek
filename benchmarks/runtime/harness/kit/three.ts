// The three.js baseline helpers: the renderer (`three/webgpu`, WebGPU backend), an offscreen sRGB render target of the
// protocol's size, the camera of the workload and the picture readback. Plain three.js r186 API, configured the way
// the task baselines of spec/ai-and-benchmarks.md section 6.3 configure it.
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RenderTarget,
  Scene,
  SRGBColorSpace,
  WebGPURenderer,
} from "three/webgpu";
import protocol from "../../protocol.json" with { type: "json" };
import type { Vec3 } from "../../common/layout.ts";
import type { PixelsRgba } from "../types.ts";

export interface ThreeContext {
  readonly renderer: WebGPURenderer;
  readonly target: RenderTarget;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
}

/** `#rrggbb` as three.js's linear working-space colour (what `new Color().setStyle(hex, SRGBColorSpace)` does). */
export function srgb(hex: string): Color {
  return new Color().setStyle(hex, SRGBColorSpace);
}

export async function createThreeContext(camera: { position: Vec3; target: Vec3 }): Promise<ThreeContext> {
  const { width, height } = protocol.target;
  const renderer = new WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(srgb(protocol.clearColorSrgb), 1);
  await renderer.init();
  const target = new RenderTarget(width, height, { depthBuffer: true });
  target.texture.colorSpace = SRGBColorSpace;
  const view = new PerspectiveCamera((protocol.camera.fovY * 180) / Math.PI, width / height, protocol.camera.near, protocol.camera.far);
  view.position.set(...camera.position);
  view.lookAt(...camera.target);
  view.updateMatrixWorld();
  return { renderer, target, scene: new Scene(), camera: view };
}

/** One frame into the offscreen target. */
export function renderThree(context: ThreeContext): void {
  context.renderer.setRenderTarget(context.target);
  context.renderer.render(context.scene, context.camera);
  context.renderer.setRenderTarget(null);
}

export async function readThree(context: ThreeContext): Promise<PixelsRgba> {
  const { width, height } = protocol.target;
  const bytes = await context.renderer.readRenderTargetPixelsAsync(context.target, 0, 0, width, height);
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width, height, data: Uint8Array.from(view) };
}

/** Releases the target and the renderer; `WebGPURenderer.dispose()` is asynchronous and destroys the GPU device three.js acquired. */
export async function disposeThree(context: ThreeContext): Promise<void> {
  context.target.dispose();
  await context.renderer.dispose();
}

/** A unit-extent box geometry of the given size, and a flat-colour material: the three.js equivalent of `Box` and `Unlit`. */
export function boxGeometry(size: number): BoxGeometry {
  return new BoxGeometry(size, size, size);
}

export function unlitMaterial(hex: string): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: srgb(hex) });
}

export { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial };
