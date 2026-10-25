import { Scene } from "three/webgpu";
import { MathUtils } from "three/webgpu";
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

  // Clamp a coordinate to the valid range [-4.5, 4.5]
  const clampCoordinate = (value: number): number => {
    return MathUtils.clamp(value, -4.5, 4.5);
  };

  // Handle cursor input from the host
  host.onInput("cursor", (value: unknown) => {
    if (Array.isArray(value) && value.length === 2) {
      const [x, y] = value as [unknown, unknown];
      if (typeof x === "number" && typeof y === "number") {
        marker.position.x = clampCoordinate(x);
        marker.position.y = clampCoordinate(y);
        marker.position.z = 0;
      }
    }
  });

  // Handle Space key to reset marker to center
  host.onKeyDown("Space", () => {
    marker.position.set(0, 0, 0);
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
