import { color, uniform } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // "Flat": a node material whose colour is parameterized by a uniform.
  const colorUniform = uniform(color(srgb("#808080")));
  const flat = new MeshBasicNodeMaterial();
  flat.name = "Flat";
  flat.colorNode = colorUniform;

  const cube = boxMesh([1, 1, 1], flat);
  cube.name = "Cube";
  scene.add(cube);

  // Listen for tint input from the host
  host.onInput("tint", (value) => {
    if (typeof value === "string") {
      colorUniform.value.copy(srgb(value));
    }
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
