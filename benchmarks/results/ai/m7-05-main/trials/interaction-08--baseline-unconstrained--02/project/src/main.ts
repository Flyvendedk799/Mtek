import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Set clear color
  const clearColor = "#202020";
  
  // Create camera - orthographic with visible height 12.8
  const camera = orthographicCamera({
    position: [0, 0, 10],
    target: [0, 0, 0],
    height: 12.8,
    near: 0.1,
    far: 1000
  });
  
  // Create track (dark grey box: 12 wide, 0.2 high, 0.2 deep)
  const trackMaterial = unlit("#404040");
  const track = boxMesh([12, 0.2, 0.2], trackMaterial);
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);
  
  // Create runner (orange box: 1 wide, 1 high, 0.5 deep)
  const runnerMaterial = unlit("#f97316");
  const runner = boxMesh([1, 1, 0.5], runnerMaterial);
  runner.name = "Runner";
  runner.position.set(-5, 0, 0);
  scene.add(runner);
  
  // State management
  let isMoving = false;
  
  return {
    scene,
    camera,
    clearColor,
    update(dt: number) {
      if (isMoving) {
        // Move runner along +X at 4 units per second
        runner.position.x += 4 * dt;
        
        // Wrap around: when x >= 6, subtract 12
        if (runner.position.x >= 6) {
          runner.position.x -= 12;
        }
      }
    },
    onKeyDown() {
      // This will be set below via host.onKeyDown
    }
  };
});

// We need to use host.onKeyDown for Space key
void startTask((host) => {
  const scene = new Scene();
  
  // Set clear color
  const clearColor = "#202020";
  
  // Create camera - orthographic with visible height 12.8
  const camera = orthographicCamera({
    position: [0, 0, 10],
    target: [0, 0, 0],
    height: 12.8,
    near: 0.1,
    far: 1000
  });
  
  // Create track (dark grey box: 12 wide, 0.2 high, 0.2 deep)
  const trackMaterial = unlit("#404040");
  const track = boxMesh([12, 0.2, 0.2], trackMaterial);
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);
  
  // Create runner (orange box: 1 wide, 1 high, 0.5 deep)
  const runnerMaterial = unlit("#f97316");
  const runner = boxMesh([1, 1, 0.5], runnerMaterial);
  runner.name = "Runner";
  runner.position.set(-5, 0, 0);
  scene.add(runner);
  
  // State management
  let isMoving = false;
  
  // Handle Space bar toggle
  host.onKeyDown("Space", () => {
    isMoving = !isMoving;
  });
  
  return {
    scene,
    camera,
    clearColor,
    update(dt: number) {
      if (isMoving) {
        // Move runner along +X at 4 units per second
        runner.position.x += 4 * dt;
        
        // Wrap around: when x >= 6, subtract 12
        if (runner.position.x >= 6) {
          runner.position.x -= 12;
        }
      }
    }
  };
});
