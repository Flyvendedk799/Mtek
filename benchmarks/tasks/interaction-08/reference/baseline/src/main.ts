import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const SPEED = 4;
const RIGHT_END = 6;
const LAP = 12;

void startTask((host) => {
  const scene = new Scene();

  const track = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  track.name = "Track";
  track.position.set(0, -1, 0);
  scene.add(track);

  const runner = boxMesh([1, 1, 0.5], unlit("#f97316"));
  runner.name = "Runner";
  runner.position.set(-5, 0, 0);
  scene.add(runner);

  let moving = false;
  host.onKeyDown("Space", () => {
    moving = !moving;
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt) {
      if (!moving) return;
      let x = runner.position.x + SPEED * dt;
      if (x >= RIGHT_END) x -= LAP;
      runner.position.x = x;
    },
  };
});
