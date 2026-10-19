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
  let spaceWasDown = false;
  let backspaceWasDown = false;

  host.onKeyDown("Space", () => {
    if (!spaceWasDown) {
      charge = Math.min(charge + 1, 4);
      level.value = charge / 4;
      spaceWasDown = true;
    }
  });

  host.onKeyUp("Space", () => {
    spaceWasDown = false;
  });

  host.onKeyDown("Backspace", () => {
    if (!backspaceWasDown) {
      charge = Math.max(charge - 1, 0);
      level.value = charge / 4;
      backspaceWasDown = true;
    }
  });

  host.onKeyUp("Backspace", () => {
    backspaceWasDown = false;
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
