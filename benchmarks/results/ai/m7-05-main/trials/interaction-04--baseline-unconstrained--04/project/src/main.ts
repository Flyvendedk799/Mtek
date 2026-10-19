import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const beacon = boxMesh([4, 4, 0.5], unlit("#3a3a3a"));
  beacon.name = "Beacon";
  scene.add(beacon);

  type BeaconState = "idle" | "running" | "done";
  let state: BeaconState = "idle";
  let elapsedTime = 0;
  const RUN_DURATION = 1.5;

  const setBeaconColor = (newState: BeaconState) => {
    const material = beacon.material as any;
    if (newState === "idle") {
      material.color.setStyle("#3a3a3a");
    } else if (newState === "running") {
      material.color.setStyle("#ffb000");
    } else if (newState === "done") {
      material.color.setStyle("#22c55e");
    }
  };

  host.onKeyDown("Space", () => {
    if (state === "idle") {
      state = "running";
      elapsedTime = 0;
      setBeaconColor("running");
    } else if (state === "done") {
      state = "idle";
      elapsedTime = 0;
      setBeaconColor("idle");
    }
    // If state === "running", do nothing
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt) {
      if (state === "running") {
        elapsedTime += dt;
        if (elapsedTime >= RUN_DURATION) {
          state = "done";
          setBeaconColor("done");
        }
      }
    },
  };
});
