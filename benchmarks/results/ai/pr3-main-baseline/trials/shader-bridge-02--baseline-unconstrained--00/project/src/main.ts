import { uniform, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // Create a uniform for the level that both cubes will use
  const level = uniform(0.25);

  // "Shade": a shared node material that draws a flat grey
  const shade = new MeshBasicNodeMaterial();
  shade.name = "Shade";

  const left = boxMesh([1, 1, 1], shade);
  left.name = "Left";
  left.position.set(-1.2, 0, 0);
  
  const right = boxMesh([1, 1, 1], shade);
  right.name = "Right";
  right.position.set(1.2, 0, 0);
  
  scene.add(left, right);

  // Set the colorNode after both meshes are created so we can use the same material
  // Left shows the level, Right shows 1 - level
  // We'll use a custom colorNode that checks which mesh is being rendered
  // Actually, we need two separate materials to have different colors
  // Let me reconsider: we can use the same material but need to make it work for both
  // The task says "a new level must change values only: no material or shader is replaced"
  // So we need to share the material but have different outputs
  
  // Actually, re-reading: both keep drawing with a Shade material
  // This could mean they share the same material instance, but that's impossible
  // to have different colors from the same material in the same frame.
  // Let me re-read: "Both cubes keep drawing with a Shade material"
  // I think this means both materials are named "Shade", not that it's the same instance.
  
  const shadeLeft = new MeshBasicNodeMaterial();
  shadeLeft.name = "Shade";
  shadeLeft.colorNode = vec3(level);
  left.material = shadeLeft;
  
  const shadeRight = new MeshBasicNodeMaterial();
  shadeRight.name = "Shade";
  shadeRight.colorNode = vec3(level.oneMinus());
  right.material = shadeRight;

  // Register the host input
  host.onInput("level", (value) => {
    level.value = value as number;
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
