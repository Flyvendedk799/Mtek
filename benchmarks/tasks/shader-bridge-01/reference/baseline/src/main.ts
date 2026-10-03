import { uniform } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // "Flat": a node material whose colour is a uniform, so changing it never rebuilds the shader.
  const tint = uniform(srgb("#808080"));
  const flat = new MeshBasicNodeMaterial();
  flat.colorNode = tint;

  const cube = boxMesh([1, 1, 1], flat);
  cube.name = "Cube";
  scene.add(cube);

  host.onInput("tint", (value) => {
    if (typeof value !== "string") throw new TypeError("tint must be a colour string like #ff8800");
    tint.value.copy(srgb(value));
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
