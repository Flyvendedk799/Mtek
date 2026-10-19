import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  uniform,
  vec3,
  positionLocal,
  sin,
  mix,
  float,
} from "three/tsl";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // Create the panel mesh
  const geometry = new BoxGeometry(4, 2, 0.2);
  
  // Create the Sweep material using TSL
  const timeUniform = uniform(0);
  
  // Define the color computation in TSL
  const material = new MeshBasicNodeMaterial();
  material.name = "Sweep";
  
  // Get x coordinate from object-space position
  const x = positionLocal.x;
  
  // w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = float(0.5).add(
    float(0.5).mul(sin(float(0.8).mul(x).add(timeUniform)))
  );
  
  // Colors in linear space
  const colorA = srgb("#1a237e"); // linear
  const colorB = srgb("#ffb300"); // linear
  
  // Blend: (1 - w) * A + w * B
  material.colorNode = mix(colorA, colorB, w);
  
  const panel = new Mesh(geometry, material);
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
      far: 1000,
    }),
    clearColor: "#202020",
    update(dt: number) {
      timeUniform.value += dt;
    },
  };
});
