import { color, uniform } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // "Flat": a node material whose colour is settable via tint input.
  const tintUniform = uniform(srgb("#808080"));
  const flat = new MeshBasicNodeMaterial();
  flat.name = "Flat";
  flat.colorNode = color(tintUniform);

  const cube = boxMesh([1, 1, 1], flat);
  cube.name = "Cube";
  scene.add(cube);

  host.onInput("tint", (value) => {
    if (typeof value === "string") {
      tintUniform.value.copy(srgb(value));
    }
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
