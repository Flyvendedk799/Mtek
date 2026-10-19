import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The housing never changes.
  const housing = boxMesh([5, 5, 1], unlit("#4b5563"));
  housing.name = "Housing";
  scene.add(housing);

  // The bulb is a square plate in front of the housing; its edge is 1 + 2 * brightness.
  const bulb = boxMesh([2, 2, 0.2], unlit("#fde047"));
  bulb.name = "Bulb";
  bulb.position.set(0, 0, 1);
  scene.add(bulb);

  // The lamp's brightness from 0 (small) to 1 (large); the host page sets it.
  let brightness = 0.5;

  host.onKeyDown("Space", () => {
    brightness = 1;
  });
  host.onKeyDown("KeyD", () => {
    brightness = 0;
  });
  host.onInput("brightness", (value) => {
    if (typeof value !== "number") throw new TypeError("brightness must be a number");
    brightness = value;
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
    clearColor: "#202020",
    update() {
      bulb.scale.set(0.5 + brightness, 0.5 + brightness, 1);
    },
  };
});
