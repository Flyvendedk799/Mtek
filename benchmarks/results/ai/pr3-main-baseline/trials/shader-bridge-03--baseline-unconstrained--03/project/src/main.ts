import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uniform, positionLocal, sin, mix, color } from "three/tsl";

void startTask(() => {
  const scene = new Scene();
  
  // Create the custom Sweep material
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";
  
  // Define the uniforms and shader logic
  // w = 0.5 + 0.5 * sin(0.8 * x + t)
  // color = (1 - w) * A + w * B
  const colorA = color(srgb("#1a237e"));
  const colorB = color(srgb("#ffb300"));
  
  // Create a uniform for elapsed time that we'll update each frame
  const elapsedTime = uniform(0);
  
  // Get x coordinate from object-space position
  const xCoord = positionLocal.x;
  
  // Calculate w: 0.5 + 0.5 * sin(0.8 * x + t)
  const w = sin(xCoord.mul(0.8).add(elapsedTime)).mul(0.5).add(0.5);
  
  // Blend: (1 - w) * A + w * B
  const finalColor = mix(colorA, colorB, w);
  
  sweepMaterial.colorNode = finalColor;
  
  // Create the panel box: 4 wide (x), 2 high (y), 0.2 deep (z)
  const panelGeometry = new BoxGeometry(4, 2, 0.2);
  const panel = new Mesh(panelGeometry, sweepMaterial);
  panel.name = "Panel";
  panel.position.set(0.4, 0, 0);
  
  scene.add(panel);
  
  let totalTime = 0;
  
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
    update(dt: number) {
      totalTime += dt;
      elapsedTime.value = totalTime;
    },
  };
});
