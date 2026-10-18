import { Object3D, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const base = boxMesh([1.2, 1.2, 1.2], unlit("#64748b"));
  base.name = "Base";
  base.position.set(-2.5, -1.5, 0);

  const arm = new Object3D();
  arm.name = "Arm";
  arm.position.set(-2.5, -1.5, 0);
  arm.rotation.z = 0.6435011;

  const upper = boxMesh([4, 0.8, 0.6], unlit("#3b82f6"));
  upper.name = "Upper";
  upper.position.set(2, 0, 0);

  const elbow = new Object3D();
  elbow.name = "Elbow";
  elbow.position.set(4, 0, 0);
  elbow.rotation.z = -1.287002;
  elbow.scale.setScalar(0.75);

  const fore = boxMesh([3, 0.7, 0.5], unlit("#22c55e"));
  fore.name = "Fore";
  fore.position.set(1.5, 0, 0);

  const hand = sphereMesh(0.6, unlit("#f43f5e"));
  hand.name = "Hand";
  hand.position.set(3, 0, 0);

  elbow.add(fore, hand);
  arm.add(upper, elbow);
  scene.add(base, arm);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 9], target: [0, 0, 0], fovY: 0.8 }),
    clearColor: "#14161c",
  };
});
