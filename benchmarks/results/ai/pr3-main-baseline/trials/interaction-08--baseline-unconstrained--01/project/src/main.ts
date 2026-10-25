import { Scene, Mesh } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  
  // Create track
  const trackMaterial = unlit("#404040");
  const track = boxMesh([12, 0.2, 0.2], trackMaterial);
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);
  
  // Create runner
  const runnerMaterial = unlit("#f97316");
  const runner = boxMesh([1, 1, 0.5], runnerMaterial);
  runner.name = "Runner";
  runner.position.set(-5, 0, 0);
  scene.add(runner);
  
  // State: whether runner is moving
  let isMoving = false;
  
  // Handle Space key to toggle running state
  host.onKeyDown("Space", () => {
    isMoving = !isMoving;
  });
  
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
