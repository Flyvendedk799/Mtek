import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  
  // Set up camera - orthographic at (0, 0, 10) looking at origin
  // visible height is 12.8 world units
  const camera = orthographicCamera({
    position: [0, 0, 10],
    target: [0, 0, 0],
    height: 12.8,
    near: 0.1,
    far: 1000,
  });

  // Create track - dark grey box 12 wide, 0.2 high, 0.2 deep at (0, -1, 0)
  const track = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);

  // Create runner - orange box 1 wide, 1 high, 0.5 deep at (-5, 0, 0)
  const runner = boxMesh([1, 1, 0.5], unlit("#f97316"));
  runner.name = "Runner";
  runner.position.set(-5, 0, 0);
  scene.add(runner);

  // State for the runner
  let isMoving = false;

  // Handle Space key to toggle movement
  host.onKeyDown("Space", () => {
    isMoving = !isMoving;
  });

  return {
    scene,
    camera,
    clearColor: "#202020",
    update(dt: number) {
      if (isMoving) {
        // Move runner at 4 world units per second
        runner.position.x += 4 * dt;

        // Wrap around: keep x in range [-6, 6)
        if (runner.position.x >= 6) {
          runner.position.x -= 12;
        }
      }
    },
  };
});
