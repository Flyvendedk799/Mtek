import { Scene } from "three/webgpu";
import { boxMesh, sphereMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";
import { PlaneGeometry, Mesh, FrontSide } from "three/webgpu";

void startTask(() => {
  const scene = new Scene();

  // Floor: 12 x 12 units, y = 0, one-sided facing up
  const floorGeometry = new PlaneGeometry(12, 12);
  const floorMaterial = unlit("#4b5563");
  floorMaterial.side = FrontSide;
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Lay it flat, facing up
  floor.position.y = 0;
  scene.add(floor);

  // Tower: box 1.5 wide (x), 3.0 tall (y), 1.5 deep (z), centered at (0, 1.5, 0)
  const tower = boxMesh([1.5, 3.0, 1.5], unlit("#2563eb"));
  tower.name = "Tower";
  tower.position.set(0, 1.5, 0);
  scene.add(tower);

  // Block: box 2.0 wide (x), 1.0 tall (y), 2.0 deep (z), centered at (1.5, 0.5, 1.8)
  const block = boxMesh([2.0, 1.0, 2.0], unlit("#dc2626"));
  block.name = "Block";
  block.position.set(1.5, 0.5, 1.8);
  scene.add(block);

  // Ball: sphere radius 0.8, centered at (-1.6, 0.8, 1.2)
  const ball = sphereMesh(0.8, unlit("#eab308"));
  ball.name = "Ball";
  ball.position.set(-1.6, 0.8, 1.2);
  scene.add(ball);

  return {
    scene,
    camera: lookAtCamera({
      position: [5, 4, 9],
      target: [0, 1, 0],
      fovY: 0.7,
      near: 0.1,
      far: 1000,
    }),
    clearColor: "#9db4cc",
  };
});
