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

  // Track lamp states: true = on, false = off
  let lampAOn = false;
  let lampBOn = false;

  const updateLampColor = (lamp: any, isOn: boolean) => {
    const material = lamp.material as any;
    material.color.setStyle(isOn ? "#ffd24a" : "#3a3a3a");
  };

  const toggleLamp = (isOn: boolean) => !isOn;

  host.onKeyDown("KeyA", () => {
    lampAOn = toggleLamp(lampAOn);
    updateLampColor(lampA, lampAOn);
  });

  host.onKeyDown("KeyB", () => {
    lampBOn = toggleLamp(lampBOn);
    updateLampColor(lampB, lampBOn);
  });

  host.onKeyDown("Space", () => {
    lampAOn = toggleLamp(lampAOn);
    lampBOn = toggleLamp(lampBOn);
    updateLampColor(lampA, lampAOn);
    updateLampColor(lampB, lampBOn);
  });

  host.onKeyDown("Enter", () => {
    lampAOn = false;
    lampBOn = false;
    updateLampColor(lampA, false);
    updateLampColor(lampB, false);
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
