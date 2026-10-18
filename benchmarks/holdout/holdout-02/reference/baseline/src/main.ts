import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  const arm = boxMesh([1, 1, 1], unlit("#f59e0b"));
  arm.name = "Arm";
  arm.position.set(1, -1, 0);
  arm.rotation.z = Math.PI / 2;
  arm.scale.set(2, 1, 1);

  const hand = boxMesh([0.5, 0.5, 0.5], unlit("#22d3ee"));
  hand.name = "Hand";
  hand.position.set(1, 0, 0);

  const spark = sphereMesh(0.4, unlit("#f472b6"));
  spark.name = "Spark";
  spark.position.set(0, 1, 0);

  hand.add(spark);
  arm.add(hand);
  scene.add(arm);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 8], target: [0, 0, 0], fovY: 0.9, near: 0.1, far: 100 }),
    clearColor: "#10141c",
  };
});
