import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uniform, float, sin, mix, positionLocal, color } from "three/tsl";
import { lookAtCamera, startTask, srgb, boxMesh } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  
  // Create the time uniform that will be updated each frame
  const timeUniform = uniform(0);
  
  // Create the custom material
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";
  
  // Get the x coordinate from object-space position
  const xCoord = positionLocal.x;
  
  // Compute w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = float(0.5).add(
    float(0.5).mul(
      sin(float(0.8).mul(xCoord).add(timeUniform))
    )
  );
  
  // Define colors A and B
  const colorA = color(srgb("#1a237e"));
  const colorB = color(srgb("#ffb300"));
  
  // Blend: (1 - w) * A + w * B
  sweepMaterial.colorNode = mix(colorA, colorB, w);
  
  // Create the panel box
  const panel = new Mesh(
    new BoxGeometry(4, 2, 0.2),
    sweepMaterial
  );
  panel.name = "Panel";
  panel.position.set(0.4, 0, 0);
  scene.add(panel);
  
  return {
    scene,
    camera: lookAtCamera({
      position: [0, 0, 6],
      target: [0, 0, 0],
      fovY: 0.9,
      near: 0.1,
      far: 1000
    }),
    clearColor: "#202020",
    update(dt) {
      // Update the time uniform with accumulated time
      timeUniform.value += dt;
    },
  };
});
