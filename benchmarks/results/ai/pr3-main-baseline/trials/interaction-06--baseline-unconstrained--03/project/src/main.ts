import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The counter the bar shows: the bar is `value` world units long, its left end stays at x = -6.
  const valueObject = { name: "value", current: 1 };

  const bar = boxMesh([1, 1, 0.5], unlit("#ffd24a"));
  bar.name = "Bar";
  scene.add(bar);

  // Key handlers to modify the counter
  host.onKeyDown("KeyD", () => {
    valueObject.current = Math.min(valueObject.current * 2, 8);
  });

  host.onKeyDown("KeyP", () => {
    valueObject.current = Math.min(valueObject.current + 3, 8);
  });

  host.onKeyDown("KeyR", () => {
    valueObject.current = 1;
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      bar.position.set(-6 + valueObject.current * 0.5, 0, 0);
      bar.scale.set(valueObject.current, 1, 1);
    },
  };
});
