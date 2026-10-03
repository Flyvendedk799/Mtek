import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const cube = boxMesh([1, 1, 1], unlit("#22c55e"));
  cube.name = "Cube";

  const ball = sphereMesh(0.5, unlit("#3b82f6"));
  ball.name = "Ball";
  ball.position.set(2, 0, 0);

  scene.add(cube, ball);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
