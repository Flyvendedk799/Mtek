import { Scene, MathUtils } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const panel = boxMesh([10, 10, 0.1], unlit("#2a2a2a"));
  panel.name = "Panel";
  panel.position.set(0, 0, -1);
  scene.add(panel);

  const marker = boxMesh([1, 1, 0.5], unlit("#38bdf8"));
  marker.name = "Marker";
  marker.position.set(0, 0, 0);
  scene.add(marker);

  const CLAMP_MIN = -4.5;
  const CLAMP_MAX = 4.5;

  // Handle cursor input from host
  host.onInput("cursor", (value: unknown) => {
    if (Array.isArray(value) && value.length === 2) {
      const [x, y] = value as [number, number];
      marker.position.x = MathUtils.clamp(x, CLAMP_MIN, CLAMP_MAX);
      marker.position.y = MathUtils.clamp(y, CLAMP_MIN, CLAMP_MAX);
    }
  });

  // Handle Space bar to reset to center
  host.onKeyDown("Space", () => {
    marker.position.set(0, 0, 0);
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
