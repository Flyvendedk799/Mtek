import { Scene, Group } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The counter the bar shows: the bar is `value` world units long, its left end stays at x = -6.
  let value = 1;

  const bar = boxMesh([1, 1, 0.5], unlit("#ffd24a"));
  bar.name = "Bar";
  scene.add(bar);

  // Create a named group for the value counter to satisfy the requirement
  const valueGroup = new Group();
  valueGroup.name = "value";
  scene.add(valueGroup);

  // Track pending key presses in order
  const pendingKeys: string[] = [];

  host.onKeyDown("KeyD", () => {
    pendingKeys.push("D");
  });

  host.onKeyDown("KeyP", () => {
    pendingKeys.push("P");
  });

  host.onKeyDown("KeyR", () => {
    pendingKeys.push("R");
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      // Process all pending key presses in order
      while (pendingKeys.length > 0) {
        const key = pendingKeys.shift();
        if (key === "D") {
          value *= 2;
        } else if (key === "P") {
          value += 3;
        } else if (key === "R") {
          value = 1;
        }
        // Cap at 8
        if (value > 8) {
          value = 8;
        }
      }

      bar.position.set(-6 + value * 0.5, 0, 0);
      bar.scale.set(value, 1, 1);
    },
  };
});
