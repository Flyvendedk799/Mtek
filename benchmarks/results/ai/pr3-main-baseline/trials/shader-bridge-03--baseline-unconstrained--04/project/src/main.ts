import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry } from "three";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uniform, vec3, positionLocal, sin, mix, float } from "three/tsl";

void startTask((host) => {
  const scene = new Scene();
  
  // Create the Sweep material
  const tUniform = uniform(0);
  
  // Color A: #1a237e (sRGB) -> linear
  const colorA = srgb("#1a237e");
  // Color B: #ffb300 (sRGB) -> linear
  const colorB = srgb("#ffb300");
  
  // Get object-space x coordinate
  const x = positionLocal.x;
  
  // Calculate w = 0.5 + 0.5 * sin(0.8 * x + t)
  const w = float(0.5).add(
    float(0.5).mul(
      sin(float(0.8).mul(x).add(tUniform))
    )
  );
  
  // Blend: (1 - w) * A + w * B
  const blendedColor = mix(colorA, colorB, w);
  
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";
  sweepMaterial.colorNode = blendedColor;
  
  // Create the panel box: 4 wide (x), 2 high (y), 0.2 deep (z)
  const panelGeometry = new BoxGeometry(4, 2, 0.2);
  const panel = new Mesh(panelGeometry, sweepMaterial);
  panel.name = "Panel";
  panel.position.set(0.4, 0, 0);
  scene.add(panel);
  
  // Create camera with fovY = 0.9 radians
  const camera = lookAtCamera({
    position: [0, 0, 6],
    target: [0, 0, 0],
    fovY: 0.9,
    near: 0.1,
    far: 1000
  });
  
  return {
    scene,
    camera,
    clearColor: "#202020",
    update(dt) {
      // Update the elapsed time uniform
      tUniform.value += dt;
    }
  };
});
