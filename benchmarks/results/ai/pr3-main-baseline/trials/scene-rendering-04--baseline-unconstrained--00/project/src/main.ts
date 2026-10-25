import { Scene } from "three/webgpu";
import { boxMesh, sphereMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Floor: 12 x 12 units, y = 0, facing up
  const floorMesh = boxMesh([12, 0.01, 12], unlit("#4b5563"));
  floorMesh.position.set(0, 0, 0);
  floorMesh.name = "Floor";
  scene.add(floorMesh);
  
  // Tower: 1.5 x 3.0 x 1.5 box at (0, 1.5, 0)
  const towerMesh = boxMesh([1.5, 3.0, 1.5], unlit("#2563eb"));
  towerMesh.position.set(0, 1.5, 0);
  towerMesh.name = "Tower";
  scene.add(towerMesh);
  
  // Block: 2.0 x 1.0 x 2.0 box at (1.5, 0.5, 1.8)
  const blockMesh = boxMesh([2.0, 1.0, 2.0], unlit("#dc2626"));
  blockMesh.position.set(1.5, 0.5, 1.8);
  blockMesh.name = "Block";
  scene.add(blockMesh);
  
  // Ball: sphere with radius 0.8 at (-1.6, 0.8, 1.2)
  const ballMesh = sphereMesh(0.8, unlit("#eab308"));
  ballMesh.position.set(-1.6, 0.8, 1.2);
  ballMesh.name = "Ball";
  scene.add(ballMesh);
  
  return {
    scene,
    camera: lookAtCamera({
      position: [5, 4, 9],
      target: [0, 1, 0],
      fovY: 0.7,
      near: 0.1,
      far: 1000
    }),
    clearColor: "#9db4cc",
  };
});
