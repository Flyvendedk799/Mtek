import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const small = boxMesh([0.5, 0.5, 0.5], unlit("#ef4444"));
  small.name = "Small";
  small.position.set(-2, 0, 0);

  const medium = boxMesh([1, 1, 1], unlit("#eab308"));
  medium.name = "Medium";
  const cap = sphereMesh(0.25, unlit("#f8fafc"));
  cap.name = "Cap";
  cap.position.set(0, 0.9, 0);
  medium.add(cap);

  const large = boxMesh([1.5, 1.5, 1.5], unlit("#a855f7"));
  large.name = "Large";
  large.position.set(2, 0, 0);

  scene.add(small, medium, large);
  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 6, near: 0.1, far: 50 }),
    clearColor: "#0b1220",
  };
});
