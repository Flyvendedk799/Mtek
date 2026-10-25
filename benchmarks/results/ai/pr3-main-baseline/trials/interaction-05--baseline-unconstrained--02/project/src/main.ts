import { Scene } from "three/webgpu";
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

  const clamp = (value: number): number => {
    if (value < -4.5) return -4.5;
    if (value > 4.5) return 4.5;
    return value;
  };

  host.onInput("cursor", (value: unknown) => {
    if (Array.isArray(value) && value.length === 2) {
      const [x, y] = value as unknown as readonly [unknown, unknown];
      if (typeof x === "number" && typeof y === "number") {
        marker.position.x = clamp(x);
        marker.position.y = clamp(y);
      }
    }
  });

  host.onKeyDown("Space", () => {
    marker.position.x = 0;
    marker.position.y = 0;
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
