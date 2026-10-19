import { Scene, MeshBasicMaterial } from "three/webgpu";
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

  let lampAOn = false;
  let lampBOn = false;

  const updateLampColor = (lamp: typeof lampA, isOn: boolean) => {
    const material = lamp.material;
    if (material instanceof MeshBasicMaterial) {
      material.color.setStyle(isOn ? "#ffd24a" : "#3a3a3a");
    }
  };

  const toggleLampA = () => {
    lampAOn = !lampAOn;
    updateLampColor(lampA, lampAOn);
  };

  const toggleLampB = () => {
    lampBOn = !lampBOn;
    updateLampColor(lampB, lampBOn);
  };

  const flipBoth = () => {
    lampAOn = !lampAOn;
    lampBOn = !lampBOn;
    updateLampColor(lampA, lampAOn);
    updateLampColor(lampB, lampBOn);
  };

  const switchBothOff = () => {
    lampAOn = false;
    lampBOn = false;
    updateLampColor(lampA, false);
    updateLampColor(lampB, false);
  };

  host.onKeyDown("KeyA", toggleLampA);
  host.onKeyDown("KeyB", toggleLampB);
  host.onKeyDown("Space", flipBoth);
  host.onKeyDown("Enter", switchBothOff);

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
  };
});
