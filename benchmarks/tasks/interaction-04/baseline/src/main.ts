import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const beacon = boxMesh([4, 4, 0.5], unlit("#3a3a3a"));
  beacon.name = "Beacon";
  scene.add(beacon);

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
