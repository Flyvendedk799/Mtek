import { color } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // "Flat": a node material whose colour is fixed at #808080.
  const flat = new MeshBasicNodeMaterial();
  flat.colorNode = color(srgb("#808080"));

  const cube = boxMesh([1, 1, 1], flat);
  cube.name = "Cube";
  scene.add(cube);

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
