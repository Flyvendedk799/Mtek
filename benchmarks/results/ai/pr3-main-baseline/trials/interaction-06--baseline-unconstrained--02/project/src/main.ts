import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The counter the bar shows: the bar is `value` world units long, its left end stays at x = -6.
  let value = 1;

  const barMaterial = unlit("#ffd24a");
  barMaterial.name = "value";
  const bar = boxMesh([1, 1, 0.5], barMaterial);
  bar.name = "Bar";
  scene.add(bar);

  // Handle key presses
  host.onKeyDown("KeyD", () => {
    value = Math.min(value * 2, 8);
  });

  host.onKeyDown("KeyP", () => {
    value = Math.min(value + 3, 8);
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
