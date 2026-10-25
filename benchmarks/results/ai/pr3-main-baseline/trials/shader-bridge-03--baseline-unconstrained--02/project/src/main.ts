import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uniform, sin, positionLocal, mix, color } from "three/tsl";
import { lookAtCamera, startTask, srgb, boxMesh } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  
  // Create the custom material
  const timeUniform = uniform(0);
  
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";
  
  // Get x coordinate from object space position
  const x = positionLocal.x;
  
  // Compute w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = sin(x.mul(0.8).add(timeUniform)).mul(0.5).add(0.5);
  
  // Convert sRGB colors to linear and blend
  const colorA = srgb("#1a237e");
  const colorB = srgb("#ffb300");
  
  // Blend: (1 - w) * A + w * B
  sweepMaterial.colorNode = mix(colorA, colorB, w);
  
  // Create the box geometry and mesh
  const geometry = new BoxGeometry(4, 2, 0.2);
  const panel = new Mesh(geometry, sweepMaterial);
  panel.name = "Panel";
  panel.position.set(0.4, 0, 0);
  
  scene.add(panel);
  
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0], fovY: 0.9 }),
    clearColor: "#202020",
    update(dt) {
      // Update elapsed time
      timeUniform.value += dt;
    },
  };
});
