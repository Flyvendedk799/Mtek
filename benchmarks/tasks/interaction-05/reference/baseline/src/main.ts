import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const LIMIT = 4.5;
const clampToPanel = (value: number): number => Math.max(-LIMIT, Math.min(LIMIT, value));

void startTask((host) => {
  const scene = new Scene();

  const panel = boxMesh([10, 10, 0.1], unlit("#2a2a2a"));
  panel.name = "Panel";
  panel.position.set(0, 0, -1);
  scene.add(panel);

  const marker = boxMesh([1, 1, 0.5], unlit("#38bdf8"));
  marker.name = "Marker";
  scene.add(marker);

  host.onInput("cursor", (value) => {
    if (!Array.isArray(value) || value.length !== 2 || value.some((v) => typeof v !== "number")) {
      throw new TypeError("cursor must be a pair of numbers [x, y]");
    }
    const [x, y] = value as [number, number];
    marker.position.set(clampToPanel(x), clampToPanel(y), 0);
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
