import { Scene, Mesh, Group } from "three/webgpu";
import { lookAtCamera, startTask, boxMesh, sphereMesh, unlit, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  scene.background = srgb("#14161c");

  // Camera
  const camera = lookAtCamera({
    position: [0, 0, 9],
    target: [0, 0, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  // Base box
  const base = boxMesh([1.2, 1.2, 1.2], unlit("#64748b"));
  base.name = "Base";
  base.position.set(-2.5, -1.5, 0);
  scene.add(base);

  // Arm hierarchy
  const arm = new Group();
  arm.name = "Arm";
  arm.position.set(-2.5, -1.5, 0);
  // Rotation: angle = 0.6435011, cos(0.6435011) = 0.8, sin(0.6435011) = 0.6
  arm.rotation.z = 0.6435011;
  arm.scale.set(1, 1, 1);
  scene.add(arm);

  // Upper arm box
  const upper = boxMesh([4.0, 0.8, 0.6], unlit("#3b82f6"));
  upper.name = "Upper";
  upper.position.set(2, 0, 0);
  arm.add(upper);

  // Elbow node
  const elbow = new Group();
  elbow.name = "Elbow";
  elbow.position.set(4, 0, 0);
  elbow.rotation.z = -1.287002;
  elbow.scale.set(0.75, 0.75, 0.75);
  arm.add(elbow);

  // Fore arm box (in Elbow's frame, before scale applies)
  const fore = boxMesh([3.0, 0.7, 0.5], unlit("#22c55e"));
  fore.name = "Fore";
  fore.position.set(1.5, 0, 0);
  elbow.add(fore);

  // Hand sphere (in Elbow's frame, before scale applies)
  const hand = sphereMesh(0.6, unlit("#f43f5e"));
  hand.name = "Hand";
  hand.position.set(3, 0, 0);
  elbow.add(hand);

  return {
    scene,
    camera,
    clearColor: "#14161c",
  };
});
