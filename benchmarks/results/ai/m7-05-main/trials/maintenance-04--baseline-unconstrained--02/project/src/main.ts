import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const STEP_DEGREES = 30;

void startTask((host) => {
  const scene = new Scene();

  const turret = boxMesh([2, 2, 2], unlit("#6b5cff"));
  turret.name = "Turret";
  const barrel = boxMesh([0.8, 0.8, 0.8], unlit("#f59e0b"));
  barrel.name = "Barrel";
  barrel.position.set(0, 0, 2.2);
  turret.add(barrel);
  scene.add(turret);

  // The turret's heading in degrees: 0 when the barrel points at the camera, growing to the right.
  let heading = 0;
  host.onKeyDown("Space", () => {
    heading += STEP_DEGREES;
    turret.rotation.y = (heading * Math.PI) / 180;
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
