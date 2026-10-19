import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uniform, vec3, color, mix, sin, positionLocal, float } from "three/tsl";
import { lookAtCamera, startTask, boxMesh, srgb } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  
  // Create the time uniform - starts at 0 and will be updated each frame
  const timeUniform = uniform(0);
  
  // Create the custom material named "Sweep"
  const material = new MeshBasicNodeMaterial();
  material.name = "Sweep";
  
  // Define colors A and B in sRGB, converted to linear
  const colorA = srgb("#1a237e");
  const colorB = srgb("#ffb300");
  
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
  
  // Compute color: (1 - w) * A + w * B
  // This is equivalent to: mix(A, B, w) in linear light
  material.colorNode = mix(colorA, colorB, w);
  
  // Create the panel box at (0.4, 0, 0) with size 4x2x0.2
  const panel = new Mesh(
    new BoxGeometry(4, 2, 0.2),
    material
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
      // Update the time uniform - accumulate elapsed time
      timeUniform.value += dt;
    },
  };
});
