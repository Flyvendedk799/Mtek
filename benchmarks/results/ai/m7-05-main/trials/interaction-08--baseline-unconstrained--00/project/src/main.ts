import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // Camera: orthographic, visible height 12.8
  const camera = orthographicCamera({
    position: [0, 0, 10],
    target: [0, 0, 0],
    height: 12.8,
    near: 0.1,
    far: 1000,
  });

  // Track: 12 wide, 0.2 high, 0.2 deep at (0, -1, 0)
  const track = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  track.position.set(0, -1, 0);
  track.name = "Track";
  scene.add(track);

  // Runner: 1 wide, 1 high, 0.5 deep at (-5, 0, 0)
  const runner = boxMesh([1, 1, 0.5], unlit("#f97316"));
  runner.position.set(-5, 0, 0);
  runner.name = "Runner";
  scene.add(runner);

  // State for runner movement
  let isMoving = false;

  // Space key toggles movement
  host.onKeyDown("Space", () => {
    isMoving = !isMoving;
  });

  return {
    scene,
    camera,
    clearColor: "#202020",
    update(dt: number) {
      if (isMoving) {
        // Move runner at 4 units per second along +X
        runner.position.x += 4 * dt;
        
        // Wrap around: keep x in range [-6, 6)
        if (runner.position.x >= 6) {
          runner.position.x -= 12;
        }
      }
    },
  };
});
