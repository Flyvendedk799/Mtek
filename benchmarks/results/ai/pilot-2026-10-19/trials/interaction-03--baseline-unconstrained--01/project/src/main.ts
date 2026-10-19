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
  let isLampAOn = false;
  let isLampBOn = false;

  const offColor = "#3a3a3a";
  const onColor = "#ffd24a";

  const updateLampColor = (lamp: typeof lampA, isOn: boolean) => {
    const material = lamp.material as any;
    material.color.setStyle(isOn ? onColor : offColor);
  };

  const toggleLamp = (isOn: boolean) => !isOn;

  host.onKeyDown("KeyA", () => {
    isLampAOn = toggleLamp(isLampAOn);
    updateLampColor(lampA, isLampAOn);
  });

  host.onKeyDown("KeyB", () => {
    isLampBOn = toggleLamp(isLampBOn);
    updateLampColor(lampB, isLampBOn);
  });

  host.onKeyDown("Space", () => {
    isLampAOn = toggleLamp(isLampAOn);
    isLampBOn = toggleLamp(isLampBOn);
    updateLampColor(lampA, isLampAOn);
    updateLampColor(lampB, isLampBOn);
  });

  host.onKeyDown("Enter", () => {
    isLampAOn = false;
    isLampBOn = false;
    updateLampColor(lampA, isLampAOn);
    updateLampColor(lampB, isLampBOn);
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
