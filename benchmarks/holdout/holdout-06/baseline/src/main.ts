import { color, positionLocal, select } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // "Split": a node material that paints local x below 0 in rose and the rest in blue.
  const split = new MeshBasicNodeMaterial();
  split.colorNode = select(positionLocal.x.lessThan(0), color(srgb("#e11d48")), color(srgb("#2563eb")));

  const cube = boxMesh([1, 1, 1], split);
  cube.name = "Cube";
  scene.add(cube);

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#0f0f1a",
  };
});
