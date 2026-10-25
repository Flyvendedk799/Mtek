import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const cube = boxMesh([1, 1, 1], unlit("#6b5cff"));
  cube.name = "Cube";
  const marker = sphereMesh(0.15, unlit("#ef4444"));
  marker.name = "Marker";
  marker.position.set(0, 0, 0.75);
  cube.add(marker);
  scene.add(cube);

  const speed = 0.7;
  let angle = 0;
  let direction = 1;
  
  host.onKeyDown("Space", () => {
    direction *= -1;
  });
  
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
    update(dt) {
      angle += direction * speed * dt;
      cube.rotation.y = angle;
    },
  };
});
