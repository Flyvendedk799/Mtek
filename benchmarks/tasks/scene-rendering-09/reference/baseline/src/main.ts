import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const mid = boxMesh([2, 2, 2], unlit("#ef4444"));
  mid.name = "Mid";

  const slab = boxMesh([2, 2, 2], unlit("#22c55e"));
  slab.name = "Slab";
  slab.position.set(-2.5, 0, 5.5);

  const far = boxMesh([3, 3, 3], unlit("#3b82f6"));
  far.name = "Far";
  far.position.set(3.2, 0, -4);

  const behind = boxMesh([2, 2, 2], unlit("#ec4899"));
  behind.name = "Behind";
  behind.position.set(0, 0, 14);

  const ghost = boxMesh([2, 2, 2], unlit("#facc15"));
  ghost.name = "Ghost";
  ghost.position.set(3, 0, 2);
  ghost.visible = false;

  const rim = boxMesh([2, 2, 5], unlit("#a855f7"));
  rim.name = "Rim";
  rim.position.set(3.2, -2.2, 0);

  scene.add(mid, slab, far, behind, ghost, rim);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 10], target: [0, 0, 0], fovY: 0.9, near: 4, far: 12 }),
    clearColor: "#1e293b",
  };
});
