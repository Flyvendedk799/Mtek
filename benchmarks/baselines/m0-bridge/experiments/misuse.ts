// Run-time half of the H2 experiment: shader-graph mistakes that `tsc` accepts (type-experiments.ts,
// cases 15, 17 and 18) are built and rendered to see what three.js does with them. Not part of the
// baseline's own source (`src/`), so it is not counted in the baseline's size.
import { float, uniform, vec3, vec4 } from "three/tsl";
import {
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  Vector2,
  WebGPURenderer,
} from "three/webgpu";

export type MisuseKind = "vec3-add-vec2" | "float-as-colour" | "vec2-as-colour";

const SIZE = 16;

function colourNode(kind: MisuseKind): MeshBasicNodeMaterial["colorNode"] {
  const d = uniform(new Vector2(0.25, 0.5), "vec2");
  switch (kind) {
    case "vec3-add-vec2":
      return vec4(vec3(0.1, 0.2, 0.3).add(d), 1);
    case "float-as-colour":
      return float(0.5);
    case "vec2-as-colour":
      return d;
  }
}

/** Renders one full-target quad with the given (wrong) colour node; returns the centre RGBA8 pixel. */
async function run(kind: MisuseKind): Promise<number[]> {
  const renderer = new WebGPURenderer({ antialias: false });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 1);
  await renderer.init();
  const target = new RenderTarget(SIZE, SIZE, { depthBuffer: false });
  const material = new MeshBasicNodeMaterial();
  material.colorNode = colourNode(kind);
  const scene = new Scene();
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE);
  const centre = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
  const result = [...new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice(centre, centre + 4)];
  await renderer.dispose();
  return result;
}

declare global {
  interface Window {
    mtekMisuse: { run(kind: MisuseKind): Promise<number[]> };
  }
}

window.mtekMisuse = { run };
