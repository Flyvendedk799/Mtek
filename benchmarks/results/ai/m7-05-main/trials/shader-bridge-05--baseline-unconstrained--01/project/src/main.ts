import { uniform, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial, PointLight, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  // The lamp: its intensity is always twice the host input `power`.
  const lamp = new PointLight(0xffffff, 3);
  lamp.name = "Lamp";
  lamp.position.set(2, 3, 2);
  scene.add(lamp);

  // "Dial": a node material that draws a flat grey whose linear light value is the uniform `level`.
  const level = uniform(lamp.intensity / 10);
  const dial = new MeshBasicNodeMaterial();
  dial.name = "Dial";
  dial.colorNode = vec3(level);

  const indicator = boxMesh([1, 1, 1], dial);
  indicator.name = "Indicator";
  scene.add(indicator);

  host.onInput("power", (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("power must be a finite number");
    lamp.intensity = value * 2;
    level.value = lamp.intensity / 10;
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
