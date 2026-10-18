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

  // How many pips are lit, from 0 to MAX_COUNT.
  let count = 0;

  host.onKeyDown("Space", () => {
    if (count < MAX_COUNT) {
      count += 1;
    }
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
    clearColor: "#202020",
    update() {
      pips.forEach((pip, index) => {
        pip.visible = count >= index + 1;
      });
    },
  };
});
