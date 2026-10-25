import { Scene, Group, Mesh } from "three/webgpu";
import { BoxGeometry, SphereGeometry } from "three";
import { MeshBasicMaterial } from "three/webgpu";
import { lookAtCamera, startTask, boxMesh, sphereMesh, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Base box
  const baseGeometry = new BoxGeometry(1.2, 1.2, 1.2);
  const baseMaterial = new MeshBasicMaterial({ color: 0x64748b });
  const base = new Mesh(baseGeometry, baseMaterial);
  base.name = "Base";
  base.position.set(-2.5, -1.5, 0);
  scene.add(base);

  // Arm node (no shape, just a transform node)
  const arm = new Group();
  arm.name = "Arm";
  arm.position.set(-2.5, -1.5, 0);
  // Rotation by 0.6435011 radians (cos=0.8, sin=0.6) about Z axis
  arm.rotation.z = 0.6435011;
  arm.scale.set(1, 1, 1);
  scene.add(arm);

  // Upper box - child of Arm
  const upperGeometry = new BoxGeometry(4.0, 0.8, 0.6);
  const upperMaterial = new MeshBasicMaterial({ color: 0x3b82f6 });
  const upper = new Mesh(upperGeometry, upperMaterial);
  upper.name = "Upper";
  upper.position.set(2, 0, 0);
  arm.add(upper);

  // Elbow node (no shape) - child of Arm
  const elbow = new Group();
  elbow.name = "Elbow";
  elbow.position.set(4, 0, 0);
  elbow.rotation.z = -1.287002;
  elbow.scale.set(0.75, 0.75, 0.75);
  arm.add(elbow);

  // Fore box - child of Elbow
  const foreGeometry = new BoxGeometry(3.0, 0.7, 0.5);
  const foreMaterial = new MeshBasicMaterial({ color: 0x22c55e });
  const fore = new Mesh(foreGeometry, foreMaterial);
  fore.name = "Fore";
  fore.position.set(1.5, 0, 0);
  elbow.add(fore);

  // Hand sphere - child of Elbow
  const handGeometry = new SphereGeometry(0.6, 32, 16);
  const handMaterial = new MeshBasicMaterial({ color: 0xf43f5e });
  const hand = new Mesh(handGeometry, handMaterial);
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
      far: 1000,
    }),
    clearColor: "#14161c",
  };
});
