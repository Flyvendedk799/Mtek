import { uniform } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // Create a uniform that holds the colour, starting at #808080
  const tintUniform = uniform(srgb("#808080"));

  // "Flat": a node material whose colour comes from the tintUniform
  const flat = new MeshBasicNodeMaterial();
  flat.name = "Flat";
  flat.colorNode = tintUniform;

  const cube = boxMesh([1, 1, 1], flat);
  cube.name = "Cube";
  scene.add(cube);

  // Listen for the "tint" input from the host
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
