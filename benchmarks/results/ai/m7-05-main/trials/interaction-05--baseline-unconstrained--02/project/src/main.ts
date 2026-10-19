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
  scene.add(marker);

  const CLAMP_MIN = -4.5;
  const CLAMP_MAX = 4.5;

  host.onInput("cursor", (value: unknown) => {
    if (Array.isArray(value) && value.length === 2) {
      const x = MathUtils.clamp(value[0] as number, CLAMP_MIN, CLAMP_MAX);
      const y = MathUtils.clamp(value[1] as number, CLAMP_MIN, CLAMP_MAX);
      marker.position.set(x, y, 0);
    }
  });

  host.onKeyDown("Space", () => {
    marker.position.set(0, 0, 0);
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
