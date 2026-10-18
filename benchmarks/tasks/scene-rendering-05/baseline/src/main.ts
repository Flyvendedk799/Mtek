import { Mesh, PlaneGeometry, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // A PlaneGeometry lies in the XY plane facing +Z; turn it to lie flat facing +Y.
  const floor = new Mesh(new PlaneGeometry(7, 7), unlit("#3f4a5a"));
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2;

  const crate = boxMesh([1.5, 1.5, 1.5], unlit("#f97316"));
  crate.name = "Crate";
  crate.position.set(0, 0.75, 0);

  scene.add(floor, crate);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 3, 8], target: [0, 0, 0] }),
    clearColor: "#1a1d23",
  };
});
