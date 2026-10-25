import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import {
  uniform,
  vec3,
  color,
  mix,
  sin,
  positionLocal,
  float,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  lookAtCamera,
  startTask,
  srgb,
  boxMesh,
} from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // Create the time uniform that will be updated each frame
  const timeUniform = uniform(0);

  // Create the custom material named "Sweep"
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";

  // Get the x coordinate from object-space position
  const x = positionLocal.x;
  const t = timeUniform;

  // Compute w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = float(0.5).add(
    float(0.5).mul(sin(float(0.8).mul(x).add(t)))
  );

  // Colors: A = #1a237e (dark blue), B = #ffb300 (orange)
  // Convert from sRGB to linear using the srgb helper
  const colorA = color(srgb("#1a237e"));
  const colorB = color(srgb("#ffb300"));

  // Blend: (1 - w) * A + w * B
  // This is equivalent to mix(A, B, w) which does A + (B - A) * w
  sweepMaterial.colorNode = mix(colorA, colorB, w);

  // Create the panel mesh at position (0.4, 0, 0) with size 4×2×0.2
  const panelGeometry = new BoxGeometry(4, 2, 0.2);
  const panel = new Mesh(panelGeometry, sweepMaterial);
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
      // Update the time uniform with accumulated elapsed time
      timeUniform.value += dt;
    },
  };
});
