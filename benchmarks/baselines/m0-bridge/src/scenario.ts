// The M0 bridge scenario with three.js: two materials, two meshes, one render target, readback.
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SRGBColorSpace,
  WebGPURenderer,
} from "three/webgpu";
import { applyParams, createMixedMaterial, type MixedMaterial, type MixedParams } from "./mixed.ts";

export const TARGET_SIZE = 128;

export type MaterialName = "A" | "B";

export interface Scenario {
  /** Renders the scene into the render target and returns tightly packed RGBA8 bytes. */
  renderAndRead(): Promise<Uint8Array>;
  /** Updates uniform `.value` fields of one material; nothing else is touched. */
  update(which: MaterialName, params: Partial<MixedParams>): void;
  dispose(): Promise<void>;
}

/** Material A covers the left half of the target, material B the right half. */
export async function createScenario(
  a: MixedParams,
  b: MixedParams,
): Promise<Scenario> {
  const renderer = new WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(TARGET_SIZE, TARGET_SIZE, false);
  renderer.setClearColor(0x000000, 1);
  await renderer.init();

  const target = new RenderTarget(TARGET_SIZE, TARGET_SIZE, { depthBuffer: false });
  target.texture.colorSpace = SRGBColorSpace;

  const materials: Record<MaterialName, MixedMaterial> = {
    A: createMixedMaterial(a),
    B: createMixedMaterial(b),
  };
  const geometry = new PlaneGeometry(1, 2);
  const left = new Mesh(geometry, materials.A.material);
  const right = new Mesh(geometry, materials.B.material);
  left.position.x = -0.5;
  right.position.x = 0.5;

  const scene = new Scene();
  scene.add(left, right);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  return {
    async renderAndRead() {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      const pixels = await renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        TARGET_SIZE,
        TARGET_SIZE,
      );
      return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice();
    },
    update(which, params) {
      applyParams(materials[which].uniforms, params);
    },
    async dispose() {
      geometry.dispose();
      left.material.dispose();
      right.material.dispose();
      target.dispose();
      await renderer.dispose();
    },
  };
}
