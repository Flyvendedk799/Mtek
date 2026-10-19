import { Scene } from "three/webgpu";
import {
  boxMesh,
  orthographicCamera,
  startTask,
  unlit,
} from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  scene.background = null; // Will use clearColor

  // Create the track (thin dark grey box)
  const track = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  track.position.set(0, -1, 0);
  track.name = "Track";
  scene.add(track);

  // Create the runner (orange block)
  const runner = boxMesh([1, 1, 0.5], unlit("#f97316"));
  runner.position.set(-5, 0, 0);
  runner.name = "Runner";
  scene.add(runner);

  // State management
  let isMoving = false;

  // Space bar toggles movement
  host.onKeyDown("Space", () => {
    isMoving = !isMoving;
  });

  // Update function handles movement
  let update = (dt: number) => {
    if (isMoving) {
      // Move runner at 4 world units per second
      runner.position.x += 4 * dt;

      // Wrap around: keep x in range [-6, 6)
      if (runner.position.x >= 6) {
        runner.position.x -= 12;
      }
    }
  };

  return {
    scene,
    camera: orthographicCamera({
      position: [0, 0, 10],
      target: [0, 0, 0],
      height: 12.8,
      near: 0.1,
      far: 1000,
    }),
    clearColor: "#202020",
    update,
  };
});
