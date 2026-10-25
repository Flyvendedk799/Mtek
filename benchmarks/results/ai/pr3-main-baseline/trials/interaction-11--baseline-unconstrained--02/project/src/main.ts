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

  const TICKER_SPEED = 0.1; // world units per tick
  const GLIDER_SPEED = 6; // world units per second

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    fixedUpdate() {
      // Move Ticker 0.1 world units per tick
      ticker.position.x += TICKER_SPEED;
    },
    update(dt: number) {
      // Move Glider based on frame time
      glider.position.x += GLIDER_SPEED * dt;
    },
  };
});
