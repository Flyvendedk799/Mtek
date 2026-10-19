import { Scene, Group } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The counter the bar shows: the bar is `value` world units long, its left end stays at x = -6.
  let value = 1;

  const bar = boxMesh([1, 1, 0.5], unlit("#ffd24a"));
  bar.name = "Bar";
  scene.add(bar);

  // Create a Group to hold the value name (for scene.getObjectByName("value"))
  const valueObj = new Group();
  valueObj.name = "value";
  scene.add(valueObj);

  // Queue to store key operations in the order they are pressed
  const keyQueue: Array<() => void> = [];

  host.onKeyDown("KeyD", () => {
    keyQueue.push(() => {
      value = Math.min(value * 2, 8);
    });
  });

  host.onKeyDown("KeyP", () => {
    keyQueue.push(() => {
      value = Math.min(value + 3, 8);
    });
  });

  host.onKeyDown("KeyR", () => {
    keyQueue.push(() => {
      value = 1;
    });
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      // Process all queued key operations
      while (keyQueue.length > 0) {
        const operation = keyQueue.shift();
        operation?.();
      }

      bar.position.set(-6 + value * 0.5, 0, 0);
      bar.scale.set(value, 1, 1);
    },
  };
});
