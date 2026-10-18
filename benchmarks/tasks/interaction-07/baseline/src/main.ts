import { type Mesh, Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

/** One Pip: a small sky-blue block at (x, 0, 0). */
export function createPip(x: number): Mesh {
  const pip = boxMesh([0.8, 0.8, 0.5], unlit("#38bdf8"));
  pip.name = "Pip";
  pip.position.set(x, 0, 0);
  return pip;
}

void startTask(() => {
  const scene = new Scene();

  const rail = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  rail.name = "Rail";
  rail.position.set(0, -1.5, 0);
  scene.add(rail);

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
