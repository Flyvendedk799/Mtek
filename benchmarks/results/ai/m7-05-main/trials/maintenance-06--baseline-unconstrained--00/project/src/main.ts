import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const MAX_COUNT = 5;

void startTask((host) => {
  const scene = new Scene();

  // Pip1 ... Pip5, left to right.
  const pips = Array.from({ length: MAX_COUNT }, (_, index) => {
    const pip = boxMesh([0.7, 0.7, 0.7], unlit("#22c55e"));
    pip.name = `Pip${index + 1}`;
    pip.position.set(-3 + 1.5 * index, -2, 0);
    scene.add(pip);
    return pip;
  });

  // Alarm lamp.
  const alarm = boxMesh([1, 1, 1], unlit("#ef4444"));
  alarm.name = "Alarm";
  alarm.position.set(0, 2, 0);
  scene.add(alarm);

  // How many pips are lit, from 0 to MAX_COUNT.
  let count = 0;

  host.onKeyDown("Space", () => {
    if (count < MAX_COUNT) {
      count += 1;
    }
  });

  host.onKeyDown("KeyR", () => {
    count = 0;
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
    clearColor: "#202020",
    update() {
      pips.forEach((pip, index) => {
        pip.visible = count >= index + 1;
      });
      alarm.visible = count === MAX_COUNT;
    },
  };
});
