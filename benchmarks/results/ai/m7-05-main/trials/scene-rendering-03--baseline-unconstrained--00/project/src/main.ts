import { Scene, Mesh } from "three/webgpu";
import { lookAtCamera, startTask, boxMesh, sphereMesh, unlit, srgb } from "@mtek/benchmarks/baseline-support";
import { Group } from "three";

void startTask(() => {
  const scene = new Scene();
  
  // Create the base box
  const baseMaterial = unlit("#64748b");
  const baseBox = boxMesh([1.2, 1.2, 1.2], baseMaterial);
  baseBox.name = "Base";
  baseBox.position.set(-2.5, -1.5, 0);
  scene.add(baseBox);
  
  // Create the arm hierarchy
  const armNode = new Group();
  armNode.name = "Arm";
  armNode.position.set(-2.5, -1.5, 0);
  armNode.rotation.z = 0.6435011; // cos(0.8) = 0.8, sin(0.6) rotation
  armNode.scale.set(1, 1, 1);
  scene.add(armNode);
  
  // Upper arm box
  const upperMaterial = unlit("#3b82f6");
  const upperBox = boxMesh([4.0, 0.8, 0.6], upperMaterial);
  upperBox.name = "Upper";
  upperBox.position.set(2, 0, 0);
  armNode.add(upperBox);
  
  // Elbow node (child of arm)
  const elbowNode = new Group();
  elbowNode.name = "Elbow";
  elbowNode.position.set(4, 0, 0);
  elbowNode.rotation.z = -1.287002;
  elbowNode.scale.set(0.75, 0.75, 0.75);
  armNode.add(elbowNode);
  
  // Forearm box (child of elbow)
  const foreMaterial = unlit("#22c55e");
  const foreBox = boxMesh([3.0, 0.7, 0.5], foreMaterial);
  foreBox.name = "Fore";
  foreBox.position.set(1.5, 0, 0);
  elbowNode.add(foreBox);
  
  // Hand sphere (child of elbow)
  const handMaterial = unlit("#f43f5e");
  const handSphere = sphereMesh(0.6, handMaterial);
  handSphere.name = "Hand";
  handSphere.position.set(3, 0, 0);
  elbowNode.add(handSphere);
  
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 9], target: [0, 0, 0], fovY: 0.8, near: 0.1, far: 1000 }),
    clearColor: "#14161c",
  };
});
