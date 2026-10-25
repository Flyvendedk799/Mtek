import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const beacon = boxMesh([4, 4, 0.5], unlit("#3a3a3a"));
  beacon.name = "Beacon";
  scene.add(beacon);

  type State = "idle" | "running" | "done";
  let state: State = "idle";
  let elapsedTime = 0;
  const RUN_DURATION = 1.5;

  const updateColor = (newState: State) => {
    const material = beacon.material as any;
    switch (newState) {
      case "idle":
        material.color.setStyle("#3a3a3a");
        break;
      case "running":
        material.color.setStyle("#ffb000");
        break;
      case "done":
        material.color.setStyle("#22c55e");
        break;
    }
  };

  host.onKeyDown("Space", () => {
    if (state === "idle") {
      state = "running";
      elapsedTime = 0;
      updateColor("running");
    } else if (state === "done") {
      state = "idle";
      elapsedTime = 0;
      updateColor("idle");
    }
    // If state === "running", do nothing
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt: number) {
      if (state === "running") {
        elapsedTime += dt;
        if (elapsedTime >= RUN_DURATION) {
          state = "done";
          updateColor("done");
        }
      }
    },
  };
});
