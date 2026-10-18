import { color, mix, positionLocal, sin, uniform } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // "Sweep": a node material whose colour is computed per pixel from the object-space x and a time
  // uniform. Advancing the time changes the uniform's value only; the shader is built once.
  const time = uniform(0);
  const w = sin(positionLocal.x.mul(0.8).add(time)).mul(0.5).add(0.5);
  const sweep = new MeshBasicNodeMaterial();
  sweep.name = "Sweep";
  sweep.colorNode = mix(color(srgb("#1a237e")), color(srgb("#ffb300")), w);

  const panel = boxMesh([4, 2, 0.2], sweep);
  panel.name = "Panel";
  panel.position.set(0.4, 0, 0);
  scene.add(panel);

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
    update(dt) {
      time.value += dt;
    },
  };
});
