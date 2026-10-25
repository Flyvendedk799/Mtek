import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const lampA = boxMesh([2, 2, 0.5], unlit("#3a3a3a"));
  lampA.name = "LampA";
  lampA.position.set(-3, 0, 0);
  scene.add(lampA);

  const lampB = boxMesh([2, 2, 0.5], unlit("#3a3a3a"));
  lampB.name = "LampB";
  lampB.position.set(3, 0, 0);
  scene.add(lampB);

  const colorOff = "#3a3a3a";
  const colorOn = "#ffd24a";

  let lampAOn = false;
  let lampBOn = false;

  const updateLampA = () => {
    const material = lampA.material as any;
    material.color.setStyle(lampAOn ? colorOn : colorOff);
  };

  const updateLampB = () => {
    const material = lampB.material as any;
    material.color.setStyle(lampBOn ? colorOn : colorOff);
  };

  host.onKeyDown("KeyA", () => {
    lampAOn = !lampAOn;
    updateLampA();
  });

  host.onKeyDown("KeyB", () => {
    lampBOn = !lampBOn;
    updateLampB();
  });

  host.onKeyDown("Space", () => {
    lampAOn = !lampAOn;
    lampBOn = !lampBOn;
    updateLampA();
    updateLampB();
  });

  host.onKeyDown("Enter", () => {
    lampAOn = false;
    lampBOn = false;
    updateLampA();
    updateLampB();
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
