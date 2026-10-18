import { Mesh, PlaneGeometry, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // A PlaneGeometry faces +Z; turned by -90 degrees about X it lies in the x-z plane facing up.
  const floor = new Mesh(new PlaneGeometry(8, 8), unlit("#4d7c0f"));
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2;

  const front = boxMesh([2, 2, 1], unlit("#2563eb"));
  front.name = "Front";
  front.position.set(-1.3, 1, 0.8);

  const back = boxMesh([1.5, 3, 1.5], unlit("#dc2626"));
  back.name = "Back";
  back.position.set(-1.5, 1.5, -1.5);

  const tall = boxMesh([1, 2, 1], unlit("#f97316"));
  tall.name = "Tall";
  tall.position.set(2.3, 1, -0.8);

  const orb = sphereMesh(0.9, unlit("#14b8a6"));
  orb.name = "Orb";
  orb.position.set(1.2, 0.9, -0.8);

  const ghost = boxMesh([1, 1, 1], unlit("#f8fafc"));
  ghost.name = "Ghost";
  ghost.position.set(0.5, 0.5, 1);
  ghost.visible = false;

  scene.add(floor, front, back, tall, orb, ghost);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 5, 10], target: [0, 0, 0], fovY: 0.9, near: 0.1, far: 100 }),
    clearColor: "#0f172a",
  };
});
