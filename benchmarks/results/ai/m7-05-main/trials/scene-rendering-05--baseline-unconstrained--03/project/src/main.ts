import { Mesh, PlaneGeometry, Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // A PlaneGeometry lies in the XY plane facing +Z; turn it to lie flat facing +Y.
  const floor = new Mesh(new PlaneGeometry(7, 7), unlit("#3f4a5a"));
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2;

  const crate = boxMesh([1.5, 1.5, 1.5], unlit("#f97316"));
  crate.name = "Crate";
  crate.position.set(2, 0.75, -1);

  const dome = sphereMesh(1.2, unlit("#38bdf8"));
  dome.name = "Dome";
  dome.position.set(-1.5, 0, 1);

  scene.add(floor, crate, dome);
  return {
    scene,
    camera: orthographicCamera({ position: [0, 6, 6], target: [0, 0, 0], height: 8, near: 0.1, far: 100 }),
    clearColor: "#1a1d23",
  };
});
