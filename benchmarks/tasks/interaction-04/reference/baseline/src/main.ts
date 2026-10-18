import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, srgb, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const RUN_SECONDS = 1.5;
const IDLE = "#3a3a3a";
const RUNNING = "#ffb000";
const DONE = "#22c55e";

type Phase = "idle" | "running" | "done";

void startTask((host) => {
  const scene = new Scene();

  const material = unlit(IDLE);
  const beacon = boxMesh([4, 4, 0.5], material);
  beacon.name = "Beacon";
  scene.add(beacon);

  let phase: Phase = "idle";
  let elapsed = 0;
  const show = (): void => {
    material.color.copy(srgb(phase === "idle" ? IDLE : phase === "running" ? RUNNING : DONE));
  };

  host.onKeyDown("Space", () => {
    if (phase === "idle") {
      phase = "running";
      elapsed = 0;
    } else if (phase === "done") {
      phase = "idle";
    }
    show();
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt) {
      if (phase !== "running") return;
      elapsed += dt;
      if (elapsed >= RUN_SECONDS) {
        phase = "done";
        show();
      }
    },
  };
});
