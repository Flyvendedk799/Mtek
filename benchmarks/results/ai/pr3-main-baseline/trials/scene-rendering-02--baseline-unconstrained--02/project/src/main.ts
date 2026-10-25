import { Scene, Mesh } from "three/webgpu";
import { boxMesh, sphereMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Create the amber bar
  const bar = boxMesh([4.0, 1.0, 0.5], unlit("#f59e0b"));
  bar.name = "Bar";
  bar.rotation.z = 0.9272952; // cos=0.6, sin=0.8
  scene.add(bar);

  // Create the red sphere at the end of the bar
  const tip = sphereMesh(0.6, unlit("#ef4444"));
  tip.name = "Tip";
  tip.position.set(1.2, 1.6, 0);
  scene.add(tip);

  return {
    scene,
    camera: lookAtCamera({
      position: [0, 0, 8],
      target: [0, 0, 0],
      fovY: 0.8,
      near: 0.1,
      far: 100,
    }),
    clearColor: "#101820",
  };
});
