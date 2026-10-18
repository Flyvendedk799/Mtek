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

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
