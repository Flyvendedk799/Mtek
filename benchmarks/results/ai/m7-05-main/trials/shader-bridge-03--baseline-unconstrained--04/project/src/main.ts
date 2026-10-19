import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import {
  lookAtCamera,
  startTask,
  srgb,
  boxMesh,
} from "@mtek/benchmarks/baseline-support";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  positionLocal,
  sin,
  mix,
  float,
  color,
  time,
} from "three/tsl";

void startTask(() => {
  const scene = new Scene();

  // Create the custom Sweep material
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";

  // Get the x coordinate from object space position
  const x = positionLocal.x;

  // Compute w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = float(0.5).add(
    float(0.5).mul(
      sin(
        float(0.8).mul(x).add(time)
      )
    )
  );

  // Define colors from sRGB hex - color() converts from sRGB to linear
  const colorA = color("#1a237e");
  const colorB = color("#ffb300");

  // Blend: (1 - w) * A + w * B
  // mix does the blending in linear light, result is displayed as-is
  sweepMaterial.colorNode = mix(colorA, colorB, w);

  // Create the panel box at (0.4, 0, 0) with size 4x2x0.2
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
  };
});
