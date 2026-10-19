import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const beacon = boxMesh([4, 4, 0.5], unlit("#3a3a3a"));
  beacon.name = "Beacon";
  const beaconMaterial = beacon.material as import("three/webgpu").MeshBasicMaterial;
  scene.add(beacon);

  type State = "idle" | "running" | "done";
  let state: State = "idle";
  let elapsedTime = 0;
  const runDuration = 1.5;

  host.onKeyDown("Space", () => {
    if (state === "idle") {
      state = "running";
      elapsedTime = 0;
      beaconMaterial.color.setStyle("#ffb000");
    } else if (state === "done") {
      state = "idle";
      elapsedTime = 0;
      beaconMaterial.color.setStyle("#3a3a3a");
    }
    // If running, do nothing
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt) {
      if (state === "running") {
        elapsedTime += dt;
        if (elapsedTime >= runDuration) {
          state = "done";
          beaconMaterial.color.setStyle("#22c55e");
        }
      }
    },
  };
});
