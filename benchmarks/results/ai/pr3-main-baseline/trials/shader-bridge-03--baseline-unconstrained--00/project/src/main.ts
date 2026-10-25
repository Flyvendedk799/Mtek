import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uniform, positionLocal, sin, color, mix, float } from "three/tsl";
import { lookAtCamera, startTask, boxMesh, srgb } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  
  // Create the time uniform
  const timeUniform = uniform(0);
  
  // Create the custom Sweep material
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";
  
  // Get the x coordinate from object space position
  const x = positionLocal.x;
  
  // Compute w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = float(0.5).add(
    float(0.5).mul(
      sin(
        float(0.8).mul(x).add(timeUniform)
      )
    )
  );
  
  // Colors in sRGB converted to linear
  const colorA = srgb("#1a237e");
  const colorB = srgb("#ffb300");
  
  // Blend: (1 - w) * A + w * B, done in linear light
  sweepMaterial.colorNode = mix(colorA, colorB, w);
  
  // Create the panel box at (0.4, 0, 0)
  const panelGeometry = new BoxGeometry(4, 2, 0.2);
  const panel = new Mesh(panelGeometry, sweepMaterial);
  panel.name = "Panel";
  panel.position.set(0.4, 0, 0);
  scene.add(panel);
  
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0], fovY: 0.9, near: 0.1, far: 1000 }),
    clearColor: "#202020",
    update(dt) {
      // Accumulate elapsed time
      timeUniform.value += dt;
    },
  };
});
