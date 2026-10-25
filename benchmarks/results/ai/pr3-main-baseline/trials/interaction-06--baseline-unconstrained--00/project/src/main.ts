import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The counter the bar shows: the bar is `value` world units long, its left end stays at x = -6.
  const counter = { value: 1, name: "value" };
  scene.userData.counter = counter;

  const bar = boxMesh([1, 1, 0.5], unlit("#ffd24a"));
  bar.name = "Bar";
  scene.add(bar);

  // Queue to hold pending key presses for this frame
  const keyQueue: Array<() => void> = [];

  host.onKeyDown("KeyD", () => {
    keyQueue.push(() => {
      counter.value = Math.min(counter.value * 2, 8);
    });
  });

  host.onKeyDown("KeyP", () => {
    keyQueue.push(() => {
      counter.value = Math.min(counter.value + 3, 8);
    });
  });

  host.onKeyDown("KeyR", () => {
    keyQueue.push(() => {
      counter.value = 1;
    });
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      // Process all queued key presses for this frame in order
      while (keyQueue.length > 0) {
        const action = keyQueue.shift();
        action?.();
      }

      // Update bar based on counter value
      bar.position.set(-6 + counter.value * 0.5, 0, 0);
      bar.scale.set(counter.value, 1, 1);
    },
  };
});
