import { Scene } from "three/webgpu";
import { orthographicCamera, startTask } from "@mtek/benchmarks/baseline-support";

// Skeleton. `startTask` renders the returned scene into a 128 x 128 target for the tests.
// Build the scene described in the task and return it.
void startTask(() => ({
  scene: new Scene(),
  camera: orthographicCamera({ position: [0, 0, 1], target: [0, 0, 0] }),
  clearColor: "#000000",
}));
