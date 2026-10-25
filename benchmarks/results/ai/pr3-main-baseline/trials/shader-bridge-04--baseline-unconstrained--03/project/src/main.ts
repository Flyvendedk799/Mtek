import { uniform, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

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

  let charge = 0;

  host.onKeyDown("Space", () => {
    if (charge < 4) {
      charge++;
      level.value = charge / 4;
    }
  });

  host.onKeyDown("Backspace", () => {
    if (charge > 0) {
      charge--;
      level.value = charge / 4;
    }
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
