import { Mesh, PlaneGeometry, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // A PlaneGeometry lies in the XY plane facing +Z; turn it to lie flat facing +Y.
  const floor = new Mesh(new PlaneGeometry(12, 12), unlit("#4b5563"));
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2;

  const block = boxMesh([2, 1, 2], unlit("#dc2626"));
  block.name = "Block";
  block.position.set(1.5, 0.5, 1.8);

  const tower = boxMesh([1.5, 3, 1.5], unlit("#2563eb"));
  tower.name = "Tower";
  tower.position.set(0, 1.5, 0);

  const ball = sphereMesh(0.8, unlit("#eab308"));
  ball.name = "Ball";
  ball.position.set(-1.6, 0.8, 1.2);

  scene.add(floor, block, tower, ball);
  return {
    scene,
    camera: lookAtCamera({ position: [5, 4, 9], target: [0, 1, 0], fovY: 0.7 }),
    clearColor: "#9db4cc",
  };
});
