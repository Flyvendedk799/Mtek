import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const frame = boxMesh([2.2, 5.6, 0.2], unlit("#334155"));
  frame.name = "Frame";
  frame.position.set(0, 0, -1);

  const fill = boxMesh([1.6, 1, 0.5], unlit("#22c55e"));
  fill.name = "Fill";

  scene.add(frame, fill);

  let level = 0.5;
  host.onKeyDown("ArrowUp", () => {
    level += 0.25;
  });
  host.onKeyDown("ArrowDown", () => {
    fill.scale.y = 1 + 4 * Math.max(level - 0.25, 0);
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 8, near: 0.1, far: 50 }),
    clearColor: "#101820",
    update() {
      fill.scale.y = 1 + 4 * level;
    },
  };
});
