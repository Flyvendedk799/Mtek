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

  // Track lamp states: true = on (yellow), false = off (dark grey)
  let lampAOn = false;
  let lampBOn = false;

  const updateLampColor = (lamp: typeof lampA, isOn: boolean) => {
    (lamp.material as any).color.setStyle(isOn ? "#ffd24a" : "#3a3a3a");
  };

  const toggleLamp = (isLampA: boolean) => {
    if (isLampA) {
      lampAOn = !lampAOn;
      updateLampColor(lampA, lampAOn);
    } else {
      lampBOn = !lampBOn;
      updateLampColor(lampB, lampBOn);
    }
  };

  const flipBothLamps = () => {
    lampAOn = !lampAOn;
    lampBOn = !lampBOn;
    updateLampColor(lampA, lampAOn);
    updateLampColor(lampB, lampBOn);
  };

  const turnBothOff = () => {
    lampAOn = false;
    lampBOn = false;
    updateLampColor(lampA, false);
    updateLampColor(lampB, false);
  };

  host.onKeyDown("KeyA", () => toggleLamp(true));
  host.onKeyDown("KeyB", () => toggleLamp(false));
  host.onKeyDown("Space", () => flipBothLamps());
  host.onKeyDown("Enter", () => turnBothOff());

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
