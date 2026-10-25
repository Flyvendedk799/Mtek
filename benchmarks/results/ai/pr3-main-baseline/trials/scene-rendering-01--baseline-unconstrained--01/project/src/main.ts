import { Scene } from "three/webgpu";
import { boxMesh, sphereMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Create the green box (Cube)
  const cube = boxMesh([1, 1, 1], unlit("#22c55e"));
  cube.name = "Cube";
  scene.add(cube);
  
  // Create the blue sphere (Ball)
  const ball = sphereMesh(0.5, unlit("#3b82f6"));
  ball.name = "Ball";
  ball.position.set(2, 0, 0);
  scene.add(ball);
  
  return {
    scene,
    camera: lookAtCamera({ 
      position: [0, 0, 6], 
      target: [0, 0, 0],
      fovY: 0.9,
      near: 0.1,
      far: 1000
    }),
    clearColor: "#202020",
  };
});
