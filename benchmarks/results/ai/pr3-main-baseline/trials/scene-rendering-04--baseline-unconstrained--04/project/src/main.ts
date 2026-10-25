import { Scene, Mesh } from "three/webgpu";
import { MeshBasicMaterial, PlaneGeometry, BoxGeometry, SphereGeometry, FrontSide } from "three/webgpu";
import { boxMesh, sphereMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Floor: 12x12 square at y=0, single-sided facing up
  const floorGeometry = new PlaneGeometry(12, 12);
  const floorMaterial = new MeshBasicMaterial({
    color: 0x4b5563,
    side: FrontSide,
  });
  floorMaterial.name = "FloorMaterial";
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat in XZ plane facing up
  floor.position.y = 0;
  scene.add(floor);

  // Tower: Box 1.5 (x) × 3.0 (y) × 1.5 (z) at (0, 1.5, 0)
  const tower = boxMesh([1.5, 3.0, 1.5], unlit("#2563eb"));
  tower.name = "Tower";
  tower.position.set(0, 1.5, 0);
  scene.add(tower);

  // Block: Box 2.0 (x) × 1.0 (y) × 2.0 (z) at (1.5, 0.5, 1.8)
  const block = boxMesh([2.0, 1.0, 2.0], unlit("#dc2626"));
  block.name = "Block";
  block.position.set(1.5, 0.5, 1.8);
  scene.add(block);

  // Ball: Sphere radius 0.8 at (-1.6, 0.8, 1.2)
  const ball = sphereMesh(0.8, unlit("#eab308"));
  ball.name = "Ball";
  ball.position.set(-1.6, 0.8, 1.2);
  scene.add(ball);

  // Camera at (5, 4, 9) looking at (0, 1, 0)
  const camera = lookAtCamera({
    position: [5, 4, 9],
    target: [0, 1, 0],
    fovY: 0.7,
    near: 0.1,
    far: 1000,
  });

  return {
    scene,
    camera,
    clearColor: "#9db4cc",
  };
});
