import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const postLeft = boxMesh([0.3, 1.6, 0.3], unlit("#64748b"));
  postLeft.name = "PostLeft";
  postLeft.position.set(-3.5, 0, 0);

  const postRight = boxMesh([0.3, 1.6, 0.3], unlit("#64748b"));
  postRight.name = "PostRight";
  postRight.position.set(3.5, 0, 0);

  const slider = boxMesh([0.8, 0.8, 0.8], unlit("#f97316"));
  slider.name = "Slider";
  slider.position.set(-2.5, 0, 0);

  scene.add(postLeft, postRight, slider);

  let moving = false;
  let direction = 1;
  host.onKeyDown("Space", () => {
    if (!moving) moving = true;
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 8, near: 0.1, far: 50 }),
    clearColor: "#0b1020",
    update(dt) {
      if (!moving) return;
      const target = direction * 2.5;
      const x = slider.position.x + direction * 2.5 * dt;
      if ((x - target) * direction >= 0) {
        slider.position.x = target;
        moving = false;
        direction = -direction;
      } else {
        slider.position.x = x;
      }
    },
  };
});
