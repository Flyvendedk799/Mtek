import { Scene, Group, Mesh } from "three/webgpu";
import { lookAtCamera, startTask, unlit, boxMesh, sphereMesh } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Create the base box
  const baseMaterial = unlit("#64748b");
  const baseGeometry = boxMesh([1.2, 1.2, 1.2], baseMaterial);
  baseGeometry.name = "Base";
  baseGeometry.position.set(-2.5, -1.5, 0);
  scene.add(baseGeometry);
  
  // Create the Arm node (no shape, just a transform node)
  const arm = new Group();
  arm.name = "Arm";
  arm.position.set(-2.5, -1.5, 0);
  // Rotation by 0.6435011 radians (counter-clockwise about Z axis)
  arm.rotation.z = 0.6435011;
  arm.scale.set(1, 1, 1);
  scene.add(arm);
  
  // Create the Upper box (child of Arm)
  const upperMaterial = unlit("#3b82f6");
  const upper = boxMesh([4.0, 0.8, 0.6], upperMaterial);
  upper.name = "Upper";
  upper.position.set(2, 0, 0);
  arm.add(upper);
  
  // Create the Elbow node (no shape, just a transform node, child of Arm)
  const elbow = new Group();
  elbow.name = "Elbow";
  elbow.position.set(4, 0, 0);
  elbow.rotation.z = -1.287002;
  elbow.scale.set(0.75, 0.75, 0.75);
  arm.add(elbow);
  
  // Create the Fore box (child of Elbow)
  const foreMaterial = unlit("#22c55e");
  const fore = boxMesh([3.0, 0.7, 0.5], foreMaterial);
  fore.name = "Fore";
  fore.position.set(1.5, 0, 0);
  elbow.add(fore);
  
  // Create the Hand sphere (child of Elbow)
  const handMaterial = unlit("#f43f5e");
  const hand = sphereMesh(0.6, handMaterial);
  hand.name = "Hand";
  hand.position.set(3, 0, 0);
  elbow.add(hand);
  
  return {
    scene,
    camera: lookAtCamera({ 
      position: [0, 0, 9], 
      target: [0, 0, 0],
      fovY: 0.8,
      near: 0.1,
      far: 1000
    }),
    clearColor: "#14161c",
  };
});
