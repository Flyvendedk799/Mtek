import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  
  // Create track
  const track = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);
  
  // Create runner
  const runner = boxMesh([1, 1, 0.5], unlit("#f97316"));
  runner.name = "Runner";
  runner.position.set(-5, 0, 0);
  scene.add(runner);
  
  // State for runner movement
  let isMoving = false;
  
  // Space bar toggles movement
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
      far: 1000
    }),
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
