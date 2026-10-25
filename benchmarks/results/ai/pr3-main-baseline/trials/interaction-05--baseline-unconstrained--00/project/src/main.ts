import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";
import { MathUtils } from "three/webgpu";

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

  host.onInput("cursor", (value: unknown) => {
    if (Array.isArray(value) && value.length === 2) {
      const [x, y] = value as [number, number];
      marker.position.x = MathUtils.clamp(x, -4.5, 4.5);
      marker.position.y = MathUtils.clamp(y, -4.5, 4.5);
      marker.position.z = 0;
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
