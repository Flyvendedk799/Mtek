import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const ticker = boxMesh([1, 1, 0.5], unlit("#ef4444"));
  ticker.name = "Ticker";
  ticker.position.set(-5.5, 3, 0);
  scene.add(ticker);

  const glider = boxMesh([1, 1, 0.5], unlit("#38bdf8"));
  glider.name = "Glider";
  glider.position.set(-5.5, -3, 0);
  scene.add(glider);

  let fixedStepAccumulator = 0;
  const FIXED_STEP = 1 / 60;
  const MAX_TICKS_PER_FRAME = 4;
  const MAX_FRAME_DURATION = 0.1;

  const runFixedTick = () => {
    // Ticker moves 0.1 units per tick
    ticker.position.x += 0.1;
  };

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt: number) {
      // Clamp dt to max 0.1 s
      const clampedDt = Math.min(dt, MAX_FRAME_DURATION);

      // Glider moves 6 units per second
      glider.position.x += 6 * clampedDt;

      // Handle fixed steps
      fixedStepAccumulator += clampedDt;

      let ticksThisFrame = 0;
      while (fixedStepAccumulator >= FIXED_STEP && ticksThisFrame < MAX_TICKS_PER_FRAME) {
        runFixedTick();
        fixedStepAccumulator -= FIXED_STEP;
        ticksThisFrame++;
      }

      // If we hit the max ticks limit, drop any remaining whole steps
      if (ticksThisFrame >= MAX_TICKS_PER_FRAME) {
        const remainingSteps = Math.floor(fixedStepAccumulator / FIXED_STEP);
        fixedStepAccumulator -= remainingSteps * FIXED_STEP;
      }
    },
  };
});
