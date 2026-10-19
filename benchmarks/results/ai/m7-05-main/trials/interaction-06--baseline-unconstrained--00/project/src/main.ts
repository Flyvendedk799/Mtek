import { Scene } from "three/webgpu";
import { uniform } from "three/tsl";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The counter the bar shows: the bar is `value` world units long, its left end stays at x = -6.
  const valueUniform = uniform(1);
  valueUniform.name = "value";

  const bar = boxMesh([1, 1, 0.5], unlit("#ffd24a"));
  bar.name = "Bar";
  scene.add(bar);

  // Queue for pending key presses
  const keyQueue: Array<() => void> = [];

  host.onKeyDown("KeyD", () => {
    keyQueue.push(() => {
      valueUniform.value = Math.min(valueUniform.value * 2, 8);
    });
  });

  host.onKeyDown("KeyP", () => {
    keyQueue.push(() => {
      valueUniform.value = Math.min(valueUniform.value + 3, 8);
    });
  });

  host.onKeyDown("KeyR", () => {
    keyQueue.push(() => {
      valueUniform.value = 1;
    });
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      // Process all queued key presses in order
      while (keyQueue.length > 0) {
        const action = keyQueue.shift();
        if (action) action();
      }

      bar.position.set(-6 + valueUniform.value * 0.5, 0, 0);
      bar.scale.set(valueUniform.value, 1, 1);
    },
  };
});
