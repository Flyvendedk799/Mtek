import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Create green box (Cube)
  const cube = boxMesh([1, 1, 1], unlit("#22c55e"));
  cube.name = "Cube";
  scene.add(cube);
  
  // Create blue sphere (Ball)
  const sphere = sphereMesh(0.5, unlit("#3b82f6"));
  sphere.name = "Ball";
  sphere.position.set(2, 0, 0);
  scene.add(sphere);
  
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0], fovY: 0.9, near: 0.1, far: 1000 }),
    clearColor: "#202020",
  };
});
