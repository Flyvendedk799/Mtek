import { uniform, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // Shared level uniform, initially 0.25
  const level = uniform(0.25);

  // "Shade": a node material that draws a flat grey whose linear light value is determined by level.
  const shadeLeft = new MeshBasicNodeMaterial();
  shadeLeft.name = "Shade";
  shadeLeft.colorNode = vec3(level);
  
  const shadeRight = new MeshBasicNodeMaterial();
  shadeRight.name = "Shade";
  shadeRight.colorNode = vec3(level.oneMinus());

  const left = boxMesh([1, 1, 1], shadeLeft);
  left.name = "Left";
  left.position.set(-1.2, 0, 0);
  const right = boxMesh([1, 1, 1], shadeRight);
  right.name = "Right";
  right.position.set(1.2, 0, 0);
  scene.add(left, right);

  // Wire up host input to update level
  host.onInput("level", (value) => {
    if (typeof value === "number") {
      level.value = value;
    }
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
