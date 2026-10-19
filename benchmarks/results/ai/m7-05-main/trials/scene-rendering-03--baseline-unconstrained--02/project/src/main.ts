import { Scene, Group, Mesh } from "three/webgpu";
import { BoxGeometry, SphereGeometry, MeshBasicMaterial } from "three/webgpu";
import { boxMesh, sphereMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Set clear color
  const clearColor = "#14161c";

  // Create camera
  const camera = lookAtCamera({
    position: [0, 0, 9],
    target: [0, 0, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  // Base box
  const baseBox = boxMesh([1.2, 1.2, 1.2], unlit("#64748b"));
  baseBox.name = "Base";
  baseBox.position.set(-2.5, -1.5, 0);
  scene.add(baseBox);

  // Arm hierarchy
  const armNode = new Group();
  armNode.name = "Arm";
  armNode.position.set(-2.5, -1.5, 0);
  armNode.rotation.z = 0.6435011;
  armNode.scale.set(1, 1, 1);
  scene.add(armNode);

  // Upper box (in Arm's frame)
  const upperBox = boxMesh([4.0, 0.8, 0.6], unlit("#3b82f6"));
  upperBox.name = "Upper";
  upperBox.position.set(2, 0, 0);
  armNode.add(upperBox);

  // Elbow node (in Arm's frame)
  const elbowNode = new Group();
  elbowNode.name = "Elbow";
  elbowNode.position.set(4, 0, 0);
  elbowNode.rotation.z = -1.287002;
  elbowNode.scale.set(0.75, 0.75, 0.75);
  armNode.add(elbowNode);

  // Fore box (in Elbow's frame)
  const foreBox = boxMesh([3.0, 0.7, 0.5], unlit("#22c55e"));
  foreBox.name = "Fore";
  foreBox.position.set(1.5, 0, 0);
  elbowNode.add(foreBox);

  // Hand sphere (in Elbow's frame)
  const handSphere = sphereMesh(0.6, unlit("#f43f5e"));
  handSphere.name = "Hand";
  handSphere.position.set(3, 0, 0);
  elbowNode.add(handSphere);

  return {
    scene,
    camera,
    clearColor,
  };
});
