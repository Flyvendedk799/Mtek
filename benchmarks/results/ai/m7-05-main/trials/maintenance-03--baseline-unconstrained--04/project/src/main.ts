import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const RISE = 0.5;

function sway(t: number, amplitude: number): number {
  return amplitude * Math.sin(t);
}

void startTask((host) => {
  const scene = new Scene();

  const bob = boxMesh([1, 1, 1], unlit("#ec4899"));
  bob.name = "Bob";
  scene.add(bob);

  // Seconds since the start.
  let elapsed = 0;
  // How many times Space has been pressed.
  let presses = 0;

  host.onKeyDown("Space", () => {
    presses += 1;
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
    clearColor: "#202020",
    update(dt) {
      elapsed += dt;
      bob.position.set(sway(elapsed, 2.0), RISE * presses, 0);
    },
  };
});
