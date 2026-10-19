import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import {
  uniform,
  vec3,
  mix,
  sin,
  positionLocal,
  float,
  color,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // Create the custom material with color sweep
  const timeUniform = uniform(0);
  
  // Color A (#1a237e) and B (#ffb300) in linear space
  const colorA = color(srgb("#1a237e"));
  const colorB = color(srgb("#ffb300"));

  // Get x coordinate from local position
  const x = positionLocal.x;
  
  // Calculate w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = float(0.5).add(
    float(0.5).mul(sin(float(0.8).mul(x).add(timeUniform)))
  );

  // Blend: (1 - w) * A + w * B
  const blendedColor = mix(colorA, colorB, w);

  const material = new MeshBasicNodeMaterial();
  material.name = "Sweep";
  material.colorNode = blendedColor;

  // Create the panel box: 4 wide (x), 2 high (y), 0.2 deep (z)
  const geometry = new BoxGeometry(4, 2, 0.2);
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
    update(dt) {
      // Update elapsed time
      timeUniform.value += dt;
    },
  };
});
