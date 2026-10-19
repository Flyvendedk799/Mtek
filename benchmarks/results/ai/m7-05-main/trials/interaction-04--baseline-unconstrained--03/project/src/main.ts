import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

type BeaconState = "idle" | "running" | "done";

void startTask((host) => {
  const scene = new Scene();

  const beacon = boxMesh([4, 4, 0.5], unlit("#3a3a3a"));
  beacon.name = "Beacon";
  scene.add(beacon);

  let state: BeaconState = "idle";
  let runTimer = 0;
  const RUN_DURATION = 1.5;

  host.onKeyDown("Space", () => {
    if (state === "idle") {
      state = "running";
      runTimer = 0;
      (beacon.material as any).color.setStyle("#ffb000");
    } else if (state === "done") {
      state = "idle";
      runTimer = 0;
      (beacon.material as any).color.setStyle("#3a3a3a");
    }
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt: number) {
      if (state === "running") {
        runTimer += dt;
        if (runTimer >= RUN_DURATION) {
          state = "done";
          (beacon.material as any).color.setStyle("#22c55e");
        }
      }
    },
  };
});
