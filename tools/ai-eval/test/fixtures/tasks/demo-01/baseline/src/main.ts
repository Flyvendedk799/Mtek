import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  const cube = boxMesh([1, 1, 1], unlit("#22c55e"));
  cube.name = "Cube";
  const marker = boxMesh([0.2, 0.2, 0.2], unlit("#ef4444"));
  marker.name = "Marker";
  let speed = 1;
  scene.add(cube, marker);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
    update(dt) {
      cube.rotation.y += speed * dt;
    },
  };
});
