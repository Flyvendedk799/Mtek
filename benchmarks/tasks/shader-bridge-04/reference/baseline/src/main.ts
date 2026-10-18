import { uniform, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

const MAX_CHARGE = 4;

void startTask((host) => {
  const scene = new Scene();

  // "Gauge": a node material that draws a flat grey whose linear light value is the uniform `level`.
  const level = uniform(0);
  const gauge = new MeshBasicNodeMaterial();
  gauge.name = "Gauge";
  gauge.colorNode = vec3(level);

  const meter = boxMesh([1, 1, 1], gauge);
  meter.name = "Meter";
  scene.add(meter);

  // The charge lives on the CPU; only its fraction reaches the shader, as a uniform value.
  let charge = 0;
  const show = (): void => {
    level.value = charge / MAX_CHARGE;
  };
  host.onKeyDown("Space", () => {
    if (charge < MAX_CHARGE) charge += 1;
    show();
  });
  host.onKeyDown("Backspace", () => {
    if (charge > 0) charge -= 1;
    show();
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
