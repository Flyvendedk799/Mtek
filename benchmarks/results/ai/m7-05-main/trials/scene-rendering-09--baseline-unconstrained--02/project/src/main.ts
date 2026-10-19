import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Mid box at origin
  const mid = boxMesh([2, 2, 2], unlit("#ef4444"));
  mid.name = "Mid";
  mid.position.set(0, 0, 0);
  scene.add(mid);

  // Slab box
  const slab = boxMesh([2, 2, 2], unlit("#22c55e"));
  slab.name = "Slab";
  slab.position.set(-2.5, 0, 5.5);
  scene.add(slab);

  // Far box (larger)
  const far = boxMesh([3, 3, 3], unlit("#3b82f6"));
  far.name = "Far";
  far.position.set(3.2, 0, -4);
  scene.add(far);

  // Behind box (outside far plane)
  const behind = boxMesh([2, 2, 2], unlit("#ec4899"));
  behind.name = "Behind";
  behind.position.set(0, 0, 14);
  scene.add(behind);

  // Ghost box (hidden)
  const ghost = boxMesh([2, 2, 2], unlit("#facc15"));
  ghost.name = "Ghost";
  ghost.position.set(3, 0, 2);
  ghost.visible = false;
  scene.add(ghost);

  // Rim box (different dimensions)
  const rim = boxMesh([2, 2, 5], unlit("#a855f7"));
  rim.name = "Rim";
  rim.position.set(3.2, -2.2, 0);
  scene.add(rim);

  return {
    scene,
    camera: lookAtCamera({
      position: [0, 0, 10],
      target: [0, 0, 0],
      fovY: 0.9,
      near: 4.0,
      far: 12.0,
    }),
    clearColor: "#1e293b",
  };
});
