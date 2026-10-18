import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, srgb, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const YELLOW = "#ffd24a";
const RED = "#ef4444";
const LIMIT = 4;

void startTask((host) => {
  const scene = new Scene();

  const track = boxMesh([10, 0.2, 0.2], unlit("#404040"));
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);

  const material = unlit(YELLOW);
  const handle = boxMesh([0.8, 0.8, 0.5], material);
  handle.name = "Handle";
  scene.add(handle);

  const moveTo = (x: number): void => {
    handle.position.x = Math.max(-LIMIT, Math.min(LIMIT, x));
    material.color.copy(srgb(Math.abs(handle.position.x) === LIMIT ? RED : YELLOW));
  };

  host.onKeyDown("ArrowRight", () => moveTo(handle.position.x + 1));
  host.onKeyDown("ArrowLeft", () => moveTo(handle.position.x - 1));
  host.onKeyDown("Enter", () => moveTo(0));

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
