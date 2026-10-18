import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const lampA = boxMesh([2, 2, 0.5], unlit("#3a3a3a"));
  lampA.name = "LampA";
  lampA.position.set(-3, 0, 0);
  scene.add(lampA);

  const lampB = boxMesh([2, 2, 0.5], unlit("#3a3a3a"));
  lampB.name = "LampB";
  lampB.position.set(3, 0, 0);
  scene.add(lampB);

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
