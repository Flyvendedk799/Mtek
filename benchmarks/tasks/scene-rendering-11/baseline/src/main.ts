import { Scene } from "three/webgpu";
import { lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

// Skeleton. `startTask` renders the returned scene into a 128 x 128 target for the tests.
// Build the scene described in the task and return it. The function may be async (`async () => ...`): `startTask` waits for it.
// The files of assets/ are served next to the page, so the image of the task is the URL "assets/swatch.png"; the support module
// has a helper that loads such an image as a three.js texture.
void startTask(() => ({
  scene: new Scene(),
  camera: lookAtCamera({ position: [0, 0, 1], target: [0, 0, 0] }),
  clearColor: "#000000",
}));
