import { BoxGeometry, Mesh, MeshBasicMaterial, Scene, Vector3 } from "three/webgpu";
import { lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  const geometry = new BoxGeometry(1, 1, 1);

  const left = new Mesh(geometry, new MeshBasicMaterial({ color: srgb("#f97316") }));
  left.name = "Left";
  left.position.set(-1.5, 0, 0);

  const right = new Mesh(geometry, new MeshBasicMaterial({ color: srgb("#14b8a6") }));
  right.name = "Right";
  right.position.copy(new Vector3(1.5, 0, 0));

  scene.add(left, right);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
