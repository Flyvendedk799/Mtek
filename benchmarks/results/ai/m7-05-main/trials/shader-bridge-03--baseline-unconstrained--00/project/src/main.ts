import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import {
  uniform,
  positionLocal,
  sin,
  mix,
  color,
  float,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  lookAtCamera,
  startTask,
  srgb,
} from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // Create the time uniform that will be updated each frame
  const timeUniform = uniform(0);

  // Create the custom Sweep material
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";

  // Get object-space x coordinate and time
  const xCoord = positionLocal.x;
  const t = timeUniform;

  // Compute w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = float(0.5).add(sin(xCoord.mul(0.8).add(t)).mul(0.5));

  // Convert sRGB colors to linear and create color nodes
  const colorA = color(srgb("#1a237e"));
  const colorB = color(srgb("#ffb300"));

  // Blend: (1 - w) * A + w * B
  const blendedColor = mix(colorA, colorB, w);

  // Set the color node
  sweepMaterial.colorNode = blendedColor;

  // Create the box geometry (width=4, height=2, depth=0.2)
  const geometry = new BoxGeometry(4, 2, 0.2);

  // Create the mesh
  const panel = new Mesh(geometry, sweepMaterial);
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
      // Update the time uniform with elapsed time
      timeUniform.value += dt;
    },
  };
});
