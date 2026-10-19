import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry, MeshBasicMaterial } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Create the six boxes
  const mid = boxMesh([2.0, 2.0, 2.0], unlit("#ef4444"));
  mid.name = "Mid";
  mid.position.set(0, 0, 0);
  scene.add(mid);
  
  const slab = boxMesh([2.0, 2.0, 2.0], unlit("#22c55e"));
  slab.name = "Slab";
  slab.position.set(-2.5, 0, 5.5);
  scene.add(slab);
  
  const far = boxMesh([3.0, 3.0, 3.0], unlit("#3b82f6"));
  far.name = "Far";
  far.position.set(3.2, 0, -4);
  scene.add(far);
  
  const behind = boxMesh([2.0, 2.0, 2.0], unlit("#ec4899"));
  behind.name = "Behind";
  behind.position.set(0, 0, 14);
  scene.add(behind);
  
  const ghost = boxMesh([2.0, 2.0, 2.0], unlit("#facc15"));
  ghost.name = "Ghost";
  ghost.position.set(3, 0, 2);
  ghost.visible = false;
  scene.add(ghost);
  
  // Rim with custom dimensions [2.0, 2.0, 5.0]
  const rimGeometry = new BoxGeometry(2.0, 2.0, 5.0);
  const rimMaterial = unlit("#a855f7");
  const rim = new Mesh(rimGeometry, rimMaterial);
  rim.name = "Rim";
  rim.position.set(3.2, -2.2, 0);
  scene.add(rim);
  
  const camera = lookAtCamera({
    position: [0, 0, 10],
    target: [0, 0, 0],
    fovY: 0.9,
    near: 4.0,
    far: 12.0
  });
  
  return {
    scene,
    camera,
    clearColor: "#1e293b"
  };
});
