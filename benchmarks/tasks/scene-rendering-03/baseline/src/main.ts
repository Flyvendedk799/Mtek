import { Scene } from "three/webgpu";
import { lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

// Skeleton. `startTask` renders the returned scene into a 128 x 128 target for the tests.
// Build the scene described in the task and return it.
void startTask(() => ({
  scene: new Scene(),
  camera: lookAtCamera({ position: [0, 0, 1], target: [0, 0, 0] }),
  clearColor: "#000000",
}));
