import { Scene, Mesh } from "three/webgpu";
import { uniform, sin, mix, positionLocal, float, color } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { BoxGeometry } from "three";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  
  // Create the custom Sweep material
  const timeUniform = uniform(0);
  
  // Convert sRGB colors to linear for the node material
  const colorA = srgb("#1a237e");
  const colorB = srgb("#ffb300");
  
  // Create the color node expression
  // w = 0.5 + 0.5 * sin(0.8 * x + t)
  // color = (1 - w) * A + w * B
  const xCoord = positionLocal.x;
  const w = float(0.5).add(
    sin(float(0.8).mul(xCoord).add(timeUniform)).mul(0.5)
  );
  
  const colorNode = mix(
    color(colorA),
    color(colorB),
    w
  );
  
  const sweepMaterial = new MeshBasicNodeMaterial();
  sweepMaterial.name = "Sweep";
  sweepMaterial.colorNode = colorNode;
  
  // Create the Panel box: 4 wide (x), 2 high (y), 0.2 deep (z)
  const panelGeometry = new BoxGeometry(4, 2, 0.2);
  const panel = new Mesh(panelGeometry, sweepMaterial);
  panel.name = "Panel";
  panel.position.set(0.4, 0, 0);
  scene.add(panel);
  
  // Create camera with specified parameters
  const camera = lookAtCamera({
    position: [0, 0, 6],
    target: [0, 0, 0],
    fovY: 0.9
  });
  
  let elapsedTime = 0;
  
  return {
    scene,
    camera,
    clearColor: "#202020",
    update(dt: number) {
      elapsedTime += dt;
      timeUniform.value = elapsedTime;
    }
  };
});
