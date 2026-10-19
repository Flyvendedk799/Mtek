import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The counter the bar shows: the bar is `value` world units long, its left end stays at x = -6.
  let value = 1;
  
  // Queue to track key presses in order within a frame
  const keyQueue: string[] = [];

  const bar = boxMesh([1, 1, 0.5], unlit("#ffd24a"));
  bar.name = "Bar";
  scene.add(bar);

  // Create a named object to hold the value property for tests to find
  const valueObject = { name: "value", current: value };

  host.onKeyDown("KeyD", () => {
    keyQueue.push("D");
  });

  host.onKeyDown("KeyP", () => {
    keyQueue.push("P");
  });

  host.onKeyDown("KeyR", () => {
    keyQueue.push("R");
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      // Process all queued key presses in order
      while (keyQueue.length > 0) {
        const key = keyQueue.shift();
        if (key === "D") {
          value = value * 2;
        } else if (key === "P") {
          value = value + 3;
        } else if (key === "R") {
          value = 1;
        }
        // Apply cap of 8
        if (value > 8) {
          value = 8;
        }
      }

      // Update the value object for tests
      valueObject.current = value;

      bar.position.set(-6 + value * 0.5, 0, 0);
      bar.scale.set(value, 1, 1);
    },
  };
});
