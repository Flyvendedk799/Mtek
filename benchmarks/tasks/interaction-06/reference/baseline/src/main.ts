import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const MAX_VALUE = 8;

void startTask((host) => {
  const scene = new Scene();

  // The counter the bar shows: the bar is `value` world units long, its left end stays at x = -6.
  let value = 1;

  const bar = boxMesh([1, 1, 0.5], unlit("#ffd24a"));
  bar.name = "Bar";
  scene.add(bar);

  host.onKeyDown("KeyD", () => {
    value = Math.min(value * 2, MAX_VALUE);
  });
  host.onKeyDown("KeyP", () => {
    value = Math.min(value + 3, MAX_VALUE);
  });
  host.onKeyDown("KeyR", () => {
    value = 1;
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      bar.position.set(-6 + value * 0.5, 0, 0);
      bar.scale.set(value, 1, 1);
    },
  };
});
